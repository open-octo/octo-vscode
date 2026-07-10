import WebSocket from 'ws';

export interface OctoClientOptions {
  host: string;
  port: number;
  accessKey?: string;
}

export interface OctoSession {
  id: string;
  name: string;
  status?: string;
  workingDir?: string;
  // RFC3339 — sessionItem.CreatedAt is a Go time.Time, not a unix timestamp.
  createdAt?: string;
}

export interface OctoUserFile {
  name: string;
  dataUrl?: string;
  path?: string;
  mimeType?: string;
}

// ui_payload shapes, keyed by tool. Built ad hoc in ws_handlers.go's
// handleEvent (agent.EventToolDone -> "ui_payload": ev.UI), not declared as
// named structs in ws_types.go — these mirror internal/tools/edit_file.go,
// write_file.go, read_file.go, terminal.go, tasks.go's respective
// `ui := map[string]any{...}` literals, the actual (and only) source of
// truth for the field names.
export type UIPayload =
  | { type: 'edit'; path: string; occurrences: number; diff: string }
  | { type: 'write'; path: string; size_bytes: number; line_count: number; preview: string; preview_truncated: boolean }
  | { type: 'file_read'; path: string; lines_read: number; truncated: boolean; content_preview: string; total_lines?: number }
  | { type: 'terminal'; command: string; status: string; output_preview: string }
  // Task-tool checklist (tasks.go's taskUI). Rides a tool_result AND
  // triggers a standalone todo_update broadcast — see OctoEvent below.
  // No dedicated checklist widget yet: the tool's plain-text Text summary
  // still renders via tool_result.result, just not as a structured list.
  | { type: 'todo'; action: string; progress: string; todos: { content: string; status: string }[] };

// Mirrors what ws_handlers.go's handleEvent actually constructs and
// broadcasts during a live turn — NOT ws_types.go's named structs, several
// of which (wsEventOutput, wsEventDiff, wsEventFilePreview,
// wsEventShellPreview) are declared but never constructed anywhere in the
// server. Verified by grepping every `"type": "..."` literal actually
// broadcast, not by trusting the struct declarations.
//
// Text streams as text_delta (per-token), NOT "output" — "output" is dead
// code. At turn end, an assistant_message event carries the complete,
// aggregated content; it supersedes (replaces, not appends to) whatever
// text_delta had streamed, matching web/src/views/ChatView.svelte's own
// handling ("Frontend expects a complete assistant_message event rather
// than streaming text_delta fragments" — ws_handlers.go's comment on why
// the server sends it). thinking_delta is the same relationship for the
// reasoning trace, finalized into assistant_message.thinking.
//
// tool_call/tool_result/tool_error/tool_stdout all carry tool_id — added by
// handleEvent to the ad-hoc map[string]any it actually broadcasts;
// ws_types.go's named structs for these don't declare it, but it's the
// only reliable way to pair a result back to its call (no ordering
// guarantee otherwise). tool_call has no "summary" field — that was
// invented from the unused wsEventToolCall struct, never actually sent.
export type OctoEvent =
  // Sent on connect + refresh. NOT OctoSession-shaped: the wire's
  // wsSessionInfo carries created_at as a unix-ms number, unlike
  // sessionItem's RFC3339 string (OctoSession.createdAt) — currently
  // unconsumed, so left loose rather than mistyped.
  | { type: 'session_list'; sessions: unknown[] }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'assistant_message'; content: string; thinking?: string }
  | { type: 'history_user_message'; content: string; created_at?: number; images?: string[] }
  | { type: 'tool_call'; name: string; args: unknown; tool_id?: string }
  | { type: 'tool_result'; result: string; ui_payload?: UIPayload; tool_id?: string }
  | { type: 'tool_error'; error: string; tool_id?: string }
  | { type: 'tool_stdout'; lines: string[]; tool_id?: string }
  // Rides alongside a tool_result whose ui_payload.type is "todo" — same
  // todos list, broadcast standalone so a task-list panel doesn't have to
  // mine it out of tool_result. Currently unconsumed (no such panel yet).
  | { type: 'todo_update'; todos: { content: string; status: string }[] }
  // message is present only in the REST history-replay snapshot, never on
  // the live turn-start/re-seed broadcasts — those carry progress_type
  // ("thinking") instead, with no message text at all.
  | { type: 'progress'; message?: string; progress_type?: string; phase: string }
  | { type: 'complete'; iterations: number; awaiting_user_feedback?: boolean }
  // Redundant with assistant_message (both carry the final reply); never
  // acted on, kept here only so the type is documented rather than a
  // silent unknown.
  | { type: 'turn_done'; reply: { content: string } }
  | { type: 'session_update'; status?: string; context_usage?: number; context_tokens?: number; working_dir?: string; permission_mode?: string; reasoning_effort?: string }
  | { type: 'request_confirmation'; id: string; message: string; kind: string; tool_name?: string; command?: string; diff?: string; input?: string }
  // Another client (e.g. the Web UI, on the same session) already answered
  // this confirmation — close it here too instead of leaving a stale modal
  // that would double-answer if the user then clicked it.
  | { type: 'confirmation_complete'; id: string; result: string }
  | { type: 'request_user_question'; question_id: string; question: string; options: string[]; multi_select: boolean; header?: string }
  | { type: 'dismiss_user_question'; question_id: string }
  | { type: 'session_deleted'; session_id: string }
  | { type: 'session_activity'; session_id: string; kind: string }
  // REST history replay only (GET /api/sessions/{id}/messages) — an
  // intermediate tool-round's reasoning, standalone because that round has
  // no answer bubble of its own to attach it to. No live counterpart (live
  // streams thinking_delta and folds the final round's reasoning into
  // assistant_message.thinking instead). Currently unhandled: reasoning
  // display is already best-effort (show_reasoning is off by default), so
  // a toolless intermediate round's trace just doesn't render in replay.
  | { type: 'thinking'; text: string };

