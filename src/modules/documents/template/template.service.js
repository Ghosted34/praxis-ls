/**
 * Document templates (Studio backend, doc/DOCUMENT_TEMPLATES_PLAN.md §2/§6).
 * Resolves per-(docType, entity_id) config over the branding/entity defaults,
 * renders a template to HTML (live preview) or to a real, vaulted PDF (generate),
 * and lists real records for the preview picker. Config lives in the generic
 * settings store under section "document_template", key "<docType>:<entity|default>".
 */
"use strict";
const settings = require("../../security/setting/setting.service");
const registry = require("../../../services/documents/templates/registry");
const kit = require("../../../services/documents/templates/kit");
const pdf = require("../../../services/pdf.service");
const brandLogo = require("../../../services/brand-logo.service");
const emailSvc = require("../../../services/email.service");
const verifyLink = require("../../../services/signatures/verify-link");
const sealView = require("../../../services/signatures/seal-view");
// The one outbound-language helper (mail/signature/language.js). A second copy
// of this rule is how a French client starts receiving English documents.
const { asLang } = require("../../mail/signature/language");
// The one letterhead assembler (MOD-01). The entity dossier previews with the
// same function, so the designer and the printer cannot disagree.
const letterhead = require("../../master/entity-letterhead.service");
const letterheadBlocks = require("../../../services/documents/templates/letterhead-blocks");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

// Own section — NOT "document_template", which carries a legacy name/status/
// body_html validator (setting.rules.js) for the old raw template editor.
const SECTION = "document_template_config";
const keyOf = (docType, entityId) => `${docType}:${entityId || "default"}`;

// settings.get throws NOT_FOUND when a key is absent (the common "unconfigured"
// case) — swallow that into null so an unconfigured template still resolves.
async function safeGet(client, key) {
  try { return await settings.get(client, SECTION, key); } catch { return null; }
}

const list = () => registry.list();

// Moved to services/brand-logo.service.js when the signature card needed the
// same resolution — see that file's header for why it is shared rather than
// copied. Re-exported through these local bindings so the call sites below read
// unchanged.
const { resolveLogo, brandingLogoRef } = brandLogo;

/**
 * The tenant's active-currency catalogue (code → { symbol, decimals, name }),
 * used to render the currency SYMBOL (e.g. "FCFA") and the right fraction
 * digits instead of a hardcoded "XAF" + 2 decimals. Falls back to an empty map
 * so a tenant whose currency master is empty still renders the raw code.
 */
async function currencyCatalog(client) {
  try {
    const { rows } = await client.query(
      "SELECT code, symbol, name, decimals FROM currency WHERE is_active = true",
    );
    const m = {};
    for (const r of rows) m[r.code.trim()] = { symbol: r.symbol || r.code.trim(), name: r.name, decimals: Number.isInteger(r.decimals) ? r.decimals : 2 };
    return m;
  } catch {
    /* @silent:storage — an unreadable currency master must not fail the render;
       the document falls back to the raw ISO code + 2 decimals. */
    return {};
  }
}

/**
 * A country's name in the document's own language.
 *
 * `Intl.DisplayNames` rather than a lookup table: the shared catalogue carries
 * English exonyms only, so a French Cameroonian letterhead printed "Cameroon".
 * The alternative was a second country list with French names in it, which is a
 * catalogue to maintain and to disagree with the first one. This is ICU data,
 * it covers every ISO code, and it is already in the runtime.
 */
function countryName(code, language) {
  const c = String(code || "").trim().toUpperCase();
  if (c.length !== 2) return null;
  try {
    return new Intl.DisplayNames([language === "fr" ? "fr" : "en"], { type: "region" }).of(c) || null;
  } catch {
    /* @silent:parse — a runtime built without full ICU, or an unassigned code.
       The caller falls back to the raw code, which is still true. */
    return null;
  }
}

/**
 * The issuing entity, with the facts a letterhead is BUILT FROM rather than the
 * raw row.
 *
 * ── Why this stopped reading `corporate_entity.address` ────────────────────
 * It is a free-text column that predates `entity_address`, and the structured
 * table — line1, line2, po_box, postal_code, city, region, country_code, with a
 * REGISTERED type and a primary flag — has existed, been CRUD-wired under
 * `/entities/:id/addresses` and been editable on the entity dossier all along.
 * The documents were the only surface still reading the blob, so an operator
 * could fill the address in properly and watch the PDF ignore it.
 *
 * Same for the identifiers: `entity_registration` and
 * `entity_tax_registration` hold what each jurisdiction requires, so a French
 * entity's document carries SIREN and TVA where a Cameroonian one carries NIU
 * and RCCM — instead of the two hardcoded labels the foot used to print.
 *
 * `entity-letterhead.service` owns both derivations and is the same function
 * the entity dossier previews with, so what the designer shows is what prints.
 * The legacy columns stay as its fallback; nothing here re-implements them.
 */
