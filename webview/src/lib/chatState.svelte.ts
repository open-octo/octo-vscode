import { inlineSlashCommand, type SlashItem } from './inlineSlash';
import { postToHost } from './vscodeApi';
import type { AskAnswerPayload, AskOutcome } from './askStepper';
import type { ConnectionState, InboundHostMessage, OctoEvent, OutboundFile, UIPayload } from './protocol';

/** One line of the agent's task checklist (tasks.go's taskUI). */
export type Todo = { content: string; status: string };

/** What the header shows about the open session. Every field arrives from the
 * server's session_update except the name, which the host supplies. */
export type SessionInfo = {
  name: string;
  /** 0-100. */
  contextUsage: number | null;
  permissionMode: string | null;
  /** The session's working directory — its PROJECT's generated workspace, not
   * the folder open in VS Code (that is mounted as a source folder). */
  workingDir: string | null;
};

export type ToolBlock = {
  kind: 'tool';
  toolId?: string;
  name: string;
  args: unknown;
  result?: string;
  error?: string;
  stdout: string[];
  uiPayload?: UIPayload;
};

export type TextBlock = {
  kind: 'user' | 'assistant';
  text: string;
  // 'assistant' only: still being appended to by text_delta, not yet
  // finalized by assistant_message. Never set on 'user' blocks.
  streaming?: boolean;
  // 'assistant' only: the reasoning trace finalized alongside this reply
  // (assistant_message.thinking), if show_reasoning was on.
  thinking?: string;
  // Selection/file context attached to this turn — set on 'user' blocks
  // once the host reports back what it actually attached (see
  // ChatViewProvider.send). Never set for 'assistant'.
  attachments?: string[];
};

export type Block = TextBlock | ToolBlock;

// Mirrors src/context/editorContext.ts's combineContext(): attachment
// blocks (full file/selection content, for the agent) joined by this
// separator, then the user's actual typed text. Splitting it back apart is
// display-only — what already got sent to the agent is unaffected — so a
// user message that happens to contain this exact separator literally is a
// rare, harmless mis-split, not a correctness bug.
const CONTEXT_SEPARATOR = '\n\n---\n\n';

function splitContextFromMessage(content: string): { text: string; attachments: string[] } {
  const idx = content.lastIndexOf(CONTEXT_SEPARATOR);
  if (idx === -1) return { text: content, attachments: [] };

  const contextBlob = content.slice(0, idx);
  const text = content.slice(idx + CONTEXT_SEPARATOR.length);
  const attachments: string[] = [];
  for (const m of contextBlob.matchAll(/^(?:Selected code|Current file) \(([^)]+)\):/gm)) {
    attachments.push(m[1]);
  }
  for (const m of contextBlob.matchAll(/^Attached file: (.+)$/gm)) {
    attachments.push(m[1]);
  }
  return { text, attachments };
}

type PendingConfirmation = Extract<OctoEvent, { type: 'request_confirmation' }>;
type PendingQuestion = Extract<OctoEvent, { type: 'request_user_question' }>;

export class ChatState {
  connectionState: ConnectionState = $state('disconnected');
  blocks: Block[] = $state([]);
  busy: boolean = $state(false);
  status: string | null = $state(null);
  // Live thinking_delta buffer for the round currently streaming — handed
  // off to the next assistant block's `.thinking` the moment text_delta
  // starts (reasoning always precedes its reply within a round), and
  // cleared once assistant_message finalizes it.
  thinking: string | null = $state(null);
  sendError: string | null = $state(null);
  pendingConfirmation: PendingConfirmation | null = $state(null);
  pendingQuestion: PendingQuestion | null = $state(null);
  // Files picked via 'Attach file', queued for the next send.
  pendingAttachments: string[] = $state([]);
  // The active editor file/selection the host will auto-attach on send,
  // shown as a live indicator in the composer. null when no editor is focused.
  activeFile: string | null = $state(null);
  // The agent's current task checklist. Fed by todo_update live and by the
  // todo tool_result's ui_payload on replay, so it survives a session switch.
  todos: Todo[] = $state([]);
  session: SessionInfo = $state({ name: '', contextUsage: null, permissionMode: null, workingDir: null });
  // The server's transient notices (wsToast). The inline slash commands
  // report through nothing else, so this is not decoration.
  toast: { message: string; level: string } | null = $state(null);
  // Installed skills, for the composer's "/" menu. Built-ins are static (see
  // inlineSlash.ts); these come from the host's GET /api/skills.
  skills: SlashItem[] = $state([]);
  // Messages typed while a turn was running, sent in order as it finishes.
  // Their bubbles are already in the transcript — this holds only what still
  // has to go on the wire. Reactive because the composer shows its depth.
  private queue: { text: string; files?: OutboundFile[] }[] = $state([]);

