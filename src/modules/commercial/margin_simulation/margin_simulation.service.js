/**
 * Margin simulator (MOD-27, KB §6.7) — rapid quote maths, NO GL.
 *
 * §3.1: this is now a controlled document, matching the legacy screen:
 * DRAFT → SUBMITTED → APPROVED | REJECTED, LINK COSTING (import the costing's
 * lines — the pricer's real workflow is cost the file, then price it), a
 * per-line VAT toggle + notes, and `quote` — an APPROVED simulation becomes a
 * DRAFT quotation, with the link recorded both ways.
 *
 * `preview` computes without persisting; `create` snapshots the computed
 * totals and lines. Margin is on services only; débours are pass-through
 * (rules file). All SQL is in the repo.
 */
"use strict";

const repo = require("./margin_simulation.repo");
const events = require("./margin_simulation.events");
const { computeMargin, priceForMargin, lineEconomics } = require("./margin_simulation.rules");
const quotationService = require("../quotation/quotation.service");
const { getRule, getSetting } = require("../../../shared/config/settings");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "margin_simulation:" + id;

/** Tenant VAT rate — same source as quotation totals (settings finance.vat). */
const vatRate = (client) => getRule(client, "finance", "vat", "rate_percent", 19.25);
/** Same thresholds as the pricing-variance flag: one notion of "good margin". */
const thresholdsOf = async (client) =>
  (await getSetting(client, "commercial", "pricing_variance", null)) || {};

/** Pure compute with the tenant VAT rate — no write. */
async function preview(client, { lines = [] }) {
  return computeMargin(lines, { vatRatePercent: await vatRate(client) });
}

/**
 * The margin_simulation.currency column is char(3) REFERENCES currency(code)
 * (0345). A free-text code that does not exist used to surface as a raw 23503
 * FK violation; validate it against the catalogue first so the pricer gets a
 * 422 naming the bad code instead (SS4). XAF is the schema default and is
 * always accepted; anything else must exist in the tenant's currency table.
 */
async function assertCurrency(client, code) {
  const want = String(code || "XAF").toUpperCase().trim();
  if (want === "XAF") return want;
  const { rows } = await client.query("SELECT 1 FROM currency WHERE code = $1", [want]);
  if (!rows.length) {
    throw new AppError("UNKNOWN_CURRENCY", `Currency "${want}" is not in the currency catalogue — add it in Master Data → Currencies first`, 422);
  }
  return want;
}

/**
 * LINK COSTING (§3.1) — the point of the screen. Legacy
 * api/marginpricing/link-costing.php:132 selects the costing's lines and
 * copies them in, converting when the costing currency is not XAF (:148).
 * Ours converts with the rate THE COSTING ITSELF was priced at
 * (costing.exchange_rate_to_xaf) — not a hardcoded 615 — so the imported cost
 * base is the one the approver saw. unit_price starts at 0: pricing is the
 * pricer's job, not the import's.
 */
async function fromCosting(client, { costingId }) {
  const costing = await repo.costingForLink(client, costingId);
  if (!costing) throw new AppError("NOT_FOUND", "Costing not found", 404);
  const toXaf = costing.currency !== "XAF" ? Number(costing.exchange_rate_to_xaf) || 1 : 1;
  const lines = (await repo.costingLinesForLink(client, costingId)).map((l) => ({
    dictionary_item_id: l.dictionary_item_id,
    label: l.label,
    qty: Number(l.qty) || 1,
    unit_cost: Math.round((Number(l.unit_cost) || 0) * toXaf * 100) / 100,
    unit_price: 0,
    is_disbursement: l.is_disbursement === true,
    // The costing's tax code becomes the simulator's simple toggle.
    vat_applicable: !!l.tax_code_id,
    notes: null,
  }));
  return {
    costing: {
      costing_id: costing.costing_id,
      doc_number: costing.doc_number,
      dossier_id: costing.dossier_id,
      currency: costing.currency,
      status: costing.status,
      converted_to_xaf: toXaf !== 1,
    },
    lines,
  };
}

async function create(client, { dossierId = null, serviceTypeId = null, costingId = null, currency = "XAF", lines = [], actor = {} }) {
  const ccy = await assertCurrency(client, currency);
  const totals = computeMargin(lines, { vatRatePercent: await vatRate(client) });
  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, {
      dossier_id: dossierId, service_type_id: serviceTypeId, costing_id: costingId,
      created_by: await resolveActorId(client, actor.user_id),
      margin_percent: totals.margin_percent, total_cost: totals.total_cost, total_price: totals.total_price,
      currency: ccy,
    });
    for (const ln of lines) {
       
      await repo.insertLine(client, {
        margin_simulation_id: sim.margin_simulation_id, dictionary_item_id: ln.dictionary_item_id || null,
        label: ln.label || "Line", qty: ln.qty || 1, unit_cost: ln.unit_cost || 0, unit_price: ln.unit_price || 0,
        is_disbursement: ln.is_disbursement === true,
        vat_applicable: ln.vat_applicable === true, notes: ln.notes || null,
      });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(sim.margin_simulation_id), after: { totals } });
    await client.query("COMMIT");
    return { ...(await get(client, sim.margin_simulation_id)), totals };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const sim = await repo.getSim(client, id);
  if (!sim) return null;
  const [lines, thresholds, rate] = await Promise.all([
    repo.listLines(client, id),
    thresholdsOf(client),
    vatRate(client),
  ]);
  // Per-line MARGIN + KPI (§3.1): how a pricer finds which line kills the
  // deal. Derived on read, never stored.
  sim.lines = lines.map((l) => ({ ...l, economics: lineEconomics(l, thresholds) }));
  sim.totals = lines.length ? computeMargin(lines, { vatRatePercent: rate }) : null;
  return sim;
}