async function resolveEntity(client, entityId, { language = "en" } = {}) {
  const q = entityId
    ? await client.query("SELECT * FROM corporate_entity WHERE entity_id = $1", [entityId])
    : await client.query("SELECT * FROM corporate_entity ORDER BY created_at LIMIT 1");
  const entity = q.rows[0] || {};
  const ref = entity.logo_light_ref || (await brandingLogoRef(client));

  if (entity.entity_id) {
    // Best-effort: a document must still render for a tenant whose dossier
    // tables are empty or unreadable. Each derivation falls back to the legacy
    // column on its own, so a partial failure loses one line, not the header.
    const [addresses, registrations, taxRegistrations] = await Promise.all([
      client.query("SELECT * FROM entity_address WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
      client.query("SELECT * FROM entity_registration WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
      client.query("SELECT * FROM entity_tax_registration WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
    ]);
    entity.address_lines = letterhead.addressLines(entity, addresses, { countryName, language });
    entity.identifiers = letterhead.identifiers(entity, registrations, taxRegistrations);
    /*
     * THE LETTERHEAD ROW, AND WHY IT IS FETCHED HERE.
     *
     * `entity_letterhead` has existed since 0516 and until now this function
     * never read it. The designer wrote it, the dossier drew its own preview
     * from it, and the RENDERER took a different road entirely — the settings
     * store — so every toggle on that tab was a dead end: a tenant could switch
     * the share capital off, watch the preview obey, and keep printing it.
     *
     * The same best-effort rule as the derivations above: a document must still
     * render for a tenant whose dossier tables are empty or unreadable, so each
     * of these falls back on its own and a partial failure costs one block, not
     * the header.
     *
     * WHAT THE `.catch` DOES AND DOES NOT COVER. `req.tenantDb` hands out a
     * PINNED connection, not an open transaction (see middleware/tenant-context
     * — there is no BEGIN), so a failing query here is an autocommit error and
     * the ones beside it still succeed. It would NOT survive being called from
     * inside someone else's transaction, where the first error aborts the whole
     * thing regardless of who catches it. That is the same exposure every other
     * read in this function already has, and the reason it is acceptable is the
     * repo's migration discipline: 12760 ships with this code, so
     * `entity_letterhead_line` exists by the time anything renders.
     */
    const [lhRow, lhLines, treasury, establishments] = await Promise.all([
      client.query("SELECT * FROM entity_letterhead WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows[0] || null).catch(() => null),
      client.query(
        `SELECT * FROM entity_letterhead_line
           WHERE entity_id = $1 AND is_active
           ORDER BY zone, sort_order, created_at`, [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
      client.query("SELECT * FROM treasury_account WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
      client.query("SELECT * FROM entity_establishment WHERE entity_id = $1", [entity.entity_id])
        .then((r) => r.rows).catch(() => []),
    ]);
    entity.letterhead_row = lhRow;
    entity.letterhead_lines = lhLines;
    entity.letterhead_sources = { addresses, treasuryAccounts: treasury, establishments };
  } else {
    entity.address_lines = letterhead.addressLines(entity, [], { countryName, language });
    entity.identifiers = letterhead.identifiers(entity, [], []);
    entity.letterhead_row = null;
    entity.letterhead_lines = [];
    entity.letterhead_sources = { addresses: [], treasuryAccounts: [], establishments: [] };
  }

  return { entity, brand: { logo_url: await resolveLogo(ref) } };
}

/*
 * ── THE ENTITY OWNS ITS IDENTITY AND ITS BRAND ─────────────────────────────
 *
 * The knobs below existed in TWO places under two different names: the entity's
 * Letterhead tab (`paper_size`, `logo_position`, `brand_color`, `accent_color`,
 * `footer_note_*`) and the Document Studio's per-docType config (`paper`,
 * `logo.align`, `accent`, `footer_text`). Only the Studio's reached the page.
 *
 * Precedence is now: brand default → ENTITY LETTERHEAD → Studio tenant default
 * → Studio per-entity override → the caller's per-render override. The entity
 * sits below the Studio deliberately: the Studio's remaining knobs are
 * per-DOCUMENT (a watermark on a proforma, a terms block on a quotation), and a
 * setting made for one document type should still win for that document type.
 * What changed is that the entity's values are no longer ignored — they are the
 * floor every document starts from, so setting the accent once on the dossier
 * colours every sheet the tenant prints.
 *
 * A colour is validated, not trusted. These land in a stylesheet that themes
 * every document, and the row is tenant-writable; anything that is not a plain
 * hex triple is dropped rather than interpolated.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const hex = (v) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : null);

function entityLetterheadCfg(entity) {
  const row = entity.letterhead_row;
  if (!row) return {};
  const out = {};
  if (hex(row.brand_color)) out.accent = hex(row.brand_color);
  if (hex(row.accent_color)) out.rule = hex(row.accent_color);
  if (row.paper_size === "A4" || row.paper_size === "LETTER") {
    out.paper = row.paper_size === "LETTER" ? "Letter" : "A4";
  }
  const align = { LEFT: "left", CENTER: "center", RIGHT: "right" }[row.logo_position];
  if (align) out.logo = { align };
  const mm = Number(row.logo_height_mm);
  if (Number.isFinite(mm) && mm > 0) out.logo = { ...(out.logo || {}), height_mm: Math.min(60, Math.max(4, mm)) };
  return out;
}

/** entity override merged over the tenant default (entity_id = null). */
async function savedConfig(client, docType, entityId) {
  const def = await safeGet(client, keyOf(docType, null));
  const ov = entityId ? await safeGet(client, keyOf(docType, entityId)) : null;
  return { ...(def && def.value ? def.value : {}), ...(ov && ov.value ? ov.value : {}) };
}

/**
 * The language ONE render comes out in.
 *
 * Resolution order, and it is deliberately short:
 *   1. what the operator picked at print time (`language`, from the request)
 *   2. what the tenant configured for this doc type in the Document Studio
 *
 * The operator's pick wins because they are the one looking at the client's
 * file while they press Download — a tenant-wide default cannot know that this
 * particular consignee reads English. `asLang` drops anything that is not a
 * supported code, so an unrecognised value falls through to the tenant setting
 * rather than rendering a document in nothing.
 *
 * "bilingual" is a legitimate configured value and is passed through untouched;
 * it is only ever chosen deliberately.
 */
function resolveDocLanguage(picked, saved) {
  const explicit = asLang(picked);
  if (explicit) return explicit;
  return (saved && saved.language) || undefined;
}

async function resolveCfg(client, docType, entityId, override, { language = null } = {}) {
  const saved = await savedConfig(client, docType, entityId);
  const picked = resolveDocLanguage(language, saved);
  // Resolved BEFORE the entity, because the entity's own derived lines are
  // language-dependent — a French document says "Cameroun", an English one
  // "Cameroon", and both come from the same country_code.
  const { entity, brand } = await resolveEntity(client, entityId, { language: picked === "fr" ? "fr" : "en" });
  const fromEntity = entityLetterheadCfg(entity);
  const cfg = kit.mergeCfg(brand, {
    ...fromEntity, ...saved, ...(override || {}), ...(picked ? { language: picked } : {}),
    // `logo` is nested, so a spread would let the Studio's {show:true} erase the
    // entity's height_mm and align. Merged key-wise instead, entity underneath.
    logo: { ...(fromEntity.logo || {}), ...(saved.logo || {}), ...((override || {}).logo || {}) },
  });
  /*
   * The company cachet, inlined the same way the letterhead logo is.
   *
   * It was configurable (`signature.image_url` has been in `kit.defaults`
   * since the kit existed) and it was never RESOLVED, so a tenant that set one
   * got a bare storage key in an <img src> — which loads in the preview iframe,
   * where there is an origin, and silently nothing in the PDF, where there is
   * not. Same failure the logo had, same fix.
   */
  if (cfg.signature && cfg.signature.image_url) {
    cfg.signature = { ...cfg.signature, image_url: await resolveLogo(cfg.signature.image_url) };
  }
  // Currency catalogue + the entity's default currency, so templates render the
  // symbol ("FCFA") and correct decimals, and fall back to the entity's base
  // currency (not a hardcoded XAF) when a document has no currency column.
  const currencies = await currencyCatalog(client);
  cfg.currencies = currencies;
  const base = (entity.default_currency || "").trim() || "XAF";
  cfg.base_currency = base;
  const b = currencies[base];
  entity.default_currency_decimals = b ? b.decimals : 2;

  /*
   * Compose the shell ONCE, here, and hand it to the kit on `cfg`.
   *
   * `kit.standardHead` can compose for itself and does when this is absent —
   * that is what keeps an unmigrated caller rendering. But composing here is
   * what lets it see the entity's ADDRESS ROWS, TREASURY ACCOUNTS and
   * ESTABLISHMENTS, which the kit has no way to fetch and no business fetching.
   * The alternative is a letterhead that silently drops the payment block on
   * every real render and shows it in every preview.
   */
  const src = entity.letterhead_sources || {};
  cfg.letterhead = letterheadBlocks.compose({
    entity,
    config: entity.letterhead_row || {},
    layout: (entity.letterhead_row && entity.letterhead_row.layout) || null,
    customLines: entity.letterhead_lines || [],
    addresses: src.addresses || [],
    treasuryAccounts: src.treasuryAccounts || [],
    establishments: src.establishments || [],
    logo_url: (cfg.logo && cfg.logo.show !== false && cfg.logo.url) || null,
    logo_height_mm: (cfg.logo && cfg.logo.height_mm) || null,
  }, cfg.language === "fr" ? "fr" : "en");

  return { cfg, entity };
}

async function getConfig(client, { docType, entityId }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const def = await safeGet(client, keyOf(docType, null));
  const ov = entityId ? await safeGet(client, keyOf(docType, entityId)) : null;
  const { entity } = await resolveEntity(client, entityId);
  return {
    docType, entity_id: entityId || null, title: tpl.title, fields: tpl.fields || [],
    tenant_default: (def && def.value) || {},
    entity_override: ov ? ov.value : null,
    defaults: kit.defaults({ logo_url: await resolveLogo(entity.logo_light_ref || (await brandingLogoRef(client))) }),
  };
}

async function setConfig(client, { docType, entityId, config, actor }) {
  if (!registry.get(docType)) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  await settings.put(client, { section: SECTION, key: keyOf(docType, entityId), value: config || {}, actor });
  return { ok: true, docType, entity_id: entityId || null };
}

/* ── record loading (real records for the preview picker / generate) ────────── */
const INVOICE_TYPE = { FINAL_INVOICE: "FINAL", CREDIT_NOTE: "CREDIT_NOTE" };
// docTypes with their own head table (label column for the picker).
const SIMPLE = {
  PROFORMA_ADVANCE: { table: "advance", pk: "advance_id", label: null },
  QUOTATION: { table: "quotation", pk: "quotation_id", label: "doc_number" },
  PAYMENT_RECEIPT: { table: "payment_receipt", pk: "receipt_id", label: null },
  PROPOSAL: { table: "proposal", pk: "proposal_id", label: "title" },
  SUPPLIER_INVOICE: { table: "supplier_invoice", pk: "supplier_invoice_id", label: "doc_number" },
  PURCHASE_ORDER: { table: "purchase_order", pk: "po_id", label: "doc_number" },
  PURCHASE_REQUEST: { table: "purchase_request", pk: "pr_id", label: "doc_number" },
  CASH_REQUEST: { table: "cash_request", pk: "cash_request_id", label: "doc_number" },
  COSTING: { table: "costing", pk: "costing_id", label: "doc_number" },
  REGIE_ADVANCE: { table: "regie_advance", pk: "regie_advance_id", label: null },
  WORK_ORDER: { table: "work_order", pk: "work_order_id", label: null },
  EMPLOYMENT_CONTRACT: { table: "hr_contract", pk: "hr_contract_id", label: "doc_number" },
  SOP_DOCUMENT: { table: "sop_document", pk: "sop_document_id", label: "title" },
  DELIVERY_NOTE: { table: "delivery_note", pk: "delivery_note_id", label: "doc_number" },
  TRANSIT_ORDER: { table: "transit_order", pk: "transit_order_id", label: "ot_number" },
  GRN: { table: "grn_inbound", pk: "grn_inbound_id", label: null },
  GOODS_RECEIVED: { table: "goods_received_note", pk: "grn_id", label: "doc_number" },
  CYCLE_COUNT_SHEET: { table: "cycle_count", pk: "cycle_count_id", label: null },
  TRIP_SHEET: { table: "fleet_dispatch", pk: "fleet_dispatch_id", label: null },
};
const clientLines = (r) => [r.client_niu && `NIU ${r.client_niu}`, r.client_rccm && `RCCM ${r.client_rccm}`].filter(Boolean);
const humanize = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const RECEIPT_METHOD = { BANK: "Virement / Bank transfer", CASH: "Espèces / Cash", MOBILE_MONEY: "Mobile money", CHEQUE: "Chèque / Cheque" };

async function records(client, docType) {
  // Defensive: a missing/renamed table (or a schema behind on migrations) must
  // degrade the picker to "no records", never 500 the Studio.
  try {
    if (INVOICE_TYPE[docType]) {
      const { rows } = await client.query(
        "SELECT invoice_id AS id, COALESCE(doc_number, LEFT(invoice_id::text, 8)) AS label FROM invoice WHERE type = $1 ORDER BY created_at DESC LIMIT 25",
        [INVOICE_TYPE[docType]],
      );
      return rows;
    }
    if (docType === "PAYSLIP") {
      const { rows } = await client.query(
        "SELECT i.payroll_run_item_id AS id, COALESCE(e.full_name, LEFT(i.payroll_run_item_id::text, 8)) || ' — ' || r.period_code AS label " +
          "FROM payroll_run_item i JOIN payroll_run r ON r.payroll_run_id = i.payroll_run_id LEFT JOIN employee e ON e.employee_id = i.employee_id " +
          "ORDER BY r.period_code DESC LIMIT 25",
      );
      return rows;
    }
    const s = SIMPLE[docType];
    if (s) {
      const lbl = s.label ? `COALESCE(${s.label}, LEFT(${s.pk}::text, 8))` : `LEFT(${s.pk}::text, 8)`;
      const { rows } = await client.query(`SELECT ${s.pk} AS id, ${lbl} AS label FROM ${s.table} ORDER BY created_at DESC LIMIT 25`);
      return rows;
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * The transit order's print payload.
 *
 * ITS OWN FUNCTION, unlike the one-liners above, because it is the only
 * document here whose facts come from THREE places and whose correctness
 * depends on picking the right one:
 *
 *   · the order itself — the decisions (regime, insurance, surveyor, value)
 *   · its lines — the cargo
 *   · the shipment-details projection — client, vessel, B/L, ports, dates
 *
 * THE SNAPSHOT COMES FIRST, AND THAT IS THE WHOLE POINT. Once the order has
 * been issued, `shipment_details_snapshot` (0661) holds the facts as they stood
 * when the client was asked to sign. Reprinting from the live dossier is the
 * legacy defect: `get_file.php` re-read the file every time, so a reprint after
 * a vessel change silently showed different facts than the stamped copy in the
 * client's file. The live projection is used only for a DRAFT, which has no
 * snapshot because it has not been shown to anyone yet.
 *
 * Facets are read BY ROLE, never by field key, so this works on a sea file, an
 * air file and a service type nobody has invented yet — the same reason
 * shipment_details.rules exists.
 */
const REGIME_CODES = ["IM4", "IM7", "IM8", "EX1", "EX2"];
const fmtMoney = (n, ccy) =>
  `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${ccy || "XAF"}`;

/**
 * Delivery-note projection.
 *
 * The containers come from `delivery_note_container` — the note's own snapshot
 * — and NOT from the file's live `dossier_container_unit` rows. That is the
 * whole point of snapshotting them at pick time: a note signed in March must
 * reprint in September showing the boxes that were actually handed over, even
 * if the file has since been corrected.
 */
async function deliveryNoteData(client, recordId) {
  const { rows } = await client.query(
    `SELECT dn.*, d.ref AS dossier_ref, cm.name AS client_name, au.full_name AS issued_by_name
       FROM delivery_note dn
       LEFT JOIN dossier d ON d.dossier_id = dn.dossier_id
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
       LEFT JOIN app_user au ON au.user_id = dn.issued_by
      WHERE dn.delivery_note_id = $1`,
    [recordId],
  );
  const dn = rows[0];
  if (!dn) return null;

  const [lr, cr] = await Promise.all([
    client.query(
      "SELECT label, qty, gross_weight_kg, marks FROM delivery_note_line "
      + "WHERE delivery_note_id = $1 ORDER BY delivery_note_line_id",
      [recordId],
    ),
    client.query(
      `SELECT container_no, seal_no, gross_weight_kg, dossier_container_line_id,
              container_type_code, qty, redelivery_reason
         FROM delivery_note_container WHERE delivery_note_id = $1 ORDER BY seq, created_at`,
      [recordId],
    ),
  ]);

  /*
   * WHERE THIS DELIVERY SITS IN THE FILE.
   *
   * A sea file's containers do not all clear at once, so one file produces
   * several notes over weeks. Until now each note said only what was in it, and
   * neither the driver nor the client's gatekeeper could tell whether more was
   * coming. `position` is derived from the OTHER notes on the same file — never
   * stored — by the same rollup the operations screen reads, so the sheet and
   * the screen cannot disagree.
   *
   * Best-effort: a note must still print for a file whose progress cannot be
   * computed. It then prints as a plain delivery note, which is what it was
   * before this existed.
   */
  let position = null;
  /*
   * DOES THIS FILE MOVE CONTAINERS?
   *
   * The printed note reserved twelve ruled manifest slots on every document,
   * so an AIR FREIGHT delivery note came out with a container manifest on it —
   * a third of the page given to boxes that do not exist for that shipment,
   * while its packages had nowhere to state their weight. The sheet asks the
   * same question the form does, from the same place.
   *
   * Defaults to false: a file whose service type cannot be resolved prints as
   * packages, which is the shape that loses nothing. A container file printed
   * as packages still lists its boxes as cargo lines; a package file printed
   * with a manifest prints twelve empty ruled rows.
   */
  let containerised = false;
  if (dn.dossier_id) {
    try {
      const dnRules = require("../../operations/delivery_note/delivery_note.rules");
      const dnRepo = require("../../operations/delivery_note/delivery_note.repo");
      const progress = dnRules.deliveryProgress(await dnRepo.progressForDossier(client, dn.dossier_id));
      const seq = await dnRepo.sequenceOnDossier(client, { dossierId: dn.dossier_id, noteId: recordId });
      position = dnRules.deliveryPosition(progress, seq);
      containerised = await dnRepo.capturesContainers(client, dn.dossier_id);
    } catch (err) {
      logger.warn({ err: err && err.message, delivery_note_id: recordId },
        "[documents] delivery note printed without its position on the file");
    }
  }

  return {
    entity_id: dn.entity_id || null,
    data: {
      number: dn.doc_number || String(dn.delivery_note_id).slice(0, 8),
      date: dn.created_at,
      delivery_date: dn.delivery_date,
      dossier_ref: dn.dossier_ref || null,
      status: dn.status,
      status_words: require("../../operations/delivery_note/delivery_note.rules").statusWords(dn.status),
      position,
      // Decides whether the sheet prints a container manifest at all.
      containerised,
      party: {
        name: dn.consignee || dn.client_name || "—",
        // The address is the point of the document; city/zone alone is routing.
        lines: [dn.address, dn.city_zone, dn.contact_person, dn.phone].filter(Boolean),
      },
      /*
       * The cargo lines, with what a PACKAGE note needs on them.
       *
       * On a container file the manifest carries the identity of the goods and
       * these are empty. On an air or road file they are the document: the
       * weight the consignee checks at the counter, and the marks that identify
       * the cartons the way a number identifies a box.
       */
      lines: lr.rows.map((l) => ({
        label: l.label,
        qty: Number(l.qty),
        gross_weight_kg: l.gross_weight_kg === null ? null : Number(l.gross_weight_kg),
        marks: l.marks || null,
      })),
      // 10708 — a container row is either a per-box unit (number + seal) or a
      // GROUPED line ("3 × 40HC"): the note prints whichever the file stated.
      containers: cr.rows.map((c) => ({
        container_no: c.container_no,
        seal_no: c.seal_no,
        container_type_code: c.container_type_code,
        qty: Number(c.qty) || 1,
        // Why a box already signed for is going out again. Printed, because
        // the note is the only place a reader will ever look for it.
        redelivery_reason: c.redelivery_reason || null,
      })),
      /*
       * `reservations`, and deliberately NOT also as `reserves`.
       *
       * canonical.js's DELIVERY_NOTE builder reads `d.reserves || d.remarks`,
       * and nothing has ever supplied either — so the signed payload carries an
       * empty reserves field. That looks like a wiring bug and is left alone on
       * purpose, because the lifecycle already gives what the field was meant
       * to buy and feeding it would cost more than it gives:
       *
       *   · reservations are written once, at DELIVERED, and a DELIVERED note
       *     cannot be edited (delivery_note.rules.assertEditable). There is no
       *     path by which reserves change under a signature.
       *   · a note signed at ISSUE — our countersignature — would flip to
       *     AMENDED the moment the client writes anything in the box at the
       *     gate. That is the document completing its lifecycle, not somebody
       *     tampering with it, and an amendment alarm that fires on the normal
       *     path is an alarm people learn to ignore.
       *
       * Adding it would mean a v2 payload (canonical.js is explicit: never edit
       * a live builder), which is a different piece of work with a migration of
       * its own. The container manifest is absent from the payload for the same
       * reason and is protected the same way — containers are frozen at ISSUE,
       * and signing is only offered on a numbered note.
       */
      reservations: dn.reservations || null,
      received_by_name: dn.received_by_name || null,
      received_at: dn.received_at || null,
      issued_by_name: dn.issued_by_name || null,
      currency: null,
    },
  };
}

async function transitOrderData(client, recordId) {
  const { rows } = await client.query(
    `SELECT t.*, d.ref AS dossier_ref, cm.name AS client_name
       FROM transit_order t
       LEFT JOIN dossier d ON d.dossier_id = t.dossier_id
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE t.transit_order_id = $1`,
    [recordId],
  );
  const to = rows[0];
  if (!to) return null;

  const lr = await client.query(
    "SELECT * FROM transit_order_line WHERE transit_order_id = $1 ORDER BY line_no NULLS LAST, transit_order_line_id",
    [recordId],
  );

  // Snapshot for an issued order; live only for a draft that has none.
  let details = to.shipment_details_snapshot || null;
  if (!details && to.dossier_id) {
    try {
      const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");
      details = await shipmentDetails.forDossier(client, to.dossier_id);
    } catch (err) {
      // A draft whose service type has lost its field set must still PRINT —
      // the shipment boxes read "—" and the operator sees the decisions, which
      // is strictly better than a 500 on the one screen they are trying to use
      // to fix the file. Logged rather than swallowed: it is a real data
      // problem on that dossier, just not this document's to raise.
      logger.warn({ err, transit_order_id: recordId }, "[documents] transit order printed without shipment details");
    }
  }
  const facet = (role) => {
    const f = details && details.facets ? details.facets[role] : null;
    return (f && f.value) || null;
  };

  const declaredCcy = to.declared_currency || "XAF";
  const fx = Number(to.declared_fx_to_xaf || 1) || 1;
  const declared = to.declared_value === null || to.declared_value === undefined ? null : Number(to.declared_value);

  const ticked = new Set(
    (Array.isArray(to.submitted_docs) ? to.submitted_docs : []).map((d) => String(d && d.code ? d.code : d).toUpperCase()),
  );
  const rules = require("../../operations/transit_order/transit_order.rules");

  return {
    entity_id: to.entity_id || null,
    data: {
      number: to.ot_number || String(to.transit_order_id).slice(0, 8),
      date: to.issued_at || to.created_at,
      status: to.status,
      /*
       * A PAIR, not "Émis / Issued".
       *
       * This field used to be a pre-joined bilingual string, so a document
       * configured `fr` printed the English half too and there was nothing
       * `cfg.language` could do about it — the projection had already decided.
       * Same for the attached-document labels below. Every label a template
       * renders now leaves here as {fr, en}, and the template picks a side.
       */
      status_words: rules.statusWords(to.status),
      direction: to.service_direction || "",

      client: to.client_name || "—",
      /*
       * The counterparty in the shape `canonical.js` and the public
       * verification portal expect.
       *
       * Without it the signed payload carried `party: { name: "" }` and the
       * portal answered "Donneur d'ordre: —" to anyone scanning a signed
       * transit order — the one field a stranger holding the paper uses to
       * confirm they are looking at their own document. `client` stays beside
       * it: the native document view reads it, and dropping a field the
       * projection has always emitted is not this change's business.
       *
       * ⚠ This CHANGES THE CANONICAL HASH for transit orders. A signature
       *   taken before this change recomputes to a different digest and reads
       *   as AMENDED — correctly, in the sense that the payload it attested to
       *   really was missing the counterparty. The seal was never rendered on
       *   this doc type before now, so that set is empty in practice; it is
       *   called out here because the next person to change a projection field
       *   needs to know that is what they are doing.
       */
      party: { name: to.client_name || "—", lines: [] },
      // The conveyance under the key canonical.js reads for a movement document.
      vehicle: facet("CONVEYANCE") || "",
      dossier_ref: to.dossier_ref || "—",
      conveyance: facet("CONVEYANCE"),
      transport_ref: facet("TRANSPORT_REF"),
      origin: facet("ORIGIN"),
      destination: facet("DESTINATION"),
      arrival_date: facet("ARRIVAL_DATE"),
      // The order's own departure date is the one the client agreed to; the
      // file's is only a fallback for an order raised before it was set.
      departure_date: to.departure_date || facet("DEPARTURE_DATE"),
      place_of_delivery: facet("FINAL_DELIVERY") || facet("DESTINATION"),

      lines: lr.rows.map((l) => ({
        marks: l.marks || "",
        packages: String(Number(l.packages || 0)),
        label: l.label,
        weight: l.weight || "",
        value: l.value_amount === null || l.value_amount === undefined ? "" : fmtMoney(l.value_amount, declaredCcy),
      })),

      declared_value_text: declared === null ? null : fmtMoney(declared, declaredCcy),
      // Only shown when it says something the line above does not.
      declared_value_xaf_text: declared === null || declaredCcy === "XAF" ? null : fmtMoney(declared * fx, "XAF"),

      regimes: REGIME_CODES.map((code) => ({ code, on: to.customs_regime === code })),
      customs_regime_other: to.customs_regime_other || null,

      insurance_type: to.insurance_type || "CLIENT",
      surveyor_party: to.surveyor_party || "CLIENT",

      documents: rules.SUBMITTED_DOC_TYPES.map((d) => ({
        code: d.code,
        label: { fr: d.label_fr, en: d.label_en },
        on: ticked.has(d.code),
      })),

      instructions: to.instructions || null,
      declaration_ref: to.declaration_ref || null,
      lodged_date: to.lodged_at || null,
      issued_date: to.issued_at || null,
      signed_date: to.signed_at || null,
      signed_by_name: to.signed_by_name || null,
      currency: declaredCcy,
    },
  };
}

async function loadRecord(client, docType, recordId) {
  if (INVOICE_TYPE[docType]) {
    const { rows } = await client.query(
      "SELECT i.*, cm.name AS client_name, cm.niu AS client_niu, cm.rccm AS client_rccm " +
        "FROM invoice i LEFT JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
      [recordId],
    );
    const i = rows[0];
    if (!i) return null;
    const lr = await client.query("SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY line_no", [recordId]);
    return {
      entity_id: i.entity_id,
      data: {
        number: i.doc_number || String(i.invoice_id).slice(0, 8), date: i.issued_on, due: i.payment_due_on, status: i.status,
        original_ref: docType === "CREDIT_NOTE" ? null : undefined,
        party: { name: i.client_name || "—", lines: clientLines(i) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: l.is_disbursement ? null : 19.25, amount: Number(l.line_ht) })),
        totals: { service_ht: Number(i.service_ht), disbursement_total: Number(i.disbursement_total), vat_total: Number(i.vat_total), total_ttc: Number(i.total_ttc) },
        currency: i.currency,
      },
    };
  }

  if (docType === "QUOTATION") {
    const { rows } = await client.query(
      "SELECT q.*, cm.name AS client_name, cm.niu AS client_niu, cm.rccm AS client_rccm FROM quotation q LEFT JOIN client_master cm ON cm.client_id = q.client_id WHERE q.quotation_id = $1",
      [recordId],
    );
    const q = rows[0];
    if (!q) return null;
    const lr = await client.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [recordId]);
    return {
      entity_id: q.entity_id,
      data: {
        number: q.doc_number || String(q.quotation_id).slice(0, 8), date: q.created_at, valid_until: q.valid_until,
        party: { name: q.client_name || "—", lines: clientLines(q) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: 19.25, amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: Number(q.total_ht), vat_total: Number(q.total_ttc) - Number(q.total_ht), total_ttc: Number(q.total_ttc) },
        currency: q.currency,
      },
    };
  }

  if (docType === "PAYMENT_RECEIPT") {
    const { rows } = await client.query("SELECT r.*, cm.name AS client_name FROM payment_receipt r LEFT JOIN client_master cm ON cm.client_id = r.client_id WHERE r.receipt_id = $1", [recordId]);
    const r = rows[0];
    if (!r) return null;
    // What the receipt pays: allocations onto invoices.
    const al = await client.query(
      "SELECT a.amount, i.doc_number, i.invoice_id FROM payment_allocation a LEFT JOIN invoice i ON i.invoice_id = a.invoice_id WHERE a.receipt_id = $1 ORDER BY a.allocation_id",
      [recordId],
    );
    const allocations = al.rows.map((a) => ({ label: a.doc_number || (a.invoice_id ? `Facture ${String(a.invoice_id).slice(0, 8)}` : "Imputation"), amount: Number(a.amount) }));
    return {
      entity_id: null,
      data: {
        number: String(r.receipt_id).slice(0, 8), date: r.received_on || r.created_at, method: RECEIPT_METHOD[r.method] || r.method,
        amount: Number(r.amount), party: { name: r.client_name || "—", lines: [] },
        allocations, invoice_ref: allocations.map((a) => a.label).join(", ") || null,
        lines: allocations.length ? allocations.map((a) => ({ label: a.label, amount: a.amount })) : undefined,
        currency: null,
      },
    };
  }

  if (docType === "PROFORMA_ADVANCE") {
    const { rows } = await client.query("SELECT a.*, cm.name AS client_name FROM advance a LEFT JOIN client_master cm ON cm.client_id = a.client_id WHERE a.advance_id = $1", [recordId]);
    const a = rows[0];
    if (!a) return null;
    const amount = Number(a.amount);
    const applied = Number(a.applied_amount || 0);
    return {
      entity_id: null,
      data: {
        number: String(a.advance_id).slice(0, 8), date: a.received_on || a.created_at,
        party: { name: a.client_name || "—", lines: [] },
        lines: [{ label: "Acompte / Advance payment", qty: 1, unit: amount, amount }],
        totals: { service_ht: amount, vat_total: 0, total_ttc: amount },
        applied, currency: null,
      },
    };
  }

  if (docType === "PROPOSAL") {
    const { rows } = await client.query("SELECT p.*, cm.name AS client_name FROM proposal p LEFT JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1", [recordId]);
    const p = rows[0];
    if (!p) return null;
    const nr = await client.query("SELECT section, body FROM proposal_narrative WHERE proposal_id = $1 ORDER BY sort_order", [recordId]);
    const lr = await client.query("SELECT label, qty, unit_price FROM proposal_line WHERE proposal_id = $1 ORDER BY proposal_line_id", [recordId]);
    const sections = nr.rows.map((n) => ({ title: humanize(n.section), body: n.body || "" }));
    const lines = lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) }));
    const ht = lines.reduce((s2, l) => s2 + l.amount, 0);
    return {
      entity_id: null,
      data: {
        number: p.doc_number || String(p.proposal_id).slice(0, 8), date: p.created_at, status: p.status, headline: p.title,
        party: { name: p.client_name || "—", lines: [] }, sections, lines,
        totals: ht ? { service_ht: ht, total_ttc: ht } : undefined, currency: null,
      },
    };
  }

  if (docType === "SUPPLIER_INVOICE") {
    const { rows } = await client.query(
      `SELECT si.*, sm.name AS supplier_name, sm.niu AS supplier_niu, sm.address AS supplier_address, sm.city AS supplier_city,
              po.doc_number AS po_doc_number,
              COALESCE(e_p.signatory_name, au_p.full_name) AS posted_by_name,
              e_p.job_title AS posted_by_title,
              c.decimals AS currency_decimals
         FROM supplier_invoice si
         LEFT JOIN supplier_master sm ON sm.supplier_id = si.supplier_id
         LEFT JOIN purchase_order po ON po.po_id = si.po_id
         LEFT JOIN journal_entry je ON je.entry_id = si.entry_id
         LEFT JOIN app_user au_p ON au_p.user_id = je.created_by
         LEFT JOIN employee e_p ON e_p.employee_id = au_p.employee_id
         LEFT JOIN currency c ON c.code = si.currency
        WHERE si.supplier_invoice_id = $1`,
      [recordId],
    );
    const si = rows[0];
    if (!si) return null;
    const lr = await client.query("SELECT * FROM supplier_invoice_line WHERE supplier_invoice_id = $1 ORDER BY supplier_invoice_line_id", [recordId]);
    const ttc = Number(si.amount_ttc || 0);
    return {
      entity_id: si.entity_id,
      data: {
        number: si.doc_number || String(si.supplier_invoice_id).slice(0, 8), date: si.created_at, status: si.status, supplier_ref: si.supplier_ref,
        due: si.due_on, po_ref: si.po_doc_number,
        party: { name: si.supplier_name || "—", lines: [si.supplier_address, si.supplier_city, si.supplier_niu && `NIU ${si.supplier_niu}`].filter(Boolean) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: Number(si.amount_ht), vat_total: Number(si.vat_total), wht_total: Number(si.wht_total), total_ttc: ttc },
        amount_in_words: ttc,
        currency: si.currency || "XAF",
        posted_by_name: si.posted_by_name || null,
        posted_by_title: si.posted_by_title || null,
        currency_decimals: si.currency_decimals !== null && si.currency_decimals !== undefined ? Number(si.currency_decimals) : undefined,
      },
    };
  }

  if (docType === "PURCHASE_ORDER") {
    const { rows } = await client.query(
      `SELECT po.*,
              COALESCE(po.supplier_name, sm.name) AS supplier_name,
              COALESCE(po.supplier_niu, sm.niu) AS supplier_niu,
              COALESCE(po.supplier_address, sm.address) AS supplier_address,
              COALESCE(po.supplier_city, sm.city) AS supplier_city,
              COALESCE(e_i.signatory_name, au_i.full_name) AS issuer_name,
              e_i.job_title AS issuer_title,
              COALESCE(e_a.signatory_name, au_a.full_name) AS approver_name,
              e_a.job_title AS approver_title,
              c.decimals AS currency_decimals
         FROM purchase_order po
         LEFT JOIN supplier_master sm ON sm.supplier_id = po.supplier_id
         LEFT JOIN app_user au_i ON au_i.user_id = po.issuer_id
         LEFT JOIN employee e_i ON e_i.employee_id = au_i.employee_id
         LEFT JOIN app_user au_a ON au_a.user_id = po.approver_id
         LEFT JOIN employee e_a ON e_a.employee_id = au_a.employee_id
         LEFT JOIN currency c ON c.code = po.currency
        WHERE po.po_id = $1`,
      [recordId],
    );
    const po = rows[0];
    if (!po) return null;
    // Per-line VAT resolved through the line's tax code, so the printed column
    // and the printed totals agree with what the PO was priced at (10720).
    const lr = await client.query(
      `SELECT poi.*, tc.rate_percent AS vat_rate
         FROM purchase_order_item poi
         LEFT JOIN tax_code tc ON tc.tax_code_id = poi.tax_code_id
        WHERE poi.po_id = $1 ORDER BY poi.po_item_id`,
      [recordId],
    );
    const ht = lr.rows.reduce((s2, l) => s2 + Number(l.qty) * Number(l.unit_price), 0);
    const ttc = Number(po.total_ttc) || ht;
    const vat = Number(po.total_vat) || Math.max(0, ttc - ht);
    const withholding = Math.round((ht * Number(po.air_rate || 0)) / 100 * 100) / 100;
    const net = po.net_payable !== null && po.net_payable !== undefined ? Number(po.net_payable) : Math.round((ttc - withholding - Number(po.adv_paid || 0)) * 100) / 100;
    return {
      entity_id: po.entity_id || null,
      data: {
        number: po.doc_number || String(po.po_id).slice(0, 8), date: po.created_at, status: po.status,
        currency: po.currency || "XAF",
        delivery_on: po.delivery_on, due_on: po.due_on, delivery_location: po.delivery_location,
        payment_means: po.payment_means, pay_days: Number(po.pay_days || 0),
        air_rate: Number(po.air_rate || 0), adv_paid: Number(po.adv_paid || 0), remarks: po.remarks,
        party: { name: po.supplier_name || "—", lines: [po.supplier_address, po.supplier_city, po.supplier_niu && `NIU ${po.supplier_niu}`].filter(Boolean) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: l.vat_rate !== null && l.vat_rate !== undefined ? String(l.vat_rate) : "", amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: ht, vat_total: vat, total_ttc: ttc, withholding, net_payable: net },
        amount_in_words: net,
        issuer_name: po.issuer_name || null,
        issuer_title: po.issuer_title || null,
        approver_name: po.approver_name || null,
        approver_title: po.approver_title || null,
        currency_decimals: po.currency_decimals !== null && po.currency_decimals !== undefined ? Number(po.currency_decimals) : undefined,
      },
    };
  }

  if (docType === "PURCHASE_REQUEST") {
    const { rows } = await client.query(
      `SELECT pr.*, u.full_name AS requester,
              COALESCE(e.signatory_name, u.full_name) AS requester_name,
              e.job_title AS requester_title
         FROM purchase_request pr
         LEFT JOIN app_user u ON u.user_id = pr.requested_by
         LEFT JOIN employee e ON e.employee_id = u.employee_id
        WHERE pr.pr_id = $1`,
      [recordId],
    );
    const pr = rows[0];
    if (!pr) return null;
    const lr = await client.query("SELECT label, qty, unit_price FROM purchase_request_line WHERE pr_id = $1 ORDER BY purchase_request_line_id", [recordId]);
    const lines = lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) }));
    const total = lines.reduce((s2, l) => s2 + l.amount, 0);
    return {
      entity_id: null,
      data: {
        number: pr.doc_number || String(pr.pr_id).slice(0, 8), date: pr.created_at, status: pr.status, department: pr.department,
        party: { name: pr.requester || pr.department || "—", lines: [pr.department].filter(Boolean) },
        reason: pr.justification || undefined, lines, totals: { total_ttc: total }, currency: null,
        requester_name: pr.requester_name || null,
        requester_title: pr.requester_title || null,
      },
    };
  }

  if (docType === "CASH_REQUEST") {
    const { rows } = await client.query(
      `SELECT cr.*, u.full_name AS requester_name, u.email AS requester_email, d.ref AS dossier_ref,
              COALESCE(e_v.signatory_name, au_v.full_name) AS validated_by_name,
              e_v.job_title AS validated_by_title,
              COALESCE(e_a.signatory_name, au_a.full_name) AS approved_by_name,
              e_a.job_title AS approved_by_title
         FROM cash_request cr
         LEFT JOIN app_user u ON u.user_id = cr.requested_by
         LEFT JOIN dossier d ON d.dossier_id = cr.dossier_id
         LEFT JOIN app_user au_v ON au_v.user_id = cr.validated_by
         LEFT JOIN employee e_v ON e_v.employee_id = au_v.employee_id
         LEFT JOIN app_user au_a ON au_a.user_id = cr.approver_id
         LEFT JOIN employee e_a ON e_a.employee_id = au_a.employee_id
        WHERE cr.cash_request_id = $1`,
      [recordId],
    );
    const cr = rows[0];
    if (!cr) return null;
    const lr = await client.query("SELECT label, budget_amount, vat_percent FROM cash_request_line WHERE cash_request_id = $1 ORDER BY cash_request_line_id", [recordId]);
    const purpose = lr.rows.map((l) => l.label).filter(Boolean).join(", ");
    // §3.5 — the voucher footer: Subtotal / VAT / TOTAL PAYABLE, same rule the
    // service applies (lazy require: see the transit-order branch note).
    const { computeTotals } = require("../../costing/cash_request/cash_request.rules");
    const totals = computeTotals(lr.rows);
    return {
      entity_id: null,
      data: {
        number: cr.doc_number || String(cr.cash_request_id).slice(0, 8), date: cr.created_at, status: cr.status,
        amount: Number(cr.amount), purpose, dossier_ref: cr.dossier_ref,
        beneficiary: cr.beneficiary, category: cr.category, cost_center: cr.cost_center,
        overhead_justification: cr.overhead_justification, remarks: cr.remarks,
        method: cr.disbursement_method || null,
        method_details: cr.disbursement_details || {},
        lines: lr.rows.map((l) => ({ label: l.label, qty: 1, unit: Number(l.budget_amount), tax: l.vat_percent !== null && l.vat_percent !== undefined ? Number(l.vat_percent) : null, amount: Number(l.budget_amount) })),
        totals,
        party: { name: cr.requester_name || "—", lines: [cr.requester_email].filter(Boolean) },
        validated_by_name: cr.validated_by_name || null,
        validated_by_title: cr.validated_by_title || null,
        approved_by_name: cr.approved_by_name || null,
        approved_by_title: cr.approved_by_title || null,
        received_by_name: cr.beneficiary || null,
        currency: null,
      },
    };
  }

  /*
   * §3.3 — the costing worksheet.
   *
   * WHAT THIS PROJECTION USED TO GET WRONG, and why each mattered.
   *
   * `entity_id: null`. Every other document that belongs to a corporate entity
   * passes one; this passed null, and `resolveEntity` answers null with
   * `SELECT * FROM corporate_entity ORDER BY created_at LIMIT 1`. So on a
   * multi-entity tenant — which is the shape this product is sold in — the
   * costing printed the letterhead, the address and the tax identifiers of
   * whichever company was created first. It comes from the FILE now, which is
   * the entity whose paper this is.
   *
   * NO COUNTERPARTY. `party` is the shape `canonical.js` hashes and the
   * verification portal reads. Without it a signed costing attested to
   * `party: { name: "" }`, so the one field that says whose file this is was
   * absent from the very payload meant to prove the sheet had not changed.
   *
   * NO SHIPMENT FACTS. A pricer prices the SHIPMENT — a vessel, a route, a
   * B/L, a container count — and the sheet showed a table of charges with none
   * of it. The snapshot comes first for the same reason the transit order's
   * does: an approved sheet must keep citing what it was approved WITH.
   *
   * TOTALS WERE RECOMPUTED. `computeCosting` at print time answers with
   * today's tax rates, so reprinting a sheet approved before a VAT change
   * printed a different total than the copy in the file. 12766 persisted the
   * totals as columns precisely so the stored figures are what prints; the
   * recompute stays only as the fallback for a pre-12766 row that has none.
   *
   * DÉBOURS VAT IS BUDGETED (12768). A débours is re-billed at the supplier's
   * net plus their VAT; that VAT is the operations officer's cash to spend, so
   * on this BUDGET (not a fiscal invoice) it counts toward the VAT total and the
   * TTC, shown per line as "amount (PT)" and named in a remarks line. The stored
   * total_vat already includes it.
   */
  if (docType === "COSTING") {
    const { rows } = await client.query(
      `SELECT c.*,
              d.ref AS dossier_ref, d.entity_id, d.bl_mawb, d.pol, d.pod, d.eta, d.incoterm,
              cm.name AS client_name, cm.niu AS client_niu, cm.rccm AS client_rccm,
              st.name_en AS service_name_en, st.name_fr AS service_name_fr,
              rp.name AS rate_provider_name,
              COALESCE(e_v.signatory_name, v.full_name) AS validator_name, e_v.job_title AS validator_title,
              COALESCE(e_vb.signatory_name, vb.full_name) AS validated_by_name, e_vb.job_title AS validated_by_title,
              COALESCE(e_a.signatory_name, ap.full_name) AS approver_name, e_a.job_title AS approver_title
         FROM costing c
         LEFT JOIN dossier d ON d.dossier_id = c.dossier_id
         LEFT JOIN client_master cm ON cm.client_id = d.client_id
         LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
         LEFT JOIN rate_provider rp ON rp.rate_provider_id = d.rate_provider_id
         LEFT JOIN app_user v  ON v.user_id  = c.validator_id
         LEFT JOIN app_user vb ON vb.user_id = c.validated_by
         LEFT JOIN app_user ap ON ap.user_id = c.approver_id
         -- The title is on employee, not on app_user — the join every other
         -- projection in this file makes (CASH_REQUEST, PURCHASE_REQUEST, the
         -- invoice pair). signatory_name is the name a person wants ON PAPER,
         -- which is not always the one they log in under.
         LEFT JOIN employee e_v  ON e_v.employee_id  = v.employee_id
         LEFT JOIN employee e_vb ON e_vb.employee_id = vb.employee_id
         LEFT JOIN employee e_a  ON e_a.employee_id  = ap.employee_id
        WHERE c.costing_id = $1`,
      [recordId],
    );
    const c = rows[0];
    if (!c) return null;

    // The line reader the worksheet itself uses — container type, item code,
    // the line's own VAT rate and its pass-through nature, in `line_no` order.
    // Reading `costing_line` directly here would be a second, poorer copy of a
    // query that already exists, and it is the copy that would drift.
    const costingRepo = require("../../costing/costing/costing.repo");
    const lines = await costingRepo.listLines(client, recordId);

    // Frozen for an approved sheet, live for one still being worked on — the
    // rule the transit order follows above, for the same reason.
    let details = c.shipment_details_snapshot || null;
    if (!details && c.dossier_id) {
      try {
        const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");
        details = await shipmentDetails.forDossier(client, c.dossier_id);
      } catch (err) {
        // A file whose service type has lost its field set must still PRINT.
        logger.warn({ err, costing_id: recordId }, "[documents] costing printed without shipment details");
      }
    }

    // Lazy require (the transit-order branch's pattern): pulling the costing
    // rules at module load would force every test that mocks this service's
    // collaborators to know about them.
    const rules = require("../../costing/costing/costing.rules");
    // 12766 persisted these. The recompute is the fallback for a row written
    // before it, never the preference — see the header.
    const stored = c.total_ttc !== null && c.total_ttc !== undefined;
    const computed = stored ? null : rules.computeCosting(lines);
    const totals = stored
      ? {
        total_ht: Number(c.total_ht || 0),
        vat_total: Number(c.total_vat || 0),
        total_ttc: Number(c.total_ttc || 0),
        disbursement_total: lines.reduce((a, l) => a + (l.is_disbursement ? Number(l.qty) * Number(l.unit_cost) : 0), 0),
        upstream_vat_total: lines.reduce((a, l) => a + (l.is_disbursement ? Number(l.upstream_vat_amount || 0) : 0), 0),
      }
      : {
        total_ht: computed.total_ht,
        vat_total: computed.vat_total,
        total_ttc: computed.total_ttc,
        disbursement_total: computed.disbursement_total,
        upstream_vat_total: computed.upstream_vat_total,
      };

    // Best-effort, like every other derivation on this path: a sheet whose
    // snapshot cannot be read must still PRINT.
    let amendment = null;
    try {
      const snapshot = await costingRepo.latestSnapshot(client, recordId);
      if (snapshot) {
        const diff = rules.diffLines(snapshot.lines || [], lines);
        if (diff.has_changes) {
          amendment = { ...diff, since_revision: snapshot.revision, approved_at: snapshot.approved_at };
        }
      }
    } catch (err) {
      logger.warn({ err, costing_id: recordId }, "[documents] costing printed without its amendment summary");
    }

    return {
      entity_id: c.entity_id || null,
      data: {
        number: c.doc_number || String(c.costing_id).slice(0, 8),
        date: c.created_at,
        status: c.status,
        // A PAIR, never a pre-joined bilingual string — the transit order's
        // lesson: a projection that joins the two halves leaves `cfg.language`
        // nothing to decide.
        status_words: rules.statusWords(c.status),
        dossier_ref: c.dossier_ref,
        service: { fr: c.service_name_fr || c.service_name_en || "", en: c.service_name_en || c.service_name_fr || "" },
        carrier: c.rate_provider_name || null,
        incoterm: c.incoterm || null,
        bl_mawb: c.bl_mawb || null,
        pol: c.pol || null,
        pod: c.pod || null,
        eta: c.eta || null,
        // The counterparty, in the shape canonical.js hashes and the portal reads.
        party: {
          name: c.client_name || "—",
          lines: clientLines(c),
        },
        client: c.client_name || "—",
        shipment: details || null,
        validator: c.validator_name,
        validator_title: c.validator_title || null,
        validated_by_name: c.validated_by_name || null,
        validated_by_title: c.validated_by_title || null,
        validated_at: c.validated_at || null,
        approved_by_name: c.approver_name || null,
        approved_by_title: c.approver_title || null,
        approved_at: c.approved_at || null,
        remarks: c.remarks,
        // What moved since the last approval. On paper for the same reason it
        // is on screen: after an unlock somebody is asked to approve the sheet
        // a second time, and three changed lines are a shorter read than
        // fourteen unchanged ones. Derived, never attested — it is deliberately
        // NOT in the canonical payload, because it describes the diff rather
        // than the commitment.
        amendment,
        exchange_rate: Number(c.exchange_rate_to_xaf),
        lines: lines.map((l) => ({
          label: l.label,
          item_code: l.item_code || null,
          // D10: the equipment a per-container charge was priced FOR. A sheet
          // with "Demurrage" twice and no box named is unreadable — and
          // demurrage IS one line per container type.
          container_type: l.container_type_code || null,
          qty: Number(l.qty),
          unit: Number(l.unit_cost),
          tax: l.is_disbursement ? null : (l.tax_rate_percent !== null && l.tax_rate_percent !== undefined ? Number(l.tax_rate_percent) : null),
          is_disbursement: l.is_disbursement === true,
          // 12768: the supplier's VAT on a débours, now budgeted into the sheet's
          // VAT total (the stored total_vat already includes it). Shown on the
          // line as "amount (PT)"; a remarks line explains it.
          upstream_vat: l.is_disbursement && l.upstream_vat_amount !== null && l.upstream_vat_amount !== undefined
            ? Number(l.upstream_vat_amount)
            : null,
          amount: Number(l.qty) * Number(l.unit_cost),
        })),
        totals,
        amount_in_words: totals.total_ttc,
        currency: c.currency,
      },
    };
  }

  if (docType === "REGIE_ADVANCE") {
    const { rows } = await client.query("SELECT * FROM regie_advance WHERE regie_advance_id = $1", [recordId]);
    const ra = rows[0];
    if (!ra) return null;
    return { entity_id: null, data: { number: String(ra.regie_advance_id).slice(0, 8), date: ra.issued_on || ra.created_at, status: ra.state, amount: Number(ra.amount), party: { name: "—", lines: [] }, currency: null } };
  }

  if (docType === "WORK_ORDER") {
    const { rows } = await client.query(
      "SELECT wo.*, v.registration FROM work_order wo LEFT JOIN vehicle v ON v.vehicle_id = wo.vehicle_id WHERE wo.work_order_id = $1",
      [recordId],
    );
    const wo = rows[0];
    if (!wo) return null;
    const lr = await client.query("SELECT * FROM work_order_part WHERE work_order_id = $1 ORDER BY work_order_part_id", [recordId]);
    const parts = lr.rows.map((p) => ({ label: p.label, qty: Number(p.qty), unit_cost: Number(p.unit_cost) }));
    const cost = wo.cost !== null && wo.cost !== undefined ? Number(wo.cost) : parts.reduce((s2, p) => s2 + p.qty * p.unit_cost, 0);
    return { entity_id: null, data: { number: String(wo.work_order_id).slice(0, 8), date: wo.opened_on || wo.created_at, status: wo.status, vehicle: wo.registration || "—", description: wo.description, parts, cost, currency: null } };
  }

  if (docType === "SOP_DOCUMENT") {
    const { rows } = await client.query("SELECT * FROM sop_document WHERE sop_document_id = $1", [recordId]);
    const d = rows[0];
    if (!d) return null;
    /*
     * `sections` is cut from `body_md` at its `##` headings by the SAME helper
     * the contract renderer uses, and for the same reason: what a person edited
     * on screen must be what the printed document is divided into. An SOP with
     * no body renders as a letterhead and a sign-off block with nothing between
     * them — which is exactly the defect 0700 found in contracts, so the screen
     * refuses to render a PDF for an SOP that has no text rather than producing
     * a convincing empty procedure.
     */
    return {
      entity_id: null,
      data: {
        number: String(d.sop_document_id).slice(0, 8),
        title: d.title,
        scope: d.scope,
        department: d.department,
        version: d.version_no,
        effective_on: d.effective_on,
        review_on: d.review_on,
        sections: contractArticles(d.body_md),
        currency: null,
      },
    };
  }

  if (docType === "EMPLOYMENT_CONTRACT") {
    const { rows } = await client.query(
      `SELECT c.*, e.full_name, e.job_title AS employee_job_title, coalesce(c.entity_id, e.entity_id) AS entity_id
         FROM hr_contract c LEFT JOIN employee e ON e.employee_id = c.employee_id
        WHERE c.hr_contract_id = $1`,
      [recordId],
    );
    const c = rows[0];
    if (!c) return null;
    /*
     * `articles` used to be a hard-coded `[]`.
     *
     * The template renders one "Article N — <title>" section per entry, so an
     * empty list produced a contract with a letterhead, the two parties, a
     * signature block — AND NO CLAUSES. Every employment contract this system
     * has ever generated was a blank form. Nobody caught it because the PDF
     * looks entirely correct until you read it.
     *
     * `body_md` (0700) is the agreed text, drafted by the model or the
     * template and then edited by a human. `contractArticles` cuts it at its
     * `##` headings, which is exactly the shape the renderer wants.
     */
    return {
      entity_id: c.entity_id,
      data: {
        // The tenant's allocated CTR number (11743). The id fragment stays as
        // the fallback ONLY for contracts issued before numbering existed —
        // it is a last resort, not the design.
        number: c.doc_number || String(c.hr_contract_id).slice(0, 8),
        status: c.status,
        kind: c.kind,
        effective_on: c.effective_on,
        end_on: c.end_on,
        employee_name: c.full_name || "—",
        job_title: c.job_title || c.employee_job_title,
        party: { name: c.full_name || "—", lines: [c.job_title || c.employee_job_title].filter(Boolean) },
        articles: contractArticles(c.body_md),
        // The terms, so a template that wants them beside the clauses has them
        // rather than having to parse the prose back out.
        gross_salary: c.gross_salary === null || c.gross_salary === undefined ? null : Number(c.gross_salary),
        probation_months: c.probation_months,
        probation_ends_on: c.probation_ends_on,
        notice_days: c.notice_days,
        working_hours: c.working_hours,
        place_of_work: c.place_of_work,
        signed_on: c.signed_on,
        signed_vault_id: c.pdf_vault_id || null,
        currency: c.salary_currency || "XAF",
      },
    };
  }

  if (docType === "DELIVERY_NOTE") return deliveryNoteData(client, recordId);

  if (docType === "TRANSIT_ORDER") return transitOrderData(client, recordId);

  if (docType === "GRN") {
    const { rows } = await client.query("SELECT * FROM grn_inbound WHERE grn_inbound_id = $1", [recordId]);
    const g = rows[0];
    if (!g) return null;
    const lr = await client.query("SELECT item, ordered, received, condition FROM grn_line WHERE grn_inbound_id = $1 ORDER BY grn_line_id", [recordId]);
    return { entity_id: null, data: { number: String(g.grn_inbound_id).slice(0, 8), date: g.created_at, po_ref: g.dossier_id ? String(g.dossier_id).slice(0, 8) : null, qa_status: g.qa_status, supplier: "—", lines: lr.rows.map((l) => ({ item: l.item, ordered: String(Number(l.ordered)), received: String(Number(l.received)), condition: l.condition || "" })), currency: null } };
  }

  if (docType === "GOODS_RECEIVED") {
    const { rows } = await client.query(
      `SELECT grn.*, po.doc_number AS po_doc_number, po.currency AS po_currency,
              sm.name AS supplier_name, sm.address AS supplier_address, sm.city AS supplier_city, sm.niu AS supplier_niu,
              COALESCE(e_r.signatory_name, au_r.full_name) AS received_by_name,
              e_r.job_title AS received_by_title
         FROM goods_received_note grn
         LEFT JOIN purchase_order po ON po.po_id = grn.po_id
         LEFT JOIN supplier_master sm ON sm.supplier_id = po.supplier_id
         LEFT JOIN app_user au_r ON au_r.user_id = grn.received_by
         LEFT JOIN employee e_r ON e_r.employee_id = au_r.employee_id
        WHERE grn.grn_id = $1`,
      [recordId],
    );
    const g = rows[0];
    if (!g) return null;
    const lr = await client.query("SELECT * FROM goods_received_line WHERE grn_id = $1 ORDER BY grn_line_id", [recordId]);
    return {
      entity_id: g.entity_id || null,
      data: {
        number: g.doc_number || String(g.grn_id).slice(0, 8),
        date: g.received_on || g.created_at,
        po_ref: g.po_doc_number || (g.po_id ? String(g.po_id).slice(0, 8) : null),
        supplier_invoice_ref: g.supplier_invoice_ref,
        supplier: g.supplier_name || "—",
        supplier_lines: [g.supplier_address, g.supplier_city, g.supplier_niu && `NIU ${g.supplier_niu}`].filter(Boolean),
        note: g.note,
        received_by_name: g.received_by_name || null,
        received_by_title: g.received_by_title || null,
        lines: lr.rows.map((l) => ({ item: l.label, ordered: String(Number(l.ordered)), received: String(Number(l.received)), condition: l.condition || "" })),
        currency: g.po_currency || "XAF",
      },
    };
  }

  if (docType === "CYCLE_COUNT_SHEET") {
    const { rows } = await client.query("SELECT * FROM cycle_count WHERE cycle_count_id = $1", [recordId]);
    const cc = rows[0];
    if (!cc) return null;
    const raw = cc.discrepancy;
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.lines) ? raw.lines : []);
    // Discrepancy lines carry inventory_item_id; resolve to a human sku/description.
    const ids = arr.map((l) => l.inventory_item_id).filter(Boolean);
    const nameById = {};
    if (ids.length) {
      const im = await client.query("SELECT inventory_item_id, sku, description FROM inventory_item WHERE inventory_item_id = ANY($1)", [ids]);
      for (const r of im.rows) nameById[r.inventory_item_id] = r.description || r.sku || String(r.inventory_item_id).slice(0, 8);
    }
    const lines = arr.map((l) => ({
      item: l.item || l.label || nameById[l.inventory_item_id] || (l.inventory_item_id ? String(l.inventory_item_id).slice(0, 8) : "—"),
      expected: String(l.expected ?? ""), counted: String(l.counted ?? ""),
      variance: String(l.variance ?? (Number(l.counted || 0) - Number(l.expected || 0))),
    }));
    const locRow = cc.location_id ? await client.query("SELECT zone FROM warehouse_location WHERE location_id = $1", [cc.location_id]).then((x) => x.rows[0]).catch(() => null) : null;
    const location = (locRow && locRow.zone) || (cc.location_id ? String(cc.location_id).slice(0, 8) : "—");
    return { entity_id: null, data: { number: String(cc.cycle_count_id).slice(0, 8), date: cc.created_at, location, lines, currency: null } };
  }

  if (docType === "TRIP_SHEET") {
    const { rows } = await client.query(
      "SELECT d.*, v.registration, e.full_name AS driver_name FROM fleet_dispatch d LEFT JOIN vehicle v ON v.vehicle_id = d.vehicle_id LEFT JOIN employee e ON e.employee_id = d.driver_employee_id WHERE d.fleet_dispatch_id = $1",
      [recordId],
    );
    const d = rows[0];
    if (!d) return null;
    const dist = d.odometer_out !== null && d.odometer_in !== null && d.odometer_out !== undefined && d.odometer_in !== undefined ? Number(d.odometer_in) - Number(d.odometer_out) : null;
    return { entity_id: null, data: { number: String(d.fleet_dispatch_id).slice(0, 8), date: d.check_out_at || d.created_at, vehicle: d.registration || "—", driver: d.driver_name || "—", origin: "", destination: "", odometer_out: d.odometer_out, odometer_in: d.odometer_in, distance: dist, currency: null } };
  }

  if (docType === "PAYSLIP") {
    const { rows } = await client.query(
      "SELECT i.*, r.period_code, r.entity_id, e.full_name, e.job_title, e.cnps_number FROM payroll_run_item i " +
        "JOIN payroll_run r ON r.payroll_run_id = i.payroll_run_id LEFT JOIN employee e ON e.employee_id = i.employee_id WHERE i.payroll_run_item_id = $1",
      [recordId],
    );
    const it = rows[0];
    if (!it) return null;
    const b = it.breakdown || {};
    const ded = b.employee || {};
    const earnings = [{ label: "Salaire de base", amount: Number(b.base || 0) }].concat(
      (b.earning_lines || []).map((l) => ({ label: l.label || "Prime", amount: Number(l.amount || 0) })),
    );
    const deductions = [
      { label: "CNPS pension", amount: Number(ded.cnps_pension || 0) },
      { label: "IRPP", amount: Number(ded.irpp || 0) },
      { label: "CAC", amount: Number(ded.cac || 0) },
      { label: "CFC", amount: Number(ded.cfc || 0) },
    ].filter((d) => d.amount);
    const totalDed = deductions.reduce((s2, d) => s2 + d.amount, 0);
    return {
      entity_id: it.entity_id,
      data: {
        number: String(it.payroll_run_item_id).slice(0, 8), period: it.period_code, staff_no: null,
        employee_name: it.full_name || "—", job_title: it.job_title, cnps_number: it.cnps_number,
        earnings, deductions, gross: Number(it.gross), total_deductions: totalDed, net: Number(it.net_pay), currency: null,
      },
    };
  }

  return null;
}

