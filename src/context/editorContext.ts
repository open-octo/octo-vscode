import * as vscode from 'vscode';

/**
 * One piece of editor context riding along with a message.
 *
 * A whole file is referenced BY PATH, never by content: the session's octo
 * project mounts the workspace, so the agent reads what it needs with its own
 * tools, and pasting a file into every prompt just burns the context window on
 * text the agent may not even need. A selection is the exception — the
 * selected lines ARE the message, and no path can express "these ones".
 *
 * The same split the obsidian client makes (<linked_note> / <context_files>
 * carry paths; <editor_selection> carries text).
 */
export type AttachmentKind = 'current' | 'file' | 'selection';

export interface CapturedAttachment {
  /** Workspace-relative — for the composer chip and the transcript, never for
   * the agent. */
  label: string;
  kind: AttachmentKind;
  /** Absolute. A project's working directory is octo's own generated
   * workspace and the repository is mounted into it, so a relative path
   * leaves the model searching the filesystem for the file. */
  path: string;
  /** 'selection' only: the selected text and any diagnostics over it. */
  block?: string;
}

/** Caps a selection — the one thing here that still carries text. Someone can
 * always select a whole generated file. */
const MAX_SELECTION_BYTES = 100_000;

// vscode.window.activeTextEditor goes undefined the instant focus moves to
// any non-editor UI — including the chat view's own composer, which is
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

// The label captureEditorContext() would attach for this editor: bare
// relative path when nothing is selected, path:line(-line) for a selection.
// Shared so the composer's live indicator can't drift from what actually
// gets sent.
function labelFor(editor: vscode.TextEditor): string {
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  if (editor.selection.isEmpty) return relativePath;
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  return startLine === endLine ? `${relativePath}:${startLine}` : `${relativePath}:${startLine}-${endLine}`;
}

/**
 * The label of the file/selection that captureEditorContext() would attach
 * right now, or null when no editor has ever been focused this session.
 * Drives the composer's "current file" indicator so the user can see, before
 * sending, exactly what editor context is riding along.
 */
export function currentEditorLabel(): string | null {
  const editor = currentEditor();
  return editor ? labelFor(editor) : null;
}

/**
 * Snapshots the current (or last-focused, see currentEditor()) editor's
 * non-empty selection as a fenced code block plus any diagnostics
 * overlapping the selected range — the same red-squiggle errors the user
 * sees are what the agent sees. Returns null when there's no editor or the
 * selection is empty, so callers can tell "user has actually selected some
 * lines" apart from "just has a file open". The label (path:line(-line))
 * doubles as the composer chip caption.
 */
export function captureSelection(): CapturedAttachment | null {
  try {
    const editor = currentEditor();
    if (!editor || editor.selection.isEmpty) return null;

    const document = editor.document;
    const selection = editor.selection;
    const label = labelFor(editor);

    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.range.intersection(selection) !== undefined);

    const selected = document.getText(selection);
    const text = selected.length > MAX_SELECTION_BYTES ? `${selected.slice(0, MAX_SELECTION_BYTES)}\n… (truncated)` : selected;
    const lineAttr = label.includes(':') ? ` lines="${label.slice(label.indexOf(':') + 1)}"` : '';
    let block = `<editor_selection path="${document.uri.fsPath}"${lineAttr}>\n\`\`\`${document.languageId}\n${text}\n\`\`\``;
    if (diagnostics.length) {
      const lines = diagnostics.map(
        (d) => `- ${severityLabel(d.severity)}: ${d.message} (line ${d.range.start.line + 1})`,
      );
      block += `\nDiagnostics in this range:\n${lines.join('\n')}`;
    }
    block += '\n</editor_selection>';

    return { label, kind: 'selection', path: document.uri.fsPath, block };
  } catch {
    return null;
  }
}

/**
 * The auto-context fallback used only when the user has pinned no explicit
 * references: the current selection if there is one, otherwise the whole
 * open file (from the live editor buffer, so unsaved edits are included) so
 * there's always situational awareness of what the user is looking at.
 * Returns null only when no editor has ever been focused this session, or
 * the underlying document read fails (e.g. a stale reference to a
 * since-closed tab).
 */
export function captureEditorContext(): CapturedAttachment | null {
  const selection = captureSelection();
  if (selection) return selection;
  try {
    const editor = currentEditor();
    if (!editor) return null;

    const document = editor.document;
    return {
      label: vscode.workspace.asRelativePath(document.uri, false),
      kind: 'current',
      path: document.uri.fsPath,
    };
  } catch {
    return null;
  }
}

/**
 * References a workspace file for attachment. Nothing is read: the agent has
 * the file mounted and its own tools to read it with, and a path costs a line
 * of context instead of a whole file.
 */
export function fileAttachment(uri: vscode.Uri): CapturedAttachment {
  return { label: vscode.workspace.asRelativePath(uri, false), kind: 'file', path: uri.fsPath };
}

/**
 * Builds the prompt: what the user typed, then the context after it, in XML
 * blocks the agent can tell apart from the message. Paths are absolute
 * throughout — see CapturedAttachment.path.
 */
export function combineContext(attachments: CapturedAttachment[], text: string): string {
  if (!attachments.length) return text;

  const parts: string[] = [];
  const current = attachments.find((a) => a.kind === 'current');
  if (current) {
    parts.push(`<current_file>\n${current.path}\n</current_file>`);
  }
  const files = attachments.filter((a) => a.kind === 'file');
  if (files.length) {
    parts.push(`<context_files>\n${files.map((a) => a.path).join('\n')}\n</context_files>`);
  }
  for (const selection of attachments) {
    if (selection.kind === 'selection' && selection.block) parts.push(selection.block);
  }
  return [text, ...parts].join('\n\n');
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
