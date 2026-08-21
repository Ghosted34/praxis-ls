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
const { computeMargin, priceForMargin, lineEconomics, classifyLine } = require("./margin_simulation.rules");
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
  const unclassified = [];
  const lines = (await repo.costingLinesForLink(client, costingId)).map((l) => {
    // §2.1: the catalogue classifies, not the copied boolean. The costing's tax
    // code is the pricer's starting intent; classifyLine overrides it to false
    // on a disbursement, because the DB will refuse that combination anyway.
    // Guard on dict_direction, NOT on dictionary_item_id: the join is a LEFT
    // one and the item may be gone (recycled — 0641). A missing row would
    // otherwise present as a catalogue answer of "no direction", which reads as
    // "not a disbursement" and would silently declassify a débours. direction
    // is NOT NULL in the catalogue (0630:77), so its presence proves a row.
    const dict = l.dict_direction
      ? { direction: l.dict_direction, category: l.dict_category, is_disbursement: l.dict_is_disbursement }
      : null;
    const nature = classifyLine(
      { is_disbursement: l.is_disbursement === true, vat_applicable: !!l.tax_code_id },
      dict,
    );
    if (nature.source === "line") unclassified.push(l.label);
    return {
      dictionary_item_id: l.dictionary_item_id,
      label: l.label,
      qty: Number(l.qty) || 1,
      unit_cost: Math.round((Number(l.unit_cost) || 0) * toXaf * 100) / 100,
      unit_price: 0,
      is_disbursement: nature.is_disbursement,
      vat_applicable: nature.vat_applicable,
      cost_nature: nature.nature,
      nature_source: nature.source,
      notes: null,
    };
  });
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
    // The screen should say so rather than imply the classification is known:
    // these lines have no catalogue entry, so their nature is only a copied flag.
    unclassified,
  };
}

/**
 * §2.1 — re-classify incoming lines against the catalogue before anything is
 * stored or computed. A payload may assert `is_disbursement` / `vat_applicable`
 * freely; where the line names a dictionary item, the catalogue wins. This is
 * the one place both `create` and `update` funnel through, so the two can never
 * disagree about what a line is.
 */
async function classifyLines(client, lines = []) {
  const natures = await repo.dictionaryNatures(client, lines.map((l) => l.dictionary_item_id));
  return lines.map((ln) => {
    // `|| null` matters: an id with no catalogue row falls back to the line's
    // own flags rather than being read as an empty classification.
    const n = classifyLine(ln, (ln.dictionary_item_id && natures[ln.dictionary_item_id]) || null);
    return { ...ln, is_disbursement: n.is_disbursement, vat_applicable: n.vat_applicable };
  });
}

/** Write the line set for a simulation. Shared by create and update so the two
 *  cannot drift in what they persist. */
async function writeLines(client, simId, lines) {
  for (const ln of lines) {
    await repo.insertLine(client, {
      margin_simulation_id: simId, dictionary_item_id: ln.dictionary_item_id || null,
      label: ln.label || "Line", qty: ln.qty || 1, unit_cost: ln.unit_cost || 0, unit_price: ln.unit_price || 0,
      is_disbursement: ln.is_disbursement === true,
      vat_applicable: ln.vat_applicable === true, notes: ln.notes || null,
    });
  }
}

async function create(client, { dossierId = null, serviceTypeId = null, costingId = null, currency = "XAF", lines = [], actor = {} }) {
  const ccy = await assertCurrency(client, currency);
  const priced = await classifyLines(client, lines);
  const totals = computeMargin(priced, { vatRatePercent: await vatRate(client) });
  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, {
      dossier_id: dossierId, service_type_id: serviceTypeId, costing_id: costingId,
      created_by: await resolveActorId(client, actor.user_id),
      margin_percent: totals.margin_percent, total_cost: totals.total_cost, total_price: totals.total_price,
      currency: ccy,
    });
    await writeLines(client, sim.margin_simulation_id, priced);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(sim.margin_simulation_id), after: { totals } });
    await client.query("COMMIT");
    return { ...(await get(client, sim.margin_simulation_id)), totals };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * EDIT A DRAFT (§2.4a) — the gap that made this screen unusable.
 *
 * There was no update path at all: a simulation was frozen the moment it was
 * created, in every status. A pricer who mistyped a price, forgot a line or
 * imported a mis-flagged charge had exactly two moves — submit it wrong, or
 * abandon it and build the whole thing again. REJECTED was therefore terminal
 * in practice, which defeats the point of having the state.
 *
 * EDITABLE mirrors the legacy screen exactly: `isEditableStatus()` is DRAFT or
 * REJECTED (costing-module.php:1665), and the simulator's `isLocked` is
 * explicitly false for a revision (margin-simulator-billing.php:1765).
 *
 * Editing a REJECTED simulation returns it to DRAFT and clears the rejection.
 * A rejection is an instruction to change something; once the author has, the
 * old verdict describes a document that no longer exists, and leaving it in
 * REJECTED would leave `submit` (DRAFT-only) unreachable — the same dead end in
 * a new place. The reason is preserved in the audit trail, not on the row.
 */