// Each sendable docType → the SQL that yields its recipient email from the
// party master (client/supplier/employee) or a CRM lead. $1 is the record id.
const RECIPIENT_SQL = {
  FINAL_INVOICE: "SELECT cm.email FROM invoice i JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
  CREDIT_NOTE: "SELECT cm.email FROM invoice i JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
  QUOTATION: "SELECT cm.email FROM quotation q JOIN client_master cm ON cm.client_id = q.client_id WHERE q.quotation_id = $1",
  PAYMENT_RECEIPT: "SELECT cm.email FROM payment_receipt r JOIN client_master cm ON cm.client_id = r.client_id WHERE r.receipt_id = $1",
  PROFORMA_ADVANCE: "SELECT cm.email FROM advance a JOIN client_master cm ON cm.client_id = a.client_id WHERE a.advance_id = $1",
  PROPOSAL: "SELECT COALESCE(l.email, cm.email) AS email FROM proposal p LEFT JOIN lead l ON l.lead_id = p.lead_id LEFT JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1",
  PURCHASE_ORDER: "SELECT sm.email FROM purchase_order po JOIN supplier_master sm ON sm.supplier_id = po.supplier_id WHERE po.po_id = $1",
  SUPPLIER_INVOICE: "SELECT sm.email FROM supplier_invoice si JOIN supplier_master sm ON sm.supplier_id = si.supplier_id WHERE si.supplier_invoice_id = $1",
  EMPLOYMENT_CONTRACT: "SELECT e.email FROM hr_contract c JOIN employee e ON e.employee_id = c.employee_id WHERE c.hr_contract_id = $1",
  PAYSLIP: "SELECT e.email FROM payroll_run_item i JOIN employee e ON e.employee_id = i.employee_id WHERE i.payroll_run_item_id = $1",
  // Consignee/carrier aren't emailable masters, so resolve to the dossier's
  // client (the served party); the Send prompt stays editable for a different one.
  DELIVERY_NOTE: "SELECT cm.email FROM delivery_note dn JOIN dossier d ON d.dossier_id = dn.dossier_id JOIN client_master cm ON cm.client_id = d.client_id WHERE dn.delivery_note_id = $1",
  TRANSIT_ORDER: "SELECT cm.email FROM transit_order t JOIN dossier d ON d.dossier_id = t.dossier_id JOIN client_master cm ON cm.client_id = d.client_id WHERE t.transit_order_id = $1",
};

