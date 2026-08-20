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
 *
 * ── WHY `collect` EXISTS ──────────────────────────────────────────────────
 *
 * The list above was correct and INERT: `assist.service` required this file and
 * then used it only inside an `if` whose branches were both empty. No read ever
 * ran, so no fact ever reached the fence, so the fence had nothing to compare a
 * draft against and passed everything. A whitelist that is never executed is a
 * comment. `collect()` is the executor, and it is the ONLY way facts enter a
 * draft — the service does not read the database for grounding itself.
 *
 * Three properties `collect` guarantees, each of which was a way to leak:
 *
 *   1. RBAC is re-checked per source, against the CALLER, using the same
 *      `identityCache.getGrants` the HTTP middleware uses. Mail's own MOD-72
 *      grant says nothing about whether this user may read invoices. A source
 *      the caller cannot read is reported as withheld, not silently dropped —
 *      otherwise the draft is quietly thinner for some users than others and
 *      nobody can tell why.
 *   2. A read that throws is withheld, never fatal. One module being down
 *      degrades the draft; it does not deny the user a composer.
 *   3. Every fact carries the source key it came from, so the composer's
 *      "sources" strip can name them and the operator can audit the draft
 *      against the record rather than trusting it.
 */
"use strict";

const identityCache = require("../../../shared/cache/identity-cache");
const { logger } = require("../../../config/logger");

const DENY = [
  "costing", "margin", "payroll", "salary", "supplier_rate", "buy_rate",
  "email_thread_note", "pricing_variance",
];

/* ── The module services each source reads through ────────────────────────── */
const opsFile = require("../../operations/operations_file/operations_file.service");
const milestone = require("../../operations/milestone/milestone.service");
const finalInvoice = require("../../finance/final_invoice/final_invoice.service");
const receivables = require("../../finance/smart_receivables/smart_receivables.service");
const quotation = require("../../commercial/quotation/quotation.service");
const clientMaster = require("../../master/client_master/client_master.service");
const intake = require("../binding/intake.service");

const money = (v) => (v === null || v === undefined ? null : Number(v).toFixed(2));
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/**
 * `read` returns an ARRAY OF STRINGS, each a complete factual sentence.
 *
 * Strings, not objects, because the fact-fence works by substring: every
 * reference, amount, date and percentage the model is allowed to write must
 * appear here literally. A fact shaped `{ due: "2026-03-14" }` would serialise
 * differently in the prompt than in the fence, and the fence would then reject
 * the model for repeating a date we ourselves gave it.
 */
const SOURCES = [
  {
    key: "dossier_status",
    module_key: "MOD-29",
    permission: "view",
    label: "Operations file",
    applies: (ctx) => Boolean(ctx.dossier_id),
    read: async (client, ctx) => {
      const d = await opsFile.get(client, ctx.dossier_id);
      if (!d) return [];
      const out = [`Operations file ${d.ref} is at status ${d.status}.`];
      if (d.incoterm) out.push(`The agreed incoterm on ${d.ref} is ${d.incoterm}.`);
      if (d.delivery_place) out.push(`The place of delivery on ${d.ref} is ${d.delivery_place}.`);
      if (d.bl_number) out.push(`The bill of lading on ${d.ref} is ${d.bl_number}.`);
      if (d.vessel_name) out.push(`The vessel on ${d.ref} is ${d.vessel_name}.`);
      if (d.eta) out.push(`The ETA on ${d.ref} is ${day(d.eta)}.`);
      return out;
    },
  },
  {
    key: "milestones",
    module_key: "MOD-31",
    permission: "view",
    label: "Milestones",
    applies: (ctx) => Boolean(ctx.dossier_id),
    read: async (client, ctx) => {
      const rows = await milestone.listByDossier(client, ctx.dossier_id);
      if (!rows.length) return ["No milestone chain has been instantiated on this file."];
      const done = rows.filter((m) => m.status === "COMPLETED");
      const open = rows.filter((m) => m.status !== "COMPLETED");
      const out = [];
      const last = done[done.length - 1];
      if (last) {
        out.push(`The last completed stage is ${last.label || last.code}` +
          `${last.completed_at ? ` on ${day(last.completed_at)}` : ""}.`);
      }
      const next = open[0];
      if (next) {
        out.push(`The current stage is ${next.label || next.code}` +
          `${next.due_date ? `, due ${day(next.due_date)}` : ""}.`);
      }
      return out;
    },
  },
  {
    key: "invoice_status",
    module_key: "MOD-51",
    permission: "view",
    label: "Invoices",
    applies: (ctx) => Boolean(ctx.client_id),
    read: async (client, ctx) => {
      const rows = await finalInvoice.list(client, { client_id: ctx.client_id, limit: 5 });
      if (!rows.length) return ["This client has no issued invoices on file."];
      return rows.map((i) =>
        `Invoice ${i.doc_number}: ${money(i.total_ttc)} ${i.currency || ""}`.trim() +
        `, status ${i.status}` +
        (i.payment_due_on ? `, due ${day(i.payment_due_on)}` : "") + ".");
    },
  },
  {
    key: "payment_status",
    module_key: "MOD-56",
    permission: "view",
    label: "Receivables",
    applies: (ctx) => Boolean(ctx.client_id),
    read: async (client, ctx) => {
      const a = await receivables.ageing(client, { clientId: ctx.client_id });
      if (!a || !a.open_count) return ["Nothing is outstanding on this account."];
      const out = [`There are ${a.open_count} open invoices, totalling ${money(a.total)}.`];
      const overdue = Number(a.d1_30 || 0) + Number(a.d31_60 || 0) +
        Number(a.d61_90 || 0) + Number(a.d90_plus || 0);
      if (overdue > 0) out.push(`Of that, ${money(overdue)} is past due.`);
      if (Number(a.d90_plus || 0) > 0) out.push(`${money(a.d90_plus)} has been outstanding more than 90 days.`);
      return out;
    },
  },
  {
    key: "quote_status",
    module_key: "MOD-27",
    permission: "view",
    label: "Quotations",
    applies: (ctx) => Boolean(ctx.client_id),
    read: async (client, ctx) => {
      const rows = await quotation.list(client, { client_id: ctx.client_id, limit: 5 });
      if (!rows.length) return ["No quotation has been issued to this client."];
      return rows.map((q) =>
        `Quotation ${q.doc_number}: ${money(q.total_ttc)} ${q.currency || ""}`.trim() +
        `, status ${q.status}` +
        (q.valid_until ? `, valid until ${day(q.valid_until)}` : "") + ".");
    },
  },
  {
    key: "client_terms",
    module_key: "MOD-03",
    permission: "view",
    label: "Client terms",
    applies: (ctx) => Boolean(ctx.client_id),
    read: async (client, ctx) => {
      const c = await clientMaster.get(client, ctx.client_id);
      if (!c) return [];
      // Projected field by field ON PURPOSE. `c` is the whole master row and it
      // grows columns over time; spreading it into the prompt would hand the
      // model whatever finance adds next, which is the failure mode this entire
      // file exists to prevent.
      const out = [`The client of record is ${c.name}.`];
      if (c.payment_terms_days !== null && c.payment_terms_days !== undefined) {
        out.push(`Agreed payment terms are ${c.payment_terms_days} days.`);
      }
      return out;
    },
  },
  {
    key: "document_checklist",
    module_key: "MOD-64",
    permission: "view",
    label: "Documents outstanding",
    applies: (ctx) => Boolean(ctx.client_id),
    read: async (client, ctx) => {
      const chase = await intake.chaseList(client, ctx.client_id);
      if (chase.nothing_outstanding) return ["Every required document has been received."];
      return [`The documents still outstanding are: ` +
        `${chase.missing.map((m) => m.name_en || m.doc_type_code).join(", ")}.`];
    },
  },
];

