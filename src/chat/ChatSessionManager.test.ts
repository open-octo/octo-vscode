import { describe, expect, it, vi } from 'vitest';

import { ChatSessionManager } from './ChatSessionManager';
import type { ConnectionController } from '../connection/ConnectionController';
import type { OctoEvent } from '../octoClient/octoClient';

// Duck-typed fake covering exactly the ConnectionController surface
// ChatSessionManager calls, with a call log so ordering can be asserted —
// the thing that actually matters here, not just "was it called". Also
// captures the onEvent callback so tests can simulate a broadcast (e.g.
// session_deleted) arriving on the connection's raw event stream.
function fakeController(events: unknown[] = []) {
  const calls: string[] = [];
  let onEventCallback: ((payload: { sessionId?: string; event: OctoEvent }) => void) | undefined;
  const controller = {
    onEvent: vi.fn((cb: (payload: { sessionId?: string; event: OctoEvent }) => void) => {
      onEventCallback = cb;
      return { dispose: () => {} };
    }),
    onStateChange: vi.fn(() => ({ dispose: () => {} })),
    ready: vi.fn(async () => {}),
    unsubscribe: vi.fn((id: string) => calls.push(`unsubscribe:${id}`)),
    subscribe: vi.fn((id: string) => calls.push(`subscribe:${id}`)),
    getSessionMessages: vi.fn(async (id: string) => {
      calls.push(`getSessionMessages:${id}`);
      return events;
    }),
    createSession: vi.fn(async () => {
      calls.push('createSession');
      // Empty name mirrors what the server returns for a placeholder session
      // (see createAndBindSession: no name is sent so octo can auto-title).
      return { id: 'new-session', name: '' };
    }),
    listSessions: vi.fn(async () => []),
    deleteSession: vi.fn(async (id: string) => {
      calls.push(`deleteSession:${id}`);
    }),
  };
  return {
    controller: controller as unknown as ConnectionController,
    calls,
    fireEvent: (payload: { sessionId?: string; event: OctoEvent }) => onEventCallback?.(payload),
  };
}

function fakeMemento() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    }),
  } as unknown as import('vscode').Memento;
}

describe('ChatSessionManager.switchToSession', () => {
  it('fetches history before subscribing, not after', async () => {
    const { controller, calls } = fakeController();
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.switchToSession('session-2');

    // Regression test for the exact bug this ordering caused: subscribing
    // before history arrives lets a live event for the new session render,
    // then get silently wiped by loadHistory()'s unconditional reset once
    // the (now-stale-relative-to-that-event) history response lands.
    const getIdx = calls.indexOf('getSessionMessages:session-2');
    const subIdx = calls.indexOf('subscribe:session-2');
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThan(getIdx);
  });

  it('unsubscribes the previous session before fetching the new one', async () => {
    const { controller, calls } = fakeController();
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.switchToSession('session-1');
    calls.length = 0;
    await manager.switchToSession('session-2');

    expect(calls).toEqual(['unsubscribe:session-1', 'getSessionMessages:session-2', 'subscribe:session-2']);
  });

  it('persists the switched-to session id and restores it', async () => {
    const { controller } = fakeController();
    const memento = fakeMemento();
    const manager = new ChatSessionManager(controller, memento);

    await manager.switchToSession('session-9');
    expect(memento.get('octo.lastSessionId')).toBe('session-9');

    const { controller: controller2, calls: calls2 } = fakeController();
    const manager2 = new ChatSessionManager(controller2, memento);
    await manager2.restoreLastSession();

    expect(calls2).toContain('getSessionMessages:session-9');
    expect(manager2.getSessionId()).toBe('session-9');
  });

  it('waits for the connection to be ready before touching the client', async () => {
    // Regression test: startNewSession()/switchToSession() used to call
    // straight through to controller methods that throw synchronously
    // ("octo: not connected") if invoked before connect() finishes — e.g. a
    // fast click on the sidebar's "New Session" welcome-view button right
    // after activation. ready() must resolve before any controller call.
    const { controller, calls } = fakeController();
    let releaseReady = () => {};
    controller.ready = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve;
        }),
    );
    const manager = new ChatSessionManager(controller, fakeMemento());

    const pending = manager.startNewSession();
    expect(calls).toEqual([]);

    releaseReady();
    await pending;

    expect(calls).toEqual(['createSession', 'subscribe:new-session']);
  });

  it('creates sessions without a hardcoded name so octo can auto-generate the title', async () => {
    // A real name (this used to be "VS Code") counts as a user-set title on
    // the server and permanently suppresses the post-first-turn auto-title —
    // so createAndBindSession must send no name at all.
    const { controller } = fakeController();
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.startNewSession();

    expect(controller.createSession).toHaveBeenCalledTimes(1);
    const opts = (controller.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts).not.toHaveProperty('name');
  });

  it('clears the persisted session id if it no longer exists on the server', async () => {
    const { controller } = fakeController();
    controller.getSessionMessages = vi.fn().mockRejectedValue(new Error('404'));
    const memento = fakeMemento();
    await memento.update('octo.lastSessionId', 'gone');

    const manager = new ChatSessionManager(controller, memento);
    await manager.restoreLastSession();

    expect(memento.get('octo.lastSessionId')).toBeUndefined();
    expect(manager.getSessionId()).toBeNull();
  });
});