/** Best-effort recipient email for a record, resolved from the party master
 *  (client/supplier/employee) or a CRM lead. Returns null when none is stored →
 *  the caller falls back to a manually-supplied address. */
async function resolveRecipient(client, docType, recordId) {
  if (!recordId || !RECIPIENT_SQL[docType]) return null;
  try {
    const { rows } = await client.query(RECIPIENT_SQL[docType], [recordId]);
    return (rows[0] && rows[0].email) || null;
  } catch { /* @silent:parse — resolving a recipient is a convenience lookup over a
    per-doc-type SQL map; a missing table or a renamed column must degrade to
    "caller supplies `to`", never fail the send. The caller already handles null
    by requiring an explicit recipient. */ }
  return null;
}

/**
 * The signatures a rendered document should carry a QR for, newest first.
 *
 * Revoked rows are excluded: the portal keeps answering "revoked" for a PDF
 * printed before the revocation (that is the whole point of not deleting the
 * row), but a document rendered AFTER it must not advertise a credential the
 * tenant has withdrawn.
 */
async function activeSignatures(client, entityRef) {
  if (!entityRef) return [];
  try {
    const sigRepo = require("../../vault/document_signature/document_signature.repo");
    const rows = await sigRepo.listByRef(client, entityRef);
    return rows.filter((r) => !r.revoked_at);
  } catch (err) {
    // Best-effort by design: a document must still render when the signature
    // table cannot be read. It renders WITHOUT a QR, which is honest — an
    // unverifiable document showing no verification block is correct, and is
    // the failure this whole chapter exists to stop pretending otherwise.
    logger.warn({ err: err && err.message, entity_ref: entityRef }, "could not resolve signatures for render");
    return [];
  }
}

