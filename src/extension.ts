import * as vscode from 'vscode';

import { OctoClient } from './octoClient/octoClient';
import { ensureServerRunning } from './octoClient/serverLauncher';

interface OctoConfig {
  host: string;
  port: number;
  accessKey?: string;
  autoStart: boolean;
  binaryPath: string;
}

function readConfig(): OctoConfig {
  const cfg = vscode.workspace.getConfiguration('octo');
  return {
    host: cfg.get<string>('host', '127.0.0.1'),
    port: cfg.get<number>('port', 8088),
    accessKey: cfg.get<string>('accessKey', '') || undefined,
    autoStart: cfg.get<boolean>('autoStart', true),
    binaryPath: cfg.get<string>('binaryPath', 'octo'),
  };
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

class ConnectionController {
  private client: OctoClient | null = null;
  private state: ConnectionState = 'disconnected';
  private origin: 'attached' | 'spawned' | null = null;

  constructor(private readonly statusBarItem: vscode.StatusBarItem) {
    this.render();
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    const config = readConfig();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const result = await ensureServerRunning({
      host: config.host,
      port: config.port,
      accessKey: config.accessKey,
      binaryPath: config.binaryPath,
      cwd: workspaceFolder?.uri.fsPath,
    });

    if (result.outcome === 'failed') {
      this.setState('failed');
      void vscode.window.showErrorMessage(`octo: ${result.reason}`);
      return;
    }
    this.origin = result.outcome;

    const client = new OctoClient({ host: config.host, port: config.port, accessKey: config.accessKey });
    this.client = client;

    client.connect({
      onOpen: () => this.setState('connected'),
      onClose: () => this.setState('disconnected'),
      onError: (err) => console.error('octo client error:', err),
    });
  }

  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
    this.setState('disconnected');
  }

  getClient(): OctoClient | null {
    return this.client;
  }

  describe(): string {
    const config = readConfig();
    const base = `http://${config.host}:${config.port}`;
    switch (this.state) {
      case 'connected':
        return `Connected to ${base} (${this.origin === 'spawned' ? 'daemon started by this extension' : 'attached to an existing server'}).`;
      case 'connecting':
        return `Connecting to ${base}...`;
      case 'failed':
        return `Failed to reach or start octo serve at ${base}.`;
      default:
        return `Not connected to ${base}.`;
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    switch (this.state) {
      case 'connected':
        this.statusBarItem.text = '$(check) octo: connected';
        this.statusBarItem.tooltip = this.describe();
        break;
      case 'connecting':
        this.statusBarItem.text = '$(sync~spin) octo: connecting';
        this.statusBarItem.tooltip = this.describe();
        break;
      case 'failed':
        this.statusBarItem.text = '$(error) octo: failed';
        this.statusBarItem.tooltip = this.describe();
        break;
      default:
        this.statusBarItem.text = '$(circle-slash) octo: disconnected';
        this.statusBarItem.tooltip = this.describe();
    }
    this.statusBarItem.show();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'octo.showStatus';
  context.subscriptions.push(statusBarItem);

  const controller = new ConnectionController(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('octo.showStatus', () => {
      void vscode.window.showInformationMessage(controller.describe());
    }),
    vscode.commands.registerCommand('octo.reconnect', () => {
      controller.disconnect();
      void controller.connect();
    }),
  );

  void controller.connect();

  context.subscriptions.push({ dispose: () => controller.disconnect() });
}

export function deactivate(): void {
  // Connection teardown happens via the subscriptions.push({ dispose }) above.
}
