<script lang="ts">
  // The reasoning trace: streamed as thinking_delta while a round runs, then
  // finalized onto the round's assistant block (assistant_message.thinking).
  // Collapsed by default — it's context for a reply, not the reply.
  let { text, live = false }: { text: string; live?: boolean } = $props();

  let expanded = $state(false);

  // While streaming, the last line is the interesting one; it reads as
  // progress rather than as a wall of text the user has to scroll past.
  const tail = $derived(text.trim().split('\n').filter(Boolean).at(-1) ?? '');
</script>

<div class="think" class:live>
  <button class="row" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
    <svg class="chev" class:open={expanded} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    <span class="label">{live ? 'Thinking…' : 'Thought process'}</span>
    {#if live && !expanded && tail}
      <span class="tail">{tail}</span>
    {/if}
  </button>
  {#if expanded}
    <div class="body">{text}</div>
  {/if}
</div>

<style>
  .think {
    flex-shrink: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 2px;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    text-align: left;
    font: inherit;
    overflow: hidden;
  }
  .row:hover {
    color: var(--vscode-foreground);
  }
  .chev {
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .label {
    font-size: 11.5px;
    flex-shrink: 0;
  }
  .live .label {
    opacity: 0.85;
    animation: pulse 1.6s ease-in-out infinite;
  }
  .tail {
    font-size: 11px;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    margin: 2px 0 4px 18px;
    padding: 6px 10px;
    border-left: 2px solid var(--vscode-widget-border);
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
</style>