/**
 * The verification block for a document, or null when it carries no signature.
 *
 * An UNSIGNED document gets no QR. That is deliberate and it is the honest
 * answer: there is nothing to verify, so printing a symbol that resolves to a
 * 404 would teach readers that the tenant's QRs do not work — which costs more
 * than the blank space saves.
 */
async function wetPrintBlockFor(client, { entityRef }) {
  if (!entityRef) return null;
  try {
    const { rows: flagRows } = await client.query(
      "SELECT 1 FROM feature_state WHERE feature_key = 'signatures.wet' AND state = 'on' LIMIT 1",
    );
    if (!flagRows[0]) return null;
    const wetRepo = require("../../vault/signature_wet/signature_wet.repo");
    const barcode = require("../../../services/signatures/barcode");
    const job = await wetRepo.openJobForEntity(client, entityRef);
    if (!job) return null;
    return {
      code: job.print_code,
      svg: await barcode.generateSvg(job.print_code),
      reprintNo: job.reprint_no,
    };
  } catch (err) {
    logger.warn({ err: err && err.message, entity_ref: entityRef }, "wet-signature barcode could not be rendered");
    return null;
  }
}

/**
 * The seals a rendered document should carry, in print order.
 *
 * Handed to the template as `data.seals`. A template that does not know about
 * seals simply ignores the key, which is why this can be resolved once here
 * rather than per doc type — the placement decision the guide's delivery table
 * deferred is the TEMPLATE's, and there is now one template making it.
 *
 * Best-effort, like everything else on this path: no seals is the same page a
 * tenant with no signatures gets.
 */
