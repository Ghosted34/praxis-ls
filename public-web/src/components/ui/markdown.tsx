import * as React from "react";

/**
 * Tiny dependency-free markdown renderer for tenant-authored public copy — the
 * job advert being the case that matters.
 *
 * WHY IT EXISTS. An advert is drafted in a markdown editor (`hr/careers`, whose
 * preview renders it), and the public page that prints `## Requirements` and
 * `- Five years in clearing` as literal text is the page where the tenant looks
 * worst. So the same grammar gets rendered, not stripped.
 *
 * WHY IT IS SAFE ON A STRANGER'S PAGE. React nodes are built directly — there is
 * no `dangerouslySetInnerHTML` anywhere in this file, so text is escaped by
 * construction and raw HTML in a description renders AS the text it is. Links are
 * additionally restricted to http(s)/mailto: `[resume](javascript:…)` is the
 * payload this class of renderer usually forgets, and it arrives here through a
 * form a tenant's own staff can fill.
 *
 * Supported: `#`–`####` headings, `-`/`*` bullets, `1.` lists, fenced code,
 * `>` quotes, pipe tables, paragraphs; inline `code`, **bold**, *italic*,
 * [text](url). Deliberately NOT supported: images, nested lists, footnotes, HTML
 * blocks, autolinks. Anything else is a paragraph, which is the right failure —
 * a lost bullet, not a broken page.
 */
const SAFE_HREF = /^(https?:|mailto:)/i;

type Align = "left" | "center" | "right";

export function renderInline(
  text: string,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/;
  let rest = text;
  let i = 0;
  while (rest.length) {
    const m = pattern.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const label = mm ? mm[1] : tok;
      const href = (mm ? mm[2] : "").trim();
      nodes.push(
        SAFE_HREF.test(href) ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {label}
          </a>
        ) : (
          // An unsafe href keeps its words and loses the link. Dropping the text
          // would silently delete part of an advert.
          <span key={k}>{label}</span>
        ),
      );
    } else {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

const splitRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());

const isDelimiterRow = (line: string): boolean =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function alignOf(cell: string): Align {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  return l && r ? "center" : r ? "right" : "left";
}

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "code"; text: string; lang?: string }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; aligns: Align[]; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = String(src || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ t: "p", text: para.join(" ").trim() });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }

    // Fenced code: everything inside is literal, which is the point of a fence.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ t: "code", text: buf.join("\n"), lang: fence[1] });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({
        t: "h",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ t: "quote", text: buf.join(" ").trim() });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim());
        i += 1;
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim());
        i += 1;
      }
      blocks.push({ t: "ol", items });
      continue;
    }

    // A table is a header row followed by a delimiter row. Both must be pipes or
    // the start/end of the line, so an em-dash in prose is never a table.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isDelimiterRow(lines[i + 1])
    ) {
      flushPara();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, c) => cells[c] ?? ""));
        i += 1;
      }
      blocks.push({ t: "table", head, aligns, rows });
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flushPara();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div>
      {blocks.map((b, idx) => {
        const k = `b-${idx}`;
        switch (b.t) {
          case "h": {
            // A document's own `#` can't be an `<h1>` here — the page already has
            // one, and "one h1 per page" is a rule this app keeps (N10). So every
            // level in a body of copy shifts down one and caps at h5.
            const level = Math.min(b.level + 1, 5);
            const size =
              level <= 3 ? "text-h3" : level === 4 ? "text-title" : "text-base";
            return React.createElement(
              `h${level}`,
              { key: k, className: `mt-8 mb-2 font-semibold ${size}` },
              renderInline(b.text, k),
            );
          }
          case "ul":
            return (
              <ul key={k}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${k}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={k}
                className="my-4 overflow-x-auto rounded-lg border bg-muted p-4 text-sm"
              >
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote
                key={k}
                className="my-4 border-l-2 border-[var(--primary)] pl-4 italic text-muted-foreground"
              >
                {renderInline(b.text, k)}
              </blockquote>
            );
          case "table":
            return (
              <div key={k} className="my-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {b.head.map((cell, c) => (
                        <th
                          key={c}
                          className="border-b px-3 py-2 text-left font-semibold"
                          style={{ textAlign: b.aligns[c] || "left" }}
                        >
                          {renderInline(cell, `${k}-h${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className="border-b px-3 py-2 align-top"
                            style={{ textAlign: b.aligns[c] || "left" }}
                          >
                            {renderInline(cell, `${k}-${r}-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={k}>{renderInline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}

export default Markdown;
