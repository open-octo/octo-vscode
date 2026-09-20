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
  // Same shape as createdAt. sessionItem.UpdatedAt is ContentUpdatedAt when the
  // session has one (see toSessionItem's comment) — i.e. last real message, not
  // bookkeeping writes — which is what the sidebar's ordering wants.
  updatedAt?: string;
  // A turn this session is blocked on, waiting for an answer from any client.
  // The sidebar badges these so a session parked on a question is findable
  // without opening each one.
  pendingQuestion?: boolean;
  pendingConfirmation?: boolean;
  // 0-100, sessionItem.ContextUsage.
  contextUsage?: number;
}

/**
 * An octo "project": a group of sessions sharing a workspace directory and a
 * set of mounted source folders. A session's working directory comes from its
 * project — see createSession's groupId.
 */
export interface OctoSessionGroup {
  id: string;
  name: string;
  /** The project's own generated workspace — never one of the mounted folders. */
  workingDir?: string;
  /** External folders mounted as extra roots for the tools. */
  sourceDirs: string[];
  /** Members, in the order the server holds them. */
  sessionIds: string[];
}

/** One entry of GET /api/skills — the "/" menu's non-builtin half. */
export interface OctoSkill {
  name: string;
  description: string;
  enabled: boolean;
}

/** An attachment riding along with a user message. Mirrors ws_types.go's
 * wsUserFile — the wire keys are snake_case, applied in sendUserMessage. */
export interface OctoUserFile {
  name: string;
  /** Inline base64 data URL (images). */
  dataUrl?: string;
  /** A real absolute path on this machine — honored only for a loopback peer,
   * which is the only kind this extension ever talks to. No upload: the agent
   * reads the file in place. */
  localPath?: string;
}

// ui_payload shapes, keyed by tool. Built ad hoc in ws_handlers.go's
// handleEvent (agent.EventToolDone -> "ui_payload": ev.UI), not declared as
// named structs in ws_types.go — these mirror internal/tools/edit_file.go,
// write_file.go, read_file.go, terminal.go, tasks.go's respective
// `ui := map[string]any{...}` literals, the actual (and only) source of
// truth for the field names.
/** One choice of an ask_user_question question. */
export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
}

/** One question of an ask_user_question set. */
export interface AskQuestion {
  question: string;
  header: string;
  multi_select?: boolean;
  options?: AskOption[];
}

/** How the user left the picker. */
export type AskOutcome = 'submitted' | 'clarify' | 'rejected';

