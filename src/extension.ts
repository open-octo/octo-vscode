import * as vscode from 'vscode';

import { ChatSessionManager } from './chat/ChatSessionManager';
import { ChatViewProvider } from './chat/ChatViewProvider';
import { ConnectionController } from './connection/ConnectionController';
import { registerDiffContentProvider } from './context/diffView';

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

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'octo.showStatus';
  context.subscriptions.push(statusBarItem);

  const controller = new ConnectionController();
  context.subscriptions.push(controller);
  context.subscriptions.push(controller.onStateChange(() => renderStatusBar(statusBarItem, controller)));
  renderStatusBar(statusBarItem, controller);

  const session = new ChatSessionManager(controller, context.workspaceState);
  context.subscriptions.push(session);

  const chatViewProvider = new ChatViewProvider(context.extensionUri, controller, session);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatViewProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('octo.showStatus', () => {
      void vscode.window.showInformationMessage(controller.describe());
    }),
    vscode.commands.registerCommand('octo.reconnect', () => {
      controller.disconnect();
      void controller.connect();
    }),
    vscode.commands.registerCommand('octo.switchSession', () => {
      void chatViewProvider.showSessionPicker();
    }),
  );

  void controller.connect().then(() => session.restoreLastSession());
}

export function deactivate(): void {
  // Teardown happens via context.subscriptions (ConnectionController.dispose
  // closes the socket; a spawned daemon is left running by design).
}
