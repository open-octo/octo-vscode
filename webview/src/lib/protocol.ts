// Mirrors src/octoClient/octoClient.ts's OctoEvent union and the extension
// host <-> webview postMessage contract (ChatViewProvider.ts). Duplicated
// rather than imported: that file pulls in `ws`, a Node-only module that
// can't land in this browser bundle. Keep the two in sync by hand.

export type OctoEvent =
  | { type: 'session_list'; sessions: unknown[] }
  | { type: 'output'; content: string }
  | { type: 'tool_call'; name: string; args: unknown; summary?: string }
  | { type: 'tool_result'; result: string; ui_payload?: unknown }
  | { type: 'tool_error'; error: string }
  | { type: 'tool_stdout'; lines: string[] }
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
  | { command: 'sendError'; message: string };

export type OutboundHostMessage =
  | { command: 'ready' }
  | { command: 'send'; text: string }
  | { command: 'interrupt' }
  | { command: 'confirm'; id: string; result: string }
  | { command: 'answerQuestion'; questionId: string; choices: string[]; custom: string; cancelled: boolean };
