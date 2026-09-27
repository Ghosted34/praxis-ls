/**
 * "Suggest" — the standard charge set for an operations file, priced.
 *
 * THE GAP THIS CLOSES. The legacy sheet had a Suggest button
 * (costing-module.php:1896-1975): it mapped the file's service type to a string
 * and loaded every dictionary line whose `service_applicability` contained it.
 * Ours had no equivalent, so every worksheet opened blank — a lot of typing and
 * a lot of forgotten charges.
 *
 * We can do considerably better than legacy could, because the foundation is
 * already in the database and has never been reachable from a route:
 *
 *   · `service_type_dictionary_item` (0630) maps each charge to a service type
 *     AND a tier — BASIC ⊆ ADVANCED ⊆ FULL, nested. 165 items are seeded across
 *     15 service types (9080). Legacy had one flat applicability string.
 *   · `dictionary_item` knows each charge's nature: pass-through or own
 *     service, billable, its unit of measure, whether it varies by equipment.
 *     Legacy asked the user to tick a VAT box that defaulted to ticked, which is
 *     why the supplied sample sheet charges 19.25% VAT on customs duty.
 *   · `expense_rate` (0634) prices per carrier and per container type, with an
 *     effective-date window. Legacy had no rates at all — every line was typed.
 *   · `dossier_container_line` (0660) says what equipment is on the file. Legacy
 *     duplicated the CATALOGUE per box size instead (`Container Maintenance 20'`
 *     and `40'` as two codes), which is why its sample sheet has 18 lines where
 *     ours has 14.
 *
 * NOTHING HERE WRITES. The builder returns a proposal; a person ticks what they
 * want and the ordinary create/update path stores it. That is deliberate — a
 * suggestion that saved itself would be a costing nobody chose.
 */
"use strict";

const repo = require("./costing.repo");
const { pickRate } = require("../../master/expense_rate/expense_rate.rules");
const currencySvc = require("../../master/currency/currency.service");
const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);

/** Nested, so ADVANCED yields BASIC + ADVANCED. Mirrors 0630's CASE exactly. */
const TIERS = ["BASIC", "ADVANCED", "FULL"];

/**
 * How many of a thing a charge is for, when the charge does NOT vary by
 * equipment.
 *
 * Read from the item's own `unit_of_measure` (the seeded UNIT vocabulary,
 * 0630), because that is where the catalogue records what it is priced by.
 * `null` means "we genuinely cannot know" and is left blank for a person to
 * fill: a storage charge is per DAY and nothing on the file says how many days
 * the box will sit. A guess there would be worse than a blank, because a
 * plausible wrong number gets approved.
 */
function qtyFromUnit(unitOfMeasure, file) {
  switch (String(unitOfMeasure || "").toUpperCase()) {
    case "KG":
      return num(file.gross_weight) > 0 ? num(file.gross_weight) : null;
    case "TON":
      return num(file.gross_weight) > 0 ? round2(num(file.gross_weight) / 1000) : null;
    case "CBM":
      return num(file.volume_cbm) > 0 ? num(file.volume_cbm) : null;
    // One bill of lading, one file — the charge applies once.
    case "BL":
    case "DOSSIER":
      return 1;
    // A day count is a fact about the future. Nothing on the file knows it.
    case "DAY":
      return null;
    case "UNIT":
      return num(file.package_count) > 0 ? num(file.package_count) : 1;
    default:
      return 1;
  }
}

/** Why a quantity is what it is, so an approver can see it was derived. */
function qtyBasis(unitOfMeasure, qty) {
  if (qty === null) return "TYPED";
  switch (String(unitOfMeasure || "").toUpperCase()) {
    case "KG":
    case "TON":
      return "GROSS_WEIGHT";
    case "CBM":
      return "VOLUME";
    case "UNIT":
      return "PACKAGES";
    default:
      return "DEFAULT";
  }
}

/**
 * Price one line, and say where the price came from.
 *
 * The cascade, in order (Q3):
 *   1. an `expense_rate` for this carrier and this container type, then the
 *      carrier's general rate, then the item's default rate — `pickRate` scores
 *      and orders that, and it is the same function the rate editor uses;
 *   2. the item's standard rate as read with the item (`default_price`, which
 *      since 14120 IS the no-carrier expense rate, so step 1 normally already
 *      found it — this only matters for a caller that passes no rate rows);
 *   3. nothing, badged so the gap is visible before the sheet is submitted.
 *
 * `pickRate` throws NO_RATE / NO_RATE_MATCH when nothing is effective or
 * nothing matches the scope. Both are ordinary outcomes here, not failures —
 * see the comment on that function. Caught narrowly so a real error still
 * surfaces.
 */