async function sealsFor(client, { entityRef, entity, data, cfg, origin = null, signatures = null }) {
  if (!entityRef || !cfg || !cfg.show || !cfg.show.signature) return [];
  try {
    const rows = signatures || (await activeSignatures(client, entityRef));
    if (!rows.length) return [];
    return await sealView.build(client, rows, {
      entity,
      docRef: (data && data.number) || "",
      // A bilingual document seals in French: the seal is a sentence, not a
      // label pair, and `sealBlock` has no stacked form to render both in.
      language: cfg.language === "en" ? "en" : "fr",
      origin,
    });
  } catch (err) {
    logger.warn({ err: err && err.message, entity_ref: entityRef }, "seals could not be resolved for render");
    return [];
  }
}

async function verifyBlockFor(client, { entityRef, origin = null, signatures = null }) {
  const rows = signatures || (await activeSignatures(client, entityRef));
  if (!rows.length) return null;
  try {
    return await verifyLink.verifyContext(client, { code: rows[0].verify_code, origin });
  } catch (err) {
    logger.warn({ err: err && err.message, entity_ref: entityRef }, "verification block could not be rendered");
    return null;
  }
}

/** Live preview → HTML (no PDF). Real record when recordId + a loader exist, else sample. */
async function preview(client, { docType, entityId, recordId, config, origin = null, language = null }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  let data = tpl.sampleData;
  let ent = entityId;
  let real = false;
  /*
   * The ref the verification block is looked up under.
   *
   * Set INSIDE the `if (rec)` — that is, only once a real record has come back
   * from the database — rather than derived from `recordId` at the call site.
   *
   * The first version read `real && recordId ? await verifyBlockFor(…) : null`,
   * and CodeQL was right about it (js/user-controlled-bypass, High): whether a
   * verification block renders is a security-relevant decision, and that
   * expression let a request-body value be the thing deciding it. Hanging the
   * ref off the loaded record inverts it — the guard is now a database result,
   * and `recordId` is only ever part of a VALUE. A null ref returns no block,
   * because `activeSignatures` finds nothing to look up.
   *
   * The behaviour it protects is unchanged and worth stating: a preview that
   * fell back to SAMPLE data must not carry a real document's QR, because the
   * figures on the page would not be the figures that were signed.
   */
  let signedRef = null;
  if (recordId) {
    const rec = await loadRecord(client, docType, recordId);
    if (rec) {
      data = rec.data;
      ent = ent || rec.entity_id;
      real = true;
      signedRef = `${docType.toLowerCase()}:${recordId}`;
    }
  }
  const { cfg, entity } = await resolveCfg(client, docType, ent, config, { language });
  cfg.wet_print = await wetPrintBlockFor(client, { entityRef: signedRef });
  const verify = await verifyBlockFor(client, { entityRef: signedRef, origin });
  // The preview must show the seal the PDF will carry, or the operator checks
  // one document and sends another.
  const seals = await sealsFor(client, { entityRef: signedRef, entity, data, cfg, origin });
  const shown = seals.length ? { ...data, seals } : data;
  return {
    html: tpl.build(shown, cfg, entity, verify),
    sample: !real,
    data: shown, // structured data for the native (app-themed) detail view
    language: cfg.language,
    title: tpl.title,
    entity: { legal_name: entity.legal_name, niu: entity.niu, rccm: entity.rccm },
    /* `suggested_to` was here, and it is gone: it existed to seed the default
       of `window.prompt("Send document to (email):")`, and the composer now
       resolves the recipient properly — with the party's NAME and their
       contacts, not one bare address (see composePrefill). Every preview was
       paying a party-master lookup for it. */
    report: !!tpl.report,
  };
}

