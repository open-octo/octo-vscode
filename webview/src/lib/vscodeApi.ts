import type { OutboundHostMessage } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function postToHost(message: OutboundHostMessage): void {
  api.postMessage(message);
}
