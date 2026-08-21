<script lang="ts">
  // ask_user_question picker, matching octo's own web UI and Claude Code's: a
  // set of 1-4 questions walked as tabs with a review/submit tab, each
  // question rendered in one of two mutually exclusive layouts, and three
  // outcomes rather than two.
  //
  // Everything decided rather than drawn lives in lib/askStepper.ts, shared
  // verbatim with octo-agent so the two clients can't drift.
  import type { OctoEvent } from '../lib/protocol';
  import {
    advanceIndex,
    allAnswered,
    answerSummary,
    answersPayload,
    anyAnswered,
    emptyDraft,
    emptyDrafts,
    focusedPreview,
    hasReviewTab,
    isAnswered,
    isReviewTab,
    toggleChoice,
    usesPreviewLayout,
    type AskAnswerPayload,
    type AskDraft,
    type AskOutcome,
  } from '../lib/askStepper';

  type Pending = Extract<OctoEvent, { type: 'request_user_question' }>;

  let {
    pending,
    onAnswer,
  }: {
    pending: Pending | null;
    onAnswer: (outcome: AskOutcome, answers: AskAnswerPayload[]) => void;
  } = $props();

  const questions = $derived(pending?.questions ?? []);
  let qIdx = $state(0);
  let drafts: AskDraft[] = $state([]);
  let focusedLabel = $state('');
  let lastQuestionId: string | null = null;

  const question = $derived(questions[qIdx]);
  const draft = $derived(drafts[qIdx] ?? emptyDraft());
  const onReview = $derived(isReviewTab(questions, qIdx));
  const preview = $derived(usesPreviewLayout(question));
  const previewBody = $derived(preview ? focusedPreview(question, focusedLabel) : '');

  $effect(() => {
    if (pending && pending.question_id !== lastQuestionId) {
      lastQuestionId = pending.question_id;
      qIdx = 0;
      drafts = emptyDrafts(pending.questions ?? []);
      focusedLabel = pending.questions?.[0]?.options?.[0]?.label ?? '';
    }
  });

  function setDraft(next: AskDraft): void {
    drafts = drafts.map((d, i) => (i === qIdx ? next : d));
  }

  function goTab(i: number): void {
    qIdx = i;
    focusedLabel = questions[i]?.options?.[0]?.label ?? '';
  }

  function advance(ds: AskDraft[]): void {
    const to = advanceIndex(questions, qIdx);
    if (to === -1) finish('submitted', ds);
    else goTab(to);
  }

  function pick(label: string): void {
    if (!question) return;
    focusedLabel = label;
    const next = toggleChoice(draft, question, label);
    setDraft(next);
    // Multi-select accumulates: the user decides when the question is done.
    if (question.multi_select) return;
    advance(drafts.map((d, i) => (i === qIdx ? next : d)));
  }

  function openOther(): void {
    setDraft({ ...draft, otherOpen: true });
  }

  function commitOther(): void {
    if (!draft.custom.trim()) {
      setDraft({ ...draft, otherOpen: false });
      return;
    }
    const next = { ...draft, choices: [], otherOpen: false };
    setDraft(next);
    advance(drafts.map((d, i) => (i === qIdx ? next : d)));
  }

  function finish(outcome: AskOutcome, ds: AskDraft[] = drafts): void {
    onAnswer(outcome, outcome === 'rejected' ? [] : answersPayload(ds));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish('rejected');
    }
  }
</script>