export interface OctoClientEvents {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onEvent?: (sessionId: string | undefined, event: OctoEvent) => void;
}

const RECONNECT_DELAY_MS = 1000;

/**
 * Thin WS+REST client for octo serve, held by the extension host (not the
 * webview) so the connection survives webview teardown/recreation. Talks the
 * protocol in internal/server/ws_types.go verbatim — no private dialect.
 */
export class OctoClient {
  private ws: WebSocket | null = null;
  private handlers: OctoClientEvents = {};
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closedByUser = false;
  private readonly baseUrl: string;
  // Sessions subscribe() has been asked to track — re-sent on every socket
  // open, not just the first. send() silently no-ops on a socket that isn't
  // OPEN yet (or has dropped), so without this a subscribe() call made
  // before the handshake finishes, or a reconnect after any drop, would
  // otherwise leave the session stuck with no live updates until something
  // else happens to call subscribe() again.
  private readonly activeSubscriptions = new Set<string>();

  constructor(private readonly options: OctoClientOptions) {
    this.baseUrl = `http://${options.host}:${options.port}`;
  }

  connect(handlers: OctoClientEvents): void {
    this.handlers = handlers;
    this.closedByUser = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(sessionId: string): void {
    this.activeSubscriptions.add(sessionId);
    this.send({ type: 'subscribe', session_id: sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.send({ type: 'unsubscribe', session_id: sessionId });
  }

  sendUserMessage(sessionId: string, content: string, files?: OctoUserFile[]): void {
    this.send({
      type: 'user_message',
      session_id: sessionId,
      content,
      ...(files?.length ? { files } : {}),
    });
  }

  interrupt(sessionId: string): void {
    this.send({ type: 'interrupt', session_id: sessionId });
  }

  confirm(id: string, result: string): void {
    this.send({ type: 'confirmation', id, result });
  }

  answerUserQuestion(questionId: string, choices: string[], custom: string, cancelled: boolean): void {
    this.send({ type: 'user_question_answer', question_id: questionId, choices, custom, cancelled });
  }

  async createSession(opts: { name?: string; workingDir?: string } = {}): Promise<OctoSession> {
    const body = await this.fetchJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: opts.name ?? '' }),
    });
    const record = body as { session?: Record<string, unknown> };
    if (!record.session) {
      throw new Error('octo serve: invalid session creation response');
    }
    const session = normalizeSession(record.session);
    if (opts.workingDir) {
      await this.setWorkingDir(session.id, opts.workingDir);
    }
    return session;
  }

  async listSessions(): Promise<OctoSession[]> {
    const body = (await this.fetchJson('/api/sessions')) as { sessions?: Record<string, unknown>[] };
    return (body.sessions ?? []).map(normalizeSession);
  }

  /** History replay events — see OctoEvent's doc comment for how this
   * vocabulary differs from the live stream (no session_id, no deltas). */
  async getSessionMessages(sessionId: string): Promise<OctoEvent[]> {
    const body = (await this.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)) as {
      events?: unknown[];
    };
    return (body.events ?? []) as OctoEvent[];
  }

  async setWorkingDir(sessionId: string, workingDir: string): Promise<void> {
    await this.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/working_dir`, {
      method: 'PATCH',
      body: JSON.stringify({ working_dir: workingDir }),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  private open(): void {
    if (this.ws) return;

    const url = this.wsUrl();
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.on('open', () => {
      for (const sessionId of this.activeSubscriptions) {
        this.send({ type: 'subscribe', session_id: sessionId });
      }
      this.handlers.onOpen?.();
    });

    socket.on('close', () => {
      this.ws = null;
      this.handlers.onClose?.();
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (err: Error) => this.handlers.onError?.(err));

    socket.on('message', (data: WebSocket.RawData) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        this.handlers.onError?.(new Error('octo serve: invalid WS message'));
        return;
      }
      const record = raw as Record<string, unknown>;
      const sessionId = typeof record.session_id === 'string' ? record.session_id : undefined;
      this.handlers.onEvent?.(sessionId, record as OctoEvent);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) {
        this.open();
      }
    }, RECONNECT_DELAY_MS);
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private wsUrl(): string {
    const suffix = this.options.accessKey ? `?access_key=${encodeURIComponent(this.options.accessKey)}` : '';
    return `ws://${this.options.host}:${this.options.port}/ws${suffix}`;
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
    const sep = path.includes('?') ? '&' : '?';
    const auth = this.options.accessKey ? `${sep}access_key=${encodeURIComponent(this.options.accessKey)}` : '';
    const res = await fetch(`${this.baseUrl}${path}${auth}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error');
      throw new Error(`octo serve: HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }
}

function normalizeSession(record: Record<string, unknown>): OctoSession {
  return {
    id: String(record.id ?? ''),
    name: String(record.name ?? ''),
    status: typeof record.status === 'string' ? record.status : undefined,
    workingDir: typeof record.working_dir === 'string' ? record.working_dir : undefined,
    createdAt: typeof record.created_at === 'string' ? record.created_at : undefined,
  };
}
