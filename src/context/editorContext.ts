import * as vscode from 'vscode';

export interface CapturedAttachment {
  label: string;
  block: string;
}

const MAX_FILE_BYTES = 100_000;

// vscode.window.activeTextEditor goes undefined the instant focus moves to
// any non-editor UI — including the chat panel's own composer, which is
// exactly when captureEditorContext() needs to know what the user was just
// looking at (its "or, when none has focus, the one that has changed input
// most recently" doc claim does not hold in practice once a webview has
// focus). Tracked independently via onDidChangeActiveTextEditor so a real
// editor's content is still the fallback instead of nothing at all.
let lastActiveEditor: vscode.TextEditor | undefined;

/** Call once during activation. */
export function trackActiveEditor(context: vscode.ExtensionContext): void {
  lastActiveEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) lastActiveEditor = editor;
    }),
  );
}

function currentEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor ?? lastActiveEditor;
}

/**
 * Captures the current (or last-focused, see currentEditor()) editor's
 * selection, formatted as a fenced code block plus any diagnostics
 * overlapping the selected range — the same red-squiggle errors the user
 * sees are what the agent sees. With no selection, falls back to the whole
 * open file (from the live editor buffer, so unsaved edits are included)
 * so there's always situational awareness of what the user is looking at,
 * matching the design doc's "当前选区/打开文件的内容" bullet — this covered
 * only the selection half until now. Returns null only when no editor has
 * ever been focused this session, or the underlying document read fails
 * (e.g. a stale reference to a since-closed tab).
 */
export function captureEditorContext(): CapturedAttachment | null {
  try {
    const editor = currentEditor();
    if (!editor) return null;

    const document = editor.document;
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);

    if (editor.selection.isEmpty) {
      const truncated = document.getText().length > MAX_FILE_BYTES;
      const text = truncated ? document.getText().slice(0, MAX_FILE_BYTES) : document.getText();
      const block = `Current file (${relativePath}):\n\`\`\`${document.languageId}\n${text}${truncated ? '\n… (truncated)' : ''}\n\`\`\``;
      return { label: relativePath, block };
    }

    const selection = editor.selection;
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const label = startLine === endLine ? `${relativePath}:${startLine}` : `${relativePath}:${startLine}-${endLine}`;

    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.range.intersection(selection) !== undefined);

    let block = `Selected code (${label}):\n\`\`\`${document.languageId}\n${document.getText(selection)}\n\`\`\``;
    if (diagnostics.length) {
      const lines = diagnostics.map(
        (d) => `- ${severityLabel(d.severity)}: ${d.message} (line ${d.range.start.line + 1})`,
      );
      block += `\nDiagnostics in this range:\n${lines.join('\n')}`;
    }

    return { label, block };
  } catch {
    return null;
  }
}

/**
 * Reads a workspace file for attachment, truncating past MAX_FILE_BYTES so
 * a large binary-ish or generated file can't blow up the turn's context.
 */
export async function readFileAttachment(uri: vscode.Uri): Promise<CapturedAttachment> {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const truncated = bytes.byteLength > MAX_FILE_BYTES;
  const text = new TextDecoder('utf-8').decode(truncated ? bytes.slice(0, MAX_FILE_BYTES) : bytes);
  const languageId = languageIdForPath(relativePath);

  const block = `Attached file: ${relativePath}\n\`\`\`${languageId}\n${text}${truncated ? '\n… (truncated)' : ''}\n\`\`\``;
  return { label: relativePath, block };
}

export function combineContext(attachments: CapturedAttachment[], text: string): string {
  if (!attachments.length) return text;
  return `${attachments.map((a) => a.block).join('\n\n')}\n\n---\n\n${text}`;
}

const FILE_PICKER_EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}';

/**
 * Native VS Code quick pick over workspace files — the `@`-mention affordance
 * from the design doc, implemented as a picker rather than an in-textarea
 * autocomplete popup (no custom fuzzy-search/positioning UI to build and
 * maintain; the quick pick already does fuzzy matching on the label).
 */
export async function pickWorkspaceFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.workspace.findFiles('**/*', FILE_PICKER_EXCLUDE, 2000);
  const items = uris
    .map((uri) => ({ label: vscode.workspace.asRelativePath(uri, false), uri }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Attach a file to the next message' });
  return picked?.uri;
}

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'hint';
  }
}

// Best-effort fence language from the file extension — good enough for
// syntax-highlighting a pasted snippet, not a substitute for VS Code's own
// language detection (which needs the file actually open in an editor).
function languageIdForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    go: 'go',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    java: 'java',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    css: 'css',
    html: 'html',
  };
  return known[ext] ?? '';
}
