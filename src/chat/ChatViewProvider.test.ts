import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ChatViewProvider } from './ChatViewProvider';
import type { ConnectionController } from '../connection/ConnectionController';

const windowMock = vscode.window as unknown as { activeTextEditor?: unknown };

/** An open file with no selection — the shape that makes captureEditorContext
 * attach the whole file as fallback context, which is the default state of
 * anyone typing in the composer. */
function openFile(text = 'const answer = 42;'): void {
  windowMock.activeTextEditor = {
    document: {
      uri: { fsPath: '/repo/src/answer.ts' },
      languageId: 'typescript',
      getText: () => text,
    },
    selection: { isEmpty: true },
  };
}

/** Minimal WebviewView, plus a handle on the message callback the provider
 * registers — that callback is the whole host-side entry point. */
function fakeView() {
  let onMessage: ((message: unknown) => void) | undefined = undefined;
  const view = {
    webview: {
      options: {},
      html: '',
      cspSource: '',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(() => Promise.resolve(true)),
      onDidReceiveMessage: (cb: (message: unknown) => void) => {
        onMessage = cb;
        return { dispose: () => {} };
      },
    },
    onDidDispose: () => ({ dispose: () => {} }),
  };
  return { view, send: (message: unknown) => onMessage?.(message) };
}

function fakeSession() {
  return {
    onEvent: vi.fn(() => ({ dispose: () => {} })),
    onHistoryLoaded: vi.fn(() => ({ dispose: () => {} })),
    getSessionId: vi.fn(() => 'session-1'),
    sendMessage: vi.fn(async (_content: string, _files?: unknown, _queue?: boolean) => {}),
    replayCurrentHistory: vi.fn(async () => {}),
    sessionName: vi.fn(async () => ''),
  };
}

function fakeController() {
  return {
    onStateChange: vi.fn(() => ({ dispose: () => {} })),
    onEvent: vi.fn(() => ({ dispose: () => {} })),
    getState: vi.fn(() => 'connected' as const),
    listSkills: vi.fn(async () => []),
  };
}

function resolved() {
  const session = fakeSession();
  const controller = fakeController();
  const provider = new ChatViewProvider(
    vscode.Uri.file('/ext'),
    controller as unknown as ConnectionController,
    session as unknown as ChatSessionManager,
  );
  const { view, send } = fakeView();
  provider.resolveWebviewView(view as unknown as vscode.WebviewView);
  return { session, send };
}

beforeEach(() => {
  windowMock.activeTextEditor = undefined;
});

describe('ChatViewProvider send', () => {
  it('sends an inline slash command verbatim, with no editor context appended', () => {
    // The server matches /clear, /compact, /reload and /goal against the WHOLE
    // trimmed message (ws_handlers.go). Appending the open file — which every
    // other message gets — silently demotes the command to an ordinary prompt:
    // the session isn't cleared and a full turn runs, while the webview shows
    // no bubble and no spinner for it.
    openFile();
    const { session, send } = resolved();

    send({ command: 'send', text: '/clear', inline: true });

    expect(session.sendMessage).toHaveBeenCalledWith('/clear');
  });

  it('still attaches the open file to an ordinary message', () => {
    openFile();
    const { session, send } = resolved();

    send({ command: 'send', text: 'what does this do?' });

    const content = session.sendMessage.mock.calls[0][0];
    expect(content).toContain('Current file (repo/src/answer.ts)');
    expect(content).toContain('const answer = 42;');
    expect(content.endsWith('what does this do?')).toBe(true);
  });

  it('leaves pinned attachments alone for an inline command', async () => {
    // The chips belong to the message the user is still composing; a /clear
    // typed in the middle of building one must not consume them.
    openFile();
    const session = fakeSession();
    const provider = new ChatViewProvider(
      vscode.Uri.file('/ext'),
      fakeController() as unknown as ConnectionController,
      session as unknown as ChatSessionManager,
    );
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);

    send({ command: 'send', text: '/compact', inline: true });
    view.webview.postMessage.mockClear();
    send({ command: 'send', text: 'now answer' });

    const content = session.sendMessage.mock.calls[1][0];
    expect(content).toContain('Current file');
  });

  it('passes the queue flag through so the server parks the message', () => {
    const { session, send } = resolved();

    send({ command: 'send', text: 'follow-up', queue: true });

    expect(session.sendMessage).toHaveBeenCalledWith('follow-up', undefined, true);
  });
});