/**
 * Render a real, immutable, vaulted PDF for a record.
 *
 * ── The ordering that makes verification possible ──────────────────────────
 * The verify code is minted at SIGNING time (PR-1), so it exists before this
 * function runs and can be printed into the bytes. The artifact hash is the
 * sha256 of those bytes and therefore only exists afterwards, so it is written
 * BACK onto the signature rows once the render has landed. Two hashes, two
 * moments — and neither one has to be inside the document it describes, which
 * is the circularity that made every previous Praxis PDF unverifiable
 * (services/signatures/canonical.js).
 *
 * `origin` is the host the QR should resolve on. The HTTP path passes the
 * request's own host; the worker passes the tenant's. See verify-link.js.
 */
async function generate(client, { docType, entityId, recordId, actor, origin = null, language = null }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const rec = recordId ? await loadRecord(client, docType, recordId) : null;
  const data = rec ? rec.data : tpl.sampleData;
  const ent = entityId || (rec && rec.entity_id);
  const { cfg, entity } = await resolveCfg(client, docType, ent, null, { language });
  const entityRef = `${docType.toLowerCase()}:${recordId || "adhoc"}`;
  const key = `documents/${docType}/${recordId || "adhoc"}-${Date.now()}.pdf`;
  // G2 — sandbox renders are watermarked TEST SANDBOX regardless of config.
  cfg.watermark = kit.watermarkFor(client, cfg.watermark);
  const signatures = await activeSignatures(client, entityRef);
  cfg.wet_print = await wetPrintBlockFor(client, { entityRef });
  const verify = await verifyBlockFor(client, { entityRef, origin, signatures });
  const seals = await sealsFor(client, { entityRef, entity, data, cfg, origin, signatures });
  const html = tpl.build(seals.length ? { ...data, seals } : data, cfg, entity, verify);
  const out = await pdf.renderAndStore(client, { html, key, entityRef, docType, actor });
  await recordArtifact(client, signatures, out);
  return out;
}

