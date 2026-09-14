/**
 * Smart Comms → ERP references (MOD-64).
 *
 * "Send me that invoice" has two possible answers, and they age differently.
 *
 * The PDF is a snapshot. It is correct forever about what was true when it was
 * sent, and silently wrong about everything since — a bubble that still reads
 * UNPAID on an invoice settled last Tuesday, in a thread somebody scrolls back
 * through to decide whether to chase a client. Nothing about the bubble tells
 * them it is stale, because a PDF has no way to say so.
 *
 * A REFERENCE stays true, because it is resolved when it is READ. That is the
 * whole design here: `comms_attachment` stores `erp_kind` + `erp_id` and never
 * a copy of the figures, and this module turns that pointer into a card at the
 * moment somebody's screen draws it.
 *
 * ── AND IT RESOLVES AGAINST THE READER, NOT THE SENDER ────────────────────
 *
 * Which is the half that is easy to get wrong. A channel has members with
 * different jobs: an ops coordinator and a finance controller are both in the
 * dossier channel, and only one of them is supposed to see what the client is
 * being charged. If the card were rendered once by the sender and stored, the
 * thread would become a way to leak every figure in the ERP to anybody who can
 * be added to a channel — RBAC bypassed not by a bug but by a design that
 * cached the answer.
 *
 * So every read passes an `allow` set — the module keys THIS reader holds
 * `view` on, resolved per-request from `readPermissions` — and a card the
 * reader cannot see comes back `redacted: true` carrying only `erp_label`, the
 * document number the sender saw. They learn that an invoice was referenced and
 * which one. They do not learn what it is worth. That is the same thing the
 * product tells them everywhere else, and the alternative — hiding the
 * attachment entirely — makes the conversation unreadable ("as discussed,
 * attached" with nothing attached).
 *
 * ── WHY A REGISTRY AND NOT SIX ENDPOINTS ──────────────────────────────────
 *
 * Because the picker has to search all of them at once. Somebody who types
 * "SLAS-2026" does not know whether that is a dossier ref or an invoice number,
 * and making them choose a type first is asking them to answer a question the
 * product can answer for them. One registry entry per kind is also what keeps
 * the permission mapping in one readable place rather than spread across the
 * modules that happen to own each table.
 */
"use strict";

const { AppError } = require("../../utils/errors");

/**
 * The permission each kind answers to.
 *
 * An invoice is the one that is not a constant: `invoice` holds proformas and
 * final invoices in the same table and they are DIFFERENT modules (MOD-50 vs
 * MOD-51), because quoting a price and billing for it are different rights.
 * Resolving it from the row rather than the kind is what keeps a sales user who
 * can see proformas from reading final invoices through a chat bubble.
 */
/**
 * DATA, in a Map — not functions, and not an object literal. Both halves of
 * that are a security property rather than a style preference.
 *
 * `kind` arrives in a URL, so this table is indexed by untrusted input, and the
 * two obvious shapes are both wrong:
 *
 *   An OBJECT LITERAL carries `Object.prototype`, so `MODULE_FOR[kind]` with
 *   `kind = "constructor"` or `"toString"` resolves to a real function.
 *
 *   A Map of FUNCTIONS fixes the lookup but not the call: `MODULE_FOR.get(kind)`
 *   is safely `undefined` for an unknown key, but `resolver(row)` is still
 *   "invoke a value obtained by indexing with user-controlled input", which is
 *   what CodeQL's unvalidated-dynamic-method-call query is actually about — and
 *   it flagged the Map version too.
 *
 * So there is nothing here to invoke. Each entry is a plain record, `moduleFor`
 * branches over it explicitly, and the only dynamic step left is a Map lookup
 * that either finds a record or does not.
 *
 * `proforma` exists because `invoice` holds proformas and final invoices in one
 * table and they are DIFFERENT modules (MOD-50 vs MOD-51) — quoting a price and
 * billing for it are different rights. It is the only row-dependent kind, which
 * is why one optional field beats five closures.
 */
const MODULE_FOR = new Map([
  ["INVOICE", { module: "MOD-51", proforma: "MOD-50" }],
  ["DOSSIER", { module: "MOD-29" }],
  ["CLIENT", { module: "MOD-03" }],
  ["PURCHASE_ORDER", { module: "MOD-60" }],
  ["SUPPLIER_INVOICE", { module: "MOD-61" }],
]);