function isDenied(key) {
  const k = String(key || "").toLowerCase();
  return DENY.some((d) => k.includes(d));
}

function allowedKeys() {
  return SOURCES.map((s) => s.key);
}

const COLUMN = {
  view: "can_read", read: "can_read", create: "can_create",
  edit: "can_update", update: "can_update", delete: "can_delete", approve: "can_approve",
};

/**
 * May this caller read this source? Same cache, same TTL and same invalidation
 * as `middleware/rbac.js`, so the AI path and the HTTP path cannot disagree.
 * Anything unresolvable is a NO — an unverifiable grant must not become an
 * assumed one.
 */
async function mayRead(client, user, source) {
  if (!user) return false;
  if (user.is_ceo === true) return true;
  try {
    const grants = await identityCache.getGrants(client, {
      role_ids: user.role_ids || [],
      module: source.module_key,
    });
    return grants.some((g) => g[COLUMN[source.permission]] === true);
  } catch (err) {
    logger.warn({ err, source: source.key }, "mail AI grounding: grant lookup failed, withholding source");
    return false;
  }
}

/**
 * Execute the whitelist for one thread.
 *
 * @param ctx {{ client_id, dossier_id, supplier_id, entity_ref }} — the binding,
 *            resolved by the caller from the thread. Nothing here is derived
 *            from the message body: a draft grounded in what the last email
 *            CLAIMED, rather than in what the record says, is exactly the
 *            failure the fact-fence exists to catch, and it should never get
 *            far enough to need catching.
 * @returns {{facts: object[], sources: object[], withheld: object[]}}
 */
async function collect(client, ctx = {}, user = null) {
  const facts = [];
  const sources = [];
  const withheld = [];

  for (const source of SOURCES) {
    if (!source.applies(ctx)) continue;
    if (!(await mayRead(client, user, source))) {
      withheld.push({ key: source.key, label: source.label, reason: `requires ${source.module_key} view` });
      continue;
    }
    let lines = [];
    try {
      lines = await source.read(client, ctx);
    } catch (err) {
      logger.warn({ err, source: source.key }, "mail AI grounding: source read failed");
      withheld.push({ key: source.key, label: source.label, reason: "this module did not answer" });
      continue;
    }
    const clean = (lines || []).filter((l) => typeof l === "string" && l.trim());
    if (!clean.length) continue;
    for (const line of clean) facts.push({ source: source.key, module_key: source.module_key, text: line });
    sources.push({ key: source.key, label: source.label, module_key: source.module_key, count: clean.length });
  }

  return { facts, sources, withheld };
}

/** The fence and the prompt both want plain strings. One place decides how. */
const factText = (facts) => (facts || []).map((f) => (typeof f === "string" ? f : f.text));

module.exports = { SOURCES, DENY, isDenied, allowedKeys, collect, factText, mayRead };