/**
 * Write the rendered artifact back onto every signature the document carries.
 *
 * Best-effort: the PDF exists and is vaulted by the time this runs, so a
 * failure here must not lose it. The consequence of a miss is narrow and
 * self-healing — the portal reports the artifact verdict as "not recorded"
 * rather than wrongly, and the next render fills it in.
 */
async function recordArtifact(client, signatures, out) {
  if (!signatures || !signatures.length || !out) return;
  const sigRepo = require("../../vault/document_signature/document_signature.repo");
  for (const sig of signatures) {
    try {
      await sigRepo.setArtifact(client, {
        id: sig.signature_id, documentVaultId: out.doc_id, artifactHash: out.content_hash,
      });
    } catch (err) {
      logger.warn({ err: err && err.message, signature_id: sig.signature_id }, "artifact hash write-back failed");
    }
  }
}

/** Render a branded PDF from already-computed data (reports / tax filings, which
 *  are parameterized rather than record-based). Resolves the doc's config +
 *  entity, builds via the registry, and vaults the PDF. */
async function renderPdfFromData(client, { docType, data, entityId, actor }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const { cfg, entity } = await resolveCfg(client, docType, entityId);
  const stamp = Date.now();
  const entityRef = `${docType.toLowerCase()}:${stamp}`;
  const key = `documents/${docType}/${stamp}.pdf`;
  // G2 — sandbox renders are watermarked TEST SANDBOX regardless of config.
  cfg.watermark = kit.watermarkFor(client, cfg.watermark);
  // No verification block: this path renders from computed data under a
  // timestamped ref that no signature can point at. A report is not a signed
  // document, and printing a QR on one would resolve to nothing.
  const html = tpl.build(data, cfg, entity, null);
  return pdf.renderAndStore(client, { html, key, entityRef, docType, actor });
}

/** Send a document to a recipient: render it, attach the PDF (falling back to
 *  inline HTML if the render fails), then vault a PDF copy (best-effort) and
 *  audit. `to` is resolved from the record where possible (e.g. a proposal's
 *  lead) and otherwise supplied by the caller. */
async function send(client, { docType, entityId, recordId, to, subject, actor = {}, origin = null, language = null }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const recipient = to || (await resolveRecipient(client, docType, recordId));
  if (!recipient) throw new AppError("NO_RECIPIENT", "recipient email 'to' is required", 422);
  const { html } = await preview(client, { docType, entityId, recordId, origin, language });
  const title = (tpl.title && (tpl.title.en || tpl.title.fr)) || docType;

  // Attach the rendered PDF so the recipient gets a real document, not just an
  // inline HTML body. Best-effort: if Puppeteer fails, still send inline.
  let attachments = null;
  try {
    const buffer = await pdf.renderHtml(html);
    if (buffer && buffer.length) attachments = [{ filename: `${docType.toLowerCase()}.pdf`, content: buffer, contentType: "application/pdf" }];
  } catch { /* @silent:storage — the PDF render needs headless Chrome, which is the
    one dependency that is routinely absent on a fresh deploy (see
    doc/PDF_RENDERING_SETUP.md). The email still goes, with the document inline;
    losing the attachment is strictly better than not sending it. */ }

  await emailSvc.send(client, {
    to: recipient, subject: subject || title, html, attachments, purpose: "NOTIFICATIONS", moduleKey: "MOD-70",
    // §3.5 — every generated document emailed from its record. This is the send
    // point a group most wants bound PER CORPORATE ENTITY, so each company's
    // paperwork leaves from that company's address; `entityId` is what lets
    // `sendpoint.service` answer at that tier rather than tenant-wide.
    sendPoint: "document.share", entityId: entityId || null,
    // Record the source document on the send-log row (e.g. `invoice:<id>`).
    entityRef: entityId || recordId ? `${String(docType).toLowerCase()}:${entityId || recordId}` : null,
  });
  try { await generate(client, { docType, entityId, recordId, actor, language }); } catch { /* @silent:storage —
    the email has already been sent by this point. Filing a vault copy is
    bookkeeping; failing here would report the send as failed and invite somebody
    to send it twice. */ }
  await audit(client, { actorUserId: actor.user_id || null, action: "document.sent", moduleKey: "MOD-70", entityRef: `${docType.toLowerCase()}:${recordId || "adhoc"}`, after: { to: recipient, docType, attached: !!attachments } });
  return { sent: true, to: recipient, docType, attached: !!attachments };
}


/**
 * Everything the composer needs to open on a document, in one round trip.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  THIS REPLACES `window.prompt("Send document to (email):")`.
 *
 *    That prompt was the entire send UI: one address, no cc, no subject, no
 *    body, no chance to read what was about to go out, and it fired a
 *    transactional system email that never appeared in the sender's own Sent
 *    folder. A document going to a client is CORRESPONDENCE — it belongs in
 *    the thread with everything else that client was told.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the PDF is vaulted here rather than attached by the client ─────────
 * The composer attaches from the vault by id (`/mail/attachments/from-vault`),
 * so the file has to exist before the draft can reference it. Rendering it here
 * also means the attachment is the SAME artifact the Download button produces
 * and the same one the signature engine writes its artifact hash against —
 * rather than a second render that could differ from what was signed.
 *
 * ── The language is the operator's, chosen at this moment ─────────────────
 * The document, its subject line and its body all come out in one language,
 * decided by the toggle on the document page when they press Send. A French
 * client gets a French sheet under a French subject; that is one decision, made
 * once, and this is where it is applied.
 *
 * ── The counterparty is offered regardless of the caller's party grants ────
 * `signature_request.candidates` resolves who this document is ABOUT — the
 * client on the file, and their contacts. Those addresses come from THIS
 * RECORD, not from a search, so an operations clerk who may raise a transit
 * order but may not browse the client register can still email it to the client
 * it is addressed to. The recipient PICKER is gated separately and stays gated
 * (see mail.service.searchRecipients); this is the one address the document
 * itself supplies.
 */
async function composePrefill(client, { docType, recordId, entityId = null, actor = {}, origin = null, language = null }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  if (!recordId) throw new AppError("VALIDATION_ERROR", "record_id is required", 422);

  const rec = await loadRecord(client, docType, recordId);
  if (!rec) throw new AppError("NOT_FOUND", `No ${docType} ${recordId}`, 404);
  const data = rec.data;
  const ent = entityId || rec.entity_id;
  const { cfg, entity } = await resolveCfg(client, docType, ent, null, { language });

  // The artifact, vaulted. Not best-effort: a compose window that opens with
  // nothing attached is worse than an error, because the operator will write
  // the covering note, press send, and only then discover the document is
  // missing — by which time it has gone.
  const artifact = await generate(client, { docType, entityId: ent, recordId, actor, origin, language });

  const copy = registry.emailCopy(docType, data, { language: cfg.language, entity }) || { subject: "", body: "" };

  let counterparty = null;
  try {
    const candidates = require("../../vault/signature_request/signature_request.candidates");
    counterparty = await candidates.counterpartyFor(client, { docType, entityRef: `${docType.toLowerCase()}:${recordId}` });
  } catch (err) {
    /* @silent:parse — the counterparty is a convenience prefill. Losing it
       opens the composer with an empty To field and the operator types or
       searches, which is exactly what happens for a doc type that has no
       counterparty at all. */
    logger.warn({ err: err && err.message, doc_type: docType }, "[documents] compose prefill without a counterparty");
  }

  // One address in `to`, and every address we hold offered beside it. The
  // primary contact wins over the party's generic mailbox when both exist —
  // `candidates` already orders them that way.
  const suggestions = (counterparty && counterparty.signatories) || [];
  const to = (suggestions[0] && suggestions[0].email)
    || (await resolveRecipient(client, docType, recordId))
    || null;

  return {
    doc_type: docType,
    record_id: recordId,
    language: cfg.language,
    vault_id: artifact.doc_id,
    filename: `${String(data.number || docType).replace(/[^\w.-]+/g, "-")}.pdf`,
    to,
    subject: copy.subject,
    body: copy.body,
    counterparty: counterparty
      ? {
        party_id: counterparty.party_id,
        party_name: counterparty.party_name,
        // `source_ref` is carried through so a later change can attribute the
        // address the same way a signature request does.
        contacts: suggestions.map((c) => ({
          name: c.full_name, email: c.email, role: c.party_role, source_ref: c.source_ref,
        })),
      }
      : null,
  };
}

/**
 * Split a contract body into the articles the template renders.
 *
 * Cuts on `##` headings — the shape both the AI drafter and the template
 * fallback produce (see hr_contract.draft). Text before the first heading is
 * kept as an untitled preamble rather than dropped: a human editing the body is
 * entitled to write a sentence at the top without it silently vanishing from
 * the PDF.
 */
function contractArticles(bodyMd) {
  if (!bodyMd || !String(bodyMd).trim()) return [];
  const out = [];
  let title = null;
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (title || body) out.push({ title: title || "", body });
    buf = [];
  };
  for (const line of String(bodyMd).split(/\r?\n/)) {
    const h = /^\s*#{2,3}\s+(.*\S)\s*$/.exec(line);
    if (h) {
      flush();
      title = h[1];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.filter((a) => a.title || a.body);
}

module.exports = {
  // Exported for the test that pins it — see tests/unit/contract-draft.
  contractArticles, list, getConfig, setConfig, records, preview, generate, renderPdfFromData, send, composePrefill,
  // Exported for document_signature.service, which needs the SAME record shape
  // the templates render from — hashing anything else would attest to a
  // projection of the document rather than the document (guide §3.6).
  loadRecord };
