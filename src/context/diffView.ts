import * as path from 'node:path';

import * as vscode from 'vscode';

const SCHEME = 'octo-diff';

class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.changeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

let provider: DiffContentProvider | undefined;
let counter = 0;

export function registerDiffContentProvider(context: vscode.ExtensionContext): void {
  provider = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider));
}

// Uri.from() takes path/query/fragment as separate structured fields rather
// than parsing one combined string — Uri.parse() on a template literal
// would misread a label containing '#' or '?' (a plausible file name, e.g.
// "notes (draft #2).md") as a fragment/query delimiter and silently
// truncate the path, pointing the diff view at the wrong content.
function virtualUri(id: number, side: 'before' | 'after', label: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${id}/${side}/${label}` });
}

interface EditDiffLines {
  before: string;
  after: string;
}

/**
 * Parses EditUIDiff's removed/added block ("- old\n- old2\n+ new\n+ new2")
 * back into old/new text. This is the server's own permission-ask and
 * tool-result preview format — a plain prefix-per-line block, not a unified
 * diff (no @@ hunks, no shared context lines) — so a straight prefix-strip
 * reconstructs it losslessly (modulo the server's own ~24-line/1600-char cap).
 */
function parseEditDiffBlock(diff: string): EditDiffLines {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('- ')) before.push(line.slice(2));
    else if (line.startsWith('+ ')) after.push(line.slice(2));
  }
  return { before: before.join('\n'), after: after.join('\n') };
}

/** Pre-execution: neither side is a real file yet, so both are virtual. */
export async function openEditDiffPreview(diff: string, label: string): Promise<void> {
  if (!provider) return;
  const { before, after } = parseEditDiffBlock(diff);
  const id = counter++;
  const beforeUri = virtualUri(id, 'before', label);
  const afterUri = virtualUri(id, 'after', label);
  provider.set(beforeUri, before);
  provider.set(afterUri, after);
  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `${label} (proposed edit)`, {
    preview: true,
    preserveFocus: true,
  });
}

/**
 * Post-execution: the edit already landed on disk, so the "after" side is
 * the real file (live, syntax-highlighted, editable) rather than a frozen
 * virtual snapshot — only "before" needs reconstructing from the diff text.
 */
export async function openEditDiffResult(diff: string, absPath: string): Promise<void> {
  if (!provider) return;
  const { before } = parseEditDiffBlock(diff);
  const id = counter++;
  const label = vscode.workspace.asRelativePath(vscode.Uri.file(absPath), false);
  const beforeUri = virtualUri(id, 'before', label);
  provider.set(beforeUri, before);
  await vscode.commands.executeCommand('vscode.diff', beforeUri, vscode.Uri.file(absPath), `${label} (applied edit)`, {
    preview: true,
    preserveFocus: true,
  });
}

/**
 * Resolves a tool-reported path for opening in the editor. edit_file/
 * write_file's ui_payload.path is always absolute; read_file's is the raw,
 * possibly-relative input path, resolved against the first workspace folder
 * (correct for this extension's sessions, which are always bound to the
 * workspace root — see ChatSessionManager.ensureSession).
 */
function resolveToolPath(toolPath: string): vscode.Uri {
  if (path.isAbsolute(toolPath)) {
    return vscode.Uri.file(toolPath);
  }
  const root = vscode.workspace.workspaceFolders?.[0];
  return root ? vscode.Uri.joinPath(root.uri, toolPath) : vscode.Uri.file(toolPath);
}

export async function openFileAtPath(path: string): Promise<void> {
  await vscode.window.showTextDocument(resolveToolPath(path), { preview: true, preserveFocus: false });
}

export async function openDiffFromWebview(diff: string, path: string | undefined): Promise<void> {
  if (path) {
    await openEditDiffResult(diff, path);
  } else {
    await openEditDiffPreview(diff, 'pending edit');
  }
}
