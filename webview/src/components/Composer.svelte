<script lang="ts">
  import { BUILTIN_SLASH_COMMANDS, composeSlashCommand, matchSlashItems, slashQuery, type SlashItem } from '../lib/inlineSlash';
  import { readViewState, writeViewState } from '../lib/vscodeApi';
  import type { OutboundFile } from '../lib/protocol';

  let {
    disabled,
    busy,
    queuedCount,
    pendingAttachments,
    activeFile,
    skills,
    onSend,
    onInterrupt,
    onPickFile,
    onRemoveAttachment,
  }: {
    disabled: boolean;
    busy: boolean;
    queuedCount: number;
    pendingAttachments: string[];
    activeFile: string | null;
    skills: SlashItem[];
    onSend: (text: string, files?: OutboundFile[]) => void;
    onInterrupt: () => void;
    onPickFile: () => void;
    onRemoveAttachment: (label: string) => void;
  } = $props();

  // Restored from the webview's own persisted state: VS Code rebuilds a
  // sidebar view that has been hidden long enough, and losing a half-written
  // message to that is the kind of thing people never forgive.
  let draft = $state(readViewState<{ draft?: string }>()?.draft ?? '');
  let textarea: HTMLTextAreaElement | undefined = $state();
  // Images pasted into the box, sent inline with the next message.
  let images: OutboundFile[] = $state([]);

  // A `path:line` / `path:line-line` label is a pinned selection; a bare path
  // is a whole-file attachment. Only the caption's shape tells them apart, so
  // the chip icon keys off it.
  const isSelection = (label: string): boolean => /:\d/.test(label);

  // ── "/" menu ──────────────────────────────────────────────────────────────
  // Skills come from the server (GET /api/skills); the built-ins aren't
  // discoverable anywhere, so inlineSlash.ts spells them out.
  const query = $derived(slashQuery(draft));
  const matches = $derived(query === null ? [] : matchSlashItems([...BUILTIN_SLASH_COMMANDS, ...skills], query));
  const menuOpen = $derived(matches.length > 0);
  let active = $state(0);

  // Keyed on the candidates themselves, not just their count: "/re" and "/rc"
  // can both match two entries while matching different ones, and a highlight
  // left on index 1 would then point at something the user never looked at.
  const matchKey = $derived(matches.map((m) => m.name).join('\u0000'));
  $effect(() => {
    void matchKey;
    active = 0;
  });

  $effect(() => {
    writeViewState({ draft });
  });

  $effect(() => {
    // Grow with the content up to a cap, then scroll — a fixed 2-row box
    // makes anything longer than a sentence unreadable while writing it.
    if (!textarea) return;
    void draft;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  });

  function pick(item: SlashItem): void {
    draft = composeSlashCommand(item);
    textarea?.focus();
  }

  function submit(): void {
    if (disabled) return;
    if (!draft.trim() && !images.length) return;
    onSend(draft, images.length ? images : undefined);
    draft = '';
    images = [];
  }

  function onKeydown(e: KeyboardEvent): void {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = (active + 1) % matches.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active - 1 + matches.length) % matches.length;
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Closing the menu without losing the draft: a trailing space takes
        // the text off slashQuery's "bare /word" shape.
        draft = `${draft} `;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Images ride as data URLs (ws_types.go's wsUserFile.data_url). The server
  // decides what to do with them: embedded for a vision model, saved and
  // handed over as a path note otherwise.
  function onPaste(e: ClipboardEvent): void {
    const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    for (const item of items) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          images = [...images, { name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`, dataUrl: reader.result }];
        }
      };
      reader.readAsDataURL(file);
    }
  }
</script>

<div class="composer-wrap">
  {#if menuOpen}
    <div class="menu" role="listbox" aria-label="Slash commands">
      {#each matches.slice(0, 8) as item, i}
        <button class="menu-item" class:active={i === active} role="option" aria-selected={i === active} onclick={() => pick(item)}>
          <span class="menu-name">/{item.name}</span>
          {#if item.builtin}<span class="menu-tag">built-in</span>{/if}
          <span class="menu-desc">{item.description}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="card">
    {#if pendingAttachments.length || images.length}
      <div class="chips">
        {#each pendingAttachments as label}
          <span class="chip">
            {#if isSelection(label)}
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 3L2 8l4 5M10 3l4 5-4 5" />
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                <path d="M4 2h5l3 3v9H4z" />
                <path d="M9 2v3h3" />
              </svg>
            {/if}
            {label}
            <button class="chip-remove" onclick={() => onRemoveAttachment(label)} aria-label="Remove attachment">×</button>
          </span>
        {/each}
        {#each images as image}
          <span class="chip">
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M2 11l3.5-3 3 2.5L11 8l3 3" />
            </svg>
            {image.name}
            <button class="chip-remove" onclick={() => (images = images.filter((i) => i !== image))} aria-label="Remove image">×</button>
          </span>
        {/each}
      </div>
    {/if}

    <textarea
      bind:this={textarea}
      bind:value={draft}
      onkeydown={onKeydown}
      onpaste={onPaste}
      disabled={disabled}
      placeholder={disabled ? 'Waiting for octo serve…' : 'How can I help you today?  ("/" for commands)'}
      rows="2"
    ></textarea>

    {#if activeFile && !pendingAttachments.length}
      <div class="context-row" title="Current file — sent as context with your message">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
          <rect x="2" y="4.5" width="8" height="8" rx="1" />
          <path d="M6 4.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" />
        </svg>
        <span class="context-file">In {activeFile}</span>
      </div>
    {/if}

    <div class="toolbar">
      <button class="icon-btn" disabled={disabled} onclick={onPickFile} title="Attach a file" aria-label="Attach a file">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11.5 5.5l-5 5a2 2 0 1 0 2.8 2.8l5-5a3.5 3.5 0 1 0-5-5l-5 5a1 1 0 0 0 1.4 1.4l4.6-4.6" />
        </svg>
      </button>
      <span class="hint">
        {#if queuedCount}
          {queuedCount} queued · sends when this turn ends
        {:else}
          Enter to send · Shift+Enter for newline
        {/if}
      </span>
      {#if busy}
        <button class="icon-btn stop-btn pushed-right" onclick={onInterrupt} title="Stop" aria-label="Stop">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
        </button>
      {/if}
      <button class="icon-btn send" class:pushed-right={!busy} disabled={disabled || (!draft.trim() && !images.length)} onclick={submit} title={busy ? 'Queue this message' : 'Send'} aria-label="Send">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 12.5V3.5M4 7.5L8 3.5l4 4" />
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .composer-wrap {
    padding: 8px 10px 10px;
    position: relative;
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
  .menu {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: calc(100% - 6px);
    max-height: 40vh;
    overflow-y: auto;
    z-index: 5;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  }
  .menu-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    text-align: left;
    font: inherit;
    overflow: hidden;
  }
  .menu-item.active,
  .menu-item:hover {
    background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }
  .menu-name {
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    flex-shrink: 0;
  }
  .menu-tag {
    font-size: 9.5px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    flex-shrink: 0;
  }
  .menu-desc {
    font-size: 11px;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    max-height: 220px;
    overflow-y: auto;
  }
  .context-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding: 2px 10px 0;
    color: var(--vscode-descriptionForeground);
  }
  .context-file {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .icon-btn.stop-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .icon-btn.stop-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .icon-btn.send {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  /* Whichever button comes first on the right takes the gap, so adding
     anything to the toolbar can't silently break the layout. */
  .icon-btn.pushed-right {
    margin-left: auto;
  }
  .icon-btn.send:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
    color: var(--vscode-button-foreground);
  }
  .icon-btn.send:disabled {
    opacity: 0.4;
  }
</style>
