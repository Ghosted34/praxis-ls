/**
 * Mapping a mail server's folders onto the six the product speaks.
 *
 * ── WHY SPECIAL-USE FLAGS BEAT NAMES ────────────────────────────────────────
 *
 * A server that implements RFC 6154 tells you which folder is Sent by flagging
 * it `\Sent`. That is authoritative and language-independent. Guessing from the
 * name is not: the Sent folder is "Sent", "Sent Items", "Sent Mail",
 * "INBOX.Sent", "Éléments envoyés", "Gesendete Elemente", and a dozen more, and
 * a name list is never finished. So flags first, names only as the fallback for
 * servers that do not advertise them — which, on cPanel/Dovecot, many do.
 *
 * ── WHY MOST FOLDERS ARE NOT SYNCED ─────────────────────────────────────────
 *
 * A mailbox can advertise hundreds. Pulling them all on first connect turns a
 * two-minute setup into an overnight job and fills the document vault with a
 * decade of attachments nobody asked for. Only the canonical six sync by
 * default; the rest are recorded so the UI can show them and a later feature can
 * opt them in.
 *
 * PURE. Takes the folder list an adapter reports and returns what to store.
 */
"use strict";

const CANONICAL = ["INBOX", "SENT", "DRAFTS", "SPAM", "ARCHIVE", "TRASH"];

/** RFC 6154 special-use attribute → our name. The authoritative path. */
const BY_FLAG = {
  "\\sent": "SENT",
  "\\drafts": "DRAFTS",
  "\\junk": "SPAM",
  "\\archive": "ARCHIVE",
  "\\trash": "TRASH",
  "\\all": null,        // Gmail's "All Mail" is every message twice over — never sync it
  "\\flagged": null,
  "\\important": null,
};

/**
 * Name patterns, for servers that do not advertise special-use. English and
 * French first because that is the deployment, then the handful that show up on
 * shared hosting regardless of the account language.
 */
const BY_NAME = [
  [/^inbox$/i, "INBOX"],
  [/^(sent|sent[\s._-]*items|sent[\s._-]*mail|outbox)$/i, "SENT"],
  [/^(éléments?[\s._-]*envoyés|elements?[\s._-]*envoyes|messages?[\s._-]*envoyés)$/i, "SENT"],
  [/^(gesendete[\s._-]*(elemente|objekte)|enviados|posta[\s._-]*inviata)$/i, "SENT"],
  [/^(drafts?|brouillons?|entw(ü|ue)rfe|borradores)$/i, "DRAFTS"],
  [/^(spam|junk|junk[\s._-]*e-?mail|bulk[\s._-]*mail|courrier[\s._-]*ind(é|e)sirable|pourriel)$/i, "SPAM"],
  [/^(archive[sd]?|archives?|archiv)$/i, "ARCHIVE"],
  [/^(trash|deleted|deleted[\s._-]*items|bin|corbeille|papierkorb|papelera)$/i, "TRASH"],
];

/** The last segment of a hierarchical path — `INBOX.Sent` is Sent. */
function leafName(path, delimiter = ".") {
  const p = String(path || "").trim();
  if (!p) return "";
  const parts = delimiter && p.includes(delimiter) ? p.split(delimiter) : p.split(/[./]/);
  return (parts[parts.length - 1] || p).trim();
}

/**
 * Which canonical role a folder plays, or null for "one of the user's own".
 * `flags` is whatever the adapter reports — a Set, an array, or absent.
 */
function canonicalFor(folder = {}) {
  const flags = folder.flags instanceof Set ? [...folder.flags] : folder.flags || [];
  for (const raw of flags) {
    const f = String(raw || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(BY_FLAG, f)) return BY_FLAG[f];
  }
  const path = String(folder.path || folder.name || "");
  if (/^inbox$/i.test(path)) return "INBOX";
  const leaf = leafName(path, folder.delimiter);
  for (const [re, name] of BY_NAME) if (re.test(leaf)) return name;
  return null;
}

/**
 * Turn an adapter's folder listing into rows to upsert.
 *
 * Two folders can claim the same role — a server with both "Sent" and
 * "Sent Items", or one that flags `\Sent` on a folder also called "Archive". The
 * first wins and later claimants are demoted to ordinary folders, because the
 * unique index will reject a second and a failed sync is worse than a folder
 * appearing in the wrong list.
 */
function mapFolders(list = [], { limit = 25 } = {}) {
  const claimed = new Set();
  const rows = [];
  for (const f of list) {
    const path = String(f.path || f.name || "").trim();
    if (!path) continue;
    let canonical = canonicalFor(f);
    if (canonical && claimed.has(canonical)) canonical = null;
    if (canonical) claimed.add(canonical);
    rows.push({
      provider_path: path,
      canonical,
      display_name: leafName(path, f.delimiter) || path,
      is_syncable: Boolean(canonical),
    });
  }
  // Deterministic: canonical folders first in the product's own order, then the
  // rest alphabetically. The cap applies to the tail, never to the six.
  const order = (r) => (r.canonical ? CANONICAL.indexOf(r.canonical) : 100);
  rows.sort((a, b) => order(a) - order(b) || a.provider_path.localeCompare(b.provider_path));
  return rows.slice(0, Math.max(limit, CANONICAL.length));
}

/**
 * Has this folder been renumbered since we last looked?
 *
 * IMAP's answer to "the uids you remember are meaningless now" is a changed
 * UIDVALIDITY, and the only correct response is to re-scan the folder from zero.
 * Getting this wrong in the other direction — treating a changed value as
 * unchanged — silently skips every message that arrived since.
 */
function cursorFor(stored, uidValidity) {
  const prior = stored || {};
  const same = Number(prior.uidvalidity) === Number(uidValidity);
  return { uidvalidity: Number(uidValidity), last_uid: same ? Number(prior.last_uid || 0) : 0, rescanned: !same };
}

module.exports = { CANONICAL, BY_FLAG, BY_NAME, leafName, canonicalFor, mapFolders, cursorFor };
