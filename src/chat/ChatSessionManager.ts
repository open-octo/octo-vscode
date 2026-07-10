import * as vscode from 'vscode';

import { ConnectionController } from '../connection/ConnectionController';
import { OctoEvent, OctoUserFile } from '../octoClient/octoClient';

/**
 * Owns the single chat session backing the sidebar webview: creates it
 * lazily on first use (bound to the workspace root), subscribes to its
 * events, and filters the connection-wide event stream down to just this
 * session before handing events to the webview.
 */
export class ChatSessionManager {
  private sessionId: string | null = null;
  private sessionPromise: Promise<string> | null = null;

  private readonly eventEmitter = new vscode.EventEmitter<OctoEvent>();
  readonly onEvent = this.eventEmitter.event;

  constructor(private readonly controller: ConnectionController) {
    controller.onEvent(({ sessionId, event }) => {
      if (this.sessionId && sessionId === this.sessionId) {
        this.eventEmitter.fire(event);
      }
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async sendMessage(text: string, files?: OctoUserFile[]): Promise<void> {
    const sessionId = await this.ensureSession();
    this.controller.sendUserMessage(sessionId, text, files);
  }

  interrupt(): void {
    if (this.sessionId) this.controller.interrupt(this.sessionId);
  }

  confirm(id: string, result: string): void {
    this.controller.confirm(id, result);
  }

  answerUserQuestion(questionId: string, choices: string[], custom: string, cancelled: boolean): void {
    this.controller.answerUserQuestion(questionId, choices, custom, cancelled);
  }

  dispose(): void {
    this.eventEmitter.dispose();
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (!this.sessionPromise) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      this.sessionPromise = this.controller
        .createSession({ name: 'VS Code', workingDir: workspaceFolder?.uri.fsPath })
        .then((session) => {
          this.sessionId = session.id;
          this.controller.subscribe(session.id);
          return session.id;
        })
        .catch((err) => {
          this.sessionPromise = null;
          throw err;
        });
    }
    return this.sessionPromise;
  }
}
