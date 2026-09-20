import { describe, expect, it } from 'vitest';

import {
  BUILTIN_SLASH_COMMANDS,
  composeSlashCommand,
  inlineSlashCommand,
  matchSlashItems,
  slashQuery,
} from './inlineSlash';

describe('inlineSlashCommand', () => {
  it('matches the commands the server handles inline, case-insensitively', () => {
    expect(inlineSlashCommand('/clear')).toBe('clear');
    expect(inlineSlashCommand('  /Compact  ')).toBe('compact');
    expect(inlineSlashCommand('/RELOAD')).toBe('reload');
  });

  it('takes arguments for /goal, case-sensitively — mirroring ws_handlers.go', () => {
    expect(inlineSlashCommand('/goal')).toBe('goal');
    expect(inlineSlashCommand('/goal ship the release')).toBe('goal');
    expect(inlineSlashCommand('/Goal')).toBeNull();
  });

  it('is not an inline command once anything is appended to an exact-match one', () => {
    // The server compares the whole trimmed message, so "/clear please" is
    // ordinary chat text and DOES run a turn.
    expect(inlineSlashCommand('/clear please')).toBeNull();
  });

  it('is not an inline command when files ride along', () => {
    // Attachments take the message off the inline path server-side.
    expect(inlineSlashCommand('/clear', true)).toBeNull();
  });

  it('leaves unknown slashes to the model', () => {
    expect(inlineSlashCommand('/deploy staging')).toBeNull();
  });
});

describe('slashQuery', () => {
  it('opens only on a bare leading slash word', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/comp')).toBe('comp');
    expect(slashQuery('／comp')).toBe('comp');
  });

  it('stays shut once the command has an argument or sits mid-sentence', () => {
    expect(slashQuery('/goal ship it')).toBeNull();
    expect(slashQuery('see src/main.ts')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
});

describe('matchSlashItems', () => {
  it('ranks exact over prefix over substring', () => {
    const items = [
      { name: 'recompose', description: '', builtin: false },
      { name: 'reload', description: '', builtin: true },
      { name: 'preload-cache', description: '', builtin: false },
    ];
    expect(matchSlashItems(items, 'reload').map((i) => i.name)).toEqual(['reload', 'preload-cache']);
  });
});

describe('composeSlashCommand', () => {
  it('leaves the exact-match built-ins ready to send', () => {
    const clear = BUILTIN_SLASH_COMMANDS.find((c) => c.name === 'clear')!;
    expect(composeSlashCommand(clear)).toBe('/clear');
  });

  it('gives argument-taking commands and skills a trailing space to type after', () => {
    const goal = BUILTIN_SLASH_COMMANDS.find((c) => c.name === 'goal')!;
    expect(composeSlashCommand(goal)).toBe('/goal ');
    expect(composeSlashCommand({ name: 'code-review', description: '', builtin: false })).toBe('/code-review ');
  });
});
