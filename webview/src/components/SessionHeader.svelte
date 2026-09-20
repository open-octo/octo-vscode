<script lang="ts">
  import type { SessionInfo } from '../lib/chatState.svelte';

  // A one-line "where am I" strip: which session, how full its context is, and
  // under what permission mode its tools run. Every field but the name comes
  // from the server's session_update, which until now was received and dropped.
  let { session, busy }: { session: SessionInfo; busy: boolean } = $props();

  // permission.Mode's three values (internal/permission/permission.go).
  const MODE_LABELS: Record<string, string> = {
    interactive: 'Asks first',
    auto: 'Auto-approve',
    strict: 'Strict',
  };

  const usage = $derived(session.contextUsage ?? 0);
  const dir = $derived(session.workingDir ? session.workingDir.split(/[/\\]/).filter(Boolean).at(-1) : null);
</script>

<div class="head">
  <span class="name" title={session.name || 'New session'}>{session.name || 'New session'}</span>
  {#if busy}<span class="spinner" aria-label="Running"></span>{/if}
  <span class="right">
    {#if session.permissionMode}
      <span class="chip" title="Permission mode for this session's tools">
        {MODE_LABELS[session.permissionMode] ?? session.permissionMode}
      </span>
    {/if}
    {#if session.contextUsage !== null}
      <span class="ctx" class:warn={usage >= 75} class:hot={usage >= 90} title="Context window used — /compact frees it up">
        <span class="bar"><span class="fill" style:width={`${Math.min(usage, 100)}%`}></span></span>
        {usage}%
      </span>
    {/if}
    {#if dir}
      <!-- The project's own generated workspace, not the folder open in VS
           Code — that one is mounted into it as a source folder. -->
      <span class="chip dir" title={session.workingDir}>{dir}</span>
    {/if}
  </span>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-widget-border);
    background: var(--vscode-sideBarSectionHeader-background, transparent);
    overflow: hidden;
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .chip {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 10.5px;
    line-height: 16px;
  }
  .chip.dir {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
  }
  .bar {
    display: block;
    width: 34px;
    height: 4px;
    border-radius: 999px;
    background: var(--vscode-editorWidget-border, var(--vscode-widget-border));
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--vscode-textLink-foreground);
  }
  .ctx.warn .fill {
    background: var(--vscode-editorWarning-foreground, #cca700);
  }
  .ctx.hot {
    color: var(--vscode-errorForeground);
  }
  .ctx.hot .fill {
    background: var(--vscode-errorForeground);
  }
  .spinner {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--vscode-descriptionForeground);
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