describe('ChatSessionManager.listWorkspaceSessions', () => {
  it('waits for the connection to be ready before listing sessions', async () => {
    // Regression test: the sidebar's TreeDataProvider calls this the moment
    // the view becomes visible — right at activation, before connect()'s
    // daemon spawn/health-check has a chance to finish — and it used to hit
    // the same synchronous "octo: not connected" throw as
    // startNewSession()/switchToSession() did.
    const { controller, calls } = fakeController();
    let releaseReady = () => {};
    controller.ready = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve;
        }),
    );
    controller.listSessions = vi.fn(async () => {
      calls.push('listSessions');
      return [];
    });
    const manager = new ChatSessionManager(controller, fakeMemento());

    const pending = manager.listWorkspaceSessions();
    expect(calls).toEqual([]);

    releaseReady();
    await pending;

    expect(calls).toEqual(['listSessions']);
  });

  it('returns an empty list rather than throwing when the connection attempt fails', async () => {
    const { controller } = fakeController();
    controller.ready = vi.fn().mockRejectedValue(new Error('octo: failed to reach octo serve'));
    const manager = new ChatSessionManager(controller, fakeMemento());

    await expect(manager.listWorkspaceSessions()).resolves.toEqual([]);
  });
});

describe('ChatSessionManager.deleteSession', () => {
  it('deletes via the connection controller', async () => {
    const { controller, calls } = fakeController();
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.deleteSession('session-1');

    expect(calls).toEqual(['deleteSession:session-1']);
  });

  it('clears local state when the deleted session is the one open in the panel', async () => {
    // session_deleted is a global broadcast, so this covers both
    // deleteSession() deleting the active session itself and another
    // client (a different VS Code window, the Web UI) deleting it instead.
    const { controller, fireEvent } = fakeController();
    const memento = fakeMemento();
    const manager = new ChatSessionManager(controller, memento);
    await manager.switchToSession('session-1');

    let history: unknown;
    manager.onHistoryLoaded((h) => (history = h));
    fireEvent({ sessionId: 'session-1', event: { type: 'session_deleted', session_id: 'session-1' } });

    expect(manager.getSessionId()).toBeNull();
    expect(memento.get('octo.lastSessionId')).toBeUndefined();
    expect(history).toEqual({ sessionId: 'session-1', events: [] });
  });

  it('leaves local state alone when a different session is deleted', async () => {
    const { controller, fireEvent } = fakeController();
    const manager = new ChatSessionManager(controller, fakeMemento());
    await manager.switchToSession('session-1');

    fireEvent({ sessionId: 'session-2', event: { type: 'session_deleted', session_id: 'session-2' } });

    expect(manager.getSessionId()).toBe('session-1');
  });
});
