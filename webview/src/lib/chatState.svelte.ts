import { postToHost } from './vscodeApi';
import type { ConnectionState, InboundHostMessage, OctoEvent } from './protocol';

export type ToolBlock = {
  kind: 'tool';
  name: string;
  args: unknown;
  summary?: string;
  result?: string;
  error?: string;
  stdout: string[];
};

export type TextBlock = {
  kind: 'user' | 'assistant';
  text: string;
  // Selection/file context attached to this turn — set on 'user' blocks
  // once the host reports back what it actually attached (see
  // ChatViewProvider.send). Never set for 'assistant'.
  attachments?: string[];
};

export type Block = TextBlock | ToolBlock;

type PendingConfirmation = Extract<OctoEvent, { type: 'request_confirmation' }>;
type PendingQuestion = Extract<OctoEvent, { type: 'request_user_question' }>;

class ChatState {
  connectionState: ConnectionState = $state('disconnected');
  blocks: Block[] = $state([]);
  busy: boolean = $state(false);
  status: string | null = $state(null);
  sendError: string | null = $state(null);
  pendingConfirmation: PendingConfirmation | null = $state(null);
  pendingQuestion: PendingQuestion | null = $state(null);
  // Files picked via 'Attach file', queued for the next send.
  pendingAttachments: string[] = $state([]);

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
    }
  }

  sendMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;
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
      case 'output': {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === 'assistant') {
          last.text += event.content;
        } else {
          this.blocks.push({ kind: 'assistant', text: event.content });
        }
        this.status = null;
        break;
      }
      case 'tool_call':
        this.blocks.push({
          kind: 'tool',
          name: event.name,
          args: event.args,
          summary: event.summary,
          stdout: [],
        });
        this.status = null;
        break;
      case 'tool_result': {
        const tool = this.openToolBlock();
        if (tool) tool.result = event.result;
        break;
      }
      case 'tool_error': {
        const tool = this.openToolBlock();
        if (tool) tool.error = event.error;
        break;
      }
      case 'tool_stdout': {
        const tool = this.openToolBlock();
        if (tool) tool.stdout.push(...event.lines);
        break;
      }
      case 'progress':
        this.status = event.message ?? null;
        break;
      case 'complete':
        this.busy = false;
        this.status = null;
        break;
      case 'request_confirmation':
        this.pendingConfirmation = event;
        break;
      case 'request_user_question':
        this.pendingQuestion = event;
        break;
      case 'dismiss_user_question':
        if (this.pendingQuestion?.question_id === event.question_id) {
          this.pendingQuestion = null;
        }
        break;
      default:
        break;
    }
  }

  // The most recent tool block still missing a result/error — tool_result
  // pairs with tool_call purely by order, since the wire protocol carries
  // no shared id between them (see dev-docs/vscode-extension-design.md).
  private openToolBlock(): ToolBlock | undefined {
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
