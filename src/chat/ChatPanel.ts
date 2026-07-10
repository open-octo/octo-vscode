import * as fs from 'node:fs';

import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ConnectionController } from '../connection/ConnectionController';
import { openDiffFromWebview, openEditDiffPreview, openEditDiffResult, openFileAtPath } from '../context/diffView';
import type { OctoEvent } from '../octoClient/octoClient';
import {
  captureEditorContext,
  combineContext,
  pickWorkspaceFile,
  readFileAttachment,
  type CapturedAttachment,
} from '../context/editorContext';

// Messages the webview sends to the extension host.
type InboundMessage =
  | { command: 'ready' }
  | { command: 'send'; text: string }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  | { command: 'answerQuestion'; questionId: string; choices: string[]; custom: string; cancelled: boolean }
  | { command: 'pickFile' }
  | { command: 'removeAttachment'; label: string }
  | { command: 'openFile'; path: string }
  | { command: 'viewDiff'; diff: string; path?: string };

/**
 * The chat detail surface: a WebviewPanel opened beside the active editor
 * group (ViewColumn.Beside), not the Activity Bar sidebar — the sidebar
 * holds only the session list (SessionListProvider), which has no room and
 * no need for a composer. One panel instance is reused across
 * openNew()/openSession() calls rather than stacking a tab per session.
 */
export class ChatPanel {
  private static current: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  // Keyed by label (the relative path) so re-picking the same file just
  // refreshes its content rather than duplicating a chip.
  private readonly pendingAttachments = new Map<string, CapturedAttachment>();
  private readonly subscriptions: vscode.Disposable[] = [];

  static async openNew(
    extensionUri: vscode.Uri,
    controller: ConnectionController,
    session: ChatSessionManager,
  ): Promise<void> {
    ChatPanel.ensurePanel(extensionUri, controller, session).reveal();
    await session.startNewSession();
  }

  static async openSession(
    extensionUri: vscode.Uri,
    controller: ConnectionController,
    session: ChatSessionManager,
    sessionId: string,
  ): Promise<void> {
    ChatPanel.ensurePanel(extensionUri, controller, session).reveal();
    if (sessionId !== session.getSessionId()) {
      await session.switchToSession(sessionId);
    }
  }

  private static ensurePanel(
    extensionUri: vscode.Uri,
    controller: ConnectionController,
    session: ChatSessionManager,
  ): ChatPanel {
    ChatPanel.current ??= new ChatPanel(extensionUri, controller, session);
    return ChatPanel.current;
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly controller: ConnectionController,
    private readonly session: ChatSessionManager,
  ) {
    const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
    this.panel = vscode.window.createWebviewPanel('octo.chat', 'octo', vscode.ViewColumn.Beside, {
      enableScripts: true,
      // A background chat panel losing its JS state (and reloading, with a
      // visible flash) every time the user clicks back to an editor tab
      // would be a much worse experience than the memory cost of keeping it
      // alive — WebviewView doesn't need this (VS Code already retains
      // sidebar view content on simple visibility toggles), but
      // WebviewPanel defaults the other way.
      retainContextWhenHidden: true,
      localResourceRoots: [webviewRoot],
    });
    this.panel.webview.html = this.buildHtml(this.panel.webview, webviewRoot);

    const post = (message: unknown) => void this.panel.webview.postMessage(message);
    this.subscriptions.push(
      controller.onStateChange((state) => post({ command: 'connectionState', state })),
      session.onEvent((event) => {
        post({ command: 'event', event });
        this.autoOpenDiff(event);
      }),
      session.onHistoryLoaded(({ sessionId, events }) => post({ command: 'history', sessionId, events })),
      this.panel.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message, post)),
    );
    this.panel.onDidDispose(() => {
      for (const sub of this.subscriptions) sub.dispose();
      ChatPanel.current = undefined;
    });

    post({ command: 'connectionState', state: controller.getState() });
    post({ command: 'attachments', labels: [] });
  }

  private reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private handleMessage(message: InboundMessage, post: (message: unknown) => void): void {
    switch (message.command) {
      case 'ready':
        post({ command: 'connectionState', state: this.controller.getState() });
        post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
        break;
      case 'send':
        this.send(message.text, post);
        break;
      case 'interrupt':
        this.guard(post, () => this.session.interrupt());
        break;
      case 'confirm':
        this.guard(post, () => this.session.confirm(message.id, message.result));
        break;
      case 'answerQuestion':
        this.guard(post, () =>
          this.session.answerUserQuestion(message.questionId, message.choices, message.custom, message.cancelled),
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
        void openFileAtPath(message.path);
        break;
      case 'viewDiff':
        void openDiffFromWebview(message.diff, message.path);
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
   * piling up new ones and never steal focus from the chat panel.
   */
  private autoOpenDiff(event: OctoEvent): void {
    if (event.type === 'request_confirmation' && event.diff) {
      void openEditDiffPreview(event.diff, event.tool_name ?? 'pending edit');
    } else if (event.type === 'tool_result' && event.ui_payload?.type === 'edit') {
      void openEditDiffResult(event.ui_payload.diff, event.ui_payload.path);
    }
  }

  private send(text: string, post: (message: unknown) => void): void {
    const attachments = [...this.pendingAttachments.values()];
    const editorContext = captureEditorContext();
    if (editorContext) attachments.push(editorContext);

    this.pendingAttachments.clear();
    post({ command: 'attachments', labels: [] });
    if (attachments.length) {
      post({ command: 'contextAttached', labels: attachments.map((a) => a.label) });
    }

    this.session.sendMessage(combineContext(attachments, text)).catch((err) => {
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