const EDITABLE = new Set(["DRAFT", "REJECTED"]);

async function update(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.getSim(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Simulation not found", 404);
  if (!EDITABLE.has(before.status)) {
    throw new AppError("LOCKED", `Only a DRAFT or REJECTED simulation can be edited (this one is ${before.status})`, 422);
  }
  const rate = await vatRate(client);
  await client.query("BEGIN");
  try {
    const fields = {};
    if (patch.currency !== undefined) fields.currency = await assertCurrency(client, patch.currency);
    for (const k of ["dossier_id", "service_type_id", "costing_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    // Editing answers the rejection: back to DRAFT, verdict cleared.
    if (before.status === "REJECTED") {
      Object.assign(fields, { status: "DRAFT", rejected_by: null, rejected_at: null, reject_reason: null });
    }
    let totals = null;
    if (Array.isArray(lines)) {
      const priced = await classifyLines(client, lines);
      totals = computeMargin(priced, { vatRatePercent: rate });
      await repo.deleteLines(client, id);
      await writeLines(client, id, priced);
      // The header's cached totals are part of the row; a line edit that left
      // them stale would make the registry disagree with the document.
      Object.assign(fields, {
        margin_percent: totals.margin_percent, total_cost: totals.total_cost, total_price: totals.total_price,
      });
      // Re-pricing invalidates a justification given for the old numbers (§2.5).
      fields.low_margin_justification = null;
    }
    await repo.updateSim(client, id, fields);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id),
      before: { status: before.status, total_price: before.total_price, margin_percent: before.margin_percent },
      after: { status: fields.status || before.status, totals },
    });
    await client.query("COMMIT");
    return get(client, id);
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

/**
 * DRAFT → SUBMITTED.
 *
 * A zero or negative margin needs a written reason (§2.5). The legacy screen
 * did this — `promptRiskJustification()` / `saveJustification()`
 * (margin-simulator-billing.php:2268,2273) — and it is the one thing standing
 * between "we priced this deliberately thin" and "nobody noticed the price
 * column was still zero". SBX-2026-0001 is the second case: 95.7M of cost, no
 * price, and nothing in the flow that would have asked.
 *
 * The justification is persisted on the row (not just prompted client-side, as
 * legacy did) so the approver sees the reason with the document, and it is
 * cleared whenever the lines are re-priced — a reason given for other numbers
 * is not a reason for these.
 */
async function submit(client, { id, justification = null, actor = {} }) {
  const sim = await mustBe(client, id, "DRAFT", "submit");
  const lines = await repo.listLines(client, id);
  if (!lines.length) throw new AppError("NO_LINES", "A simulation with no lines cannot be submitted", 422);
  const totals = computeMargin(lines, { vatRatePercent: await vatRate(client) });
  const reason = String(justification || sim.low_margin_justification || "").trim();
  if (totals.margin_amount <= 0 && reason.length < 10) {
    throw new AppError(
      "LOW_MARGIN_JUSTIFICATION_REQUIRED",
      `This simulation earns ${totals.margin_amount} ${sim.currency} on a service cost of ${totals.service_cost} (${totals.margin_percent}%). Submitting at or below cost needs a written justification of at least 10 characters.`,
      422,
      { margin_amount: totals.margin_amount, margin_percent: totals.margin_percent, service_cost: totals.service_cost },
    );
  }
  const out = await repo.setStatus(client, id, {
    sql: "status = 'SUBMITTED', submitted_by = $2, submitted_at = now(), low_margin_justification = $3",
    params: [await resolveActorId(client, actor.user_id), reason || null],
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
        // Belt and braces on the §2.1 invariant: rows written BEFORE
        // classification landed can still hold disbursement + VAT together,
        // and that pair is refused outright by chk_disbursement_no_tax
        // (0230:92). Drop the tax code rather than emit a quotation line that
        // cannot become an invoice.
        tax_code_id: l.vat_applicable === true && l.is_disbursement !== true ? vatCode : null,
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

module.exports = { preview, fromCosting, create, update, get, list, submit, approve, reject, quote, priceForMargin };
