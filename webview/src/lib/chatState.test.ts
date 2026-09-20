import { beforeEach, describe, expect, it } from 'vitest';

import { ChatState, type ToolBlock } from './chatState.svelte';
import type { OctoEvent, OutboundHostMessage } from './protocol';

function fireEvent(state: ChatState, event: OctoEvent): void {
  state.handleHostMessage({ command: 'event', event });
}

// Everything postToHost has sent — the test setup's stub records it, and
// structured-clones it on the way past exactly as the real bridge does.
function posted(): OutboundHostMessage[] {
  return (globalThis as Record<string, unknown>).postedToHost as OutboundHostMessage[];
}

function lastPosted(): OutboundHostMessage {
  const all = posted();
  return all[all.length - 1];
}

function drainPosted(): void {
  posted().length = 0;
}

describe('ChatState tool_id pairing', () => {
  it('attaches a result to its own call even when another call is still open (interleaved)', () => {
    const state = new ChatState();

    fireEvent(state, { type: 'tool_call', tool_id: 'a', name: 'toolA', args: {} });
    fireEvent(state, { type: 'tool_call', tool_id: 'b', name: 'toolB', args: {} });
    // Both calls are still "open" here — a purely order-based ("most
    // recent still-open block") pairing would misattach this to b, since b
    // was pushed more recently. tool_id-based pairing must get it right.
    fireEvent(state, { type: 'tool_result', tool_id: 'a', result: 'result-a' });
    fireEvent(state, { type: 'tool_result', tool_id: 'b', result: 'result-b' });

    const [toolA, toolB] = state.blocks as ToolBlock[];
    expect(toolA.name).toBe('toolA');
    expect(toolA.result).toBe('result-a');
    expect(toolB.name).toBe('toolB');
    expect(toolB.result).toBe('result-b');
  });

  it('routes tool_stdout and tool_error to the matching call by id', () => {
    const state = new ChatState();

    fireEvent(state, { type: 'tool_call', tool_id: 'a', name: 'toolA', args: {} });
    fireEvent(state, { type: 'tool_call', tool_id: 'b', name: 'toolB', args: {} });
    fireEvent(state, { type: 'tool_stdout', tool_id: 'a', lines: ['line1'] });
    fireEvent(state, { type: 'tool_error', tool_id: 'b', error: 'boom' });

    const [toolA, toolB] = state.blocks as ToolBlock[];
    expect(toolA.stdout).toEqual(['line1']);
    expect(toolB.error).toBe('boom');
    expect(toolB.stdout).toEqual([]);
  });
});

describe('ChatState streamed text and finalization', () => {
  it('accumulates text_delta into one streaming block, then assistant_message REPLACES it', () => {
    const state = new ChatState();

    fireEvent(state, { type: 'text_delta', text: 'Hello' });
    fireEvent(state, { type: 'text_delta', text: ' world' });
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ kind: 'assistant', text: 'Hello world', streaming: true });

    fireEvent(state, { type: 'assistant_message', content: 'Hello world (final)' });

    // Must be a single block whose content was replaced, not a second
    // block appended alongside the streamed one — this is the exact
    // behavior octo-agent's own web/src/views/ChatView.svelte implements
    // and the reason 'output' (which this UI used to render text from
    // before it turned out to be dead code) never matched the real
    // text_delta -> assistant_message lifecycle.
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({
      kind: 'assistant',
      text: 'Hello world (final)',
      streaming: false,
    });
  });

  it('creates a non-streaming assistant block from assistant_message alone (no deltas at all)', () => {
    const state = new ChatState();
    fireEvent(state, { type: 'assistant_message', content: 'Straight to the point.' });
    expect(state.blocks).toEqual([{ kind: 'assistant', text: 'Straight to the point.', thinking: undefined, streaming: false }]);
  });

  it('hands the live thinking buffer off to the block the moment text starts streaming', () => {
    const state = new ChatState();

    fireEvent(state, { type: 'thinking_delta', text: 'reasoning...' });
    expect(state.thinking).toBe('reasoning...');

    fireEvent(state, { type: 'text_delta', text: 'answer' });
    expect(state.thinking).toBeNull();
    expect(state.blocks[0]).toMatchObject({ thinking: 'reasoning...', text: 'answer' });
  });
});

describe('ChatState progress status derivation', () => {
  it('shows "Thinking…" for the turn-start/re-seed broadcast, which carries no message text', () => {
    const state = new ChatState();
    fireEvent(state, { type: 'progress', progress_type: 'thinking', phase: 'active' });
    expect(state.status).toBe('Thinking…');
  });

  it('falls back to message for any other progress_type', () => {
    const state = new ChatState();
    fireEvent(state, { type: 'progress', progress_type: 'tool', phase: 'active', message: 'custom status' });
    expect(state.status).toBe('custom status');
  });
});

