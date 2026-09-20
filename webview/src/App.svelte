<script lang="ts">
  import Composer from './components/Composer.svelte';
  import ConfirmModal from './components/ConfirmModal.svelte';
  import MessageList from './components/MessageList.svelte';
  import QuestionModal from './components/QuestionModal.svelte';
  import SessionHeader from './components/SessionHeader.svelte';
  import ThinkingBlock from './components/ThinkingBlock.svelte';
  import TodoPanel from './components/TodoPanel.svelte';
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
  <SessionHeader session={chatState.session} busy={chatState.busy} />

  {#if connectionLabel}
    <div class="banner" class:error={chatState.connectionState === 'failed'}>{connectionLabel}</div>
  {/if}

  <MessageList blocks={chatState.blocks} onOpenFile={(path) => chatState.openFile(path)} />

  {#if chatState.thinking}
    <!-- The round currently streaming: shown live, then handed to the
         assistant block it belongs to once the reply starts. -->
    <div class="live-think"><ThinkingBlock text={chatState.thinking} live /></div>
  {:else if chatState.status}
    <div class="status-line">{chatState.status}</div>
  {/if}
  {#if chatState.toast}
    <!-- The inline slash commands (/clear, /compact, /reload, /goal) report
         through nothing else — this line is their entire output. -->
    <div class="status-line" class:error={chatState.toast.level === 'error'}>{chatState.toast.message}</div>
  {/if}
  {#if chatState.sendError}
    <div class="status-line error">{chatState.sendError}</div>
  {/if}

  <TodoPanel todos={chatState.todos} />

  <Composer
    disabled={chatState.connectionState !== 'connected'}
    busy={chatState.busy}
    queuedCount={chatState.queuedCount}
    pendingAttachments={chatState.pendingAttachments}
    activeFile={chatState.activeFile}
    skills={chatState.skills}
    onSend={(text, files) => chatState.sendMessage(text, files)}
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
  onAnswer={(outcome, answers) => chatState.answerQuestion(outcome, answers)}
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
  .live-think {
    flex-shrink: 0;
    padding: 2px 12px;
  }
</style>
