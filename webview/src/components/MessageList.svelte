<script lang="ts">
  import { renderMarkdown, setupCopyButtons } from '../lib/markdown';
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
  {#each blocks as block}
    {#if block.kind === 'tool'}
      {@const edit = editPayload(block)}
      {@const openable = openablePayload(block)}
      <div class="tool">
        <div class="tool-header">
          <svg class="tool-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9.5 2.5a2.5 2.5 0 0 0-3.2 3.2L2 10v3.5h3.5L10 9.2a2.5 2.5 0 0 0 3.2-3.2l-1.7 1.7-2-2z" />
          </svg>
          <span class="tool-name">{block.name}</span>
          {#if edit}
            <button class="tool-action" onclick={() => onViewDiff(edit.diff, edit.path)}>View diff</button>
          {:else if openable}
            <button class="tool-action" onclick={() => onOpenFile(openable.path)}>Open</button>
          {/if}
          <span class="tool-status">
            {#if block.error}
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="status-error" aria-label="Failed">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            {:else if block.result !== undefined}
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="status-ok" aria-label="Done">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            {:else}
              <span class="spinner" aria-label="Running"></span>
            {/if}
          </span>
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
        {#if block.thinking}
          <div class="thinking">{block.thinking}</div>
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

  /* ── Tool call card ───────────────────────────────────────────────────── */
  .tool {
    border-radius: 10px;
    overflow: hidden;
    font-size: 12px;
    background: var(--vscode-editorWidget-background);
  }
  .tool-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    color: var(--vscode-descriptionForeground);
  }
  .tool-icon {
    flex-shrink: 0;
    opacity: 0.85;
  }
  .tool-name {
    margin-right: auto;
    font-weight: 600;
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-foreground);
  }
  .tool-action {
    flex-shrink: 0;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    border: none;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .tool-action:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .tool-status {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    margin-left: 4px;
  }
  .status-ok {
    color: var(--vscode-terminal-ansiGreen, #3fb950);
  }
  .status-error {
    color: var(--vscode-errorForeground);
  }
  .spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--vscode-widget-border);
    border-top-color: var(--vscode-focusBorder);
    animation: octo-spin 0.8s linear infinite;
  }
  @keyframes octo-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .tool-body {
    margin: 0;
    padding: 2px 10px 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }
  .tool-body.error {
    color: var(--vscode-errorForeground);
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
