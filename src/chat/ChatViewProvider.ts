import * as fs from 'node:fs';

import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ConnectionController } from '../connection/ConnectionController';
import { openDiffFromWebview, openEditDiffPreview, openEditDiffResult, openFileAtPath } from '../context/diffView';
import type { AskAnswer, AskOutcome, OctoEvent } from '../octoClient/octoClient';
import {
  captureEditorContext,
  captureSelection,
  combineContext,
  currentEditorLabel,
  pickWorkspaceFile,
  readFileAttachment,
  type CapturedAttachment,
} from '../context/editorContext';

/** An image pasted into the composer (webview protocol.ts's OutboundFile). */
type OutboundFile = { name: string; dataUrl: string };

// Messages the webview sends to the extension host.
type InboundMessage =
  | { command: 'ready' }
  | {
      command: 'send';
      text: string;
      files?: OutboundFile[];
      /** Run after the turn in flight rather than steering it. */
      queue?: boolean;
      /** A command the server applies inline — send the text verbatim. */
      inline?: boolean;
    }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  // One message per question SET: the picker submits all answers at once.
  | { command: 'answerQuestion'; questionId: string; outcome: AskOutcome; answers: AskAnswer[] }
  | { command: 'pickFile' }
  | { command: 'removeAttachment'; label: string }
  | { command: 'openFile'; path: string }
  | { command: 'viewDiff'; diff: string; path?: string };

