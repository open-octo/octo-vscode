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
  version: '1.138.0',
  // Mutable by tests: a workspace folder is what turns on the project-binding
  // path in ChatSessionManager.
  workspace: {
    workspaceFolders: undefined,
    name: undefined,
    asRelativePath: (uri: { fsPath: string }) => String(uri.fsPath).replace(/^\//, ''),
  },
  // Mutable by tests, same as workspace above: activeTextEditor is what the
  // editor-context capture reads, and the chat view subscribes to the two
  // editor events at resolve time.
  window: {
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: () => {} })),
    onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: () => {} })),
  },
  languages: {
    getDiagnostics: vi.fn(() => []),
  },
  ViewColumn: { Active: -1, One: 1, Two: 2, Beside: -2 },
  MarkdownString: class {
    constructor(public value?: string) {}
  },
  ThemeIcon: class {
    constructor(
      public id: string,
      public color?: unknown,
    ) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  TreeItem: class {
    constructor(
      public label: string,
      public collapsibleState?: unknown,
    ) {}
  },
  TreeItemCollapsibleState: { None: 0 },
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
