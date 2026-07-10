import { vi } from 'vitest';

// Minimal stand-in for vscode.EventEmitter — same subscribe/fire/dispose
// shape, no VS Code runtime required.
class FakeEventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}

// The real `vscode` module only exists inside the extension host — mocked
// here with just enough surface for the units under test (ChatSessionManager,
// diffView's pure helpers). Extend as more host-side tests need more of it.
vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  workspace: {
    workspaceFolders: undefined,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }),
    from: (opts: { scheme: string; path: string }) => ({
      fsPath: opts.path,
      toString: () => `${opts.scheme}:${opts.path}`,
    }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
    }),
  },
}));
