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
// write_file.go, read_file.go, terminal.go's respective `ui := map[string]any{...}`
// literals, the actual (and only) source of truth for the field names.
export type UIPayload =
  | { type: 'edit'; path: string; occurrences: number; diff: string }
  | { type: 'write'; path: string; size_bytes: number; line_count: number; preview: string; preview_truncated: boolean }
  | { type: 'file_read'; path: string; lines_read: number; truncated: boolean; content_preview: string; total_lines?: number }
  | { type: 'terminal'; command: string; status: string; output_preview: string };

// Mirrors the wsOutEvent union in internal/server/ws_types.go, PLUS the
// tool_id field that ws_handlers.go's handleEvent adds to the ad-hoc
// map[string]any it actually broadcasts for tool_call/tool_result/tool_error/
// tool_stdout — ws_types.go's named structs for those don't declare it, but
// the live wire payload (and the REST history replay in handlers.go) both
// include it, and it's the only reliable way to pair a result back to its
// call: these events carry no ordering guarantee beyond "eventually", so an
// order-based pairing breaks the moment two tool calls interleave.
export type OctoEvent =
  | { type: 'session_list'; sessions: OctoSession[] }
  | { type: 'output'; content: string }
  | { type: 'tool_call'; name: string; args: unknown; summary?: string; tool_id?: string }
  | { type: 'tool_result'; result: string; ui_payload?: UIPayload; tool_id?: string }
  | { type: 'tool_error'; error: string; tool_id?: string }
  | { type: 'tool_stdout'; lines: string[]; tool_id?: string }
  | { type: 'progress'; message?: string; progress_type?: string; phase: string }
  | { type: 'complete'; iterations: number; awaiting_user_feedback?: boolean }
  | { type: 'session_update'; status?: string; context_usage?: number; working_dir?: string }
  | { type: 'request_confirmation'; id: string; message: string; kind: string; tool_name?: string; command?: string; diff?: string; input?: string }
  | { type: 'request_user_question'; question_id: string; question: string; options: string[]; multi_select: boolean; header?: string }
  | { type: 'dismiss_user_question'; question_id: string }
  | { type: 'session_deleted'; session_id: string }
  | { type: 'session_activity'; session_id: string; kind: string };

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
    this.send({ type: 'subscribe', session_id: sessionId });
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

  async setWorkingDir(sessionId: string, workingDir: string): Promise<void> {
    await this.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/working_dir`, {
      method: 'PATCH',
      body: JSON.stringify({ working_dir: workingDir }),
    });
  }

  private open(): void {
    if (this.ws) return;

    const url = this.wsUrl();
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.on('open', () => this.handlers.onOpen?.());

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
