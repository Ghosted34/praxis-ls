/**
 * The search mini-language: `from:maersk has:attachment demurrage`.
 *
 * ── WHY A MINI-LANGUAGE AND NOT A ROW OF DROPDOWNS ──────────────────────────
 *
 * Because everyone already knows this one. It is what Gmail, Outlook and every
 * other mail client accept, and an operator who types `from:` expecting it to
 * work and gets a literal-text search has been told the product is not a real
 * mail client. The dropdowns can exist too — they compose into the same string.
 *
 * ── THE PARSER IS DELIBERATELY FORGIVING ────────────────────────────────────
 *
 * An unknown operator is not an error; `foo:bar` is searched as text, because
 * refusing a query is worse than searching for slightly the wrong thing, and
 * colons appear in real subjects. Quotes group. A trailing `from:` with nothing
 * after it is ignored rather than matching everything.
 *
 * PURE. Returns a filter object and a tsquery string; the repo turns that into
 * SQL. Keeping it separate is what lets every operator be tested without a
 * database.
 */
"use strict";

const FOLDERS = new Set(["INBOX", "SENT", "DRAFTS", "SPAM", "ARCHIVE", "TRASH"]);

/**
 * Split on spaces, but keep "quoted phrases" together — and keep an operator
 * and its quoted value as ONE token, so `subject:"bill of lading"` is a
 * subject filter for the phrase rather than a bare `subject:` and a stray
 * phrase.
 *
 * Hand-scanned rather than regex-split. A regex that has to decide where the
 * operator name ends AND where the quoted value ends has two backtrackable
 * quantifiers feeding each other — CodeQL flagged the first draft as
 * polynomial on a caller-controlled run of `_` (`([a-z_]+)` re-tries once per
 * character before the quote fails, O(n²) over a chunk of input). Every pass
 * here is a single forward scan, so the worst case is linear in the query
 * length.
 */
function tokenise(q) {
  const s = String(q || "");
  const out = [];
  const n = s.length;
  const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  const isWordChar = (ch) => {
    const code = ch.charCodeAt(0);
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
  };

  let i = 0;
  while (i < n) {
    if (isSpace(s[i])) { i += 1; continue; }

    // A quoted phrase: everything to the closing quote, spaces included.
    if (s[i] === '"') {
      const close = s.indexOf('"', i + 1);
      const value = close === -1 ? s.slice(i + 1) : s.slice(i + 1, close);
      if (value !== "") out.push({ value, quoted: true });
      i = close === -1 ? n : close + 1;
      continue;
    }

    // An operator directly attached to its quoted value — `subject:"bill of
    // lading"` — is one token. `[a-z_]+` is found by a forward scan, so there
    // is no quantifier to backtrack.
    let opEnd = i;
    while (opEnd < n && isWordChar(s[opEnd])) opEnd += 1;
    if (opEnd > i && s[opEnd] === ":" && s[opEnd + 1] === '"') {
      const close = s.indexOf('"', opEnd + 2);
      const value = close === -1 ? s.slice(opEnd + 2) : s.slice(opEnd + 2, close);
      if (value !== "") out.push({ value: `${s.slice(i, opEnd + 1)}"${value}"`, quoted: false });
      i = close === -1 ? n : close + 1;
      continue;
    }

    // A plain word up to the next whitespace (operators without a quoted
    // value, addresses, free text). parseQuery splits `op:value` itself.
    let j = i;
    while (j < n && !isSpace(s[j])) j += 1;
    out.push({ value: s.slice(i, j), quoted: false });
    i = j;
  }
  return out;
}

