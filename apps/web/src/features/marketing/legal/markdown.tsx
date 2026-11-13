/**
 * A small, dependency-free Markdown renderer for the legal documents (Server Component only).
 *
 * It covers exactly the subset those documents use: ATX headings, paragraphs with hard
 * breaks, nested bullet/numbered lists, GFM tables, block quotes, horizontal rules and the
 * inline forms **bold**, *italic*, `code`, [links](url), bare URLs and e-mail addresses.
 * Everything is rendered as React elements — never as raw HTML.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './legal.module.css';

// ── Headings / table of contents ─────────────────────────────────────────────

export interface TocItem {
  id: string;
  label: string;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Strips inline Markdown so a heading can be used as plain text. */
function plain(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

// ── Links ────────────────────────────────────────────────────────────────────

/** Paths of the production site that live under /legal in this app. */
const LEGACY_PATHS: Record<string, string> = {
  '/terms': '/legal/terms',
  '/privacy': '/legal/privacy',
  '/dpa': '/legal/dpa',
  '/msa': '/legal/msa',
  '/vendor-terms': '/legal/vendor',
  '/cookie-policy': '/legal/cookies',
  '/do-not-sell-my-info': '/legal/do-not-sell',
};

function resolveHref(href: string): string {
  const m = href.match(/^https?:\/\/(?:www\.)?asteai\.com(\/[^?#]*)?$/i);
  const path = m ? (m[1] ?? '/').replace(/\/$/, '') || '/' : href;
  return LEGACY_PATHS[path] ?? (m && path === '/' ? '/' : href);
}

function MdLink({ href, children }: { href: string; children: ReactNode }) {
  const target = resolveHref(href);
  if (target.startsWith('/')) {
    return <Link href={target}>{children}</Link>;
  }
  if (target.startsWith('mailto:')) {
    return <a href={target}>{children}</a>;
  }
  return (
    <a href={target} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={styles.srOnly}> (opens in a new tab)</span>
    </a>
  );
}

// ── Inline ───────────────────────────────────────────────────────────────────

const INLINE = new RegExp(
  [
    '`([^`]+)`', // 1 code
    '\\*\\*(.+?)\\*\\*', // 2 bold
    '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', // 3,4 link
    '(?<![\\w*])\\*(?!\\s)([^*]+?)\\*(?![\\w*])', // 5 italic
    '(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?\'"])', // 6 bare URL
    '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})', // 7 e-mail (shown as text)
  ].join('|'),
  'g',
);

function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key}>{inline(m[2], key)}</strong>);
    else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(<MdLink key={key} href={m[4]}>{inline(m[3], key)}</MdLink>);
    } else if (m[5] !== undefined) out.push(<em key={key}>{inline(m[5], key)}</em>);
    else if (m[6] !== undefined) out.push(<MdLink key={key} href={m[6]}>{m[6]}</MdLink>);
    else if (m[7] !== undefined) out.push(<span key={key} className={styles.email}>{m[7]}</span>);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A paragraph's lines: a trailing double space (or backslash) is a hard break. */
function lines(raw: string[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  raw.forEach((line, i) => {
    const hard = /( {2,}|\\)$/.test(line);
    const text = line.replace(/( {2,}|\\)$/, '').trim();
    out.push(...inline(text, `${keyBase}-${i}`));
    if (i < raw.length - 1) out.push(hard ? <br key={`${keyBase}-br-${i}`} /> : ' ');
  });
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function isBlockStart(line: string, next?: string): boolean {
  return (
    HEADING.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    /^\s*>/.test(line) ||
    (/^\s*\|/.test(line) && next !== undefined && TABLE_SEP.test(next))
  );
}

function splitRow(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

interface ListNode {
  ordered: boolean;
  start: number;
  items: { text: string[]; children: string[] }[];
}

/** Parses a run of list lines (all at indent >= the first item's indent). */
function parseList(src: string[]): ListNode {
  const first = src[0].match(LIST_ITEM)!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const node: ListNode = { ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  for (const line of src) {
    const m = line.match(LIST_ITEM);
    if (m && m[1].length <= indent) {
      node.items.push({ text: [m[3]], children: [] });
    } else {
      const item = node.items[node.items.length - 1];
      if (m || item.children.length) item.children.push(line);
      else item.text.push(line.trim());
    }
  }
  return node;
}

interface Ctx {
  toc: TocItem[];
  ids: Map<string, number>;
}

function uniqueId(ctx: Ctx, label: string): string {
  const base = slugify(label) || 'section';
  const seen = ctx.ids.get(base) ?? 0;
  ctx.ids.set(base, seen + 1);
  return seen ? `${base}-${seen + 1}` : base;
}

function blocks(src: string[], ctx: Ctx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `${keyBase}-${k++}`;

  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      // The page owns the only h1, so document levels shift down by one where needed.
      const level = Math.min(Math.max(h[1].length, 2), 4) as 2 | 3 | 4;
      const label = plain(h[2]);
      const id = uniqueId(ctx, label);
      if (level === 2) ctx.toc.push({ id, label });
      const Tag = `h${level}` as const;
      out.push(
        <Tag key={key()} id={id} className={styles.heading}>
          {inline(h[2], id)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (HR.test(line)) { out.push(<hr key={key()} />); i++; continue; }

    if (/^\s*\|/.test(line) && src[i + 1] !== undefined && TABLE_SEP.test(src[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < src.length && /^\s*\|/.test(src[i])) rows.push(splitRow(src[i++]));
      const tk = key();
      out.push(
        <div key={tk} className={styles.tableWrap} role="region" aria-label="Table" tabIndex={0}>
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j} scope="col">{inline(c, `${tk}-h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${tk}-${ri}-${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < src.length && /^\s*>/.test(src[i])) inner.push(src[i++].replace(/^\s*>\s?/, ''));
      const bk = key();
      out.push(<blockquote key={bk}>{blocks(inner, ctx, bk)}</blockquote>);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const run: string[] = [];
      const indent = line.match(LIST_ITEM)![1].length;
      while (i < src.length) {
        const l = src[i];
        if (!l.trim()) {
          // A blank line continues the list only if the next line is another item or indented.
          const nxt = src[i + 1];
          if (nxt !== undefined && (LIST_ITEM.test(nxt) || /^\s{2,}\S/.test(nxt))) { i++; continue; }
          break;
        }
        const m = l.match(LIST_ITEM);
        if (m && m[1].length < indent) break;
        if (!m && run.length && (HEADING.test(l) || HR.test(l) || /^\s*[|>]/.test(l))) break;
        run.push(l);
        i++;
      }
      out.push(renderList(parseList(run), ctx, key()));
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (i < src.length && src[i].trim() && !(para.length && isBlockStart(src[i], src[i + 1]))) {
      para.push(src[i++]);
    }
    const pk = key();
    out.push(<p key={pk}>{lines(para, pk)}</p>);
  }
  return out;
}

function renderList(node: ListNode, ctx: Ctx, k: string): ReactNode {
  const items = node.items.map((item, j) => (
    <li key={j}>
      {lines(item.text, `${k}-${j}`)}
      {item.children.length > 0 && blocks(dedent(item.children), ctx, `${k}-${j}c`)}
    </li>
  ));
  return node.ordered ? (
    <ol key={k} start={node.start !== 1 ? node.start : undefined}>{items}</ol>
  ) : (
    <ul key={k}>{items}</ul>
  );
}

function dedent(src: string[]): string[] {
  const min = Math.min(...src.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
  return src.map((l) => l.slice(min));
}

/** Renders a Markdown document and returns its body plus the h2 table of contents. */
export function renderMarkdown(source: string): { body: ReactNode[]; toc: TocItem[] } {
  const ctx: Ctx = { toc: [], ids: new Map() };
  const body = blocks(source.replace(/\r\n/g, '\n').split('\n'), ctx, 'md');
  return { body, toc: ctx.toc };
}

// ── Document header ──────────────────────────────────────────────────────────

export interface ParsedDoc {
  lastUpdated: string;
  version: string;
  body: string;
}

/**
 * Removes the document's own "# Title" and "**Last Updated:** … | **Version:** …" header
 * (the page renders those itself), mirroring the production site's parseLegalDoc.
 */
export function parseHeader(raw: string): ParsedDoc {
  const src = raw.replace(/\r\n/g, '\n').split('\n');
  let lastUpdated = '';
  let version = '';
  let bodyStart = 0;
  let sawTitle = false;
  for (let i = 0; i < Math.min(src.length, 8); i++) {
    const line = src[i].trim();
    if (!line) continue;
    if (!sawTitle && /^#\s+/.test(line)) { sawTitle = true; bodyStart = i + 1; continue; }
    const updated = line.match(/\*\*Last Updated:\*\*\s*([^|]+)/i);
    const versioned = line.match(/\*\*Version:\*\*\s*([^|]+)/i);
    if (updated || versioned) {
      if (updated) lastUpdated = updated[1].trim();
      if (versioned) version = versioned[1].trim();
      bodyStart = i + 1;
      continue;
    }
    if (line === '---' && bodyStart > 0) bodyStart = i + 1;
    break;
  }
  return { lastUpdated, version, body: src.slice(bodyStart).join('\n') };
}
