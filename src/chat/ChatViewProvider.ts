import * as fs from 'node:fs';

import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ConnectionController } from '../connection/ConnectionController';

// Messages the webview sends to the extension host.
type InboundMessage =
  | { command: 'ready' }
  | { command: 'send'; text: string }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  | { command: 'answerQuestion'; questionId: string; choices: string[]; custom: string; cancelled: boolean };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'octo.chatView';

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
      this.session.onEvent((event) => post({ command: 'event', event })),
      webviewView.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message, post)),
    ];
    webviewView.onDidDispose(() => {
      for (const sub of subscriptions) sub.dispose();
    });

    // The view may be recreated (hidden then shown again) without the
    // extension host restarting — resend the state the fresh webview missed.
    post({ command: 'connectionState', state: this.controller.getState() });
  }

  private handleMessage(message: InboundMessage, post: (message: unknown) => void): void {
    switch (message.command) {
      case 'ready':
        post({ command: 'connectionState', state: this.controller.getState() });
        break;
      case 'send':
        this.session.sendMessage(message.text).catch((err) => {
          post({ command: 'sendError', message: err instanceof Error ? err.message : String(err) });
        });
        break;
      case 'interrupt':
        this.session.interrupt();
        break;
      case 'confirm':
        this.session.confirm(message.id, message.result);
        break;
      case 'answerQuestion':
        this.session.answerUserQuestion(message.questionId, message.choices, message.custom, message.cancelled);
        break;
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
