// Pure display helpers for tool-call rows, ported from octo's own frontends
// (web ToolGroup.svelte + obsidian ToolCallRenderer) so the VS Code panel reads
// the same way: a compact "icon name arg-summary … count status" row, collapsed
// by default, with the raw output tucked behind the fold.

import type { ToolBlock } from './chatState.svelte';

export type ToolCategory = 'file' | 'edit' | 'search' | 'terminal' | 'web' | 'list' | 'agent' | 'question' | 'default';

export function toolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'default';
  switch (name) {
    case 'read_file':
      return 'file';
    case 'write_file':
    case 'edit_file':
      return 'edit';
    case 'grep':
    case 'glob':
      return 'search';
    case 'bash':
    case 'terminal':
      return 'terminal';
    case 'web_search':
    case 'web_fetch':
      return 'web';
    case 'ls':
    case 'list_dir':
    case 'todo_write':
    case 'todowrite':
    case 'task_create':
    case 'task_update':
      return 'list';
    case 'sub_agent':
    case 'launch_agent':
    case 'task':
      return 'agent';
    case 'ask_user_question':
      return 'question';
    default:
      return 'default';
  }
}

// A friendly one-line summary of a tool's arguments (a path, a pattern, a
// command) instead of dumping raw JSON. Falls back to compact JSON.
export function argSummary(name: string, args: unknown): string {
  let a: unknown = args;
  if (typeof a === 'string') {
    const s = a.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        a = JSON.parse(s);
      } catch {
        return s;
      }
    } else {
      return s;
    }
  }
  if (!a || typeof a !== 'object') return a == null ? '' : String(a);
  const obj = a as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== '') return String(v);
    }
    return '';
  };
  switch (name) {
    case 'web_search':
      return pick('query', 'q');
    case 'web_fetch':
      return pick('url');
    case 'grep':
      return pick('pattern', 'query') + (obj.path ? `  ${String(obj.path)}` : '');
    case 'glob':
      return pick('pattern', 'glob') + (obj.path ? `  ${String(obj.path)}` : '');
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return pick('path', 'file_path', 'file', 'filename');
    case 'bash':
    case 'terminal':
      return pick('command', 'cmd');
    case 'remember':
      return pick('content', 'text', 'name');
    default: {
      const v = pick('query', 'path', 'file_path', 'command', 'url', 'name', 'pattern', 'subject', 'description');
      if (v) return v;
      const compact = JSON.stringify(a);
      return compact.length > 80 ? compact.slice(0, 77) + '…' : compact;
    }
  }
}

function nonEmptyLines(s: string): number {
  return s ? s.split('\n').filter((l) => l.trim() !== '').length : 0;
}

// Right-aligned meta count ("201 lines" / "16 matches"), derived from the
// result since the server sends no explicit counter. Empty while running or
// on error (the status icon carries that instead).
export function toolMeta(block: ToolBlock): string {
  const done = block.result !== undefined || block.error !== undefined;
  if (!done || block.error) return '';
  const res = typeof block.result === 'string' ? block.result : '';
  switch (block.name) {
    case 'grep':
      return res ? `${nonEmptyLines(res)} matches` : '';
    case 'read_file':
      return res ? `${nonEmptyLines(res)} lines` : '';
    case 'glob':
      return res ? `${nonEmptyLines(res)} files` : '';
    case 'bash':
    case 'terminal': {
      const out = block.stdout.length ? block.stdout.join('\n') : res;
      return out ? `${nonEmptyLines(out)} lines` : '';
    }
    default:
      return '';
  }
}

// Inner SVG markup for a category's icon (lucide-style, viewBox 0 0 24 24),
// injected into a namespaced <svg> so paths parse in SVG context.
const ICONS: Record<ToolCategory, string> = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  list: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  agent: '<rect width="18" height="12" x="3" y="8" rx="2"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  default: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.6-.7-.7-2.6z"/>',
};

export function toolIconPath(name: string): string {
  return ICONS[toolCategory(name)];
}

// The path a file-oriented tool acted on, so the row can open it natively.
export function openablePath(block: ToolBlock): string | null {
  const cat = toolCategory(block.name);
  if (cat !== 'file' && cat !== 'edit') return null;
  const summary = argSummary(block.name, block.args).split('  ')[0].trim();
  return summary || null;
}
