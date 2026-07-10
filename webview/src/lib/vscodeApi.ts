import type { OutboundHostMessage } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
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
