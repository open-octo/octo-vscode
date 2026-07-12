<script lang="ts">
  import { renderMarkdown, setupCopyButtons } from '../lib/markdown';
  import ToolCall from './ToolCall.svelte';
  import type { Block } from '../lib/chatState.svelte';

  let {
    blocks,
    onOpenFile,
  }: {
    blocks: Block[];
    onOpenFile: (path: string) => void;
  } = $props();

  function copyButtons(node: HTMLElement) {
    return setupCopyButtons(node);
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
  {#each blocks as block (block)}
    {#if block.kind === 'tool'}
      <ToolCall {block} {onOpenFile} />
    {:else}
      <div class="bubble" class:user={block.kind === 'user'} class:assistant={block.kind === 'assistant'}>
        {#if block.attachments?.length}
          <div class="attachments">
            {#each block.attachments as label}
              <span class="attachment-chip">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                  <path d="M4 2h5l3 3v9H4z" />
                  <path d="M9 2v3h3" />
                </svg>
                {label}
              </span>
            {/each}
          </div>
        {/if}
        {#if block.kind === 'assistant'}
          <div class="md-content" use:copyButtons>{@html renderMarkdown(block.text)}</div>
        {:else}
          {block.text}
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bubble {
    /* Direct children of the scrollable flex column must not shrink: without
       this, flexbox collapses them to fit the list's height instead of letting
       the list scroll. Harmless here (text keeps bubbles tall), but critical
       for .tool below, which has overflow:hidden and otherwise collapses to 0. */
    flex-shrink: 0;
    padding: 9px 12px;
    border-radius: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.55;
  }
  .bubble.user {
    background: var(--vscode-list-hoverBackground, var(--vscode-input-background));
    align-self: flex-end;
    max-width: 90%;
    border-radius: 14px 14px 4px 14px;
  }
  .bubble.assistant {
    background: transparent;
    padding: 2px 2px;
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .attachment-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
  }

  /* ── Markdown content (assistant replies) ────────────────────────────── */
  .md-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .md-content :global(p) {
    margin: 0;
  }
  .md-content :global(h1),
  .md-content :global(h2),
  .md-content :global(h3),
  .md-content :global(h4) {
    margin: 4px 0 0;
    font-weight: 600;
    line-height: 1.3;
  }
  .md-content :global(h1) {
    font-size: 16px;
  }
  .md-content :global(h2) {
    font-size: 15px;
  }
  .md-content :global(h3),
  .md-content :global(h4) {
    font-size: 13.5px;
  }
  .md-content :global(ul),
  .md-content :global(ol) {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .md-content :global(li) {
    line-height: 1.5;
  }
  .md-content :global(hr) {
    border: none;
    border-top: 1px solid var(--vscode-widget-border);
    margin: 4px 0;
  }
  .md-content :global(code) {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    border-radius: 4px;
    padding: 1px 5px;
  }
  .md-content :global(a) {
    color: var(--vscode-textLink-foreground);
  }
  .md-content :global(a:hover) {
    color: var(--vscode-textLink-activeForeground);
  }
  .md-content :global(.md-bq) {
    margin: 0;
    padding: 6px 12px;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-widget-border));
    background: var(--vscode-textBlockQuote-background);
    border-radius: 0 6px 6px 0;
    color: var(--vscode-descriptionForeground);
  }
  .md-content :global(.code-block) {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
  }
  .md-content :global(.code-header) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .md-content :global(.code-lang) {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
  }
  .md-content :global(.copy-btn) {
    margin-left: auto;
    height: 20px;
    padding: 0 7px;
    border: none;
    background: transparent;
    border-radius: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-family: inherit;
  }
  .md-content :global(.copy-btn:hover) {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }
  .md-content :global(.code-block pre) {
    margin: 0;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.6;
    font-family: var(--vscode-editor-font-family);
    background: transparent;
  }
  .md-content :global(.code-block code) {
    background: transparent;
    padding: 0;
  }
</style>
