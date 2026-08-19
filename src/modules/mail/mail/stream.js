/**
 * The split inbox: is this a person, or is it a machine?
 *
 * ── ONE RULE OUTRANKS EVERY OTHER ───────────────────────────────────────────
 *
 * A MESSAGE FROM A PARTY WE KNOW IS NEVER SYSTEM MAIL. If the sender resolves to
 * a client, supplier, employee or lead, it goes to the human stream regardless of
 * how many bulk headers it carries — because a great deal of legitimate business
 * correspondence goes out through platforms that stamp `Precedence: bulk` or a
 * `List-Unsubscribe` on everything.
 *
 * This is in code rather than in the rules table on purpose. It is not a rule an
 * administrator should be able to reorder or switch off: misfiling one client's
 * message into a stream nobody watches is the failure that makes people stop
 * trusting the whole split, and it is worth being conservative to avoid it.
 *
 * ── EVERY VERDICT CARRIES ITS REASON ────────────────────────────────────────
 *
 * A classification a person cannot interrogate is one they will not trust. So
 * `classify` always returns a sentence, and it is stored on the thread so
 * "why is this in System?" is answerable from the row rather than by re-deriving
 * it later against rules that may since have changed.
 *
 * PURE. Headers and a resolved-party flag in; a verdict out. The lookup that
 * decides `knownParty` belongs to the repo.
 */
"use strict";

const HUMAN = "HUMAN";
const SYSTEM = "SYSTEM";

/** Case-insensitive header read across the three shapes adapters return. */
function header(headers, name) {
  if (!headers) return null;
  const want = String(name).toLowerCase();
  if (Array.isArray(headers)) {
    const hit = headers.find((h) => h && String(h.name || "").toLowerCase() === want);
    return hit ? String(hit.value ?? "") : null;
  }
  if (typeof headers.get === "function") {
    const v = headers.get(want) ?? headers.get(name);
    if (v !== undefined && v !== null) return String(Array.isArray(v) ? v[0] : v);
  }
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === want) {
      const v = headers[k];
      return String(Array.isArray(v) ? v[0] : v);
    }
  }
  return null;
}

/**
 * A tenant rule against one message.
 *
 * The regexes are tenant-authored, so a bad one must not take the sync down with
 * it: a rule that throws is skipped and the message falls through to the next.
 */
function ruleMatches(rule, { headers, fromAddress, subject }) {
  const value = String(rule.match_value || "");
  const test = (subject_) => {
    try { return new RegExp(value, "i").test(String(subject_ ?? "")); }
    catch { return false; }
  };
  switch (rule.match_kind) {
    case "HEADER_PRESENT": return header(headers, rule.match_key) !== null;
    case "HEADER_VALUE": {
      const h = header(headers, rule.match_key);
      return h !== null && test(h);
    }
    case "FROM_ADDRESS": return test(fromAddress);
    case "FROM_DOMAIN": return test(String(fromAddress || "").split("@").pop());
    case "SUBJECT_REGEX": return test(subject);
    default: return false;
  }
}

/**
 * Which stream this message belongs to, and why.
 *
 * `rules` come from `email_stream_rule`, already ordered by priority. `knownParty`
 * is the resolved sender — pass it and the override applies; omit it and the
 * rules decide.
 */
function classify({ headers = null, fromAddress = null, subject = null, knownParty = null, rules = [] } = {}) {
  if (knownParty) {
    return {
      stream: HUMAN,
      reason: `From ${knownParty.name || fromAddress} — a ${String(knownParty.kind || "party").toLowerCase()} on record, so never filed as system mail.`,
      rule_id: null,
    };
  }
  for (const rule of rules) {
    if (rule.is_active === false) continue;
    if (ruleMatches(rule, { headers, fromAddress, subject })) {
      return { stream: rule.stream, reason: rule.reason, rule_id: rule.email_stream_rule_id || null };
    }
  }
  // The residue: an unknown sender that announced nothing about itself. Treated
  // as human, because a person we have not met yet is the more valuable of the
  // two mistakes to make.
  return { stream: HUMAN, reason: "Nothing marks this as automated, and the sender is not on record yet.", rule_id: null };
}

module.exports = { HUMAN, SYSTEM, header, ruleMatches, classify };
