<script lang="ts">
  import type { OctoEvent } from '../lib/protocol';

  type Pending = Extract<OctoEvent, { type: 'request_user_question' }>;

  let {
    pending,
    onAnswer,
  }: { pending: Pending | null; onAnswer: (choices: string[], custom: string, cancelled: boolean) => void } =
    $props();

  let selected: string[] = $state([]);
  let custom = $state('');
  let lastQuestionId: string | null = null;

  $effect(() => {
    if (pending && pending.question_id !== lastQuestionId) {
      lastQuestionId = pending.question_id;
      selected = [];
      custom = '';
    }
  });

  function toggle(option: string): void {
    if (!pending) return;
    if (pending.multi_select) {
      selected = selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
    } else {
      selected = selected[0] === option ? [] : [option];
    }
  }

  function submit(): void {
    if (!pending || (selected.length === 0 && !custom.trim())) return;
    onAnswer(selected, custom, false);
  }

  function cancel(): void {
    onAnswer([], '', true);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

{#if pending}
  <div class="backdrop" role="presentation">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="header">{pending.header || 'Question'}</div>
      <div class="body">
        <p class="question">{pending.question}</p>
        {#if pending.options.length}
          <div class="options">
            {#each pending.options as option}
              <button class="pill" class:selected={selected.includes(option)} onclick={() => toggle(option)}>
                {option}
              </button>
            {/each}
          </div>
        {/if}
        <input
          bind:value={custom}
          onkeydown={onKeydown}
          placeholder="Type a custom answer…"
        />
      </div>
      <div class="footer">
        <button class="btn-secondary" onclick={cancel}>Cancel</button>
        <span class="spacer"></span>
        <button class="btn-primary" disabled={selected.length === 0 && !custom.trim()} onclick={submit}>
          Submit
        </button>
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
    max-width: 460px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    overflow: hidden;
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
    gap: 10px;
  }
  .question {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-foreground);
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .pill.selected {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  input {
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 13px;
    font-family: inherit;
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
