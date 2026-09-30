
/**
 * Разметка полного текста документа (Markdown с дополнениями).
 *   # / ## / ###      — заголовки (главы, статьи)
 *   1. / 1) / - / *   — пункты, подпункты, списки (вложенность отступом)
 *   | a | b |         — таблицы
 *   > текст           — выделенное важное положение (блок)
 *   ==текст==         — выделение внутри строки
 *   **жирный**, *курсив*
 * Сырой HTML экранируется — внедрить скрипт через текст законопроекта нельзя.
 */
import { Marked } from 'marked';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(md) {
  const toc = [];
  let n = 0;
  const marked = new Marked({
    gfm: true, breaks: false, async: false,
    extensions: [{
      name: 'mark', level: 'inline',
      start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
        if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    }],
    renderer: {
      html(t) { return esc(t.text); },
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = `sec-${++n}`;
        if (depth <= 3) toc.push({ id, depth, text: text.replace(/<[^>]+>/g, '') });
        return `<h${depth + 1} id="${id}" class="doc-h doc-h${depth}">${text}</h${depth + 1}>\n`;
      },
      blockquote({ tokens }) {
        return `<aside class="doc-important"><span class="doc-important-label">Важное положение</span>${this.parser.parse(tokens)}</aside>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (!/^https?:\/\//i.test(href)) return text;
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
      image({ text }) { return esc(text || ''); },
      table(t) {
        // Оборачиваем таблицы — на телефоне прокручивается только таблица, а не страница
        const head = t.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = t.rows.map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="doc-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(String(md || ''));
  return { html, toc };
}