/** The module a kind answers to, or null when the kind is not one of ours. */
function moduleFor(kind, row) {
  const entry = MODULE_FOR.get(kind);
  if (!entry) return null;
  if (entry.proforma && row && row.type === "PROFORMA") return entry.proforma;
  return entry.module;
}

/** Every module key a search may need, so the controller resolves them in one
 *  pass instead of one round-trip per kind. */
const ALL_MODULES = ["MOD-29", "MOD-03", "MOD-50", "MOD-51", "MOD-60", "MOD-61"];

const KINDS = [...MODULE_FOR.keys()];

/** A card, in the one shape the bubble renders. Money is left as a number and a
 *  currency code: formatting is the client's job, and it is the client that
 *  knows the reader's locale. Dates stay ISO on the wire — the format every
 *  `date` column and every `@shared` validator is built on — and the client
 *  renders them day-first. */
const card = ({ kind, id, ref, title, subtitle, status, amount, currency, date, url }) => ({
  kind, id, ref: ref || null, title: title || null, subtitle: subtitle || null,
  status: status || null,
  amount: amount === null || amount === undefined ? null : Number(amount),
  currency: currency || null,
  date: date || null,
  url: url || null,
  redacted: false,
});

/**
 * One entry per attachable record.
 *
 * `search` is ILIKE on the human reference plus the counterparty name, which is
 * what people actually type. It is not full-text and does not try to be: the
 * picker opens from a chat composer and closes in two seconds, and the thing
 * being looked for was named in the message above it.
 */
/**
 * One entry per attachable record. A Map for the same reason as `MODULE_FOR`
 * above — `REGISTRY[kind].search(...)` with a URL-supplied `kind` is a dynamic
 * method call on a prototype-bearing object.
 */
