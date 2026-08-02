/**
 * Tiny dependency-free markdown renderer for Praxis copilot replies.
 *
 * Deliberately small: the client keeps its dependency list lean, and the model's
 * output is simple markdown (headings, bold/italic, inline code, fenced code,
 * bullet/numbered lists, links, blockquotes). We build React nodes directly — no
 * dangerouslySetInnerHTML, so text is auto-escaped and there is no XSS surface.
 * Links are additionally restricted to http(s)/mailto.
 */
import * as React from "react";

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Inline: `code`, **bold**, *italic* / _italic_, [text](url). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // earliest-match scanner over the four inline patterns
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
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = mm[2].trim();
      nodes.push(
        SAFE_HREF.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            {mm[1]}
          </a>
        ) : (
          mm[1]
        ),
      );
    } else {
      // *italic* or _italic_
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

type Align = "left" | "center" | "right" | null;
type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; header: string[]; align: Align[]; rows: string[][] };

/** Split a `| a | b |` row into trimmed cells, tolerating missing edge pipes. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** A GFM delimiter row: every cell is `---`, `:--`, `--:`, or `:-:`. */
function isDelimiterRow(line: string): boolean {
  if (!line.includes("|") && !/^\s*:?-+:?\s*$/.test(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  if (l && r) return "center";
  if (r) return "right";
  if (l) return "left";
  return null;
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: buf.join(" ") });
      continue;
    }

    // table: a header row followed by a delimiter row
    if (line.includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i++]));
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      blocks.push({ type: "ol", items });
      continue;
    }

    // paragraph (collect until blank / block boundary)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i].trim()) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1]))
    ) {
      buf.push(lines[i++]);
    }
    blocks.push({ type: "p", text: buf.join(" ") });
  }
  return blocks;
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold",
  2: "text-sm font-semibold",
  3: "text-sm font-semibold",
  4: "text-sm font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-semibold",
};

export function Markdown({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_a]:break-words">
      {blocks.map((b, bi) => {
        const key = `b-${bi}`;
        switch (b.type) {
          case "h":
            return React.createElement(
              `h${Math.min(b.level + 2, 6)}`,
              { key, className: `${HEADING_CLASS[b.level]} mt-1` },
              renderInline(b.text, key),
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-0.5 pl-5">
                {b.items.map((it, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(it, `${key}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-0.5 pl-5">
                {b.items.map((it, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(it, `${key}-${ii}`)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-lg bg-muted p-2 text-[0.8em]">
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderInline(b.text, key)}
              </blockquote>
            );
          case "table": {
            const alignClass = (a: Align) =>
              a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {b.header.map((h, hi) => (
                        <th key={`${key}-h-${hi}`} className={`px-2 py-1 font-semibold ${alignClass(b.align[hi] ?? null)}`}>
                          {renderInline(h, `${key}-h-${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={`${key}-r-${ri}`} className="border-b border-border/50">
                        {b.header.map((_, ci) => (
                          <td key={`${key}-r-${ri}-${ci}`} className={`px-2 py-1 align-top ${alignClass(b.align[ci] ?? null)}`}>
                            {renderInline(row[ci] ?? "", `${key}-r-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
