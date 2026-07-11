<script lang="ts">
  import Composer from './components/Composer.svelte';
  import ConfirmModal from './components/ConfirmModal.svelte';
  import MessageList from './components/MessageList.svelte';
  import QuestionModal from './components/QuestionModal.svelte';
  import { chatState } from './lib/chatState.svelte';

  const connectionLabel = $derived(
    {
      connected: null,
      connecting: 'Connecting to octo serve…',
      disconnected: 'Not connected to octo serve.',
      failed: 'Failed to reach octo serve.',
    }[chatState.connectionState],
  );
</script>

<div class="app">
  {#if connectionLabel}
    <div class="banner" class:error={chatState.connectionState === 'failed'}>{connectionLabel}</div>
  {/if}

  <MessageList
    blocks={chatState.blocks}
    onOpenFile={(path) => chatState.openFile(path)}
    onViewDiff={(diff, path) => chatState.viewDiff(diff, path)}
  />

  {#if chatState.thinking}
    <div class="status-line thinking">{chatState.thinking}</div>
  {:else if chatState.status}
    <div class="status-line">{chatState.status}</div>
  {/if}
  {#if chatState.sendError}
    <div class="status-line error">{chatState.sendError}</div>
  {/if}

  <Composer
    disabled={chatState.connectionState !== 'connected'}
    busy={chatState.busy}
    pendingAttachments={chatState.pendingAttachments}
    activeFile={chatState.activeFile}
    onSend={(text) => chatState.sendMessage(text)}
    onInterrupt={() => chatState.interrupt()}
    onPickFile={() => chatState.pickFile()}
    onRemoveAttachment={(label) => chatState.removeAttachment(label)}
  />
</div>

<ConfirmModal
  pending={chatState.pendingConfirmation}
  onAnswer={(id, result) => chatState.answerConfirmation(id, result)}
/>
<QuestionModal
  pending={chatState.pendingQuestion}
  onAnswer={(choices, custom, cancelled) => chatState.answerQuestion(choices, custom, cancelled)}
/>

<style>
  :global(html, body, #app) {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  :global(body) {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-sideBar-background);
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .banner {
    padding: 6px 10px;
    font-size: 12px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border);
    color: var(--vscode-descriptionForeground);
  }
  .banner.error {
    color: var(--vscode-errorForeground);
  }
  .status-line {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .status-line.error {
    color: var(--vscode-errorForeground);
  }
  .status-line.thinking {
    font-style: italic;
  }
</style>