{#if pending}
  <div class="backdrop" role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" onkeydown={onKeydown}>
      <div class="header">Question</div>

      <div class="body">
        {#if questions.length > 1 || hasReviewTab(questions)}
          <div class="tabs" role="tablist">
            {#each questions as q, i}
              <button class="tab" class:active={i === qIdx} role="tab" aria-selected={i === qIdx} onclick={() => goTab(i)}>
                {isAnswered(drafts[i]) ? '✓ ' : ''}{q.header}
              </button>
            {/each}
            {#if hasReviewTab(questions)}
              <button
                class="tab"
                class:active={onReview}
                role="tab"
                aria-selected={onReview}
                onclick={() => goTab(questions.length)}
              >
                Review
              </button>
            {/if}
          </div>
        {/if}

        {#if onReview}
          <div class="review">
            {#each questions as q, i}
              {#if isAnswered(drafts[i])}
                <div class="review-item">
                  <div class="review-q">{q.question}</div>
                  <div class="review-a">→ {answerSummary(drafts[i])}</div>
                </div>
              {/if}
            {/each}
            {#if !allAnswered(questions, drafts)}
              <div class="review-warn">You have not answered all questions</div>
            {/if}
          </div>
        {:else}
          <p class="question">{question?.question}</p>

          <div class="rows" class:with-preview={preview}>
            <div class="row-list">
              {#each question?.options ?? [] as o, i}
                <button
                  class="row"
                  class:selected={draft.choices.includes(o.label)}
                  class:focused={preview && focusedLabel === o.label}
                  onclick={() => (preview ? (focusedLabel = o.label) : pick(o.label))}
                  ondblclick={() => pick(o.label)}
                >
                  <span class="row-body">
                    <span class="row-label">{draft.choices.includes(o.label) ? '✓ ' : ''}{o.label}</span>
                    <!-- The preview layout drops descriptions: the preview
                         stands in for them, as Claude Code renders it. -->
                    {#if o.description && !preview}
                      <span class="row-desc">{o.description}</span>
                    {/if}
                  </span>
                  <span class="row-num">{i + 1}</span>
                </button>
              {/each}

              <!-- No "Other" row in the preview layout: notes take that slot. -->
              {#if !preview}
                {#if draft.otherOpen}
                  <div class="other-open">
                    <input
                      type={pending.secret ? 'password' : 'text'}
                      placeholder="Type a custom answer…"
                      value={draft.custom}
                      oninput={(e) => setDraft({ ...draft, custom: e.currentTarget.value })}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitOther();
                        }
                      }}
                    />
                    <button class="btn-primary" onclick={commitOther}>OK</button>
                  </div>
                {:else}
                  <button class="row" onclick={openOther}>
                    <span class="row-body"><span class="row-label">Other</span></span>
                    <span class="row-num">{(question?.options?.length ?? 0) + 1}</span>
                  </button>
                {/if}
              {/if}

              <button class="row row-clarify" onclick={() => finish('clarify')}>
                <span class="row-body"><span class="row-label">Chat about this</span></span>
              </button>
            </div>

            {#if preview}
              <div class="preview-col">
                <pre class="preview-body">{previewBody || 'No preview available'}</pre>
                <input
                  class="note-input"
                  placeholder="Add notes on this option…"
                  value={draft.notes}
                  oninput={(e) => setDraft({ ...draft, notes: e.currentTarget.value })}
                />
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="footer">
        <button class="btn-secondary" onclick={() => finish('rejected')}>Cancel</button>
        <span class="spacer"></span>
        {#if onReview}
          <button class="btn-primary" disabled={!anyAnswered(drafts)} onclick={() => finish('submitted')}>
            Submit answers
          </button>
        {:else if question?.multi_select}
          <button class="btn-primary" disabled={draft.choices.length === 0} onclick={() => advance(drafts)}>
            {hasReviewTab(questions) ? 'Next' : 'Submit'}
          </button>
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
    max-width: 620px;
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
    gap: 10px;
  }
  .question {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tab {
    padding: 3px 9px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab.active {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .rows {
    display: flex;
    gap: 10px;
  }
  .rows.with-preview .row-list {
    flex: 0 0 42%;
  }
  .row-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-foreground);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    height: auto;
  }
  .row:hover {
    border-color: var(--vscode-focusBorder);
  }
  .row.selected,
  .row.focused {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row-label {
    font-size: 12px;
    font-weight: 600;
    word-break: break-word;
  }
  .row-desc {
    font-size: 11px;
    opacity: 0.75;
    line-height: 1.4;
    word-break: break-word;
  }
  .row-num {
    font-size: 10px;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .row-clarify {
    border-style: dashed;
  }
  .row-clarify .row-label {
    font-weight: 400;
    opacity: 0.85;
  }

  .other-open {
    display: flex;
    gap: 6px;
  }
  .other-open input {
    flex: 1;
  }

  .preview-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview-body {
    margin: 0;
    padding: 8px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.5;
    max-height: 260px;
    overflow: auto;
    white-space: pre;
  }
  .note-input {
    font-size: 11px;
  }

  /* A narrow side panel can't hold two columns. */
  @media (max-width: 620px) {
    .rows {
      flex-direction: column;
    }
    .rows.with-preview .row-list {
      flex: 1 1 auto;
    }
  }

  .review {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .review-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .review-q {
    font-size: 12px;
  }
  .review-a {
    font-size: 12px;
    padding-left: 10px;
    color: var(--vscode-textLink-foreground);
  }
  .review-warn {
    font-size: 11px;
    opacity: 0.75;
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
