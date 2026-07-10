<script lang="ts">
  import type { Block } from '../lib/chatState.svelte';

  let { blocks }: { blocks: Block[] } = $props();

  let container: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Re-run whenever the block count or any block's text length changes —
    // referencing blocks.length here (not just in the DOM below) is what
    // gives this effect a reactive dependency to track.
    void blocks.length;
    container?.scrollTo({ top: container.scrollHeight });
  });
</script>

<div class="list" bind:this={container}>
  {#each blocks as block}
    {#if block.kind === 'tool'}
      <div class="tool">
        <div class="tool-header">
          <span class="tool-name">{block.name}</span>
          {#if block.summary}<span class="tool-summary">{block.summary}</span>{/if}
        </div>
        {#if block.stdout.length}
          <pre class="tool-body">{block.stdout.join('\n')}</pre>
        {/if}
        {#if block.error}
          <pre class="tool-body error">{block.error}</pre>
        {:else if block.result}
          <pre class="tool-body">{block.result}</pre>
        {/if}
      </div>
    {:else}
      <div class="bubble" class:user={block.kind === 'user'} class:assistant={block.kind === 'assistant'}>
        {block.text}
      </div>
    {/if}
  {/each}
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bubble {
    padding: 8px 10px;
    border-radius: 6px;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.5;
  }
  .bubble.user {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    align-self: flex-end;
    max-width: 90%;
  }
  .bubble.assistant {
    background: transparent;
  }
  .tool {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    overflow: hidden;
    font-size: 12px;
  }
  .tool-header {
    display: flex;
    gap: 8px;
    padding: 5px 8px;
    background: var(--vscode-editorWidget-background);
  }
  .tool-name {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family);
  }
  .tool-summary {
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-body {
    margin: 0;
    padding: 6px 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }
  .tool-body.error {
    color: var(--vscode-errorForeground);
  }
</style>