describe('ChatState confirmation_complete', () => {
  it('only clears the modal when the id matches the pending confirmation', () => {
    const state = new ChatState();
    fireEvent(state, { type: 'request_confirmation', id: 'conf-1', message: 'Allow?', kind: 'yes_no' });
    expect(state.pendingConfirmation?.id).toBe('conf-1');

    fireEvent(state, { type: 'confirmation_complete', id: 'some-other-id', result: 'yes' });
    expect(state.pendingConfirmation?.id).toBe('conf-1');

    fireEvent(state, { type: 'confirmation_complete', id: 'conf-1', result: 'yes' });
    expect(state.pendingConfirmation).toBeNull();
  });
});

describe('ChatState history replay', () => {
  it('renders history_user_message (unlike the live path, which relies on optimistic push instead)', () => {
    const state = new ChatState();
    state.handleHostMessage({
      command: 'history',
      sessionId: 's1',
      events: [
        { type: 'history_user_message', content: 'What does this do?' },
        { type: 'assistant_message', content: 'It does the thing.' },
      ],
    });

    expect(state.blocks).toEqual([
      { kind: 'user', text: 'What does this do?' },
      { kind: 'assistant', text: 'It does the thing.', thinking: undefined, streaming: false },
    ]);
  });

  it('strips the XML context off a replayed user message, showing only what was typed', () => {
    const state = new ChatState();
    state.handleHostMessage({ command: 'hostInfo', workspace: 'repo', workspaceRoot: '/repo' });
    const rawContent =
      'What does this do?\n\n' +
      '<current_file>\n/repo/src/foo.ts\n</current_file>\n\n' +
      '<context_files>\n/repo/src/bar.ts\n/elsewhere/baz.ts\n</context_files>\n\n' +
      '<editor_selection path="/repo/src/foo.ts" lines="12-34">\n```ts\nconst x = 1\n```\n</editor_selection>';

    state.handleHostMessage({
      command: 'history',
      sessionId: 's1',
      events: [{ type: 'history_user_message', content: rawContent }],
    });

    // Paths go to the agent absolute (it reads them with its own tools); the
    // transcript shows them the way the composer's chips did, and anything
    // outside the workspace stays absolute because that is what it is.
    expect(state.blocks).toEqual([
      {
        kind: 'user',
        text: 'What does this do?',
        attachments: ['src/foo.ts', 'src/bar.ts', '/elsewhere/baz.ts', 'src/foo.ts:12-34'],
      },
    ]);
  });

  it('still reads the pre-path format, where whole files were pasted in', () => {
    const state = new ChatState();
    const rawContent =
      'Selected code (src/foo.ts:12-34):\n```ts\nconst x = 1\n```\n' +
      '\n\n---\n\n' +
      'Attached file: src/bar.ts\n```ts\nexport const y = 2\n```\n' +
      '\n\n---\n\n' +
      'What does this code do?';
    state.handleHostMessage({
      command: 'history',
      sessionId: 's1',
      events: [{ type: 'history_user_message', content: rawContent }],
    });

    // Splitting on the LAST separator: only the true typed text ends up as
    // `text`; everything before it (even multiple attachment blocks) is
    // context, reduced to just its labels.
    expect(state.blocks).toEqual([
      {
        kind: 'user',
        text: 'What does this code do?',
        attachments: ['src/foo.ts:12-34', 'src/bar.ts'],
      },
    ]);
  });

  it('pairs replayed tool_call/tool_result by tool_id same as live', () => {
    const state = new ChatState();
    state.handleHostMessage({
      command: 'history',
      sessionId: 's1',
      events: [
        { type: 'tool_call', tool_id: 'x', name: 'read_file', args: { path: 'a.ts' } },
        { type: 'tool_result', tool_id: 'x', result: 'contents' },
      ],
    });

    expect(state.blocks[0]).toMatchObject({ kind: 'tool', name: 'read_file', result: 'contents' });
  });

  it('resets busy/status/pending modals when switching sessions', () => {
    const state = new ChatState();
    state.busy = true;
    state.status = 'Thinking…';
    fireEvent(state, { type: 'request_confirmation', id: 'stale', message: 'x', kind: 'yes_no' });

    state.handleHostMessage({ command: 'history', sessionId: 's2', events: [] });

    expect(state.busy).toBe(false);
    expect(state.status).toBeNull();
    expect(state.pendingConfirmation).toBeNull();
    expect(state.blocks).toEqual([]);
  });
});

