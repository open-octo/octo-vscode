import { postToHost } from './vscodeApi';
import type { ConnectionState, InboundHostMessage, OctoEvent, UIPayload } from './protocol';

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
      case 'contextAttached': {
        const lastUser = this.lastUserBlock();
        if (lastUser && message.labels.length) lastUser.attachments = message.labels;
        break;
      }
      case 'history':
        this.loadHistory(message.events);
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
    for (const event of events) {
      if (event.type === 'history_user_message') {
        this.blocks.push({ kind: 'user', text: event.content });
      } else {
        this.handleEvent(event);
      }
    }
  }

  sendMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;
    // Rendered optimistically rather than on the server's history_user_message
    // echo: this UI never lets a second send through while busy, so there's
    // no steer/interleaving case that needs the echo to disambiguate ordering.
    this.blocks.push({ kind: 'user', text: trimmed });
    this.busy = true;
    this.sendError = null;
    this.status = null;
    postToHost({ command: 'send', text: trimmed });
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

  switchSessions(): void {
    postToHost({ command: 'listSessions' });
  }

  answerConfirmation(id: string, result: string): void {
    this.pendingConfirmation = null;
    postToHost({ command: 'confirm', id, result });
  }

  answerQuestion(choices: string[], custom: string, cancelled: boolean): void {
    if (!this.pendingQuestion) return;
    postToHost({
      command: 'answerQuestion',
      questionId: this.pendingQuestion.question_id,
      choices,
      custom,
      cancelled,
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
      case 'complete':
        this.busy = false;
        this.status = null;
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
