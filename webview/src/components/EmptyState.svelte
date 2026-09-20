<script lang="ts">
  // What a brand-new session shows instead of a blank panel. Everything here
  // is a fact about THIS session — the folder it can see, how to reach the
  // commands — rather than a splash screen.
  let { workspace }: { workspace: string | null } = $props();
</script>

<div class="empty">
  <div class="mark">octo</div>
  {#if workspace}
    <div class="scope">working in <span class="repo">{workspace}</span></div>
  {:else}
    <div class="scope">no folder open — the agent has nothing mounted</div>
  {/if}
  <ul class="hints">
    <li>The file you have open rides along as context.</li>
    <li>Select lines in the editor to pin them to your next message.</li>
    <li>Type <code>/</code> for commands and skills.</li>
  </ul>
</div>

<style>
  .empty {
    margin: auto;
    padding: 24px 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
  .mark {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--vscode-foreground);
    opacity: 0.85;
  }
  .scope {
    margin-top: 4px;
    font-size: 12px;
  }
  .repo {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-foreground);
  }
  .hints {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11.5px;
    line-height: 1.5;
  }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    border-radius: 3px;
    padding: 0 4px;
  }
</style>
