<script lang="ts">
  import { untrack } from 'svelte';
  import type { ToolBlock } from '../lib/chatState.svelte';
  import type { UIPayload } from '../lib/protocol';
  import { argSummary, toolIconPath, toolMeta, openablePath } from '../lib/toolDisplay';

  let { block, onOpenFile }: { block: ToolBlock; onOpenFile: (path: string) => void } = $props();

  const done = $derived(block.result !== undefined || block.error !== undefined);
  const summary = $derived(argSummary(block.name, block.args));
  const meta = $derived(toolMeta(block));
  const openable = $derived(openablePath(block));

  // Collapsed by default once finished; open while still running or on error so
  // live output / failures don't need a click. untrack: deliberately the value
  // at creation only — a tool that finishes later stays as the user left it.
  let expanded = $state(untrack(() => block.result === undefined || block.error !== undefined));
  // Long output is folded to FOLD_LINES; the fold toggle reveals the rest.
  let showAll = $state(false);
  const FOLD_LINES = 14;

  function diffPayload(): Extract<UIPayload, { type: 'edit' }> | undefined {
    return block.uiPayload?.type === 'edit' ? block.uiPayload : undefined;
  }

  // The raw text to show behind the fold, plus which flavor of styling it wants.
  const output = $derived.by(() => {
    if (block.error) return { kind: 'error' as const, text: block.error };
    const diff = diffPayload();
    if (diff) return { kind: 'diff' as const, text: diff.diff };
    if (block.stdout.length) return { kind: 'term' as const, text: block.stdout.join('\n') };
    if (block.result) return { kind: 'plain' as const, text: block.result };
    return null;
  });

  // Terminal output tails (errors land at the bottom); everything else heads.
  const folded = $derived.by(() => {
    if (!output) return null;
    const lines = output.text.split('\n');
    if (showAll || lines.length <= FOLD_LINES) return { lines, hidden: 0 };
    const tail = output.kind === 'term';
    return {
      lines: tail ? lines.slice(-FOLD_LINES) : lines.slice(0, FOLD_LINES),
      hidden: lines.length - FOLD_LINES,
    };
  });

  function toggle() {
    if (output) expanded = !expanded;
  }
  function openFile(e: MouseEvent) {
    e.stopPropagation();
    if (openable) onOpenFile(openable);
  }
</script>

<div class="tc" class:running={!done}>
  <button class="tc-row" onclick={toggle} class:no-output={!output} aria-expanded={expanded}>
    <svg class="chev" class:open={expanded && !!output} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    <svg class="tc-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html toolIconPath(block.name)}</svg>
    <span class="tc-name">{block.name}</span>
    {#if summary}
      {#if openable}
        <span class="tc-summary link" role="link" tabindex="0" onclick={openFile} onkeydown={(e) => e.key === 'Enter' && openFile(e as unknown as MouseEvent)}>{summary}</span>
      {:else}
        <span class="tc-summary">{summary}</span>
      {/if}
    {/if}
    <span class="tc-right">
      {#if meta}<span class="tc-meta">{meta}</span>{/if}
      {#if block.error}
        <svg class="st err" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Failed"><path d="M18 6 6 18M6 6l12 12" /></svg>
      {:else if done}
        <svg class="st ok" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Done"><path d="M20 6 9 17l-5-5" /></svg>
      {:else}
        <span class="spinner" aria-label="Running"></span>
      {/if}
    </span>
  </button>

  {#if expanded && output && folded}
    <div class="tc-content" class:diff={output.kind === 'diff'} class:error={output.kind === 'error'}>
      {#if output.kind === 'diff'}
        {#each folded.lines as line}
          <div class="dl" class:add={line.startsWith('+')} class:rm={line.startsWith('-')} class:hdr={line.startsWith('@@')}>{line || ' '}</div>
        {/each}
      {:else}
        <pre class="tc-pre">{folded.lines.join('\n')}</pre>
      {/if}
      {#if folded.hidden > 0}
        <button class="fold-btn" onclick={() => (showAll = true)}>… {folded.hidden} more lines</button>
      {:else if showAll && output.text.split('\n').length > FOLD_LINES}
        <button class="fold-btn" onclick={() => (showAll = false)}>Show less</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tc {
    flex-shrink: 0;
    margin: 1px 0;
  }
  .tc-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 3px 2px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    overflow: hidden;
  }
  .tc-row.no-output {
    cursor: default;
  }
  .tc-row:hover:not(.no-output) {
    opacity: 0.85;
  }
  .chev {
    flex: 0 0 auto;
    color: var(--vscode-descriptionForeground);
    transition: transform 0.15s ease;
  }
  .tc-row.no-output .chev {
    visibility: hidden;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .tc-icon {
    flex: 0 0 auto;
    color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
  }
  .tc-name {
    flex: 0 0 auto;
    font-family: var(--vscode-editor-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
  }
  .tc-summary {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tc-summary.link {
    cursor: pointer;
  }
  .tc-summary.link:hover {
    color: var(--vscode-textLink-foreground);
    text-decoration: underline;
  }
  .tc-right {
    flex: 0 0 auto;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 6px;
  }
  .tc-meta {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .st {
    flex: 0 0 auto;
  }
  .st.ok {
    color: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, #3fb950));
  }
  .st.err {
    color: var(--vscode-errorForeground);
  }
  .spinner {
    flex: 0 0 auto;
    display: inline-block;
    width: 11px;
    height: 11px;
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
  /* Expanded body: blockquote-style left rule, indented — blends into the flow. */
  .tc-content {
    margin-inline-start: 8px;
    padding: 3px 0 3px 14px;
    border-inline-start: 2px solid var(--vscode-widget-border);
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    line-height: 1.5;
  }
  .tc-content.error {
    border-inline-start-color: var(--vscode-errorForeground);
  }
  .tc-pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--vscode-descriptionForeground);
    max-height: 360px;
    overflow: auto;
  }
  .tc-content.error .tc-pre {
    color: var(--vscode-errorForeground);
  }
  .dl {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--vscode-descriptionForeground);
  }
  .dl.hdr {
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
  }
  .dl.add {
    background: var(--vscode-diffEditor-insertedTextBackground, rgba(63, 185, 80, 0.15));
    color: var(--vscode-foreground);
  }
  .dl.rm {
    background: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.15));
    color: var(--vscode-foreground);
  }
  .fold-btn {
    margin-top: 4px;
    padding: 2px 0;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: var(--vscode-textLink-foreground);
  }
  .fold-btn:hover {
    text-decoration: underline;
  }
</style>