  // Correlates tool_result/tool_error/tool_stdout back to their tool_call by
  // tool_id — the only reliable pairing, since these events carry no
  // ordering guarantee once two tool calls interleave. Not itself reactive
  // state; the ToolBlock objects it holds are the same references pushed
  // into `blocks`, so mutating a field here still updates the render.
  private readonly toolBlocksById = new Map<string, ToolBlock>();

  handleHostMessage(message: InboundHostMessage): void {
    switch (message.command) {
      case 'connectionState':
        this.connectionState = message.state;
        break;
      case 'event':
        this.handleEvent(message.event);
        break;
      case 'sendError':
        this.busy = false;
        this.sendError = message.message;
        break;
      case 'attachments':
        this.pendingAttachments = message.labels;
        break;
      case 'activeFile':
        this.activeFile = message.label;
        break;
      case 'contextAttached': {
        // Merged, not assigned: a message can carry both pasted images (named
        // by sendMessage) and the host's editor context, and each only knows
        // about its own half.
        const lastUser = this.lastUserBlock();
        if (lastUser && message.labels.length) {
          lastUser.attachments = [...new Set([...(lastUser.attachments ?? []), ...message.labels])];
        }
        break;
      }
      case 'history':
        this.loadHistory(message.events);
        break;
      case 'sessionInfo':
        this.session.name = message.name;
        break;
      case 'skills':
        this.skills = message.skills.map((s) => ({ ...s, builtin: false }));
        break;
    }
  }

  /**
   * Replaces the transcript with a session's replayed history (switching
   * sessions, or starting a brand new one with an empty array). Unlike
   * live handleEvent(), this DOES render history_user_message — replayed
   * user messages have no local optimistic push to fall back on, and
   * unlike the live path there's no risk of double-rendering since this
   * only ever runs once per session switch, never alongside a live send.
   */
  private loadHistory(events: OctoEvent[]): void {
    this.blocks = [];
    this.toolBlocksById.clear();
    this.busy = false;
    this.status = null;
    this.thinking = null;
    this.sendError = null;
    this.pendingConfirmation = null;
    this.pendingQuestion = null;
    this.toast = null;
    this.todos = [];
    this.queue = [];
    // Name aside (the host sends it alongside this history), the session's
    // own fields are re-announced by the session_update that follows a
    // subscribe — blank them so a switch never shows the last session's
    // context usage against this one's transcript.
    this.session = { name: this.session.name, contextUsage: null, permissionMode: null, workingDir: null };
    for (const event of events) {
      if (event.type === 'history_user_message') {
        const { text, attachments } = splitContextFromMessage(event.content);
        this.blocks.push({ kind: 'user', text, attachments: attachments.length ? attachments : undefined });
      } else {
        this.handleEvent(event);
      }
    }
  }

  sendMessage(text: string, files?: OutboundFile[]): void {
    const trimmed = text.trim();
    if (!trimmed && !files?.length) return;

    const inline = inlineSlashCommand(trimmed, !!files?.length);
    if (inline) {
      // No bubble and no busy state: the server answers an inline command with
      // a toast (and, for /clear and /compact, a history_reload), never with a
      // turn — so a bubble would describe a message the session doesn't hold,
      // and busy would wait on a `complete` that never comes.
      this.sendError = null;
      this.toast = null;
      postToHost({ command: 'send', text: trimmed });
      return;
    }

    // Rendered optimistically rather than on the server's history_user_message
    // echo — the echo carries the host's appended editor context too, which is
    // not what the user typed.
    this.blocks.push({ kind: 'user', text: trimmed, attachments: files?.map((f) => f.name) });
    this.sendError = null;
    this.status = null;
    this.toast = null;
    if (this.busy) {
      // Queued rather than dropped: a message typed mid-turn is a follow-up
      // the user has already committed to, and silently discarding it is the
      // worse failure. It goes on the wire in order once the turn completes.
      this.queue.push({ text: trimmed, files });
      return;
    }
    this.busy = true;
    postToHost({ command: 'send', text: trimmed, files });
  }

  /** Whether anything is waiting behind the running turn — the composer shows
   * a count so a queued message doesn't look lost. */
  get queuedCount(): number {
    return this.queue.length;
  }

  private flushQueue(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    postToHost({ command: 'send', text: next.text, files: next.files });
  }

  interrupt(): void {
    postToHost({ command: 'interrupt' });
  }

  pickFile(): void {
    postToHost({ command: 'pickFile' });
  }

  removeAttachment(label: string): void {
    postToHost({ command: 'removeAttachment', label });
  }

  openFile(path: string): void {
    postToHost({ command: 'openFile', path });
  }

  viewDiff(diff: string, path?: string): void {
    postToHost({ command: 'viewDiff', diff, path });
  }

  answerConfirmation(id: string, result: string): void {
    this.pendingConfirmation = null;
    postToHost({ command: 'confirm', id, result });
  }