const REGISTRY = new Map(Object.entries({
  INVOICE: {
    async search(client, term, limit) {
      const { rows } = await client.query(
        `SELECT i.invoice_id AS id, i.doc_number, i.type, i.status, i.total_ttc, i.currency,
                i.created_at, c.name AS client_name
           FROM invoice i
           LEFT JOIN client_master c ON c.client_id = i.client_id
          WHERE i.doc_number ILIKE $1 OR c.name ILIKE $1
          ORDER BY i.created_at DESC
          LIMIT $2`,
        [term, limit],
      );
      return rows.map((r) => ({
        row: r,
        card: card({
          kind: "INVOICE", id: r.id, ref: r.doc_number || "(draft)",
          title: r.doc_number || "Draft invoice",
          subtitle: r.client_name, status: r.status,
          amount: r.total_ttc, currency: r.currency, date: r.created_at,
          url: `/finance/invoices/${r.id}`,
        }),
      }));
    },
    async get(client, id) {
      const { rows } = await client.query(
        `SELECT i.invoice_id AS id, i.doc_number, i.type, i.status, i.total_ttc, i.currency,
                i.created_at, i.payment_due_on, c.name AS client_name
           FROM invoice i
           LEFT JOIN client_master c ON c.client_id = i.client_id
          WHERE i.invoice_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        row: r,
        card: card({
          kind: "INVOICE", id: r.id, ref: r.doc_number || "(draft)",
          title: r.doc_number || "Draft invoice",
          subtitle: r.client_name, status: r.status,
          amount: r.total_ttc, currency: r.currency,
          date: r.payment_due_on || r.created_at,
          url: `/finance/invoices/${r.id}`,
        }),
      };
    },
  },

  DOSSIER: {
    /**
     * `dossier_visible`, not `dossier` — the view that excludes DRAFT (0671).
     *
     * A draft is half-finished wizard state carrying a placeholder ref, not a
     * file. Reading the base table here would put somebody's abandoned Tuesday
     * afternoon into the chat record picker, where a colleague would attach it
     * to a message and send a reference to something that does not exist yet.
     *
     * `get` reads the view too, even though it fetches a known id: nothing can
     * legitimately hold a reference to a draft, because search never offered
     * one. A reference that somehow names a draft resolves to a redacted card,
     * which is the right answer for "this points at something you should not
     * be seeing".
     */
    async search(client, term, limit) {
      const { rows } = await client.query(
        `SELECT d.dossier_id AS id, d.ref, d.status, d.pol, d.pod, d.eta, c.name AS client_name
           FROM dossier_visible d
           LEFT JOIN client_master c ON c.client_id = d.client_id
          WHERE d.ref ILIKE $1 OR d.bl_mawb ILIKE $1 OR c.name ILIKE $1
          ORDER BY d.updated_at DESC
          LIMIT $2`,
        [term, limit],
      );
      return rows.map((r) => ({
        row: r,
        card: card({
          kind: "DOSSIER", id: r.id, ref: r.ref, title: r.ref,
          subtitle: [r.client_name, r.pol && r.pod ? `${r.pol} → ${r.pod}` : null].filter(Boolean).join(" · "),
          status: r.status, amount: null, currency: null, date: r.eta,
          url: `/operations/files/${r.id}`,
        }),
      }));
    },
    async get(client, id) {
      const { rows } = await client.query(
        `SELECT d.dossier_id AS id, d.ref, d.status, d.pol, d.pod, d.eta, c.name AS client_name
           FROM dossier_visible d
           LEFT JOIN client_master c ON c.client_id = d.client_id
          WHERE d.dossier_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        row: r,
        card: card({
          kind: "DOSSIER", id: r.id, ref: r.ref, title: r.ref,
          subtitle: [r.client_name, r.pol && r.pod ? `${r.pol} → ${r.pod}` : null].filter(Boolean).join(" · "),
          status: r.status, amount: null, currency: null, date: r.eta,
          url: `/operations/files/${r.id}`,
        }),
      };
    },
  },

  CLIENT: {
    async search(client, term, limit) {
      const { rows } = await client.query(
        `SELECT client_id AS id, ref, name, is_active, cached_receivables
           FROM client_master
          WHERE name ILIKE $1 OR ref ILIKE $1
          ORDER BY name
          LIMIT $2`,
        [term, limit],
      );
      return rows.map((r) => ({
        row: r,
        card: card({
          kind: "CLIENT", id: r.id, ref: r.ref, title: r.name, subtitle: r.ref,
          status: r.is_active ? "ACTIVE" : "INACTIVE",
          amount: null, currency: null, date: null,
          url: `/master/clients/${r.id}`,
        }),
      }));
    },
    async get(client, id) {
      const { rows } = await client.query(
        `SELECT client_id AS id, ref, name, is_active, cached_receivables
           FROM client_master WHERE client_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        row: r,
        card: card({
          kind: "CLIENT", id: r.id, ref: r.ref, title: r.name, subtitle: r.ref,
          status: r.is_active ? "ACTIVE" : "INACTIVE",
          amount: null, currency: null, date: null,
          url: `/master/clients/${r.id}`,
        }),
      };
    },
  },

  PURCHASE_ORDER: {
    async search(client, term, limit) {
      const { rows } = await client.query(
        `SELECT p.po_id AS id, p.doc_number, p.status, p.total_ttc, p.created_at, s.name AS supplier_name
           FROM purchase_order p
           LEFT JOIN supplier_master s ON s.supplier_id = p.supplier_id
          WHERE p.doc_number ILIKE $1 OR s.name ILIKE $1
          ORDER BY p.created_at DESC
          LIMIT $2`,
        [term, limit],
      );
      return rows.map((r) => ({
        row: r,
        card: card({
          kind: "PURCHASE_ORDER", id: r.id, ref: r.doc_number || "(draft)",
          title: r.doc_number || "Draft purchase order",
          subtitle: r.supplier_name, status: r.status,
          amount: r.total_ttc, currency: null, date: r.created_at,
          url: `/procurement/purchase-orders/${r.id}`,
        }),
      }));
    },
    async get(client, id) {
      const { rows } = await client.query(
        `SELECT p.po_id AS id, p.doc_number, p.status, p.total_ttc, p.created_at, s.name AS supplier_name
           FROM purchase_order p
           LEFT JOIN supplier_master s ON s.supplier_id = p.supplier_id
          WHERE p.po_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        row: r,
        card: card({
          kind: "PURCHASE_ORDER", id: r.id, ref: r.doc_number || "(draft)",
          title: r.doc_number || "Draft purchase order",
          subtitle: r.supplier_name, status: r.status,
          amount: r.total_ttc, currency: null, date: r.created_at,
          url: `/procurement/purchase-orders/${r.id}`,
        }),
      };
    },
  },

  SUPPLIER_INVOICE: {
    async search(client, term, limit) {
      const { rows } = await client.query(
        `SELECT si.supplier_invoice_id AS id, si.doc_number, si.supplier_ref, si.status,
                si.amount_ttc, si.currency, si.due_on, si.created_at, s.name AS supplier_name
           FROM supplier_invoice si
           LEFT JOIN supplier_master s ON s.supplier_id = si.supplier_id
          WHERE si.doc_number ILIKE $1 OR si.supplier_ref ILIKE $1 OR s.name ILIKE $1
          ORDER BY si.created_at DESC
          LIMIT $2`,
        [term, limit],
      );
      return rows.map((r) => ({
        row: r,
        card: card({
          kind: "SUPPLIER_INVOICE", id: r.id, ref: r.doc_number || r.supplier_ref || "(draft)",
          title: r.doc_number || r.supplier_ref || "Supplier invoice",
          subtitle: r.supplier_name, status: r.status,
          amount: r.amount_ttc, currency: r.currency, date: r.due_on || r.created_at,
          url: `/procurement/supplier-invoices/${r.id}`,
        }),
      }));
    },
    async get(client, id) {
      const { rows } = await client.query(
        `SELECT si.supplier_invoice_id AS id, si.doc_number, si.supplier_ref, si.status,
                si.amount_ttc, si.currency, si.due_on, si.created_at, s.name AS supplier_name
           FROM supplier_invoice si
           LEFT JOIN supplier_master s ON s.supplier_id = si.supplier_id
          WHERE si.supplier_invoice_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        row: r,
        card: card({
          kind: "SUPPLIER_INVOICE", id: r.id, ref: r.doc_number || r.supplier_ref || "(draft)",
          title: r.doc_number || r.supplier_ref || "Supplier invoice",
          subtitle: r.supplier_name, status: r.status,
          amount: r.amount_ttc, currency: r.currency, date: r.due_on || r.created_at,
          url: `/procurement/supplier-invoices/${r.id}`,
        }),
      };
    },
  },
}));

/** What the reader is left with when they may not see the record: the reference
 *  the sender saw, and nothing that has a number in it. */
const redactedCard = (kind, id, label) => ({
  kind, id, ref: label || null, title: label || "Restricted record",
  subtitle: null, status: null, amount: null, currency: null, date: null,
  url: null, redacted: true,
});

/**
 * Search every kind the reader is allowed to see.
 *
 * A kind they cannot see is absent, not redacted — a picker is a list of things
 * you may attach, and offering a row that turns into "Restricted record" the
 * moment it is sent would be a worse answer than not offering it.
 */
async function search(client, { term, allow = new Set(), kinds = null, limit = 8 }) {
  const q = String(term || "").trim();
  if (q.length < 2) throw new AppError("BAD_SEARCH", "Type at least two characters", 422);
  const wanted = Array.isArray(kinds) && kinds.length ? kinds.filter((k) => KINDS.includes(k)) : KINDS;
  const pattern = `%${q}%`;
  const per = Math.min(Math.max(Number(limit) || 8, 1), 25);

  const results = [];
  for (const kind of wanted) {
    const entry = REGISTRY.get(kind);
    // `wanted` is already filtered to KINDS, so this cannot miss — but reading
    // it from the Map and checking is what makes that true by construction
    // rather than by the caller remembering.
    if (!entry) continue;
    // A kind whose permission depends on the ROW (invoice) cannot be excluded
    // up front, so it is filtered after the query instead.
    const constant = moduleFor(kind, null);
    const rowDependent = kind === "INVOICE";
    if (!rowDependent && !allow.has(constant)) continue;
     
    const found = await entry.search(client, pattern, per);
    for (const f of found) {
      if (!allow.has(moduleFor(kind, f.row))) continue;
      results.push(f.card);
    }
  }
  return results;
}

/**
 * Resolve one stored reference for one reader.
 *
 * A record that has been DELETED since it was attached resolves to a redacted
 * card too, rather than a 404 that would blank the bubble: the message still
 * happened, and "this referred to INV-2026-0041, which no longer exists" is the
 * true thing to show.
 */
async function resolve(client, { kind, id, label = null, allow = new Set() }) {
  const entry = REGISTRY.get(kind);
  if (!entry) return redactedCard(kind, id, label);
  const found = await entry.get(client, id);
  if (!found) return redactedCard(kind, id, label);
  if (!allow.has(moduleFor(kind, found.row))) return redactedCard(kind, id, label);
  return found.card;
}

/** Resolve many at once — one thread render carries as many cards as it has
 *  bubbles, and each would otherwise be its own round-trip from the client. */
async function resolveMany(client, refs, allow) {
  const out = [];
  for (const r of refs) {
     
    out.push(await resolve(client, { kind: r.erp_kind, id: r.erp_id, label: r.erp_label, allow }));
  }
  return out;
}

module.exports = { search, resolve, resolveMany, KINDS, ALL_MODULES, moduleFor };
