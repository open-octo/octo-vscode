<script lang="ts">
  import type { OctoEvent } from '../lib/protocol';

  type Pending = Extract<OctoEvent, { type: 'request_confirmation' }>;

  let { pending, onAnswer }: { pending: Pending | null; onAnswer: (id: string, result: string) => void } = $props();

  let modalEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (pending && modalEl) modalEl.focus();
  });

  // Result strings are the wire contract with the server (mapConfirmResult):
  // 'yes' = allow once, 'always' = allow + remember for the session, 'ok'
  // answers a plain acknowledgement, anything else denies.
  function answer(result: string): void {
    if (pending) onAnswer(pending.id, result);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!pending) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      answer(pending.kind === 'ok' ? 'ok' : 'deny');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      answer(pending.kind === 'ok' ? 'ok' : 'yes');
    }
  }
</script>

{#if pending}
  <div class="backdrop" role="presentation">
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" bind:this={modalEl} onkeydown={onKeydown}>
      <div class="header">Permission requested</div>
      <div class="body">
        {#if pending.message}<p class="desc">{pending.message}</p>{/if}
        {#if pending.command}
          <pre class="mono">$ {pending.command}</pre>
        {:else if pending.diff}
          <pre class="mono">{pending.diff}</pre>
        {:else if pending.input}
          <pre class="mono">{pending.input}</pre>
        {/if}
      </div>
      <div class="footer">
        {#if pending.kind === 'ok'}
          <button class="btn-primary" onclick={() => answer('ok')}>OK</button>
        {:else}
          <button class="btn-secondary" onclick={() => answer('deny')}>Deny</button>
          <span class="spacer"></span>
          <button class="btn-secondary" onclick={() => answer('always')}>Allow for session</button>
          <button class="btn-primary" onclick={() => answer('yes')}>Allow once</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .modal {
    width: 100%;
    max-width: 420px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .modal:focus {
    outline: none;
  }
  .header {
    padding: 10px 14px;
    font-weight: 600;
    font-size: 13px;
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .desc {
    margin: 0;
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
  }
  .mono {
    margin: 0;
    padding: 8px 10px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--vscode-widget-border);
  }
  .spacer {
    flex: 1;
  }
  button {
    height: 28px;
    padding: 0 10px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
</style>
