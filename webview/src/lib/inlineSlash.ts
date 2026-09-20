// Slash commands the server applies inline in wsUserMessage (ws_handlers.go):
// they mutate the session and return BEFORE any turn starts, so no
// history_user_message, no progress, and — crucially — no `complete` is ever
// broadcast for them.
//
// That absence is what the composer cares about. Treated like an ordinary
// message, an inline command leaves an optimistic user bubble in the
// transcript the session doesn't actually contain, and a busy spinner waiting
// on a `complete` that never comes. Their only feedback is a `toast` (plus a
// `history_reload` for /clear and /compact).
//
// The matching mirrors the server exactly: /clear, /compact and /reload are
// case-insensitive exact matches; /goal is case-sensitive and takes arguments.
// Attachments take the message off the inline path server-side, so they take
// it off this one too.
export type InlineSlashCommand = 'clear' | 'compact' | 'reload' | 'goal';

export function inlineSlashCommand(text: string, hasFiles = false): InlineSlashCommand | null {
  if (hasFiles) return null;
  const trimmed = text.trim();
  switch (trimmed.toLowerCase()) {
    case '/clear':
      return 'clear';
    case '/compact':
      return 'compact';
    case '/reload':
      return 'reload';
  }
  if (trimmed === '/goal' || trimmed.startsWith('/goal ')) return 'goal';
  return null;
}

/** One entry of the composer's "/" menu. */
export type SlashItem = { name: string; description: string; builtin: boolean };

// Built-ins aren't discoverable the way skills are (no endpoint lists them),
// so they're spelled out here, same as octo's own web composer does.
// /loop isn't inline — it falls through to the model, backed by the
// schedule_wakeup tool — but it belongs in the same menu.
export const BUILTIN_SLASH_COMMANDS: SlashItem[] = [
  { name: 'clear', description: 'Wipe this conversation and start fresh', builtin: true },
  { name: 'compact', description: 'Summarize the conversation to free up context', builtin: true },
  { name: 'reload', description: 'Recompose the system prompt (new skills, MCP tools, memory)', builtin: true },
  { name: 'goal', description: 'Set or show the session goal', builtin: true },
  { name: 'loop', description: 'Run this prompt on a schedule', builtin: true },
];

/**
 * The "/" menu opens only on a draft that is a single bare "/word" — a slash
 * command is a whole-message prefix, never something typed mid-sentence.
 * Returns the query after the slash, or null when the menu shouldn't be open.
 */
export function slashQuery(draft: string): string | null {
  // A full-width slash is what an IME-on keyboard produces; the server never
  // sees it (the menu rewrites the draft on pick), but the menu should still open.
  const normalized = draft.replace(/^／/, '/');
  if (!/^\/\S*$/.test(normalized)) return null;
  return normalized.slice(1).toLowerCase();
}

/** Name-match scoring, ported from the web composer: exact, prefix, substring. */
export function matchSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (!query) return items;
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n === query) return 100;
    if (n.startsWith(query)) return 80;
    if (n.includes(query)) return 60;
    return 0;
  };
  return items
    .map((item) => ({ item, score: score(item.name) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

/**
 * What picking a menu entry puts in the composer.
 *
 * The three built-ins the server matches by exact equality (/clear, /compact,
 * /reload) take no argument — anything appended turns them into an ordinary
 * chat message — so they are inserted ready to send. Everything else (a
 * skill, /goal, /loop) is a prefix the user continues typing after, so it
 * gets a trailing space.
 */
const EXACT_MATCH_BUILTINS = new Set(['clear', 'compact', 'reload']);

export function composeSlashCommand(item: SlashItem): string {
  return EXACT_MATCH_BUILTINS.has(item.name) ? `/${item.name}` : `/${item.name} `;
}