/**
 * The chat surface: a WebviewView living in the Activity Bar container next
 * to the session list, the way VS Code's own chat sits. It used to be a
 * WebviewPanel opened Beside the editor, which cost an editor tab to hold a
 * conversation and put the chat in competition with the code it was about.
 *
 * VS Code owns this view's lifecycle: it constructs the webview on first
 * reveal and may tear it down and call resolveWebviewView again after the
 * view has been hidden for a while, so everything per-webview is wired in
 * resolve() and torn down on the view's dispose — nothing is assumed to
 * survive (the composer's unsent draft survives via the webview's own
 * getState/setState, which is exactly what it's for).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'octo.chatView';

  // Keyed by label (the relative path) so re-picking the same file just
  // refreshes its content rather than duplicating a chip.
  private readonly pendingAttachments = new Map<string, CapturedAttachment>();
  private readonly subscriptions: vscode.Disposable[] = [];
  // Label of the editor context auto-attached on the last send. The current
  // open file rides along as fallback context only when the user pinned
  // nothing explicit — but re-sending that same file on every subsequent
  // message is pure duplication (the agent already has it from the first
  // send), so we skip it while the label is unchanged. Reset on session
  // switch so a fresh transcript re-establishes "what am I looking at".
  private lastAutoAttachedLabel: string | null = null;

  /** Brings the chat view into focus, resolving it if VS Code has not built
   * it yet. `.focus` is contributed for every view id; awaiting it is what
   * guarantees resolveWebviewView has run before the caller posts anything. */
  static async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ConnectionController,
    private readonly session: ChatSessionManager,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [webviewRoot] };
    view.webview.html = this.buildHtml(view.webview, webviewRoot);

    // Swallows: postMessage rejects once VS Code has torn the webview down,
    // and every caller here is fire-and-forget by nature (the webview asks for
    // whatever it needs again on its next 'ready').
    const post = (message: unknown) => void Promise.resolve(view.webview.postMessage(message)).catch(() => {});
    const postActiveFile = () => post({ command: 'activeFile', label: this.activeFileLabel() });
    this.subscriptions.push(
      this.controller.onStateChange((state) => {
        post({ command: 'connectionState', state });
        if (state === 'connected') void this.postSkills(post);
      }),
      this.session.onEvent((event) => {
        post({ command: 'event', event });
        this.autoOpenDiff(event);
      }),
      this.session.onHistoryLoaded(({ sessionId, events }) => {
        // New/switched transcript — let the current file auto-attach once more,
        // and re-show the composer's context indicator that dedupe had hidden.
        this.lastAutoAttachedLabel = null;
        post({ command: 'history', sessionId, events });
        post({ command: 'activeFile', label: this.activeFileLabel() });
        void this.postSessionInfo(post, sessionId);
      }),
      // octo auto-titles a session after its first turn and broadcasts the
      // name globally — the header would otherwise keep saying "New session"
      // for the rest of the conversation.
      this.controller.onEvent(({ event }) => {
        if (event.type === 'session_renamed' && event.session_id === this.session.getSessionId()) {
          post({ command: 'sessionInfo', sessionId: event.session_id, name: event.name });
        }
      }),
      view.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message, post)),
      // Keep the composer's "current file" indicator in lock-step with what
      // captureEditorContext() would attach when nothing is pinned.
      vscode.window.onDidChangeActiveTextEditor(() => postActiveFile()),
      // Selecting lines in the editor auto-pins them as a removable chip — no
      // command or shortcut, the selection itself is the gesture. postActiveFile
      // too so the bottom indicator hides the moment the first chip appears.
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.captureSelectionAttachment(post);
        postActiveFile();
      }),
    );
    view.onDidDispose(() => {
      for (const sub of this.subscriptions) sub.dispose();
      this.subscriptions.length = 0;
    });

    post({ command: 'connectionState', state: this.controller.getState() });
    post({ command: 'attachments', labels: [] });
    // Skills are not posted here: these posts race the webview's script load,
    // and the 'ready' handshake below re-sends them for exactly that reason.
  }

  dispose(): void {
    for (const sub of this.subscriptions) sub.dispose();
    this.subscriptions.length = 0;
  }

  /** The "/" menu's non-builtin half. Best-effort: the menu still lists the
   * built-ins if the server can't be reached. */
  private async postSkills(post: (message: unknown) => void): Promise<void> {
    try {
      const skills = await this.controller.listSkills();
      post({ command: 'skills', skills: skills.map((s) => ({ name: s.name, description: s.description })) });
    } catch {
      // see doc comment
    }
  }

  private async postSessionInfo(post: (message: unknown) => void, sessionId: string): Promise<void> {
    post({ command: 'sessionInfo', sessionId, name: await this.session.sessionName(sessionId) });
  }

  private handleMessage(message: InboundMessage, post: (message: unknown) => void): void {
    switch (message.command) {
      case 'ready':
        post({ command: 'connectionState', state: this.controller.getState() });
        post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
        post({ command: 'activeFile', label: this.activeFileLabel() });
        // The posts made in resolveWebviewView race the webview's own script
        // load, so this handshake — the first moment it is provably listening
        // — is where anything it can't ask for again is (re)sent.
        void this.postSkills(post);
        // A freshly (re)built webview starts empty; replay the active
        // session's history, which also re-sends the header's session info.
        void this.session.replayCurrentHistory();
        break;
      case 'send':
        this.send(message, post);
        break;
      case 'interrupt':
        this.guard(post, () => this.session.interrupt());
        break;
      case 'confirm':
        this.guard(post, () => this.session.confirm(message.id, message.result));
        break;
      case 'answerQuestion':
        this.guard(post, () =>
          this.session.answerUserQuestion(message.questionId, message.outcome, message.answers),
        );
        break;
      case 'pickFile':
        this.pickFile(post);
        break;
      case 'removeAttachment':
        this.pendingAttachments.delete(message.label);
        post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
        break;
      case 'openFile':
        void openFileAtPath(message.path, this.diffColumn());
        break;
      case 'viewDiff':
        void openDiffFromWebview(message.diff, message.path, this.diffColumn());
        break;
    }
  }

  // ConnectionController's action methods throw synchronously when there's
  // no live client (e.g. the confirmation modal is still up but the server
  // dropped) — without this, that throw would escape onDidReceiveMessage
  // uncaught instead of surfacing to the user via the usual sendError path.
  private guard(post: (message: unknown) => void, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      post({ command: 'sendError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Renders a diff natively the moment it's actionable, without waiting for
   * a click: a pending edit_file permission ask (so the user can actually
   * see what they're approving, not just the modal's plain-text preview),
   * and a just-applied edit_file result. Both use preview:true/
   * preserveFocus:true so successive edits reuse one tab rather than
   * piling up new ones and never steal focus from the chat view.
   */
  private autoOpenDiff(event: OctoEvent): void {
    if (event.type === 'request_confirmation' && event.diff) {
      void openEditDiffPreview(event.diff, event.tool_name ?? 'pending edit', this.diffColumn());
    } else if (event.type === 'tool_result' && event.ui_payload?.type === 'edit') {
      void openEditDiffResult(event.ui_payload.diff, event.ui_payload.path, this.diffColumn());
    }
  }

  // Where diffs and opened files land. Now that the chat lives in the
  // Activity Bar rather than an editor group, there is no group to avoid:
  // the active one is exactly where the user is looking, and opening there
  // can no longer bury the conversation.
  private diffColumn(): vscode.ViewColumn {
    return vscode.ViewColumn.Active;
  }

  // A selection auto-pins itself as a chip; a same-file selection replaces
  // the file's previous chip rather than stacking (so dragging out a range
  // updates the line numbers instead of piling up), while a different file's
  // selection accumulates alongside — that's how cross-file references build
  // up. Empty selections are ignored: chips are snapshots, so clicking away
  // (or ×-ing a chip) doesn't make one reappear until the user selects anew.
  private captureSelectionAttachment(post: (message: unknown) => void): void {
    const selection = captureSelection();
    if (!selection) return;

    const filePath = selection.label.split(':')[0];
    for (const key of [...this.pendingAttachments.keys()]) {
      if (key === filePath || key.startsWith(`${filePath}:`)) this.pendingAttachments.delete(key);
    }
    this.pendingAttachments.set(selection.label, selection);
    post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
  }

  // The current file/selection label for the composer's context indicator, or
  // null to hide it: hidden once that same context has already auto-attached
  // (it won't ride along again until the user moves to a different file), so
  // the indicator no longer implies a re-send that won't happen.
  private activeFileLabel(): string | null {
    const label = currentEditorLabel();
    return label === this.lastAutoAttachedLabel ? null : label;
  }

  private send(
    message: { text: string; files?: OutboundFile[]; queue?: boolean; inline?: boolean },
    post: (message: unknown) => void,
  ): void {
    const { text, files } = message;
    // A command the server applies inline (/clear, /compact, /reload, /goal)
    // is matched against the WHOLE trimmed message. Appending the open file to
    // it — which every other message gets — turns it into an ordinary prompt:
    // the session isn't cleared, a full turn runs, and the webview (which
    // rendered no bubble and set no busy state for it) shows a reply out of
    // nowhere. It also must not consume the user's pinned attachments, which
    // are for the message they are still composing.
    if (message.inline) {
      this.session.sendMessage(text).catch((err) => {
        post({ command: 'sendError', message: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

    const attachments = [...this.pendingAttachments.values()];
    // Only fall back to auto-capturing the whole current file when the user
    // has pinned nothing explicit — an explicit selection/file reference means
    // "use exactly this", not "this plus whatever file happens to be focused".
    // And only when it differs from what last auto-attached: re-sending the
    // same open file on every message just duplicates context the agent
    // already has (switching to a different file/selection attaches anew).
    if (!attachments.length) {
      const editorContext = captureEditorContext();
      if (editorContext && editorContext.label !== this.lastAutoAttachedLabel) {
        attachments.push(editorContext);
        this.lastAutoAttachedLabel = editorContext.label;
      }
    }

    this.pendingAttachments.clear();
    post({ command: 'attachments', labels: [] });
    // Hide the composer's "In <file>" indicator now that this file has ridden
    // along — activeFileLabel() returns null once it matches lastAutoAttachedLabel.
    post({ command: 'activeFile', label: this.activeFileLabel() });
    if (attachments.length) {
      post({ command: 'contextAttached', labels: attachments.map((a) => a.label) });
    }

    this.session
      .sendMessage(
        combineContext(attachments, text),
        files?.map((f) => ({ name: f.name, dataUrl: f.dataUrl })),
        message.queue,
      )
      .catch((err) => {
        post({ command: 'sendError', message: err instanceof Error ? err.message : String(err) });
      });
  }

  private async pickFile(post: (message: unknown) => void): Promise<void> {
    const uri = await pickWorkspaceFile();
    if (!uri) return;
    try {
      const attachment = await readFileAttachment(uri);
      this.pendingAttachments.set(attachment.label, attachment);
      post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
    } catch (err) {
      post({ command: 'sendError', message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private buildHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const indexPath = vscode.Uri.joinPath(webviewRoot, 'index.html').fsPath;
    let html: string;
    try {
      html = fs.readFileSync(indexPath, 'utf8');
    } catch {
      return `<html><body style="font-family:sans-serif;padding:16px">
        <p>octo webview assets not found. Run <code>npm run build</code> (which builds both the
        extension host and <code>webview/</code>) before launching the Extension Development Host.</p>
      </body></html>`;
    }

    // Vite is configured with base: './' so every asset reference in the
    // built HTML is relative (./assets/...) — rewrite those to the webview
    // URI scheme the CSP below actually allows.
    const assetBase = webview.asWebviewUri(webviewRoot).toString();
    html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_match, attr, rel) => `${attr}="${assetBase}/${rel}"`);

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);

    return html;
  }
}