  answerQuestion(outcome: AskOutcome, answers: AskAnswerPayload[]): void {
    if (!this.pendingQuestion) return;
    postToHost({
      command: 'answerQuestion',
      questionId: this.pendingQuestion.question_id,
      outcome,
      // Rebuild out of the $state proxies: postMessage structured-clones its
      // payload and throws DataCloneError on a reactive proxy — the same trap
      // 85355b6 fixed for the old flat `choices` array.
      answers: answers.map((a) => ({ choices: [...a.choices], custom: a.custom, notes: a.notes })),
    });
    this.pendingQuestion = null;
  }

  private handleEvent(event: OctoEvent): void {
    switch (event.type) {
      case 'text_delta': {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === 'assistant' && last.streaming) {
          last.text += event.text;
        } else {
          this.blocks.push({ kind: 'assistant', text: event.text, streaming: true, thinking: this.thinking ?? undefined });
          this.thinking = null;
        }
        this.status = null;
        break;
      }
      case 'thinking_delta':
        this.thinking = (this.thinking ?? '') + event.text;
        this.status = null;
        break;
      case 'assistant_message': {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === 'assistant' && last.streaming) {
          last.text = event.content;
          last.thinking = event.thinking || last.thinking;
          last.streaming = false;
        } else {
          this.blocks.push({ kind: 'assistant', text: event.content, thinking: event.thinking, streaming: false });
        }
        this.thinking = null;
        break;
      }
      case 'tool_call': {
        const tool: ToolBlock = {
          kind: 'tool',
          toolId: event.tool_id,
          name: event.name,
          args: event.args,
          stdout: [],
        };
        this.blocks.push(tool);
        if (event.tool_id) this.toolBlocksById.set(event.tool_id, tool);
        this.status = null;
        break;
      }
      case 'tool_result': {
        const tool = this.resolveToolBlock(event.tool_id);
        if (tool) {
          tool.result = event.result;
          tool.uiPayload = event.ui_payload;
        }
        // The standalone todo_update rides alongside this only on the live
        // stream; on replay the ui_payload is the checklist's only carrier, so
        // the panel has to read it from here too.
        if (event.ui_payload?.type === 'todo') this.todos = event.ui_payload.todos;
        break;
      }
      case 'tool_error': {
        const tool = this.resolveToolBlock(event.tool_id);
        if (tool) tool.error = event.error;
        break;
      }
      case 'tool_stdout': {
        const tool = this.resolveToolBlock(event.tool_id);
        if (tool) tool.stdout.push(...event.lines);
        break;
      }
      case 'progress':
        // message is only ever populated on the REST history-replay
        // snapshot, never on the live turn-start/re-seed broadcasts this
        // event actually carries — those only set progress_type.
        this.status = event.progress_type === 'thinking' ? 'Thinking…' : event.message ?? null;
        break;
      case 'todo_update':
        // An empty list is meaningful, not a no-op: /clear broadcasts one to
        // retire the panel over the wiped transcript.
        this.todos = event.todos;
        break;
      case 'session_update':
        if (typeof event.context_usage === 'number') this.session.contextUsage = event.context_usage;
        if (event.permission_mode) this.session.permissionMode = event.permission_mode;
        if (event.working_dir) this.session.workingDir = event.working_dir;
        break;
      case 'toast':
        this.toast = { message: event.message, level: event.level ?? 'info' };
        break;
      case 'send_rejected':
      case 'bind_required':
        // Terminal for this message: nothing else follows, so release the
        // composer here or it waits on a `complete` that never comes.
        this.busy = false;
        this.status = null;
        this.sendError = event.message;
        break;
      case 'complete':
        this.busy = false;
        this.status = null;
        this.flushQueue();
        break;
      case 'request_confirmation':
        this.pendingConfirmation = event;
        break;
      case 'confirmation_complete':
        if (this.pendingConfirmation?.id === event.id) {
          this.pendingConfirmation = null;
        }
        break;
      case 'request_user_question':
        this.pendingQuestion = event;
        break;
      case 'dismiss_user_question':
        if (this.pendingQuestion?.question_id === event.question_id) {
          this.pendingQuestion = null;
        }
        break;
      // history_user_message/turn_done: intentionally unhandled. The user's
      // own message is already rendered optimistically by sendMessage(), and
      // turn_done duplicates assistant_message — see both events' doc
      // comments in protocol.ts.
      default:
        break;
    }
  }

  // Prefers the tool_id map (correct even if tool calls interleave); falls
  // back to "most recent still-open tool block" only for the hypothetical
  // case of an event missing tool_id, so a malformed/older event doesn't
  // just get silently dropped.
  private resolveToolBlock(toolId: string | undefined): ToolBlock | undefined {
    if (toolId) {
      const byId = this.toolBlocksById.get(toolId);
      if (byId) return byId;
    }
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const block = this.blocks[i];
      if (block.kind === 'tool' && block.result === undefined && block.error === undefined) {
        return block;
      }
    }
    return undefined;
  }

  private lastUserBlock(): TextBlock | undefined {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const block = this.blocks[i];
      if (block.kind === 'user') return block;
    }
    return undefined;
  }
}

export const chatState = new ChatState();
