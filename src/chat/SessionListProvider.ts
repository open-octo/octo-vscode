import * as vscode from 'vscode';

import { ChatSessionManager } from './ChatSessionManager';
import { OctoSession } from '../octoClient/octoClient';

/** "3m", "2h", "5d" — a width-stable age, in the space a tree item's
 * description actually has. Empty when the server sent no timestamp. */
function age(session: OctoSession): string {
  const stamp = Date.parse(session.updatedAt ?? session.createdAt ?? '');
  if (!stamp) return '';
  const minutes = Math.max(0, Math.round((Date.now() - stamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The icon carries the session's state, because the description column is
 * too narrow to spell it out: something waiting on the user outranks
 * something running, which outranks the plain open/not-open marker. */
function icon(session: OctoSession, isCurrent: boolean): vscode.ThemeIcon {
  if (session.pendingQuestion || session.pendingConfirmation) {
    return new vscode.ThemeIcon('question', new vscode.ThemeColor('list.warningForeground'));
  }
  if (session.status === 'running' || session.status === 'busy') {
    return new vscode.ThemeIcon('sync~spin');
  }
  return new vscode.ThemeIcon(isCurrent ? 'circle-filled' : 'circle-outline');
}

export class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly session: OctoSession, isCurrent: boolean) {
    super(session.name || 'Untitled', vscode.TreeItemCollapsibleState.None);
    const waiting = session.pendingQuestion || session.pendingConfirmation;
    this.description = [waiting ? 'waiting for you' : '', age(session)].filter(Boolean).join(' · ');
    this.iconPath = icon(session, isCurrent);
    this.tooltip = new vscode.MarkdownString(
      [
        `**${session.name || 'Untitled'}**`,
        session.status ? `Status: ${session.status}` : '',
        typeof session.contextUsage === 'number' ? `Context: ${session.contextUsage}%` : '',
        session.updatedAt ? `Updated: ${new Date(session.updatedAt).toLocaleString()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    // Both the inline delete/rename buttons hang off this (package.json's
    // view/item/context menu).
    this.contextValue = 'octoSession';
    this.command = { command: 'octo.openSession', title: 'Open Session', arguments: [session.id] };
  }
}

/**
 * The session list at the top of the octo Activity Bar container, above the
 * chat view itself (ChatViewProvider). Clicking an item switches the chat to
 * that session; the composer and transcript live entirely in the chat view.
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
