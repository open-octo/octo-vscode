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
  <div class="card">
    {#if pendingAttachments.length}
      <div class="chips">
        {#each pendingAttachments as label}
          <span class="chip">
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M4 2h5l3 3v9H4z" />
              <path d="M9 2v3h3" />
            </svg>
            {label}
            <button class="chip-remove" onclick={() => onRemoveAttachment(label)} aria-label="Remove attachment">×</button>
          </span>
        {/each}
      </div>
    {/if}

    <textarea
      bind:value={draft}
      onkeydown={onKeydown}
      disabled={disabled}
      placeholder={disabled ? 'Waiting for octo serve…' : 'How can I help you today?'}
      rows="2"
    ></textarea>

    <div class="toolbar">
      <button class="icon-btn" disabled={disabled} onclick={onPickFile} title="Attach a file" aria-label="Attach a file">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11.5 5.5l-5 5a2 2 0 1 0 2.8 2.8l5-5a3.5 3.5 0 1 0-5-5l-5 5a1 1 0 0 0 1.4 1.4l4.6-4.6" />
        </svg>
      </button>
      <span class="hint">Enter to send · Shift+Enter for newline</span>
      {#if busy}
        <button class="icon-btn send stop" onclick={onInterrupt} title="Stop" aria-label="Stop">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
        </button>
      {:else}
        <button class="icon-btn send" disabled={disabled || !draft.trim()} onclick={submit} title="Send" aria-label="Send">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 12.5V3.5M4 7.5L8 3.5l4 4" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .composer-wrap {
    padding: 8px 10px 10px;
  }
  .card {
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    border-radius: 12px;
    background: var(--vscode-input-background);
    overflow: hidden;
  }
  .card:has(textarea:focus) {
    border-color: var(--vscode-focusBorder);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
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
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    resize: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: none;
    outline: none;
    padding: 10px 12px 4px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px 8px;
  }
  .hint {
    margin-left: 2px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 0;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .icon-btn.send {
    margin-left: auto;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .icon-btn.send:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
    color: var(--vscode-button-foreground);
  }
  .icon-btn.send:disabled {
    opacity: 0.4;
  }
  .icon-btn.send.stop {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .icon-btn.send.stop:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
</style>
