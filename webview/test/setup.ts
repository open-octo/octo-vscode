// acquireVsCodeApi() only exists in the real webview HTML runtime.
// vscodeApi.ts calls it lazily (on first postToHost), so most tests never
// need this — but stubbed globally anyway so a test that does exercise a
// postToHost-triggering action doesn't crash on a missing global.
//
// The stub structured-clones every payload, exactly as the real
// webview->host bridge does. That is not ceremony: a Svelte $state value
// handed to postMessage is a Proxy, and structured clone throws
// DataCloneError on one (85355b6 shipped that bug once). Cloning here means
// any test that sends such a payload fails in the suite rather than only in
// a running VS Code.
//
// The recorder is resolved off globalThis on every call, never captured in
// the closure: vscodeApi.ts memoizes the api object on first use, and test
// files share a worker — so a stub holding its own array would keep filling
// the FIRST file's array long after this setup ran again for the next one.
(globalThis as Record<string, unknown>).postedToHost = [];
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => {
    structuredClone(message);
    ((globalThis as Record<string, unknown>).postedToHost as unknown[]).push(message);
  },
  getState: () => undefined,
  setState: () => {},
});
