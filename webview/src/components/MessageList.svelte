<script lang="ts">
  import type { Block, ToolBlock } from '../lib/chatState.svelte';
  import type { UIPayload } from '../lib/protocol';

  let {
    blocks,
    onOpenFile,
    onViewDiff,
  }: {
    blocks: Block[];
    onOpenFile: (path: string) => void;
    onViewDiff: (diff: string, path?: string) => void;
  } = $props();

  // Narrowing block.uiPayload?.type === 'edit' inline in the template loses
  // the narrowing by the time it reaches an onclick closure — pulling it
  // through a typed function sidesteps that instead of fighting it.
  function editPayload(block: ToolBlock): Extract<UIPayload, { type: 'edit' }> | undefined {
    return block.uiPayload?.type === 'edit' ? block.uiPayload : undefined;
  }
  function openablePayload(block: ToolBlock): Extract<UIPayload, { type: 'write' | 'file_read' }> | undefined {
    return block.uiPayload?.type === 'write' || block.uiPayload?.type === 'file_read' ? block.uiPayload : undefined;
  }

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
      {@const edit = editPayload(block)}
      {@const openable = openablePayload(block)}
      <div class="tool">
        <div class="tool-header">
          <span class="tool-name">{block.name}</span>
          {#if edit}
            <button class="tool-action" onclick={() => onViewDiff(edit.diff, edit.path)}>View diff</button>
          {:else if openable}
            <button class="tool-action" onclick={() => onOpenFile(openable.path)}>Open</button>
          {/if}
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
        {#if block.attachments?.length}
          <div class="attachments">
            {#each block.attachments as label}<span class="attachment-chip">{label}</span>{/each}
          </div>
        {/if}
        {#if block.thinking}
          <div class="thinking">{block.thinking}</div>
        {/if}
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
  .thinking {
    margin-bottom: 6px;
    padding-left: 8px;
    border-left: 2px solid var(--vscode-widget-border);
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    font-style: italic;
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .attachment-chip {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
  }
  .tool {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    overflow: hidden;
    font-size: 12px;
  }
  .tool-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: var(--vscode-editorWidget-background);
  }
  .tool-name {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family);
  }
  .tool-action {
    margin-left: auto;
    flex-shrink: 0;
    height: 20px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .tool-action:hover {
    background: var(--vscode-button-secondaryHoverBackground);
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
