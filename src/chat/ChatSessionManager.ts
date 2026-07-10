import * as vscode from 'vscode';

import { ConnectionController } from '../connection/ConnectionController';
import { OctoEvent, OctoSession, OctoUserFile } from '../octoClient/octoClient';

export interface HistoryLoaded {
  sessionId: string;
  events: OctoEvent[];
}

const LAST_SESSION_KEY = 'octo.lastSessionId';

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

/**
 * Owns the chat session backing the detail panel (ChatPanel): creates one
 * lazily on first use (bound to the workspace root), switches to an
 * existing one via the sidebar's session list, or restores whichever
 * session was active last time this workspace was open. Filters the
 * connection-wide event stream down to whichever session is currently
 * active before handing events to the webview.
 */
export class ChatSessionManager {
  private sessionId: string | null = null;
  private sessionPromise: Promise<string> | null = null;

  private readonly eventEmitter = new vscode.EventEmitter<OctoEvent>();
  private readonly historyEmitter = new vscode.EventEmitter<HistoryLoaded>();
  readonly onEvent = this.eventEmitter.event;
  readonly onHistoryLoaded = this.historyEmitter.event;

  // workspaceState, not the webview's local storage: the transcript is
  // rebuilt from the server's own history on restore (via switchToSession),
  // which stays correct even if other clients touched the session while
  // this one wasn't running — a cached copy of the rendered transcript
  // could not make that guarantee.
  constructor(
    private readonly controller: ConnectionController,
    private readonly workspaceState: vscode.Memento,
  ) {
    controller.onEvent(({ sessionId, event }) => {
      if (this.sessionId && sessionId === this.sessionId) {
        this.eventEmitter.fire(event);
      }
    });
    // Covers both an automatic reconnect after a drop (activeSubscriptions
    // in octoClient.ts already replays for that case, so this is a no-op)
    // and an explicit octo.reconnect (a brand-new OctoClient with no memory
    // of prior subscriptions, which otherwise leaves the active session
    // getting no live updates until something else calls subscribe()).
    controller.onStateChange((state) => {
      if (state === 'connected' && this.sessionId) {
        this.controller.subscribe(this.sessionId);
      }
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Rehydrates whichever session was active last time this workspace was
   * open, if the connection is up and that session still exists. Silently
   * does nothing otherwise (a fresh install, a deleted session, or a
   * failed connection all just leave the lazy create-on-first-message path
   * in place, same as before this existed). */
  async restoreLastSession(): Promise<void> {
    const lastId = this.workspaceState.get<string>(LAST_SESSION_KEY);
    if (!lastId) return;
    try {
      await this.switchToSession(lastId);
    } catch {
      void this.workspaceState.update(LAST_SESSION_KEY, undefined);
    }
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
   * whichever session was active, fetches its history, THEN subscribes —
   * in that order. Subscribing first would open a window where a live
   * event for the new session (plausible: another client, e.g. the Web
   * UI, could be mid-turn on it) arrives and renders before the history
   * response comes back; loadHistory()'s unconditional `blocks = []` would
   * then wipe it out. octo-agent's own web/src/views/ChatView.svelte hit
   * this exact ordering bug and fixed it the same way (its comment: "Subscribe
   * only after history renders"). */
  async switchToSession(sessionId: string): Promise<void> {
    await this.controller.ready();
    if (this.sessionId && this.sessionId !== sessionId) {
      this.controller.unsubscribe(this.sessionId);
    }
    const events = await this.controller.getSessionMessages(sessionId);
    this.sessionId = sessionId;
    this.sessionPromise = Promise.resolve(sessionId);
    void this.workspaceState.update(LAST_SESSION_KEY, sessionId);
    this.historyEmitter.fire({ sessionId, events });
    this.controller.subscribe(sessionId);
  }

  /** Explicit "new session" action — distinct from the lazy creation in
   * ensureSession() so the picker's "+ New session" entry is immediate and
   * visible rather than waiting for the user's first message. */
  async startNewSession(): Promise<string> {
    await this.controller.ready();
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
    void this.workspaceState.update(LAST_SESSION_KEY, session.id);
    this.controller.subscribe(session.id);
    return session.id;
  }
}