/** One question's answer on the wire. */
export interface AskAnswer {
  choices: string[];
  custom: string;
  notes: string;
}

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
  // 1-4 questions per call; the picker walks them as tabs. Options keep
  // label/description/preview apart so the client can render the label
  // prominently and switch to the two-column preview layout.
  | { type: 'request_user_question'; question_id: string; questions: AskQuestion[]; secret?: boolean }
  | { type: 'dismiss_user_question'; question_id: string }
  | { type: 'session_deleted'; session_id: string }
  // Broadcast globally the moment any client creates a session (handlers.go's
  // handleCreateSession, plus branch/cron) — the sidebar's cue to re-list.
  | { type: 'session_created'; session_id: string }
  // Transient, client-facing notice (wsToast). The inline slash commands
  // (/clear, /compact, /reload, /goal) report ONLY through this — they run no
  // turn, so nothing else would tell the user what happened.
  | { type: 'toast'; message: string; level?: string }
  // "Re-fetch this session's history from REST" — sent after /clear and
  // /compact rewrite the transcript server-side.
  | { type: 'history_reload' }
  // The message never reached a turn (session gone, draining, binding held by
  // another client that can't be forced). Nothing else arrives after it, so
  // it's what releases a composer waiting on 'complete'.
  | { type: 'send_rejected'; message: string }
  // A recoverable variant of the above: another entry (desktop, web, channel)
  // holds this session's binding. Surfaced the same way — this extension does
  // not offer the force-takeover flow.
  | { type: 'bind_required'; message: string }
  // Global broadcast (session_id in the payload, but sent to every client,
  // not just this session's subscribers) fired once per session after its
  // first turn, carrying the model-generated sidebar title. See
  // ws_handlers.go's session_renamed broadcast + isAutoNamePlaceholder.
  | { type: 'session_renamed'; session_id: string; name: string }
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
      ...(files?.length
        ? {
            files: files.map((f) => ({
              name: f.name,
              ...(f.dataUrl ? { data_url: f.dataUrl } : {}),
              ...(f.localPath ? { local_path: f.localPath } : {}),
            })),
          }
        : {}),
    });
  }

  interrupt(sessionId: string): void {
    this.send({ type: 'interrupt', session_id: sessionId });
  }

  confirm(id: string, result: string): void {
    this.send({ type: 'confirmation', id, result });
  }

  /**
   * Close a whole ask_user_question set in one frame. `outcome` is
   * 'submitted' (answers stand), 'clarify' (the user wants to talk it over
   * instead) or 'rejected' (dismissed — the server discards the answers).
   * Answers carry no preview: the server copies the chosen option's preview
   * out of the request it still holds.
   */
  answerUserQuestion(questionId: string, outcome: AskOutcome, answers: AskAnswer[]): void {
    this.send({ type: 'user_question_answer', question_id: questionId, outcome, answers });
  }

  /**
   * Creates a session, optionally filing it under a project (`groupId`).
   *
   * Creation time is the ONLY moment that membership can be established: the
   * server's handleCreateSession registers the group BEFORE
   * applyDefaultWorkspaceDir, whose guard asks "is this session in a project?"
   * — a session created without it is seeded a throwaway task workspace
   * (~/Octo/tasks/<id>) and stranded there for good, since
   * PATCH /api/sessions/{id}/working_dir now answers 409 unconditionally.
   */
  async createSession(opts: { name?: string; groupId?: string } = {}): Promise<OctoSession> {
    const body = await this.fetchJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: opts.name ?? '',
        ...(opts.groupId ? { group_id: opts.groupId } : {}),
      }),
    });
    const record = body as { session?: Record<string, unknown> };
    if (!record.session) {
      throw new Error('octo serve: invalid session creation response');
    }
    return normalizeSession(record.session);
  }

  async listSessionGroups(): Promise<OctoSessionGroup[]> {
    const body = (await this.fetchJson('/api/session-groups')) as { groups?: Record<string, unknown>[] };
    return (body.groups ?? []).map(normalizeSessionGroup);
  }

  /**
   * Creates a project mounting `sourceDirs`. The server generates the
   * project's own workspace under its workspace root; the directories passed
   * here become mounted source folders, never the working directory.
   */
  async createSessionGroup(name: string, sourceDirs: string[]): Promise<OctoSessionGroup> {
    const body = (await this.fetchJson('/api/session-groups', {
      method: 'POST',
      body: JSON.stringify({ name, source_dirs: sourceDirs }),
    })) as { group?: Record<string, unknown> };
    if (!body.group) {
      throw new Error('octo serve: invalid session group creation response');
    }
    return normalizeSessionGroup(body.group);
  }

  /** Sets a session's sidebar title. A real title also permanently suppresses
   * octo's own auto-titling (isAutoNamePlaceholder), which is what the user
   * asking for a name means. */
  async renameSession(sessionId: string, name: string): Promise<void> {
    await this.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  /** Installed skills, for the composer's "/" menu. */
  async listSkills(): Promise<OctoSkill[]> {
    const body = (await this.fetchJson('/api/skills')) as { skills?: Record<string, unknown>[] };
    return (body.skills ?? [])
      .map((s) => ({
        name: String(s.name ?? ''),
        description: typeof s.description === 'string' ? s.description : '',
        enabled: s.enabled !== false,
      }))
      .filter((s) => s.name && s.enabled);
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
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : undefined,
    pendingQuestion: record.pending_question === true,
    pendingConfirmation: record.pending_confirmation === true,
    contextUsage: typeof record.context_usage === 'number' ? record.context_usage : undefined,
  };
}

function normalizeSessionGroup(record: Record<string, unknown>): OctoSessionGroup {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    id: String(record.id ?? ''),
    name: String(record.name ?? ''),
    workingDir: typeof record.working_dir === 'string' ? record.working_dir : undefined,
    sourceDirs: strings(record.source_dirs),
    sessionIds: strings(record.session_ids),
  };
}
