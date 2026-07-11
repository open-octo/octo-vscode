import * as vscode from 'vscode';

import { ChatPanel } from './chat/ChatPanel';
import { ChatSessionManager } from './chat/ChatSessionManager';
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
  context.subscriptions.push(vscode.window.registerTreeDataProvider('octo.sessionsView', sessionList));
  // The list's "current" marker and its contents both depend on state this
  // extension only learns asynchronously (session creation, history-driven
  // switches, the startup restore below) — refresh on every event/history
  // tick rather than trying to guess which ones actually change the list.
  context.subscriptions.push(session.onEvent(() => sessionList.refresh()));
  context.subscriptions.push(session.onHistoryLoaded(() => sessionList.refresh()));
  // session_deleted and session_renamed are both broadcast globally and can
  // name a session other than whichever one is currently open in the panel
  // (session.onEvent above only fires for the active one) — listen on the raw
  // connection stream so a deletion or an auto-generated title from any
  // client, of any session, still updates the list. session_renamed is octo's
  // post-first-turn auto-title broadcast; refreshing re-fetches the list with
  // the new name in place.
  context.subscriptions.push(
    controller.onEvent(({ event }) => {
      if (event.type === 'session_deleted' || event.type === 'session_renamed') sessionList.refresh();
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
    vscode.commands.registerCommand('octo.newSession', () => {
      void ChatPanel.openNew(context.extensionUri, controller, session);
    }),
    vscode.commands.registerCommand('octo.openSession', (sessionId: string) => {
      void ChatPanel.openSession(context.extensionUri, controller, session, sessionId);
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
        sessionList.refresh();
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
    .then(() => sessionList.refresh());
}

export function deactivate(): void {
  // Teardown happens via context.subscriptions (ConnectionController.dispose
  // closes the socket; a spawned daemon is left running by design).
}
