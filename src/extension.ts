import * as vscode from 'vscode';

import { ChatSessionManager } from './chat/ChatSessionManager';
import {
  CHAT_FALLBACK_VIEW_ID,
  CHAT_VIEW_ID,
  ChatViewProvider,
  supportsSecondarySidebar,
} from './chat/ChatViewProvider';
import { SessionListProvider, SessionTreeItem } from './chat/SessionListProvider';
import { ConnectionController } from './connection/ConnectionController';
import { registerDiffContentProvider } from './context/diffView';
import { trackActiveEditor } from './context/editorContext';

function renderStatusBar(item: vscode.StatusBarItem, controller: ConnectionController): void {
  switch (controller.getState()) {
    case 'connected':
      item.text = '$(check) octo: connected';
      break;
    case 'connecting':
      item.text = '$(sync~spin) octo: connecting';
      break;
    case 'failed':
      item.text = '$(error) octo: failed';
      break;
    default:
      item.text = '$(circle-slash) octo: disconnected';
  }
  item.tooltip = controller.describe();
  item.show();
}

export function activate(context: vscode.ExtensionContext): void {
  // Drives the `when` clauses that pick between the Secondary Side Bar view
  // and the Activity Bar fallback (see ChatViewProvider). Set before anything
  // else: it decides which of the two views VS Code is allowed to build.
  if (!supportsSecondarySidebar()) {
    void vscode.commands.executeCommand('setContext', 'octo.noSecondarySidebar', true);
  }

  registerDiffContentProvider(context);
  trackActiveEditor(context);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'octo.showStatus';
  context.subscriptions.push(statusBarItem);

  const controller = new ConnectionController();
  context.subscriptions.push(controller);
  context.subscriptions.push(controller.onStateChange(() => renderStatusBar(statusBarItem, controller)));
  renderStatusBar(statusBarItem, controller);

  const session = new ChatSessionManager(controller, context.workspaceState);
  context.subscriptions.push(session);

  const sessionList = new SessionListProvider(session);
  context.subscriptions.push(sessionList);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('octo.sessionsView', sessionList));

  // The chat itself, in the Secondary Side Bar — or, on a host without one,
  // under the Activity Bar container beneath the session list. Both ids are
  // registered because only the host knows which view it will build; the
  // `when` clauses guarantee it builds exactly one.
  // retainContextWhenHidden keeps the transcript and the composer's draft
  // alive while the user is off in another view — VS Code otherwise rebuilds
  // a long-hidden webview from scratch.
  const chatView = new ChatViewProvider(context.extensionUri, controller, session);
  context.subscriptions.push(chatView);
  for (const viewId of [CHAT_VIEW_ID, CHAT_FALLBACK_VIEW_ID]) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(viewId, chatView, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }
  // The list's "current" marker and its contents both depend on state this
  // extension only learns asynchronously (session creation, history-driven
  // switches, the startup restore below) — refresh on every event/history
  // tick rather than trying to guess which ones actually change the list.
  context.subscriptions.push(session.onEvent(() => sessionList.refresh()));
  context.subscriptions.push(session.onHistoryLoaded(() => sessionList.refresh()));
  // session_deleted and session_renamed are both broadcast globally and can
  // name a session other than whichever one is currently open in the chat view
  // (session.onEvent above only fires for the active one) — listen on the raw
  // connection stream so a deletion or an auto-generated title from any
  // client, of any session, still updates the list. session_renamed is octo's
  // post-first-turn auto-title broadcast; refreshing re-fetches the list with
  // the new name in place.
  context.subscriptions.push(
    controller.onEvent(({ event }) => {
      if (
        event.type === 'session_deleted' ||
        event.type === 'session_renamed' ||
        // Any client creating a session in this workspace's project — including
        // this extension's own octo.newSession — belongs in the list at once.
        event.type === 'session_created'
      ) {
        sessionList.refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('octo.showStatus', () => {
      void vscode.window.showInformationMessage(controller.describe());
    }),
    vscode.commands.registerCommand('octo.reconnect', () => {
      controller.disconnect();
      void controller.connect();
    }),
    vscode.commands.registerCommand('octo.newSession', async () => {
      // Focus first: the reveal is what makes VS Code resolve the webview, so
      // the new session's (empty) history has somewhere to land.
      await ChatViewProvider.reveal();
      try {
        await session.startNewSession();
      } catch (err) {
        // A connection failure was already reported by
        // ConnectionController.connect()'s own showErrorMessage, and the chat
        // view's banner reflects it too — swallowing a second, redundant
        // notification is the point. Anything else (the workspace's project
        // deleted by another client, so the create 404s) would otherwise make
        // the click do nothing at all, with no explanation.
        if (controller.getState() === 'connected') {
          void vscode.window.showErrorMessage(
            `octo: failed to start a session — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }),
    vscode.commands.registerCommand('octo.openSession', async (sessionId: string) => {
      await ChatViewProvider.reveal();
      if (sessionId !== session.getSessionId()) {
        await session.switchToSession(sessionId).catch(() => undefined);
      }
    }),
    vscode.commands.registerCommand('octo.refreshSessions', () => sessionList.refreshNow()),
    vscode.commands.registerCommand('octo.renameSession', async (item: SessionTreeItem) => {
      const name = await vscode.window.showInputBox({
        title: 'Rename octo session',
        value: item.session.name,
        // Naming a session also stops octo auto-titling it later — worth
        // saying, since the auto-title is what most sessions run on.
        prompt: 'octo stops auto-naming a session once you name it yourself.',
      });
      if (name === undefined || !name.trim()) return;
      try {
        await session.renameSession(item.session.id, name.trim());
        sessionList.refreshNow();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `octo: failed to rename session — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('octo.deleteSession', async (item: SessionTreeItem) => {
      const label = item.session.name || 'Untitled';
      const confirmed = await vscode.window.showWarningMessage(
        `Delete session "${label}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      try {
        await session.deleteSession(item.session.id);
        sessionList.refreshNow();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `octo: failed to delete session — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  void controller
    .connect()
    .then(() => session.restoreLastSession())
    .then(() => sessionList.refreshNow());
}

export function deactivate(): void {
  // Teardown happens via context.subscriptions (ConnectionController.dispose
  // closes the socket; a spawned daemon is left running by design).
}
