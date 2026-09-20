import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { ChatViewProvider, supportsSecondarySidebar } from './ChatViewProvider';
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

  it('references the open file by path on an ordinary message', () => {
    openFile();
    const { session, send } = resolved();

    send({ command: 'send', text: 'what does this do?' });

    // BY PATH, not by content: the workspace is mounted into the session's
    // octo project, so the agent reads the file with its own tools instead of
    // paying for it in every prompt. Absolute, or the model has to hunt for
    // it — a project's working directory is octo's own generated workspace.
    const content = session.sendMessage.mock.calls[0][0];
    expect(content).toBe('what does this do?\n\n<current_file>\n/repo/src/answer.ts\n</current_file>');
    expect(content).not.toContain('const answer = 42;');
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
    expect(content).toContain('<current_file>');
  });

  it('sends a selection as text, with its path and line range', () => {
    // The exception to path-only: the selected lines ARE the message, and no
    // path expresses "these ones". Same split the obsidian client makes.
    windowMock.activeTextEditor = {
      document: {
        uri: { fsPath: '/repo/src/answer.ts' },
        languageId: 'typescript',
        getText: (range?: unknown) => (range ? 'const answer = 42;' : 'whole file'),
      },
      selection: {
        isEmpty: false,
        start: { line: 11 },
        end: { line: 11 },
      },
    };
    const { session, send } = resolved();

    send({ command: 'send', text: 'explain this' });

    const content = session.sendMessage.mock.calls[0][0];
    expect(content).toContain('<editor_selection path="/repo/src/answer.ts" lines="12">');
    expect(content).toContain('const answer = 42;');
  });

  it('passes the queue flag through so the server parks the message', () => {
    const { session, send } = resolved();

    send({ command: 'send', text: 'follow-up', queue: true });

    expect(session.sendMessage).toHaveBeenCalledWith('follow-up', undefined, true);
  });
});

describe('supportsSecondarySidebar', () => {
  // viewsContainers.secondarySidebar landed in VS Code 1.106; an older host
  // ignores the container outright, which would leave the chat with nowhere
  // to appear if the Activity Bar fallback weren't gated on this.
  it('recognizes the versions that can host a container on the right', () => {
    expect(supportsSecondarySidebar('1.106.0')).toBe(true);
    expect(supportsSecondarySidebar('1.138.0')).toBe(true);
    expect(supportsSecondarySidebar('2.0.0')).toBe(true);
  });

  it('falls back on older hosts and on anything it cannot read', () => {
    expect(supportsSecondarySidebar('1.105.2')).toBe(false);
    expect(supportsSecondarySidebar('1.85.0')).toBe(false);
    // Forks report their own version strings; an unreadable one takes the
    // fallback, which works everywhere, rather than the view that may not.
    expect(supportsSecondarySidebar('weird-build')).toBe(false);
  });

  it('reads a pre-release suffix as its release', () => {
    expect(supportsSecondarySidebar('1.138.0-insider')).toBe(true);
  });
});