/** A date operator's value: `2026-08-19`, or `7d` / `24h` as a relative window. */
function parseDate(raw) {
  const v = String(raw || "").trim();
  const rel = /^(\d+)([dhw])$/i.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { d: 86400000, h: 3600000, w: 604800000 }[rel[2].toLowerCase()];
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a query into `{ filters, terms, tsquery }`.
 *
 * `terms` is what remains after the operators are taken out; `tsquery` is that
 * remainder as a Postgres query with prefix matching on the last word, so
 * "demur" finds "demurrage" while the user is still typing.
 */
function parseQuery(q) {
  const filters = {
    from: [], to: [], subject: [], folder: null, label: null, client: null,
    unread: null, starred: null, hasAttachment: null, stream: null, vip: null,
    before: null, after: null,
  };
  const terms = [];
  // `terms` for callers that want the plain strings; `tsqTerms` for the
  // tsquery builder, which needs to know which terms were quoted so a phrase
  // survives as a phrase instead of being re-split into ANDed words.
  const tsqTerms = [];

  for (const { value, quoted } of tokenise(q)) {
    const m = !quoted && /^([a-z_]+):(.*)$/i.exec(value);
    if (!m) {
      terms.push(value);
      tsqTerms.push({ text: value, quoted });
      continue;
    }
    const key = m[1].toLowerCase();
    let val = m[2];
    // `subject:"bill of lading"` means the phrase, not a literal quote mark.
    // Tokenise already kept the quoted value together; strip the marks so the
    // filter matches the words the user typed.
    if (/^".*"$/.test(val)) val = val.slice(1, -1);
    if (val === "") continue;            // a dangling `from:` matches nothing useful

    switch (key) {
      case "from": filters.from.push(val.toLowerCase()); break;
      case "to": filters.to.push(val.toLowerCase()); break;
      case "subject": filters.subject.push(val); break;
      case "folder": case "in": {
        const f = val.toUpperCase();
        if (FOLDERS.has(f)) filters.folder = f; else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); }
        break;
      }
      case "label": filters.label = val; break;
      case "client": filters.client = val; break;
      case "stream": {
        const s = val.toUpperCase();
        if (s === "HUMAN" || s === "SYSTEM") filters.stream = s; else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); }
        break;
      }
      case "is": {
        const v = val.toLowerCase();
        if (v === "unread") filters.unread = true;
        else if (v === "read") filters.unread = false;
        else if (v === "starred") filters.starred = true;
        else if (v === "vip") filters.vip = true;
        else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); }
        break;
      }
      case "has": {
        if (val.toLowerCase() === "attachment") filters.hasAttachment = true;
        else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); }
        break;
      }
      case "before": { const d = parseDate(val); if (d) filters.before = d; else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); } break; }
      case "after": case "newer": { const d = parseDate(val); if (d) filters.after = d; else { terms.push(value); tsqTerms.push({ text: value, quoted: false }); } break; }
      default: terms.push(value); tsqTerms.push({ text: value, quoted: false }); // unknown operator → plain text
    }
  }

  return { filters, terms, tsquery: toTsQuery(tsqTerms) };
}

/**
 * Free text → a Postgres tsquery string.
 *
 * Built by hand rather than with `plainto_tsquery` so the LAST word can be a
 * prefix match: search is used while typing, and "demur" finding nothing until
 * the final "rage" is typed feels broken. Every character that means something
 * to tsquery is stripped rather than escaped — the input is a search box, and a
 * user typing `&` means the character, not the operator.
 *
 * Terms may be plain strings or `{ text, quoted }`. A quoted term survives as
 * a phrase (`word1 <-> word2`, the documented tsquery FOLLOWED BY operator)
 * instead of being re-split into ANDed words — the parser's contract says
 * "quotes group", and this is where that promise is kept.
 */
function toTsQuery(terms) {
  const cleaned = terms
    .map((t) => {
      const quoted = typeof t !== "string" && Boolean(t.quoted);
      const text = String(typeof t === "string" ? t : t.text)
        .replace(/[!&|()<>:*'\\]/g, " ")
        .trim();
      return { text, quoted };
    })
    .filter((t) => t.text);
  if (!cleaned.length) return null;
  const last = cleaned.length - 1;
  return cleaned
    .map(({ text, quoted }, i) => {
      const words = text.split(/\s+/);
      if (quoted && words.length > 1) {
        const phrase = words.join(" <-> ");
        return i === last ? `${phrase}:*` : phrase;
      }
      return words
        .map((w, j) => (i === last && j === words.length - 1 ? `${w}:*` : w))
        .join(" & ");
    })
    .join(" & ");
}

module.exports = { FOLDERS, tokenise, parseDate, parseQuery, toTsQuery };