describe('ChatState question answers', () => {
  beforeEach(drainPosted);

  // The host bridge structured-clones this payload, which throws
  // DataCloneError on a Svelte $state proxy (fixed once in 85355b6 for the
  // old flat `choices` array — the same trap applies per answer now).
  it('posts one frame per question set, with plain arrays', () => {
    const state = new ChatState();
    fireEvent(state, {
      type: 'request_user_question',
      question_id: 'q_1',
      questions: [
        { question: 'Which one?', header: 'pick', options: [{ label: 'A' }, { label: 'B' }] },
        { question: 'And?', header: 'then', options: [{ label: 'C' }, { label: 'D' }] },
      ],
    });
    expect(state.pendingQuestion?.question_id).toBe('q_1');

    state.answerQuestion('submitted', [
      { choices: ['A'], custom: '', notes: 'hm' },
      { choices: [], custom: 'neither', notes: '' },
    ]);

    expect(posted()).toEqual([
      {
        command: 'answerQuestion',
        questionId: 'q_1',
        outcome: 'submitted',
        answers: [
          { choices: ['A'], custom: '', notes: 'hm' },
          { choices: [], custom: 'neither', notes: '' },
        ],
      },
    ]);
    // Answering clears the pending question, so a second submit is a no-op.
    expect(state.pendingQuestion).toBeNull();
    state.answerQuestion('submitted', []);
    expect(posted()).toHaveLength(1);
  });

  it('sends no answers when the picker is dismissed', () => {
    const state = new ChatState();
    fireEvent(state, {
      type: 'request_user_question',
      question_id: 'q_2',
      questions: [{ question: 'Which one?', header: 'pick', options: [{ label: 'A' }, { label: 'B' }] }],
    });
    state.answerQuestion('rejected', []);

    expect(posted()).toEqual([
      { command: 'answerQuestion', questionId: 'q_2', outcome: 'rejected', answers: [] },
    ]);
  });
});

describe('ChatState inline slash commands', () => {
  it('sends an inline command without a bubble or a busy spinner', () => {
    const state = new ChatState();

    state.sendMessage('/clear');

    // The server answers these before any turn starts — no
    // history_user_message, no `complete`. A bubble would describe a message
    // the session doesn't hold, and busy would never be released.
    expect(state.blocks).toEqual([]);
    expect(state.busy).toBe(false);
  });

  it('treats an inline command carrying files as an ordinary message', () => {
    const state = new ChatState();

    state.sendMessage('/clear', [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }]);

    // Attachments take the message off the inline path server-side.
    expect(state.busy).toBe(true);
    expect(state.blocks).toHaveLength(1);
  });

  it('shows a toast, the only thing an inline command reports back', () => {
    const state = new ChatState();

    fireEvent(state, { type: 'toast', message: 'Conversation cleared.', level: 'success' });

    expect(state.toast).toEqual({ message: 'Conversation cleared.', level: 'success' });
  });
});

describe('ChatState send queue', () => {
  it('releases the composer on send_rejected, which nothing follows', () => {
    const state = new ChatState();
    state.sendMessage('hello');

    fireEvent(state, { type: 'send_rejected', message: 'session not found: x' });

    expect(state.busy).toBe(false);
    expect(state.sendError).toBe('session not found: x');
  });
});

describe('ChatState session and task state', () => {
  it('keeps the checklist from both of its carriers', () => {
    const state = new ChatState();

    // Live: the standalone broadcast.
    fireEvent(state, { type: 'todo_update', todos: [{ content: 'write it', status: 'in_progress' }] });
    expect(state.todos).toEqual([{ content: 'write it', status: 'in_progress' }]);

    // Replay: only the tool_result's ui_payload carries it.
    fireEvent(state, {
      type: 'tool_result',
      tool_id: 't',
      result: 'ok',
      ui_payload: { type: 'todo', action: 'update', progress: '1/1', todos: [{ content: 'write it', status: 'completed' }] },
    });
    expect(state.todos).toEqual([{ content: 'write it', status: 'completed' }]);

    // An empty list is meaningful: /clear retires the panel with one.
    fireEvent(state, { type: 'todo_update', todos: [] });
    expect(state.todos).toEqual([]);
  });

  it('reads the header fields off session_update', () => {
    const state = new ChatState();

    fireEvent(state, {
      type: 'session_update',
      context_usage: 42,
      permission_mode: 'interactive',
      working_dir: '/octo/workspaces/repo',
    });

    expect(state.session.contextUsage).toBe(42);
    expect(state.session.permissionMode).toBe('interactive');
    expect(state.session.workingDir).toBe('/octo/workspaces/repo');
  });

  it('blanks the previous session’s header fields when the transcript is replaced', () => {
    const state = new ChatState();
    fireEvent(state, { type: 'session_update', context_usage: 88 });
    state.handleHostMessage({ command: 'sessionInfo', sessionId: 's2', name: 'Other session' });

    state.handleHostMessage({ command: 'history', sessionId: 's2', events: [] });

    expect(state.session.contextUsage).toBeNull();
    // The name rides with the switch rather than being re-announced, so it
    // must survive the reset.
    expect(state.session.name).toBe('Other session');
  });
});