function priceLine(item, rateRows, { date, rateProviderId, containerTypeRefId }) {
  if (rateRows && rateRows.length) {
    try {
      const hit = pickRate(rateRows, { date, rateProviderId, containerTypeRefId });
      return {
        unit_cost: num(hit.rate),
        currency: hit.currency || null,
        price_source: "EXPENSE_RATE",
        price_note: hit.note || null,
        expense_rate_id: hit.expense_rate_id,
        effective_from: hit.effective_from,
        // A rate scoped to no carrier is the item's fallback, not this
        // carrier's price. Saying so stops "MSC rate card" appearing beside a
        // number MSC never quoted.
        rate_scope: hit.rate_provider_id
          ? (hit.container_type_ref_id ? "CARRIER_AND_TYPE" : "CARRIER")
          : (hit.container_type_ref_id ? "TYPE" : "DEFAULT"),
      };
    } catch (err) {
      // @silent:expected — NO_RATE / NO_RATE_MATCH mean "nothing on file for
      // this scope", which is the normal case for most charges on most files
      // and falls through to the catalogue default below. Anything else is a
      // real fault and must not be swallowed.
      if (err.code !== "NO_RATE" && err.code !== "NO_RATE_MATCH") throw err;
    }
  }
  if (item.default_price !== null && item.default_price !== undefined) {
    return {
      unit_cost: num(item.default_price),
      currency: item.default_price_currency || item.currency || null,
      price_source: "CATALOGUE_DEFAULT",
      price_note: null,
      expense_rate_id: null,
      effective_from: null,
      rate_scope: null,
    };
  }
  return {
    unit_cost: null,
    currency: null,
    price_source: "NONE",
    price_note: null,
    expense_rate_id: null,
    effective_from: null,
    rate_scope: null,
  };
}

/**
 * Put a priced line into the SHEET's currency (meeting 5, 01:12:33).
 *
 * A costing has ONE currency and ONE exchange rate — `exchange_rate_to_xaf`,
 * "1 <currency> = rate XAF" — and every line is in that currency. A rate on
 * file may be in anything: XAF mostly, sometimes the carrier's EUR or USD. So:
 *
 *   rate in the sheet's currency   → as is
 *   rate in XAF                    → divided by the sheet's rate
 *   rate in a third currency       → to XAF at the Currencies module's rate for
 *                                    the day, then divided by the sheet's rate
 *
 * The sheet's own rate is the one used for the last step, never a fresh quote,
 * because it is the rate the pricer can see and edit and the approver signs.
 * A third currency with no quote on file is NOT guessed: the line comes back
 * unpriced (`NO_FX`) with the original figure, so a person decides.
 *
 * `unit_cost_xaf` is the line's value in XAF before rounding into the sheet's
 * currency. The worksheet keeps it so that switching the sheet's currency or
 * rate converts from the same XAF figure every time instead of compounding
 * rounding — XAF → EUR → XAF lands back on the number it started from.
 *
 * No `sheet.currency` → no conversion at all (the pre-conversion contract, for
 * a caller that does not pass one).
 */
async function toSheetCurrency(client, priced, sheet, cache) {
  if (!sheet || !sheet.currency || priced.unit_cost === null) return priced;
  const to = String(sheet.currency).toUpperCase();
  const sheetRate = Number(sheet.rate) > 0 ? Number(sheet.rate) : 1;
  const from = String(priced.currency || "XAF").toUpperCase();
  const unit = num(priced.unit_cost);
  if (from === to) {
    return { ...priced, currency: to, source_unit_cost: null, source_currency: null, unit_cost_xaf: to === "XAF" ? unit : unit * sheetRate };
  }
  let perXaf = 1; // XAF value of one unit of `from`
  if (from !== "XAF") {
    if (!cache.has(from)) {
      try {
        const hit = await currencySvc.rateFor(client, { base: from, quote: "XAF", date: sheet.date });
        cache.set(from, Number(hit.rate) > 0 ? Number(hit.rate) : null);
      } catch (err) {
        // @silent:expected — no quote for this currency on or before the day is
        // an ordinary state (a currency never synced); the line is returned
        // unpriced with its original figure instead of a guessed conversion.
        if (err.code !== "NO_FX_RATE") throw err;
        cache.set(from, null);
      }
    }
    perXaf = cache.get(from);
    if (!perXaf) {
      return {
        ...priced,
        unit_cost: null,
        currency: to,
        price_source: "NO_FX",
        price_note: `No ${from} → XAF exchange rate on file to convert this rate`,
        source_unit_cost: unit,
        source_currency: from,
        unit_cost_xaf: null,
      };
    }
  }
  const xaf = unit * perXaf;
  return {
    ...priced,
    unit_cost: round2(xaf / sheetRate),
    currency: to,
    source_unit_cost: unit,
    source_currency: from,
    unit_cost_xaf: xaf,
  };
}

