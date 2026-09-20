import type { OutboundHostMessage } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Lazy rather than called at module scope: acquireVsCodeApi() only exists
// in the real webview HTML runtime, and eagerly calling it here would make
// this module (and anything importing it, e.g. chatState.svelte.ts) throw
// at import time under a plain test runner.
let api: VsCodeApi | undefined;

export function postToHost(message: OutboundHostMessage): void {
  api ??= acquireVsCodeApi();
  api.postMessage(message);
}

/**
 * The webview's own persisted scratch state. Survives the view being hidden
 * and rebuilt by VS Code — which is exactly when an unsent draft would
 * otherwise vanish. Best-effort: outside the webview runtime (tests) there is
 * no API to read, and a draft is never worth throwing for.
 */
export function readViewState<T>(): T | undefined {
  try {
    api ??= acquireVsCodeApi();
    return api.getState() as T | undefined;
  } catch {
    return undefined;
  }
}

export function writeViewState(state: unknown): void {
  try {
    api ??= acquireVsCodeApi();
    api.setState(state);
  } catch {
    // see readViewState
  }
}
