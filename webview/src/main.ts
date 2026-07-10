import { mount } from 'svelte';

import App from './App.svelte';
import { chatState } from './lib/chatState.svelte';
import { postToHost } from './lib/vscodeApi';
import type { InboundHostMessage } from './lib/protocol';

window.addEventListener('message', (event: MessageEvent<InboundHostMessage>) => {
  chatState.handleHostMessage(event.data);
});

postToHost({ command: 'ready' });

mount(App, { target: document.getElementById('app')! });
