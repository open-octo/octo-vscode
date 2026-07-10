import { describe, expect, it } from 'vitest';

import { parseEditDiffBlock } from './diffView';

describe('parseEditDiffBlock', () => {
  it('splits a removed/added block into before/after text', () => {
    const diff = '- old line one\n- old line two\n+ new line one\n+ new line two\n';
    expect(parseEditDiffBlock(diff)).toEqual({
      before: 'old line one\nold line two',
      after: 'new line one\nnew line two',
    });
  });

  it('handles a pure deletion (no + lines)', () => {
    const diff = '- gone\n';
    expect(parseEditDiffBlock(diff)).toEqual({ before: 'gone', after: '' });
  });

  it('handles a pure insertion (no - lines)', () => {
    const diff = '+ added\n';
    expect(parseEditDiffBlock(diff)).toEqual({ before: '', after: 'added' });
  });

  it('ignores lines without a recognized prefix rather than misclassifying them', () => {
    // Not a real server output shape, but the parser shouldn't crash or
    // silently absorb stray content into either side.
    const diff = '- old\nnot prefixed\n+ new\n';
    expect(parseEditDiffBlock(diff)).toEqual({ before: 'old', after: 'new' });
  });

  it('preserves a leading "- " or "+ " inside the actual content (only strips the first two chars)', () => {
    const diff = '- - literal dash in old content\n+ + literal plus in new content\n';
    expect(parseEditDiffBlock(diff)).toEqual({
      before: '- literal dash in old content',
      after: '+ literal plus in new content',
    });
  });
});
