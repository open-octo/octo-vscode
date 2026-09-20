import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import type { ConnectionController } from '../connection/ConnectionController';
import type { OctoEvent, OctoSessionGroup } from '../octoClient/octoClient';

// The mocked `vscode` module's workspace is a plain mutable object (see
// test/vitest.setup.ts) — tests that need a workspace open write to it here.
const workspace = vscode.workspace as { workspaceFolders?: unknown; name?: string };

function openWorkspace(...paths: string[]): void {
  workspace.workspaceFolders = paths.map((p) => ({ uri: { fsPath: p } }));
}

afterEach(() => {
  workspace.workspaceFolders = undefined;
  workspace.name = undefined;
});

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
    createSession: vi.fn(async (opts?: { groupId?: string }) => {
      calls.push(`createSession:${opts?.groupId ?? 'no-group'}`);
      // Empty name mirrors what the server returns for a placeholder session
      // (see createAndBindSession: no name is sent so octo can auto-title).
      return { id: 'new-session', name: '' };
    }),
    listSessions: vi.fn(async () => []),
    listSessionGroups: vi.fn(async (): Promise<OctoSessionGroup[]> => {
      calls.push('listSessionGroups');
      return [];
    }),
    createSessionGroup: vi.fn(async (name: string, sourceDirs: string[]): Promise<OctoSessionGroup> => {
      calls.push(`createSessionGroup:${name}:${sourceDirs.join(',')}`);
      return { id: 'group-new', name, sourceDirs, sessionIds: [] };
    }),
    renameSession: vi.fn(async () => {}),
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

    expect(calls).toEqual(['createSession:no-group', 'subscribe:new-session']);
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

describe('ChatSessionManager project binding', () => {
  // A session's working directory comes from its project — PATCH
  // /api/sessions/{id}/working_dir answers 409 unconditionally — and
  // handleCreateSession only skips seeding a throwaway ~/Octo/tasks/<id>
  // workspace when it can already see the membership. So group_id at creation
  // time is the only thing that puts a session in the workspace.
  it('files a new session under the project that already mounts this workspace', async () => {
    const { controller, calls } = fakeController();
    controller.listSessionGroups = vi.fn(async () => [
      { id: 'group-other', name: 'other', sourceDirs: ['/elsewhere'], sessionIds: [] },
      { id: 'group-here', name: 'repo', sourceDirs: ['/repo/'], sessionIds: [] },
    ]);
    openWorkspace('/repo');
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.startNewSession();

    expect(calls).toContain('createSession:group-here');
    expect(controller.createSessionGroup).not.toHaveBeenCalled();
  });

  it('creates the project, mounting every workspace folder, when none matches', async () => {
    const { controller, calls } = fakeController();
    openWorkspace('/repo', '/repo-docs');
    workspace.name = 'repo (Workspace)';
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.startNewSession();

    expect(calls).toContain('createSessionGroup:repo (Workspace):/repo,/repo-docs');
    expect(calls).toContain('createSession:group-new');
  });

  it('creates only one project when two sessions are started at once', async () => {
    const { controller } = fakeController();
    openWorkspace('/repo');
    const manager = new ChatSessionManager(controller, fakeMemento());

    await Promise.all([manager.startNewSession(), manager.startNewSession()]);

    expect(controller.createSessionGroup).toHaveBeenCalledTimes(1);
  });

  it('still creates the session when the project cannot be resolved', async () => {
    const { controller, calls } = fakeController();
    controller.createSessionGroup = vi.fn().mockRejectedValue(new Error('bad source dir'));
    openWorkspace('/repo');
    const manager = new ChatSessionManager(controller, fakeMemento());

    await manager.startNewSession();

    // A loose session still chats — it just can't see the repository — which
    // beats failing the click outright.
    expect(calls).toContain('createSession:no-group');
  });

  it('lists the project members, newest first, not sessions matching working_dir', async () => {
    const { controller } = fakeController();
    controller.listSessionGroups = vi.fn(async () => [
      { id: 'group-here', name: 'repo', sourceDirs: ['/repo'], sessionIds: ['a', 'b'] },
    ]);
    controller.listSessions = vi.fn(async () => [
      // Every session in a project reports the project's own generated
      // workspace as working_dir — never the mounted folder — so the old
      // working_dir filter matched nothing at all.
      { id: 'a', name: 'older', workingDir: '/octo/workspaces/repo', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'b', name: 'newer', workingDir: '/octo/workspaces/repo', updatedAt: '2026-09-19T00:00:00Z' },
      { id: 'c', name: 'someone else', workingDir: '/octo/workspaces/other' },
    ]);
    openWorkspace('/repo');
    const manager = new ChatSessionManager(controller, fakeMemento());

    const sessions = await manager.listWorkspaceSessions();

    expect(sessions.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('does not create a project just to list sessions', async () => {
    const { controller } = fakeController();
    openWorkspace('/repo');
    const manager = new ChatSessionManager(controller, fakeMemento());

    await expect(manager.listWorkspaceSessions()).resolves.toEqual([]);
    expect(controller.createSessionGroup).not.toHaveBeenCalled();
  });
});

describe('session naming', () => {
  it('treats octo’s own untitled placeholders as no name at all', async () => {
    // agent.IsAutoNamePlaceholder: empty, "*Octo Agent" (stamped on a session
    // with no turns), or the web frontend's "Session N". Printed verbatim,
    // these put "*Octo Agent" in the chat header until the first turn ends.
    const { controller } = fakeController();
    controller.listSessions = vi.fn(async () => [
      { id: 'a', name: '*Octo Agent' },
      { id: 'b', name: 'Session 3' },
      { id: 'c', name: 'Fix the flaky test' },
    ]);
    const manager = new ChatSessionManager(controller, fakeMemento());

    await expect(manager.sessionName('a')).resolves.toBe('');
    await expect(manager.sessionName('b')).resolves.toBe('');
    await expect(manager.sessionName('c')).resolves.toBe('Fix the flaky test');
  });
});
