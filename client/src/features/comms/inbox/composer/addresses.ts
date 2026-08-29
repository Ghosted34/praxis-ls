/**
 * Reading a recipient row the way a person writes one.
 *
 * ── Why this is shared, and not three regexes ───────────────────────────────
 *
 * The composer split addresses on `/[,;]/`, the server's `send` schema accepted
 * `cc` only as an array of already-bare addresses, and the recipient field
 * treated the whole row as one opaque string. So the three places that decide
 * what "two recipients" means disagreed, and the disagreement surfaced as a 422
 * whose entire text was "Invalid body" — from a Cc field where a second address
 * could only be added by typing a comma nobody had been told about.
 *
 * These helpers are the client half of `mail.validator.js`'s parse, and they
 * make the same two decisions:
 *
 *   · separators inside "…" or <…> are not separators, so
 *     `"Dupont, Jean" <j@acme.cm>` stays ONE recipient rather than becoming two
 *     broken ones;
 *   · a display-name form is an address with a name in front of it, so
 *     `Jean Dupont <jean@acme.cm>` — what every mail client puts on the
 *     clipboard — is accepted and reduced to what SMTP needs.
 */

/** Split a recipient row on separators that are not inside "…" or <…>. */
export function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quoted = false;
  let angled = false;
  for (const ch of String(raw ?? "")) {
    if (ch === '"') { quoted = !quoted; buf += ch; continue; }
    if (!quoted && ch === "<") { angled = true; buf += ch; continue; }
    if (!quoted && ch === ">") { angled = false; buf += ch; continue; }
    if (!quoted && !angled && (ch === "," || ch === ";" || ch === "\n" || ch === "\r" || ch === "\t")) {
      out.push(buf); buf = ""; continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/**
 * `a@b.cm c@d.cm` → two recipients; `Jean Dupont` → one bad one.
 *
 * A space is a separator ONLY when every piece either side of it is already an
 * address, which is the one reading with no second interpretation. A display
 * name is full of spaces and is not two recipients, so a token carrying `<` or
 * a quote is left alone whatever is in it.
 */
export function expandSpaced(token: string): string[] {
  const t = String(token ?? "").trim();
  if (!/\s/.test(t) || t.includes("<") || t.includes('"')) return [t];
  const parts = t.split(/\s+/);
  return parts.every((x) => /^[^\s@]+@[^\s@]+$/.test(x)) ? parts : [t];
}

/** A row → the tokens in it, as typed — a display name keeps its name. */
export function addressTokens(raw: string): string[] {
  return splitAddressList(raw).flatMap(expandSpaced).filter(Boolean);
}

/** "Jean Dupont <jean@acme.cm>" → "jean@acme.cm". Anything else, trimmed. */
export function bareAddress(raw: string): string {
  const s = String(raw ?? "").trim();
  const angled = s.match(/<([^<>]*)>\s*$/);
  return (angled ? angled[1] : s).trim().replace(/^["']|["']$/g, "").trim();
}

/** A row → the addresses in it, in order, de-duplicated case-insensitively. */
export function parseAddresses(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of addressTokens(raw)) {
    const a = bareAddress(token);
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

/**
 * Is this an address at all?
 *
 * Deliberately the loose check, not RFC 5322: it exists to draw a red chip
 * BEFORE the send, and the server's `z.string().email()` is what actually
 * refuses. A client that were stricter than the server would refuse addresses
 * the server would have accepted, which is worse than a bounce — there is no
 * way past it.
 */
export function isAddress(raw: string): boolean {
  const a = bareAddress(raw);
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(a);
}
