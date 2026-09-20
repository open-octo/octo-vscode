<script lang="ts">
  import type { Todo } from '../lib/chatState.svelte';

  // The agent's task checklist, pinned above the composer rather than left
  // inline in the transcript: it is the one block that describes what is
  // happening NOW, and scrolling away from it defeats the point.
  let { todos }: { todos: Todo[] } = $props();

  let collapsed = $state(false);

  const done = $derived(todos.filter((t) => t.status === 'completed' || t.status === 'done').length);
  const active = $derived(todos.find((t) => t.status === 'in_progress' || t.status === 'active'));
</script>

{#if todos.length}
  <div class="todos">
    <button class="head" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
      <svg class="chev" class:open={!collapsed} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
      <span class="title">Tasks</span>
      <span class="count">{done}/{todos.length}</span>
      {#if collapsed && active}
        <span class="now">{active.content}</span>
      {/if}
    </button>
    {#if !collapsed}
      <ul>
        {#each todos as todo}
          {@const finished = todo.status === 'completed' || todo.status === 'done'}
          {@const running = todo.status === 'in_progress' || todo.status === 'active'}
          <li class:finished class:running>
            {#if finished}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            {:else if running}
              <span class="dot"></span>
            {:else}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
            {/if}
            <span class="text">{todo.content}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .todos {
    flex-shrink: 0;
    margin: 0 10px;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    background: var(--vscode-editorWidget-background);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font: inherit;
    text-align: left;
    overflow: hidden;
  }
  .chev {
    flex-shrink: 0;
    transition: transform 0.12s ease;
    color: var(--vscode-descriptionForeground);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .title {
    font-size: 11.5px;
    font-weight: 600;
  }
  .count {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
  }
  .now {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 8px 6px 8px;
    /* A long plan must not push the composer off screen. */
    max-height: 30vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 0 2px 18px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--vscode-descriptionForeground);
  }
  li svg {
    flex-shrink: 0;
    margin-top: 3px;
  }
  li.finished .text {
    text-decoration: line-through;
    opacity: 0.7;
  }
  li.running {
    color: var(--vscode-foreground);
  }
  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin: 5px 2px 0;
    border-radius: 50%;
    background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
    animation: pulse 1.4s ease-in-out infinite;
  }
  .text {
    word-break: break-word;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }
</style>
