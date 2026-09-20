// Mirrors src/octoClient/octoClient.ts's OctoEvent union and the extension
// host <-> webview postMessage contract (ChatViewProvider.ts). Duplicated rather
// than imported: that file pulls in `ws`, a Node-only module that can't
// land in this browser bundle. Keep the two in sync by hand.

import type { AskAnswerPayload, AskOutcome, AskQuestion } from './askStepper';

// ui_payload shapes — see octoClient.ts's UIPayload doc comment for why
// these come from the tools' `ui := map[string]any{...}` literals rather
// than ws_types.go's named structs.
export type UIPayload =
  | { type: 'edit'; path: string; occurrences: number; diff: string }
  | { type: 'write'; path: string; size_bytes: number; line_count: number; preview: string; preview_truncated: boolean }
  | { type: 'file_read'; path: string; lines_read: number; truncated: boolean; content_preview: string; total_lines?: number }
  | { type: 'terminal'; command: string; status: string; output_preview: string }
  // Task-tool checklist (tasks.go's taskUI). No dedicated widget yet — the
  // tool's plain-text summary still renders via tool_result.result.
  | { type: 'todo'; action: string; progress: string; todos: { content: string; status: string }[] };

// Mirrors what ws_handlers.go's handleEvent actually broadcasts during a
// live turn — see octoClient.ts's OctoEvent doc comment for the full
// derivation (output/diff/file_preview/shell_preview are dead code;
// text/thinking stream as text_delta/thinking_delta then get finalized —
// replaced, not appended to — by assistant_message at turn end; tool_call
// has no "summary" field).
export type OctoEvent =
  | { type: 'session_list'; sessions: unknown[] }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'assistant_message'; content: string; thinking?: string }
  | { type: 'history_user_message'; content: string; created_at?: number; images?: string[] }
  | { type: 'tool_call'; name: string; args: unknown; tool_id?: string }
  | { type: 'tool_result'; result: string; ui_payload?: UIPayload; tool_id?: string }
  | { type: 'tool_error'; error: string; tool_id?: string }
  | { type: 'tool_stdout'; lines: string[]; tool_id?: string }
  | { type: 'todo_update'; todos: { content: string; status: string }[] }
  | { type: 'progress'; message?: string; progress_type?: string; phase: string }
  | { type: 'complete'; iterations: number; awaiting_user_feedback?: boolean }
  | { type: 'turn_done'; reply: { content: string } }
  | { type: 'session_update'; status?: string; context_usage?: number; context_tokens?: number; working_dir?: string; permission_mode?: string; reasoning_effort?: string }
  | {
      type: 'request_confirmation';
      id: string;
      message: string;
      kind: string;
      tool_name?: string;
      command?: string;
      diff?: string;
      input?: string;
    }
  // Another client (e.g. the Web UI, on the same session) already answered
  // this confirmation — close it here too instead of leaving a stale modal
  // that would double-answer if the user then clicked it.
  | { type: 'confirmation_complete'; id: string; result: string }
  // 1-4 questions per call, each with its own options; the picker walks them
  // as tabs. The server no longer sends a flat single-question shape.
  | {
      type: 'request_user_question';
      question_id: string;
      questions: AskQuestion[];
      secret?: boolean;
    }
  | { type: 'dismiss_user_question'; question_id: string }
  | { type: 'session_deleted'; session_id: string }
  | { type: 'session_activity'; session_id: string; kind: string }
  // Transient client-facing notice (wsToast). The inline slash commands
  // (/clear, /compact, /reload, /goal) run no turn and report ONLY through
  // this, so it is the composer's sole feedback for them.
  | { type: 'toast'; message: string; level?: string }
  // "Re-fetch this session's history" — the host intercepts it (see
  // ChatSessionManager) and answers with a fresh 'history' message, so the
  // webview never has to act on it.
  | { type: 'history_reload' }
  // The message never reached a turn (session gone, server draining, binding
  // held elsewhere). Nothing follows it, so it is what releases a composer
  // otherwise waiting on 'complete'.
  | { type: 'send_rejected'; message: string }
  | { type: 'bind_required'; message: string }
  // The turn was cancelled at the user's request. Broadcast by
  // handleWSInterrupt alongside cancelling the context.
  | { type: 'interrupted' }
  // REST history replay only — see octoClient.ts's OctoEvent doc comment.
  // Currently unhandled: a toolless intermediate round's reasoning trace
  // just doesn't render in replay (reasoning display is best-effort anyway).
  | { type: 'thinking'; text: string };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export type InboundHostMessage =
  | { command: 'connectionState'; state: ConnectionState }
  | { command: 'event'; event: OctoEvent }
  | { command: 'sendError'; message: string }
  // Pending file attachments picked via the native quick pick, not yet sent.
  | { command: 'attachments'; labels: string[] }
  // The file/selection the host will auto-attach as editor context on the
  // next send (bare path, or path:line(-line) for a selection), tracking the
  // active editor live. null when no editor has been focused this session.
  | { command: 'activeFile'; label: string | null }
  // What actually got attached to the message that was just sent (selection
  // + any pending files) — the webview annotates the just-pushed user block.
  | { command: 'contextAttached'; labels: string[] }
  // The chat view switched to a (possibly different, possibly brand new)
  // session — replaces the transcript with the replayed history (empty for
  // a new session).
  | { command: 'history'; sessionId: string; events: OctoEvent[] }
  // The header's session identity. Sent on every switch and whenever octo
  // auto-titles the open session (session_renamed).
  | { command: 'sessionInfo'; sessionId: string | null; name: string }
  // Installed skills for the composer's "/" menu, fetched by the host once
  // the connection is up (GET /api/skills).
  | { command: 'skills'; skills: { name: string; description: string }[] };

/** An image pasted into the composer, forwarded to the server as an inline
 * attachment (ws_types.go's wsUserFile.data_url). */
export type OutboundFile = { name: string; dataUrl: string };

export type OutboundHostMessage =
  | { command: 'ready' }
  | {
      command: 'send';
      text: string;
      files?: OutboundFile[];
      /** Ask the server to run this as its own turn after the one in flight,
       * rather than steering the running one (wsMsgUserMessage.queue). */
      queue?: boolean;
      /** A command the server applies inline (see inlineSlash.ts). The host
       * must send the text VERBATIM: the server matches the whole trimmed
       * message, so a line of editor context appended to it turns the command
       * into an ordinary chat message that runs a full turn. */
      inline?: boolean;
    }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  // One message closes the whole question set: the picker accumulates
  // per-question drafts locally and posts once. `outcome` is 'submitted',
  // 'clarify' ("Chat about this") or 'rejected'.
  | { command: 'answerQuestion'; questionId: string; outcome: AskOutcome; answers: AskAnswerPayload[] }
  | { command: 'pickFile' }
  | { command: 'removeAttachment'; label: string }
  | { command: 'openFile'; path: string }
  | { command: 'viewDiff'; diff: string; path?: string };
