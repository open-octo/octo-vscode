// acquireVsCodeApi() only exists in the real webview HTML runtime.
// vscodeApi.ts calls it lazily (on first postToHost), so most tests never
// need this — but stubbed globally anyway so a test that does exercise a
// postToHost-triggering action doesn't crash on a missing global.
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} });