/** The display name for a container type, matching the equipment picker's. */
const typeLabel = (row) => row.container_type_en || row.container_type_fr || row.container_type_code;

/**
 * Build the proposal.
 *
 * @returns { file, tier, bands: [{ tier, lines }], counts, defaults }
 */
async function build(client, { dossierId, tier = "FULL", onDate = null, sheet = null }) {
  const wanted = TIERS.includes(String(tier).toUpperCase()) ? String(tier).toUpperCase() : "FULL";
  const date = onDate || new Date().toISOString().slice(0, 10);

  const file = await repo.dossierForCosting(client, dossierId);
  if (!file) throw new AppError("NOT_FOUND", "Operations file not found", 404);
  if (!file.service_type_id) {
    // Not a 500: a file can legitimately exist before its service is chosen,
    // and the answer the caller needs is which field to go and fill.
    throw new AppError(
      "NO_SERVICE_TYPE",
      "This operations file has no service type yet, so there is no standard charge set to suggest. Set the service type on the file first.",
      422,
    );
  }

  const [items, containers] = await Promise.all([
    repo.tieredItems(client, { serviceTypeId: file.service_type_id, tier: wanted }),
    repo.containerTypesOnFile(client, dossierId),
  ]);

  const rateRows = await repo.ratesForItems(client, items.map((i) => i.dictionary_item_id));

  // The VAT a service line should default to on this entity, at this date (Q24).
  // Null is a real answer — a FRANCHISE-regime entity charges none — and is
  // carried through rather than replaced with a guess.
  const vat = await repo.defaultSalesTaxCode(client, { entityId: file.entity_id, onDate: date });

  const bands = new Map(TIERS.map((t) => [t, []]));
  // Into the sheet's currency when the caller names one — see toSheetCurrency.
  const fx = new Map();
  const inSheet = (priced) => toSheetCurrency(client, priced, sheet && { ...sheet, date }, fx);

  for (const item of items) {
    const rows = rateRows.get(item.dictionary_item_id) || [];
    const isDisbursement = item.is_disbursement === true;
    // Pass-through is never taxed — the DB refuses a disbursement line with a
    // tax code (chk_disbursement_no_tax, 0230:92) — so the default must not
    // offer one. Its upstream VAT is disclosed separately, not charged.
    const taxCodeId = isDisbursement ? null : (vat ? vat.tax_code_id : null);

    const common = {
      dictionary_item_id: item.dictionary_item_id,
      item_code: item.code,
      label: item.label_en || item.label_fr,
      // Both names, so the sheet shows the one its reader reads (lib/dict-label).
      label_en: item.label_en || null,
      label_fr: item.label_fr,
      subcategory: item.subcategory || null,
      unit_of_measure: item.unit_of_measure || null,
      is_disbursement: isDisbursement,
      is_billable: item.is_billable !== false,
      disbursement_vat_transparent: isDisbursement && item.disbursement_vat_transparent !== false,
      tax_code_id: taxCodeId,
      tax_code: taxCodeId ? vat.code : null,
      tax_rate_percent: taxCodeId ? num(vat.rate_percent) : null,
      tier: item.tier,
      sort_order: item.sort_order,
    };

    // ── The equipment expansion ───────────────────────────────────────────
    // One catalogue line becomes one costing line PER CONTAINER TYPE on the
    // file, each priced for its own box. This is the whole reason 0632 moved
    // equipment off the catalogue and onto the rate: legacy needed
    // `Demurrage 20'` and `Demurrage 40'` as two codes, and ours needs one.
    if (item.varies_by_equipment && containers.length) {
      for (const box of containers) {
        const priced = await inSheet(priceLine(item, rows, {
          date,
          rateProviderId: file.rate_provider_id || null,
          containerTypeRefId: box.container_type_ref_id,
        }));
        bands.get(item.tier).push({
          ...common,
          container_type_ref_id: box.container_type_ref_id,
          container_type_code: box.container_type_code,
          container_type_label: typeLabel(box),
          qty: box.qty,
          qty_basis: "CONTAINERS",
          ...priced,
        });
      }
      continue;
    }

    // An equipment-varying charge on a file with no equipment recorded yet:
    // one line, no box, and a note rather than silently dropping the charge.
    const qty = qtyFromUnit(item.unit_of_measure, file);
    const priced = await inSheet(priceLine(item, rows, {
      date,
      rateProviderId: file.rate_provider_id || null,
      containerTypeRefId: null,
    }));
    bands.get(item.tier).push({
      ...common,
      container_type_ref_id: null,
      container_type_code: null,
      container_type_label: null,
      qty,
      qty_basis: item.varies_by_equipment ? "TYPED" : qtyBasis(item.unit_of_measure, qty),
      needs_equipment: item.varies_by_equipment === true,
      ...priced,
    });
  }

  const all = TIERS.flatMap((t) => bands.get(t));
  return {
    file: {
      dossier_id: file.dossier_id,
      ref: file.ref,
      client_name: file.client_name,
      service_type_id: file.service_type_id,
      service_type_key: file.service_type_key,
      service_name_en: file.service_name_en,
      service_name_fr: file.service_name_fr,
      rate_provider_id: file.rate_provider_id,
      rate_provider_name: file.rate_provider_name,
      containers: containers.map((b) => ({
        container_type_ref_id: b.container_type_ref_id,
        code: b.container_type_code,
        label: typeLabel(b),
        qty: b.qty,
      })),
    },
    tier: wanted,
    // Banded, not flat: the tiers nest, so a flat list would show the same
    // charge under three headings. One list, three bands, is the honest render.
    bands: TIERS.filter((t) => bands.get(t).length).map((t) => ({
      tier: t,
      lines: bands.get(t),
    })),
    counts: {
      total: all.length,
      priced: all.filter((l) => l.unit_cost !== null).length,
      needs_price: all.filter((l) => l.unit_cost === null).length,
      needs_quantity: all.filter((l) => l.qty === null).length,
      disbursements: all.filter((l) => l.is_disbursement).length,
    },
    defaults: {
      // Surfaced so the worksheet can say WHY no VAT is being offered, rather
      // than looking broken on a franchise-regime entity.
      tax_code_id: vat ? vat.tax_code_id : null,
      tax_code: vat ? vat.code : null,
      tax_rate_percent: vat ? num(vat.rate_percent) : null,
      vat_regime: vat ? vat.regime : null,
      priced_on: date,
    },
  };
}

