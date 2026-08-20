/**
 * GROUNDING WHITELIST — what the drafting assistant is allowed to know.
 *
 * WHY A WHITELIST AND NOT A BLACKLIST. The assistant drafts messages that go to
 * CUSTOMERS. Anything reachable here can end up in a client's inbox. A blacklist
 * fails open: a module added next year is readable until someone remembers to
 * exclude it. This list fails closed.
 *
 * ── TO ADD A SOURCE ───────────────────────────────────────────────────────
 *  1. Ask first: would it be acceptable for this value to appear, verbatim, in
 *     an email to the client this thread is bound to? If not, stop here.
 *  2. Add an entry with { key, module_key, permission, read(client, ctx), label }.
 *     `read` MUST call the module's SERVICE, never SQL, so RBAC and field
 *     visibility apply exactly as they do in the UI.
 *  3. Every value the read returns must be renderable as a short factual string,
 *     because the fact-fence compares the generated draft against these strings.
 *  4. Add it to the deny-list test in tests/unit/mail-ai-grounding.test.js if it
 *     is adjacent to anything financial-internal.
 *
 * ── PERMANENTLY OUT OF BOUNDS ─────────────────────────────────────────────
 * Do not add, under any framing:
 *   · costing, margin, or the pricing variance index   (our profit on their job)
 *   · payroll, salaries, employee compensation
 *   · supplier buy rates and supplier contract terms   (our cost base)
 *   · other clients' data of any kind
 *   · internal thread notes (PR-3)                     (structurally impossible, and stays that way)
 * These are not "sensitive-ish". Each one, in a client's inbox, is a commercial
 * incident. The list is short on purpose.
 */
"use strict";

const DENY = [
  "costing", "margin", "payroll", "salary", "supplier_rate", "buy_rate",
  "email_thread_note", "pricing_variance",
];

const SOURCES = [
  { key: "dossier_status", module_key: "MOD-29", permission: "view" },
  { key: "milestones", module_key: "MOD-31", permission: "view" },
  { key: "invoice_status", module_key: "MOD-51", permission: "view" },
  { key: "payment_status", module_key: "MOD-56", permission: "view" },
  { key: "quote_status", module_key: "MOD-27", permission: "view" },
  { key: "client_terms", module_key: "MOD-03", permission: "view" },
  { key: "document_checklist", module_key: "MOD-64", permission: "view" },
];

function isDenied(key) {
  const k = String(key || "").toLowerCase();
  return DENY.some((d) => k.includes(d));
}

function allowedKeys() {
  return SOURCES.map((s) => s.key);
}

module.exports = { SOURCES, DENY, isDenied, allowedKeys };