describe('ChatState outgoing payloads', () => {
  beforeEach(drainPosted);

  it('rebuilds file attachments as plain objects before they cross to the host', () => {
    const state = new ChatState();
    const files = [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }];

    state.sendMessage('look at this', files);

    // The composer's image list is a $state array, so what arrives here is a
    // Proxy — and postMessage structured-clones, which throws DataCloneError
    // on one. Forwarding the caller's own objects is what makes that reachable;
    // rebuilding them is what this asserts (the setup's clone would only catch
    // it when the caller actually passed a proxy).
    const sent = lastPosted() as { command: 'send'; files?: { name: string }[] };
    expect(sent.files).toEqual(files);
    expect(sent.files).not.toBe(files);
    expect(sent.files?.[0]).not.toBe(files[0]);
  });

  it('marks an inline command so the host sends it verbatim', () => {
    const state = new ChatState();

    state.sendMessage('/clear');

    // Without this flag the host appends the open file, and the server — which
    // matches the whole trimmed message — runs an ordinary turn instead.
    expect(lastPosted()).toEqual({ command: 'send', text: '/clear', inline: true });
  });

  it('asks the server to queue a message typed mid-turn', () => {
    const state = new ChatState();
    state.sendMessage('first');

    state.sendMessage('second');

    // Server-side queueing (wsMsgUserMessage.queue), not a local buffer: a
    // buffer strands the message on an interrupt, a rejection or a webview
    // rebuild, each of which leaves the bubble claiming it was sent.
    expect(lastPosted()).toMatchObject({ command: 'send', text: 'second', queue: true });
    expect(state.queuedCount).toBe(1);
    expect(state.blocks).toHaveLength(2);

    fireEvent(state, { type: 'complete', iterations: 1 });
    expect(state.queuedCount).toBe(0);
  });
});

describe('ChatState turn lifecycle', () => {
  it('shows a turn as running once progress arrives, whoever started it', () => {
    const state = new ChatState();

    // A queued message the server dequeued, a steer, or another client on the
    // same session — none of them go through sendMessage here.
    fireEvent(state, { type: 'progress', progress_type: 'thinking', phase: 'start' });

    expect(state.busy).toBe(true);
  });

  it('settles the composer after a replay that contains progress events', () => {
    const state = new ChatState();

    state.handleHostMessage({
      command: 'history',
      sessionId: 's1',
      events: [{ type: 'progress', message: 'working', phase: 'start' }],
    });

    expect(state.busy).toBe(false);
  });

  it('releases the composer when the turn is interrupted', () => {
    const state = new ChatState();
    state.sendMessage('long one');

    fireEvent(state, { type: 'interrupted' });

    expect(state.busy).toBe(false);
  });
});

describe('ChatState toast lifetime', () => {
  it('keeps the toast through the history reload that same command triggered', () => {
    // /clear broadcasts history_reload and then its toast; the host answers the
    // reload with a REST fetch, so the replayed history lands AFTER the toast.
    // Clearing it there left the one thing an inline command reports back
    // invisible.
    const state = new ChatState();
    state.handleHostMessage({ command: 'history', sessionId: 's1', events: [] });
    fireEvent(state, { type: 'toast', message: 'Conversation cleared.', level: 'success' });

    state.handleHostMessage({ command: 'history', sessionId: 's1', events: [] });

    expect(state.toast?.message).toBe('Conversation cleared.');
  });

  it('drops it when the transcript switches to another session', () => {
    const state = new ChatState();
    state.handleHostMessage({ command: 'history', sessionId: 's1', events: [] });
    fireEvent(state, { type: 'toast', message: 'Conversation cleared.', level: 'success' });

    state.handleHostMessage({ command: 'history', sessionId: 's2', events: [] });

    expect(state.toast).toBeNull();
  });
});
