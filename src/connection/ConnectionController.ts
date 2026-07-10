import * as vscode from 'vscode';

import { OctoClient, OctoEvent, OctoSession, OctoUserFile } from '../octoClient/octoClient';
import { ensureServerRunning } from '../octoClient/serverLauncher';

export interface OctoConfig {
  host: string;
  port: number;
  accessKey?: string;
  autoStart: boolean;
  binaryPath: string;
}

export function readConfig(): OctoConfig {
  const cfg = vscode.workspace.getConfiguration('octo');
  return {
    host: cfg.get<string>('host', '127.0.0.1'),
    port: cfg.get<number>('port', 8088),
    accessKey: cfg.get<string>('accessKey', '') || undefined,
    autoStart: cfg.get<boolean>('autoStart', true),
    binaryPath: cfg.get<string>('binaryPath', 'octo'),
  };
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

/**
 * The single owner of the OctoClient connection. Every other consumer
 * (status bar, chat webview, future diff/file-preview handlers) reads
 * state and events through this mediator instead of calling
 * OctoClient.connect() itself — OctoClient only supports one set of
 * handlers at a time, and the webview must survive being hidden/recreated
 * without tearing down the socket.
 */
export class ConnectionController {
  private client: OctoClient | null = null;
  private state: ConnectionState = 'disconnected';
  private origin: 'attached' | 'spawned' | null = null;

  private readonly stateEmitter = new vscode.EventEmitter<ConnectionState>();
  private readonly eventEmitter = new vscode.EventEmitter<{ sessionId?: string; event: OctoEvent }>();

  readonly onStateChange = this.stateEmitter.event;
  readonly onEvent = this.eventEmitter.event;

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
      onEvent: (sessionId, event) => this.eventEmitter.fire({ sessionId, event }),
    });
  }

  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
    this.setState('disconnected');
  }

  getState(): ConnectionState {
    return this.state;
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

  subscribe(sessionId: string): void {
    this.requireClient().subscribe(sessionId);
  }

  async createSession(opts: { name?: string; workingDir?: string }): Promise<OctoSession> {
    return this.requireClient().createSession(opts);
  }

  sendUserMessage(sessionId: string, content: string, files?: OctoUserFile[]): void {
    this.requireClient().sendUserMessage(sessionId, content, files);
  }

  interrupt(sessionId: string): void {
    this.requireClient().interrupt(sessionId);
  }

  confirm(id: string, result: string): void {
    this.requireClient().confirm(id, result);
  }

  answerUserQuestion(questionId: string, choices: string[], custom: string, cancelled: boolean): void {
    this.requireClient().answerUserQuestion(questionId, choices, custom, cancelled);
  }

  dispose(): void {
    this.disconnect();
    this.stateEmitter.dispose();
    this.eventEmitter.dispose();
  }

  private requireClient(): OctoClient {
    if (!this.client) {
      throw new Error('octo: not connected');
    }
    return this.client;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.stateEmitter.fire(state);
  }
}
