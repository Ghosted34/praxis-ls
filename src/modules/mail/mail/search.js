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

/** Split on spaces, but keep "quoted phrases" together. */
function tokenise(q) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || "")))) {
    const quoted = m[1] !== undefined;
    const value = quoted ? m[1] : m[2];
    if (value !== "") out.push({ value, quoted });
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

  for (const { value, quoted } of tokenise(q)) {
    const m = !quoted && /^([a-z_]+):(.*)$/i.exec(value);
    if (!m) { terms.push(value); continue; }
    const key = m[1].toLowerCase();
    const val = m[2];
    if (val === "") continue;            // a dangling `from:` matches nothing useful

    switch (key) {
      case "from": filters.from.push(val.toLowerCase()); break;
      case "to": filters.to.push(val.toLowerCase()); break;
      case "subject": filters.subject.push(val); break;
      case "folder": case "in": {
        const f = val.toUpperCase();
        if (FOLDERS.has(f)) filters.folder = f; else terms.push(value);
        break;
      }
      case "label": filters.label = val; break;
      case "client": filters.client = val; break;
      case "stream": {
        const s = val.toUpperCase();
        if (s === "HUMAN" || s === "SYSTEM") filters.stream = s; else terms.push(value);
        break;
      }
      case "is": {
        const v = val.toLowerCase();
        if (v === "unread") filters.unread = true;
        else if (v === "read") filters.unread = false;
        else if (v === "starred") filters.starred = true;
        else if (v === "vip") filters.vip = true;
        else terms.push(value);
        break;
      }
      case "has": {
        if (val.toLowerCase() === "attachment") filters.hasAttachment = true;
        else terms.push(value);
        break;
      }
      case "before": { const d = parseDate(val); if (d) filters.before = d; else terms.push(value); break; }
      case "after": case "newer": { const d = parseDate(val); if (d) filters.after = d; else terms.push(value); break; }
      default: terms.push(value);        // unknown operator → plain text
    }
  }

  return { filters, terms, tsquery: toTsQuery(terms) };
}

/**
 * Free text → a Postgres tsquery string.
 *
 * Built by hand rather than with `plainto_tsquery` so the LAST word can be a
 * prefix match: search is used while typing, and "demur" finding nothing until
 * the final "rage" is typed feels broken. Every character that means something
 * to tsquery is stripped rather than escaped — the input is a search box, and a
 * user typing `&` means the character, not the operator.
 */
function toTsQuery(terms) {
  const cleaned = terms
    .map((t) => String(t).replace(/[!&|()<>:*'\\]/g, " ").trim())
    .flatMap((t) => t.split(/\s+/))
    .filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.map((t, i) => (i === cleaned.length - 1 ? `${t}:*` : t)).join(" & ");
}

module.exports = { FOLDERS, tokenise, parseDate, parseQuery, toTsQuery };
