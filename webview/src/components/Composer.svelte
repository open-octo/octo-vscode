<script lang="ts">
  let {
    disabled,
    busy,
    onSend,
    onInterrupt,
  }: {
    disabled: boolean;
    busy: boolean;
    onSend: (text: string) => void;
    onInterrupt: () => void;
  } = $props();

  let draft = $state('');

  function submit(): void {
    if (!draft.trim() || disabled || busy) return;
    onSend(draft);
    draft = '';
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="composer">
  <textarea
    bind:value={draft}
    onkeydown={onKeydown}
    disabled={disabled}
    placeholder={disabled ? 'Waiting for octo serve…' : 'Message octo… (Enter to send, Shift+Enter for newline)'}
    rows="3"
  ></textarea>
  {#if busy}
    <button class="btn-secondary" onclick={onInterrupt}>Stop</button>
  {:else}
    <button class="btn-primary" disabled={disabled || !draft.trim()} onclick={submit}>Send</button>
  {/if}
</div>

<style>
  .composer {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid var(--vscode-widget-border);
  }
  textarea {
    flex: 1;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    border-radius: 4px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
  }
  textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }
  button {
    align-self: flex-end;
    height: 28px;
    padding: 0 12px;
    border-radius: 4px;
    border: none;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
</style>
