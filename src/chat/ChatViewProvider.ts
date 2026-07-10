import * as fs from 'node:fs';

import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ConnectionController } from '../connection/ConnectionController';
import { openDiffFromWebview, openEditDiffPreview, openEditDiffResult, openFileAtPath } from '../context/diffView';
import type { OctoEvent } from '../octoClient/octoClient';
import {
  captureSelectionContext,
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
  | { command: 'viewDiff'; diff: string; path?: string }
  | { command: 'listSessions' };

interface SessionPickItem extends vscode.QuickPickItem {
  // Undefined means "start a new session" — the sentinel first entry.
  sessionId?: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'octo.chatView';

  // Keyed by label (the relative path) so re-picking the same file just
  // refreshes its content rather than duplicating a chip. Lives on the
  // provider, not per resolveWebviewView call, so it survives the webview
  // being hidden and recreated before the user sends.
  private readonly pendingAttachments = new Map<string, CapturedAttachment>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ConnectionController,
    private readonly session: ChatSessionManager,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview, webviewRoot);

    const post = (message: unknown) => void webviewView.webview.postMessage(message);

    const subscriptions: vscode.Disposable[] = [
      this.controller.onStateChange((state) => post({ command: 'connectionState', state })),
      this.session.onEvent((event) => {
        post({ command: 'event', event });
        this.autoOpenDiff(event);
      }),
      this.session.onHistoryLoaded(({ sessionId, events }) => post({ command: 'history', sessionId, events })),
      webviewView.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message, post)),
    ];
    webviewView.onDidDispose(() => {
      for (const sub of subscriptions) sub.dispose();
    });

    // The view may be recreated (hidden then shown again) without the
    // extension host restarting — resend the state a fresh webview missed.
    post({ command: 'connectionState', state: this.controller.getState() });
    post({ command: 'attachments', labels: [...this.pendingAttachments.keys()] });
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
      case 'listSessions':
        void this.showSessionPicker();
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
   * and a just-applied edit_file result (the acceptance bar this milestone
   * is built against — "agent 改文件时在编辑器里看到原生 diff"). Both use
   * preview:true/preserveFocus:true so successive edits reuse one tab
   * rather than piling up new ones and never steal focus from the sidebar.
   */
  private autoOpenDiff(event: OctoEvent): void {
    if (event.type === 'request_confirmation' && event.diff) {
      void openEditDiffPreview(event.diff, event.tool_name ?? 'pending edit');
    } else if (event.type === 'tool_result' && event.ui_payload?.type === 'edit') {
      void openEditDiffResult(event.ui_payload.diff, event.ui_payload.path);
    }
  }

  /**
   * Native quick pick over sessions bound to the current workspace, plus a
   * "+ New session" entry — reachable from the webview's Sessions button
   * and the octo.switchSession command. Not a custom list UI: the sidebar
   * is too narrow to usefully compete with the chat transcript for space,
   * and quick pick already does fuzzy search over the list.
   */
  async showSessionPicker(): Promise<void> {
    try {
      const sessions = await this.session.listWorkspaceSessions();
      const items: SessionPickItem[] = [
        { label: '$(add) New session', alwaysShow: true },
        ...sessions.map((s) => ({
          label: s.name || 'Untitled',
          description: s.status,
          detail: s.id === this.session.getSessionId() ? 'current' : undefined,
          sessionId: s.id,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Switch octo session' });
      if (!picked) return;
      if (picked.sessionId) {
        await this.session.switchToSession(picked.sessionId);
      } else {
        await this.session.startNewSession();
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`octo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private send(text: string, post: (message: unknown) => void): void {
    const attachments = [...this.pendingAttachments.values()];
    const selection = captureSelectionContext();
    if (selection) attachments.push(selection);

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