const list = (client, q) => repo.listSims(client, q);

/** DRAFT → SUBMITTED. */
async function submit(client, { id, actor = {} }) {
  const sim = await mustBe(client, id, "DRAFT", "submit");
  const out = await repo.setStatus(client, id, {
    sql: "status = 'SUBMITTED', submitted_by = $2, submitted_at = now()",
    params: [await resolveActorId(client, actor.user_id)],
  });
  await emitEvent(client, { eventTypeKey: events.SUBMITTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.SUBMITTED, moduleKey: events.MODULE, entityRef: ref(id), before: { status: sim.status }, after: { status: out.status } });
  return out;
}

/** SUBMITTED → APPROVED. Maker-checker: the submitter never approves their own. */
async function approve(client, { id, actor = {} }) {
  const sim = await mustBe(client, id, "SUBMITTED", "approve");
  if (sim.submitted_by && actor.user_id && sim.submitted_by === actor.user_id) {
    throw new AppError("SELF_APPROVE", "The person who submitted cannot approve — maker-checker", 422);
  }
  const out = await repo.setStatus(client, id, {
    sql: "status = 'APPROVED', approved_by = $2, approved_at = now()",
    params: [await resolveActorId(client, actor.user_id)],
  });
  await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), before: { status: sim.status }, after: { status: out.status } });
  return out;
}

/** SUBMITTED → REJECTED, reason required. */
async function reject(client, { id, reason, actor = {} }) {
  if (!reason || !String(reason).trim()) throw new AppError("REASON_REQUIRED", "A rejection needs a reason", 422);
  const sim = await mustBe(client, id, "SUBMITTED", "reject");
  const out = await repo.setStatus(client, id, {
    sql: "status = 'REJECTED', rejected_by = $2, rejected_at = now(), reject_reason = $3",
    params: [await resolveActorId(client, actor.user_id), String(reason).trim().slice(0, 2000)],
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.REJECTED, moduleKey: events.MODULE, entityRef: ref(id), before: { status: sim.status }, after: { status: out.status, reason: out.reject_reason } });
  return out;
}

/**
 * APPROVED → a DRAFT quotation (legacy 'quote' action). The simulation's
 * priced lines become quotation lines; a line with the VAT toggle gets the
 * tenant's current VAT code (quotation totals only tax lines that name one).
 * The link is recorded on the simulation so the trail costing → simulation →
 * quotation reads in both directions.
 */
async function quote(client, { id, actor = {} }) {
  const sim = await get(client, id);
  if (!sim) throw new AppError("NOT_FOUND", "Simulation not found", 404);
  if (sim.status !== "APPROVED") throw new AppError("BAD_STATE", `Only an APPROVED simulation can be quoted (this one is ${sim.status})`, 422);
  if (sim.quotation_id) throw new AppError("ALREADY_QUOTED", "This simulation already produced a quotation", 409);
  const vatCode = await repo.defaultVatCode(client);
  const quotation = await quotationService.createDraft(client, {
    data: {
      dossier_id: sim.dossier_id,
      costing_id: sim.costing_id,
      currency: sim.currency,
      margin_percent: sim.totals ? sim.totals.margin_percent : null,
      lines: (sim.lines || []).map((l) => ({
        dictionary_item_id: l.dictionary_item_id,
        label: l.label,
        qty: Number(l.qty) || 1,
        unit_price: Number(l.unit_price) || 0,
        is_disbursement: l.is_disbursement === true,
        tax_code_id: l.vat_applicable === true ? vatCode : null,
      })),
    },
    actor,
  });
  const out = await repo.setStatus(client, id, {
    sql: "quotation_id = $2",
    params: [quotation.quotation_id],
  });
  await emitEvent(client, { eventTypeKey: events.QUOTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.QUOTED, moduleKey: events.MODULE, entityRef: ref(id), after: { quotation_id: quotation.quotation_id } });
  return { simulation: out, quotation };
}

async function mustBe(client, id, wanted, verb) {
  const sim = await repo.getSim(client, id);
  if (!sim) throw new AppError("NOT_FOUND", "Simulation not found", 404);
  if (sim.status !== wanted) throw new AppError("BAD_STATE", `Cannot ${verb} a ${sim.status} simulation`, 422);
  return sim;
}

module.exports = { preview, fromCosting, create, get, list, submit, approve, reject, quote, priceForMargin };
