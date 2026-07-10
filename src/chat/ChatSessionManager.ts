import * as vscode from 'vscode';

import { ConnectionController } from '../connection/ConnectionController';
import { OctoEvent, OctoSession, OctoUserFile } from '../octoClient/octoClient';

export interface HistoryLoaded {
  sessionId: string;
  events: OctoEvent[];
}

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

/**
 * Owns the chat session backing the sidebar webview: creates one lazily on
 * first use (bound to the workspace root), or switches to an existing one
 * via the session picker (ChatViewProvider). Filters the connection-wide
 * event stream down to whichever session is currently active before
 * handing events to the webview.
 */
export class ChatSessionManager {
  private sessionId: string | null = null;
  private sessionPromise: Promise<string> | null = null;

  private readonly eventEmitter = new vscode.EventEmitter<OctoEvent>();
  private readonly historyEmitter = new vscode.EventEmitter<HistoryLoaded>();
  readonly onEvent = this.eventEmitter.event;
  readonly onHistoryLoaded = this.historyEmitter.event;

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

  /** Sessions bound to the current workspace root — best-effort client-side
   * filter (no serve-side change), matching path strings modulo a trailing
   * separator. Sessions from other workspaces/sources (channel, cron) are
   * deliberately not surfaced here. */
  async listWorkspaceSessions(): Promise<OctoSession[]> {
    const all = await this.controller.listSessions();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return all;
    const normalizedRoot = normalizePath(root);
    return all.filter((s) => s.workingDir && normalizePath(s.workingDir) === normalizedRoot);
  }

  /** Switches the chat view to an existing session: unsubscribes from
   * whichever session was active, subscribes to the new one, and replays
   * its history so the webview can rebuild the transcript. */
  async switchToSession(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId) {
      this.controller.unsubscribe(this.sessionId);
    }
    this.sessionId = sessionId;
    this.sessionPromise = Promise.resolve(sessionId);
    this.controller.subscribe(sessionId);
    const events = await this.controller.getSessionMessages(sessionId);
    this.historyEmitter.fire({ sessionId, events });
  }

  /** Explicit "new session" action — distinct from the lazy creation in
   * ensureSession() so the picker's "+ New session" entry is immediate and
   * visible rather than waiting for the user's first message. */
  async startNewSession(): Promise<string> {
    if (this.sessionId) {
      this.controller.unsubscribe(this.sessionId);
    }
    const sessionId = await this.createAndBindSession();
    this.historyEmitter.fire({ sessionId, events: [] });
    return sessionId;
  }

  dispose(): void {
    this.eventEmitter.dispose();
    this.historyEmitter.dispose();
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (!this.sessionPromise) {
      this.sessionPromise = this.createAndBindSession().catch((err) => {
        this.sessionPromise = null;
        throw err;
      });
    }
    return this.sessionPromise;
  }

  private async createAndBindSession(): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const session = await this.controller.createSession({ name: 'VS Code', workingDir: workspaceFolder?.uri.fsPath });
    this.sessionId = session.id;
    this.sessionPromise = Promise.resolve(session.id);
    this.controller.subscribe(session.id);
    return session.id;
  }
}