/**
 * Price ONE line a person picked by hand from the finder.
 *
 * "Suggest" priced its own lines and nothing else, so a charge added with
 * "+ Add a line" arrived at 0 even when the Expense Rates screen had a price
 * for it (meeting 5, 01:01:49 — "it doesn't give the cost"). This is the same
 * `priceLine` cascade over the same rate rows, scoped by the file's carrier
 * when there is a file, so a hand-picked line and a suggested one can never be
 * priced differently.
 *
 * `dossierId` is optional: a sheet can be drafted before it is attached to a
 * file, and then only the item's own (no-carrier) rates apply.
 */
async function priceOne(client, { dossierId = null, dictionaryItemId, containerTypeRefId = null, onDate = null, sheet = null }) {
  const date = onDate || new Date().toISOString().slice(0, 10);
  const { rows } = await client.query(
    "SELECT dictionary_item_id, currency FROM dictionary_item WHERE dictionary_item_id = $1",
    [dictionaryItemId],
  );
  const item = rows[0];
  if (!item) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
  let rateProviderId = null;
  if (dossierId) {
    const file = await repo.dossierForCosting(client, dossierId);
    if (!file) throw new AppError("NOT_FOUND", "Operations file not found", 404);
    rateProviderId = file.rate_provider_id || null;
  }
  const rates = await repo.ratesForItems(client, [dictionaryItemId]);
  const priced = await toSheetCurrency(
    client,
    priceLine(item, rates.get(dictionaryItemId) || [], { date, rateProviderId, containerTypeRefId }),
    sheet && { ...sheet, date },
    new Map(),
  );
  return { dictionary_item_id: dictionaryItemId, container_type_ref_id: containerTypeRefId, ...priced };
}

module.exports = { build, priceOne, qtyFromUnit, qtyBasis, priceLine, toSheetCurrency, TIERS };
