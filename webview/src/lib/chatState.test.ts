import { describe, expect, it } from 'vitest';

import { ChatState, type ToolBlock } from './chatState.svelte';
import type { OctoEvent } from './protocol';

function fireEvent(state: ChatState, event: OctoEvent): void {
  state.handleHostMessage({ command: 'event', event });
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
