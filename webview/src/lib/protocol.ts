// Mirrors src/octoClient/octoClient.ts's OctoEvent union and the extension
// host <-> webview postMessage contract (ChatViewProvider.ts). Duplicated
// rather than imported: that file pulls in `ws`, a Node-only module that
// can't land in this browser bundle. Keep the two in sync by hand.

// ui_payload shapes — see octoClient.ts's UIPayload doc comment for why
// these come from the tools' `ui := map[string]any{...}` literals rather
// than ws_types.go's named structs.
export type UIPayload =
  | { type: 'edit'; path: string; occurrences: number; diff: string }
  | { type: 'write'; path: string; size_bytes: number; line_count: number; preview: string; preview_truncated: boolean }
  | { type: 'file_read'; path: string; lines_read: number; truncated: boolean; content_preview: string; total_lines?: number }
  | { type: 'terminal'; command: string; status: string; output_preview: string };

export type OctoEvent =
  | { type: 'session_list'; sessions: unknown[] }
  | { type: 'output'; content: string }
  | { type: 'tool_call'; name: string; args: unknown; summary?: string; tool_id?: string }
  | { type: 'tool_result'; result: string; ui_payload?: UIPayload; tool_id?: string }
  | { type: 'tool_error'; error: string; tool_id?: string }
  | { type: 'tool_stdout'; lines: string[]; tool_id?: string }
  | { type: 'progress'; message?: string; progress_type?: string; phase: string }
  | { type: 'complete'; iterations: number; awaiting_user_feedback?: boolean }
  | { type: 'session_update'; status?: string; context_usage?: number; working_dir?: string }
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
  | {
      type: 'request_user_question';
      question_id: string;
      question: string;
      options: string[];
      multi_select: boolean;
      header?: string;
    }
  | { type: 'dismiss_user_question'; question_id: string }
  | { type: 'session_deleted'; session_id: string }
  | { type: 'session_activity'; session_id: string; kind: string };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export type InboundHostMessage =
  | { command: 'connectionState'; state: ConnectionState }
  | { command: 'event'; event: OctoEvent }
  | { command: 'sendError'; message: string }
  // Pending file attachments picked via the native quick pick, not yet sent.
  | { command: 'attachments'; labels: string[] }
  // What actually got attached to the message that was just sent (selection
  // + any pending files) — the webview annotates the just-pushed user block.
  | { command: 'contextAttached'; labels: string[] };

export type OutboundHostMessage =
  | { command: 'ready' }
  | { command: 'send'; text: string }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  | { command: 'answerQuestion'; questionId: string; choices: string[]; custom: string; cancelled: boolean }
  | { command: 'pickFile' }
  | { command: 'removeAttachment'; label: string }
  | { command: 'openFile'; path: string }
  | { command: 'viewDiff'; diff: string; path?: string };
