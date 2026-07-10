import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';

// No hljs here (unlike octo-agent's own web UI) — a fixed highlight.js theme
// would clash with whichever VS Code color theme the user has active, and
// there's no simple way to map hljs token classes onto VS Code's theme
// variables. Code blocks get a clean monospace card with a copy button
// instead of syntax colors.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHref(href: string): boolean {
  if (!href) return false;
  const lower = href.trim().toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:');
}

const renderer = new Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang || 'plaintext';
  return `<div class="code-block">
  <div class="code-header">
    <span class="code-lang">${escapeHtml(language)}</span>
    <button class="copy-btn">Copy</button>
  </div>
  <pre><code>${escapeHtml(text)}</code></pre>
</div>`;
};

renderer.link = function ({ href, title, text }: { href: string; title?: string | null; text: string }) {
  const safe = isSafeHref(href);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${safe ? escapeHtml(href) : ''}"${titleAttr} target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
};

renderer.blockquote = function ({ text }: { text: string }) {
  return `<blockquote class="md-bq">${text}</blockquote>`;
};

marked.use({ renderer });

/**
 * Renders a chat message body to sanitized HTML for {@html}. DOMPurify strips
 * anything dangerous (script tags, event handlers, javascript: URLs) — the
 * agent's own output is not a trusted source, and this is the one place
 * webview code inserts raw HTML into the DOM.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text) as string, { ADD_ATTR: ['target'] });
}

export function setupCopyButtons(el: HTMLElement): { destroy: () => void } {
  function onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.copy-btn');
    if (!btn || !el.contains(btn)) return;
    const block = btn.closest('.code-block');
    const code = block?.querySelector('pre code');
    const content = code?.textContent ?? '';
    navigator.clipboard.writeText(content).then(() => {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    });
  }
  el.addEventListener('click', onClick);
  return { destroy: () => el.removeEventListener('click', onClick) };
}
