import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { OctoSession } from '../octoClient/octoClient';

class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly session: OctoSession, isCurrent: boolean) {
    super(session.name || 'Untitled', vscode.TreeItemCollapsibleState.None);
    this.description = session.status;
    this.iconPath = new vscode.ThemeIcon(isCurrent ? 'circle-filled' : 'circle-outline');
    this.command = { command: 'octo.openSession', title: 'Open Session', arguments: [session.id] };
  }
}

/**
 * The Activity Bar's persistent view: just the list, plus a title-bar "New
 * Session" button (contributes.menus["view/title"]) — no composer, no
 * input box here at all. Opening an item (or "New") opens/reveals the chat
 * detail surface as a WebviewPanel beside the editor (see ChatPanel), which
 * is where the actual conversation and its composer live.
 */
export class SessionListProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly session: ChatSessionManager) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SessionTreeItem[]> {
    const sessions = await this.session.listWorkspaceSessions();
    const currentId = this.session.getSessionId();
    return sessions.map((s) => new SessionTreeItem(s, s.id === currentId));
  }
}
