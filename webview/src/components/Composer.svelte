<script lang="ts">
  let {
    disabled,
    busy,
    pendingAttachments,
    onSend,
    onInterrupt,
    onPickFile,
    onRemoveAttachment,
  }: {
    disabled: boolean;
    busy: boolean;
    pendingAttachments: string[];
    onSend: (text: string) => void;
    onInterrupt: () => void;
    onPickFile: () => void;
    onRemoveAttachment: (label: string) => void;
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

<div class="composer-wrap">
  {#if pendingAttachments.length}
    <div class="chips">
      {#each pendingAttachments as label}
        <span class="chip">
          {label}
          <button class="chip-remove" onclick={() => onRemoveAttachment(label)} aria-label="Remove attachment">×</button>
        </span>
      {/each}
    </div>
  {/if}

  <div class="composer">
    <button class="btn-icon" disabled={disabled} onclick={onPickFile} title="Attach a file">@ file</button>
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
</div>

<style>
  .composer-wrap {
    border-top: 1px solid var(--vscode-widget-border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
  }
  .chip-remove {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 13px;
    line-height: 1;
  }
  .composer {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
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
  .btn-icon {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font-size: 12px;
  }
  .btn-icon:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
