/**
 * THE LETTERHEAD BLOCK MODEL — one definition of what a header and a footer are
 * made of, shared by everything that draws or measures one.
 *
 * WHY THIS FILE EXISTS. Before it, a letterhead was described three times:
 *
 *   · `kit.instrumentHead` / `kit.instrumentFoot` built the printed HTML for
 *     the transit order and the delivery note;
 *   · `kit.letterhead` / `kit.footer` built a DIFFERENT printed header for the
 *     other twenty-odd documents (comma-joined identity line, two hardcoded
 *     identifier labels — correct in exactly one country);
 *   · the entity dossier's Letterhead tab hand-drew a THIRD one in React, which
 *     is the one the tenant actually designs against.
 *
 * Three descriptions of one thing drift, and they had: the dossier preview
 * showed a payment block on documents that never print one, and the toggles it
 * saved reached nothing at all (see `template.service.resolveCfg` — it read the
 * settings store and never `entity_letterhead`). A tenant could switch the
 * share capital off and watch it keep printing.
 *
 * So the anatomy is stated ONCE, here, as data. `compose()` turns an entity's
 * stored facts plus its saved layout into an ordered list of resolved blocks;
 * `kit.standardHead`/`standardFoot` render that list to print HTML, the editor
 * renders the same list to a drag-and-drop canvas, and `measure()` turns it
 * into millimetres for the one-page fit model. Add a block here and all three
 * accommodate it, which is the property the whole design is for.
 *
 * PURE. No I/O and no HTML. The repo supplies rows, the kit supplies markup.
 * That is what lets the editor trust it and what makes it unit-testable.
 */
"use strict";

const lh = require("../../../modules/master/entity-letterhead.service");

/* ── zones ─────────────────────────────────────────────────────────────────
 * Two, and only two. A "body" zone was considered and dropped: the body is the
 * document's own business and every template already owns it. This file is the
 * SHELL — what wraps every document identically, which is the uniformity the
 * whole exercise is for. */
const ZONES = ["header", "footer"];

/* ── the grid ──────────────────────────────────────────────────────────────
 * Twelve columns, because it divides by 2, 3 and 4 — the only splits a
 * letterhead ever wants (logo | identity; three footer columns; a four-up
 * identifier row). Blocks carry {row, col, span}: `row` orders them down the
 * page, `col`+`span` place them across it.
 *
 * WHY A GRID AND NOT FREE x/y. The editor drags blocks; free pixel positioning
 * would let a tenant place two blocks so they overlap at their configured size
 * and then discover it only when a long legal name renders. On a grid, a block
 * that grows pushes its row taller and everything below it moves down — the
 * page stays correct at every value, which is what "exact" has to mean for a
 * template rendered against data nobody has seen yet. */
const COLS = 12;

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ── the catalogue ─────────────────────────────────────────────────────────
 * Every block a letterhead can carry. `derive` reads the entity bundle and
 * returns printable lines; returning [] means "switched on with nothing behind
 * it", which the editor surfaces rather than leaving as a silent blank.
 *
 * `source` is the DEEP LINK: which dossier tab and which field fixes this
 * block. It is the reason a tenant can click "NIU" on the canvas and land on
 * the input that sets it, instead of guessing which of eleven tabs owns it.
 *
 * `toggle` names the `entity_letterhead.show_*` column that governs the block,
 * where one exists — so the existing switches keep meaning what they meant.
 */
const CATALOGUE = [
  {
    id: "logo",
    zone: "header",
    label: { fr: "Logo", en: "Logo" },
    hint: { fr: "L'image de marque de l'entité.", en: "The entity's own mark." },
    source: { tab: "Letterhead", field: "logo" },
    // The mark is the one block whose height is SET rather than measured — see
    // `kit.headFixedMm`: an <img> constrained only by max-height contributes no
    // width to a flex item in Chrome, so it carries an explicit height in mm.
    fixed: true,
    derive: (b) => (b.logo_url ? [{ type: "image", src: b.logo_url }] : []),
    fallback: (b) => (b.entity.legal_name ? [{ type: "wordmark", text: b.entity.legal_name }] : []),
  },
  {
    id: "company_name",
    zone: "header",
    label: { fr: "Raison sociale", en: "Legal name" },
    hint: { fr: "Le nom sous lequel l'entité est immatriculée.", en: "The name the entity is registered under." },
    // Overview → About, where the dossier actually shows it. "Identity &
    // registrations" carries only the registrations table, so a link there
    // would land a tab away from the fact it claims to fix.
    source: { tab: "Overview", field: "contact" },
    derive: (b) => text(b.entity.legal_name),
  },
  {
    id: "company_line",
    zone: "header",
    label: { fr: "Forme et capital", en: "Legal form & capital" },
    hint: {
      fr: "« SARL au capital de 10 000 000 XAF » — mention obligatoire dans une grande partie de l'UE.",
      en: "\"SARL with share capital of 10,000,000 XAF\" — a mandatory mention across much of the EU.",
    },
    // Overview → Incorporation: legal form and share capital are shown there
    // together, which is also the pair this block prints.
    source: { tab: "Overview", field: "legal_form" },
    toggle: ["show_legal_form", "show_share_capital"],
    derive: (b) => text(companyQualifier(b)),
  },
  {
    id: "address",
    zone: "header",
    label: { fr: "Adresse du siège", en: "Registered address" },
    hint: { fr: "Le siège statutaire, pas le lieu d'exploitation.", en: "The statutory office, not the trading one." },
    source: { tab: "Contacts & addresses", field: "address_registered" },
    toggle: ["show_registered_address"],
    // The BLOCK shape (street, then PO box + postcode + city + country), not the
    // comma-joined line — `entity-letterhead.service` owns both and this is the
    // one somebody would write on an envelope.
    derive: (b) => lines(b.entity.address_lines),
    /*
     * The legacy free-text `corporate_entity.address` column, split on the
     * tenant's own line breaks.
     *
     * LOAD-BEARING, NOT DECORATION. The documents were the last surface reading
     * that column, and a tenant who has never filled in the structured
     * `entity_address` row must keep the letterhead they have — dropping this
     * would blank the address on every document such a tenant prints, silently,
     * on deploy day.
     */
    fallback: (b) => lines(String(b.entity.address || "").split(/\r?\n/)),
  },
  {
    id: "contact",
    zone: "header",
    label: { fr: "Téléphone, e-mail, site", en: "Phone, email, website" },
    hint: { fr: "", en: "" },
    source: { tab: "Overview", field: "contact" },
    toggle: ["show_contact"],
    derive: (b) => text(join([b.entity.phone, b.entity.email, b.entity.website])),
  },
  {
    id: "header_note",
    zone: "header",
    label: { fr: "Note d'en-tête", en: "Header note" },
    hint: { fr: "Une accroche. Ce qui ne se déduit pas.", en: "A strapline. What cannot be derived." },
    source: { tab: "Letterhead", field: "header_note" },
    authored: true,
    derive: (b) => text(b.pick(b.config.header_note_fr, b.config.header_note_en)),
  },
  {
    id: "rule",
    zone: "header",
    label: { fr: "Filet", en: "Accent rule" },
    hint: { fr: "Le trait de couleur sous l'en-tête.", en: "The colour rule under the header." },
    source: { tab: "Letterhead", field: "brand_color" },
    // A rule is never "empty": it is a line, it always prints, and reporting it
    // as an empty block would train the tenant to ignore the warning that
    // matters.
    always: true,
    fixed: true,
    derive: () => [{ type: "rule" }],
  },

  {
    id: "foot_company",
    zone: "footer",
    label: { fr: "Raison sociale (pied)", en: "Legal name (foot)" },
    hint: { fr: "Qui émet le document, légalement.", en: "Who issues the document, legally." },
    source: { tab: "Overview", field: "legal_form" },
    derive: (b) => text(join([b.entity.legal_name, companyQualifier(b)], " ")),
  },
  {
    id: "foot_address",
    zone: "footer",
    label: { fr: "Adresse (pied)", en: "Address (foot)" },
    hint: { fr: "Sur une seule ligne, comme au bas d'une facture.", en: "On one line, as along the bottom of an invoice." },
    source: { tab: "Contacts & addresses", field: "address_registered" },
    toggle: ["show_registered_address"],
    /*
     * ONE line, comma-joined — the footer shape, not the envelope shape. The
     * legacy column carries the tenant's own line breaks, which would render as
     * a newline inside a single <div>; normalised to ", " so a footer address
     * reads as a footer address whichever source it came from.
     */
    derive: (b) => text(String(b.address_line || "").replace(/\s*\r?\n\s*/g, ", ")),
  },
  {
    id: "identifiers",
    zone: "footer",
    label: { fr: "Identifiants fiscaux et commerciaux", en: "Tax & trade identifiers" },
    hint: {
      fr: "NIU, RCCM, TVA, EORI — dérivés des immatriculations, donc justes hors du Cameroun.",
      en: "NIU, RCCM, VAT, EORI — derived from the registrations, so they stay right outside Cameroon.",
    },
    source: { tab: "Identity & registrations", field: "registrations" },
    toggle: ["show_registrations"],
    /*
     * DERIVED, never two named columns. The mandatory mentions on a commercial
     * document are jurisdictional: a Cameroonian sheet carries NIU and RCCM, a
     * French one SIREN and TVA intracommunautaire. `kit.footer` printed two
     * hardcoded labels, which is correct in exactly one country and this
     * product is not sold in exactly one country.
     */
    derive: (b) => (b.entity.identifiers || []).map((i) => ({ type: "text", text: `${i.kind} ${i.number}` })),
    /*
     * The legacy `rccm` / `niu` columns, for an entity with no registration
     * rows. 0512 backfilled the columns into rows, so in practice this covers
     * an entity created before that or one whose rows were never filled — and
     * a commercial document missing its statutory identifiers is not a document
     * anyone can use.
     */
    fallback: (b) => [
      b.entity.rccm ? { type: "text", text: `RCCM ${clean(b.entity.rccm)}` } : null,
      b.entity.niu ? { type: "text", text: `NIU ${clean(b.entity.niu)}` } : null,
    ].filter(Boolean),
  },
  {
    id: "establishment",
    zone: "footer",
    label: { fr: "Établissement émetteur", en: "Issuing establishment" },
    hint: {
      fr: "Le site qui émet — sa propre référence fiscale, là où la loi l'exige.",
      en: "The issuing site — its own tax-office reference, where the law wants it.",
    },
    source: { tab: "Structure", field: "establishments" },
    toggle: ["show_establishment"],
    derive: (b) => text(b.establishment_line),
  },
  {
    id: "payment",
    zone: "footer",
    label: { fr: "Coordonnées bancaires", en: "Payment block" },
    hint: {
      fr: "Sur un document que l'on doit payer. Pas sur un ordre de transit.",
      en: "On a document somebody must pay. Not on a transit order.",
    },
    source: { tab: "Banking & treasury", field: "treasury_accounts" },
    toggle: ["show_bank_block"],
    /*
     * OFF for most documents even when the toggle is on, and that is not a bug.
     * A transit order is an authorisation to declare cargo; printing an account
     * number on it hands the tenant's banking details to every warehouse and
     * border post the sheet passes through, for nothing. The template opts in
     * (`opts.bank`); the toggle only decides whether it MAY.
     */
    derive: (b) => (b.payment.accounts || []).map((a) => ({
      type: "text",
      text: join([a.bank_name, a.branch, a.account_number, a.iban ? `IBAN ${a.iban}` : null,
        a.swift_bic ? `SWIFT ${a.swift_bic}` : null, a.currency]),
    })).filter((l) => l.text),
  },
  {
    id: "footer_note",
    zone: "footer",
    label: { fr: "Note de pied", en: "Footer note" },
    hint: { fr: "", en: "" },
    source: { tab: "Letterhead", field: "footer_note" },
    authored: true,
    derive: (b) => text(b.pick(b.config.footer_note_fr, b.config.footer_note_en)),
  },
  {
    id: "legal_mentions",
    zone: "footer",
    label: { fr: "Mentions légales", en: "Legal mentions" },
    hint: {
      fr: "Pénalités de retard, escompte, clause attributive de juridiction.",
      en: "Late-payment penalties, settlement discount, jurisdiction clause.",
    },
    source: { tab: "Letterhead", field: "legal_mentions" },
    authored: true,
    derive: (b) => text(b.pick(b.config.legal_mentions_fr, b.config.legal_mentions_en)),
  },
];

const BY_ID = new Map(CATALOGUE.map((b) => [b.id, b]));

/* ── small helpers the catalogue uses ──────────────────────────────────── */
const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());
const join = (parts, sep = " · ") => parts.map(clean).filter(Boolean).join(sep);
const text = (v) => (clean(v) ? [{ type: "text", text: clean(v) }] : []);
const lines = (arr) => (Array.isArray(arr) ? arr.map(clean).filter(Boolean).map((t) => ({ type: "text", text: t })) : []);

/**
 * "SARL au capital de 10 000 000 XAF" — the qualifier that follows the legal
 * name, assembled rather than typed so it cannot quote a share capital from
 * three years ago. Each half is governed by its own toggle because the
 * jurisdictions that require them are not the same set.
 */
function companyQualifier(b) {
  const e = b.entity;
  const c = b.config;
  const capital = lh.formatAmount(e.share_capital);
  return join([
    c.show_legal_form === false ? null : e.legal_form,
    c.show_share_capital === false || !capital
      ? null
      : (b.language === "fr"
        ? `au capital de ${capital} ${clean(e.share_capital_currency)}`.trim()
        : `share capital ${capital} ${clean(e.share_capital_currency)}`.trim()),
  ], " ");
}

/* ── tokens ────────────────────────────────────────────────────────────────
 * `{{entity.website}}` inside a tenant-authored custom line, resolved at render.
 *
 * WHY TOKENS AND NOT JUST TYPED TEXT. A custom line exists precisely for what
 * the schema will never model — a slogan, a licence number, a trade-body
 * membership. But a tenant writing "Capital: 10 000 000 XAF" by hand has just
 * created the stale-letterhead problem this whole module was built to remove.
 * A token keeps the sentence theirs and the FACT ours.
 *
 * Everything resolves to a plain string and is escaped by the renderer at the
 * point of interpolation, exactly like every other derived value — a token can
 * never introduce markup, because it never travels as markup.
 */
const TOKENS = {
  "entity.legal_name": { label: { fr: "Raison sociale", en: "Legal name" }, get: (b) => b.entity.legal_name },
  "entity.trading_name": { label: { fr: "Nom commercial", en: "Trading name" }, get: (b) => b.entity.trading_name },
  "entity.legal_form": { label: { fr: "Forme juridique", en: "Legal form" }, get: (b) => b.entity.legal_form },
  "entity.share_capital": { label: { fr: "Capital social", en: "Share capital" }, get: (b) => lh.formatAmount(b.entity.share_capital) },
  "entity.share_capital_currency": { label: { fr: "Devise du capital", en: "Capital currency" }, get: (b) => b.entity.share_capital_currency },
  "entity.phone": { label: { fr: "Téléphone", en: "Phone" }, get: (b) => b.entity.phone },
  "entity.email": { label: { fr: "E-mail", en: "Email" }, get: (b) => b.entity.email },
  "entity.website": { label: { fr: "Site web", en: "Website" }, get: (b) => b.entity.website },
  "entity.address": { label: { fr: "Adresse (une ligne)", en: "Address (one line)" }, get: (b) => b.address_line },
  "entity.niu": { label: { fr: "NIU", en: "NIU" }, get: (b) => idOf(b, "NIU") },
  "entity.rccm": { label: { fr: "RCCM", en: "RCCM" }, get: (b) => idOf(b, "RCCM") },
  "entity.vat": { label: { fr: "N° de TVA", en: "VAT number" }, get: (b) => idOf(b, "VAT") },
  "entity.identifiers": {
    label: { fr: "Tous les identifiants", en: "All identifiers" },
    get: (b) => (b.entity.identifiers || []).map((i) => `${i.kind} ${i.number}`).join(" · "),
  },
  "doc.number": { label: { fr: "N° du document", en: "Document number" }, get: (b) => b.doc.number },
  "doc.date": { label: { fr: "Date du document", en: "Document date" }, get: (b) => b.doc.date },
  "doc.title": { label: { fr: "Nom du document", en: "Document name" }, get: (b) => b.doc.title },
  "page.current": { label: { fr: "Page courante", en: "Current page" }, get: (b) => b.doc.page },
  "page.total": { label: { fr: "Nombre de pages", en: "Page count" }, get: (b) => b.doc.pages },
};

const idOf = (b, kind) => {
  const hit = (b.entity.identifiers || []).find((i) => String(i.kind).toUpperCase() === kind);
  return hit ? hit.number : "";
};

/**
 * Resolve `{{token}}` occurrences in one authored string.
 *
 * An UNKNOWN token resolves to empty, not to itself. Printing `{{entity.siret}}`
 * on a customer's invoice because somebody guessed a name is worse than
 * printing nothing, and the editor's token picker means nobody has to guess.
 *
 * A line that resolves to nothing but braces is dropped entirely by `compose`,
 * so "Licence n° {{entity.licence}}" does not print as a dangling "Licence n°".
 */
function resolveTokens(raw, bundle) {
  const s = clean(raw);
  if (!s) return "";
  let hadToken = false;
  let filled = false;
  const out = s.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi, (_, name) => {
    hadToken = true;
    const tok = TOKENS[String(name).toLowerCase()];
    const v = tok ? clean(tok.get(bundle)) : "";
    if (v) filled = true;
    return v;
  });
  // Every token in the line came back empty → the sentence has lost its
  // subject. Drop it rather than print its scaffolding.
  if (hadToken && !filled) return "";
  return out.replace(/\s{2,}/g, " ").trim();
}

/* ── layout ────────────────────────────────────────────────────────────────
 * The saved arrangement: which blocks appear, in what order, how wide, and how
 * they are set. Stored as `entity_letterhead.layout` jsonb.
 *
 * A SAVED LAYOUT IS A PREFERENCE, NOT A SCHEMA. It is merged over the default
 * below rather than replacing it, so a block added to the catalogue after a
 * tenant saved their layout still appears — at its default place — instead of
 * vanishing from every document they print. That is the "we add a field and it
 * must be accommodated" contract, and it is why this merge is not a spread.
 */
const DEFAULT_LAYOUT = {
  version: 1,
  /*
   * THE DEFAULT IS THE TRANSIT ORDER, TO THE POINT.
   *
   * Mark left, identity right, one accent rule under both, every identity line
   * at the same 7.4pt the instrument sheet sets `.lh2 .id .ln` to. This is not
   * a new design that resembles the old one — it is the old one, expressed as
   * data so a tenant can move it. A tenant who never opens the editor prints
   * exactly what the transit order and delivery note print today, which is what
   * makes this migration invisible to everyone who liked what they had.
   */
  header: [
    { id: "logo", row: 0, col: 0, span: 5, align: "left", size: 1 },
    { id: "company_name", row: 0, col: 5, span: 7, align: "right", size: 1, weight: "bold", transform: "upper" },
    { id: "company_line", row: 0, col: 5, span: 7, align: "right", size: 1, tone: "muted" },
    { id: "address", row: 0, col: 5, span: 7, align: "right", size: 1, tone: "muted" },
    { id: "contact", row: 0, col: 5, span: 7, align: "right", size: 1, tone: "muted" },
    { id: "header_note", row: 1, col: 0, span: 12, align: "left", size: 1, tone: "muted" },
    { id: "rule", row: 2, col: 0, span: 12, align: "left", size: 1 },
  ],
  /*
   * THE FOOT SAYS WHO WE ARE LEGALLY, AND NOTHING THE HEAD ALREADY SAID.
   *
   * `foot_company` and `foot_address` are catalogued — a tenant who wants the
   * name repeated along the bottom of an invoice can drag them in — but they
   * are OFF by default, and that is a decision with a scar behind it. The first
   * rebuild of the transit order printed the legal name, the address, the RCCM
   * and the NIU at BOTH ends: a quarter of the identity block on the page was
   * duplication, on a document whose entire problem is height. Head and foot
   * share nothing, by default, on every document.
   */
  footer: [
    { id: "foot_company", row: 0, col: 0, span: 12, align: "left", size: 1, visible: false },
    { id: "foot_address", row: 0, col: 0, span: 12, align: "left", size: 1, visible: false },
    { id: "identifiers", row: 0, col: 0, span: 12, align: "left", size: 1 },
    { id: "establishment", row: 0, col: 0, span: 12, align: "left", size: 1 },
    { id: "payment", row: 0, col: 0, span: 12, align: "left", size: 1 },
    { id: "footer_note", row: 0, col: 0, span: 12, align: "left", size: 1 },
    { id: "legal_mentions", row: 0, col: 0, span: 12, align: "left", size: 1 },
  ],
};

/** One placement, defaulted and clamped. Never trusts a stored value. */
function placement(zone, saved, fallbackIndex) {
  const d = (DEFAULT_LAYOUT[zone] || []).find((p) => p.id === (saved && saved.id)) || {};
  const s = saved || {};
  return {
    id: s.id,
    row: clampInt(s.row ?? d.row, 0, 40, fallbackIndex),
    col: clampInt(s.col ?? d.col, 0, COLS - 1, 0),
    span: clampInt(s.span ?? d.span, 1, COLS, COLS),
    align: ["left", "center", "right"].includes(s.align ?? d.align) ? (s.align ?? d.align) : "left",
    // The type scale, relative to the zone's base size. Bounded hard: a
    // letterhead set at 4× is not a design choice a tenant recovers from on
    // their own, and the fit model has to be able to trust this number.
    size: Math.min(2.5, Math.max(0.5, Number(s.size ?? d.size) || 1)),
    weight: s.weight ?? d.weight ?? "normal",
    tone: s.tone ?? d.tone ?? "ink",
    transform: s.transform ?? d.transform ?? "none",
    /*
     * Absent means "take the default", which for `foot_company` and
     * `foot_address` is OFF. `s.visible !== false` alone would read an absent
     * key as true and switch both back on for every tenant — the duplication
     * the default exists to prevent.
     */
    visible: s.visible === undefined ? d.visible !== false : s.visible !== false,
  };
}

/**
 * Merge a tenant's saved layout over the default.
 *
 * Blocks are matched by id. A saved entry for a block that no longer exists is
 * dropped; a catalogue block with no saved entry is appended at its default
 * placement. Custom lines (ids prefixed `custom:`) come from their own table
 * and are placed by the layout the same way, so a tenant can drag one between
 * two derived blocks rather than being stuck with an appendix at the bottom.
 */
function mergeLayout(zone, saved, customIds = []) {
  const savedList = Array.isArray(saved && saved[zone]) ? saved[zone] : [];
  const savedById = new Map(savedList.filter((p) => p && p.id).map((p) => [p.id, p]));
  const known = CATALOGUE.filter((b) => b.zone === zone).map((b) => b.id).concat(customIds);

  return known.map((id, i) => placement(zone, { ...(savedById.get(id) || {}), id }, i))
    // Row-major: down the page, then across it. A stable sort on (row, col)
    // keeps two blocks in the same cell in their catalogue order rather than in
    // whatever order the JSON happened to serialise.
    .sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

/* ── height ────────────────────────────────────────────────────────────────
 * Millimetres, computed from the composed blocks.
 *
 * WHY MEASURED AND NOT A CONSTANT. Every instrument template carries a
 * `HEIGHT_MM.head` — 17mm for the delivery note — written down from a real
 * measurement of the letterhead as it was on the day. The moment a tenant adds
 * two custom footer lines, that constant is a lie, `--k` is solved against the
 * wrong budget and the sheet quietly becomes two pages. Two pages is the exact
 * failure the one-page contract exists to prevent, and it would arrive through
 * the feature that was supposed to make the letterhead theirs.
 *
 * So the head and foot report their own height from what they actually carry.
 * The arithmetic is deliberately simple and slightly generous: a line's height
 * is its type size times a leading factor, plus the block's own gap. It is an
 * upper bound, so it errs toward setting the page a shade tighter than it had
 * to be — which costs nothing, where erring the other way costs a sheet.
 */
const MM_PER_PT = 0.3528;
const BASE_PT = { header: { name: 11.5, mark: 15, line: 7.4 }, footer: { name: 7.4, mark: 15, line: 7 } };
const LEADING = 1.45;

function blockHeightMm(block, zone) {
  if (block.kind === "rule") return 1.4;              // 0.7mm rule + its margin
  if (block.kind === "image") return Number(block.height_mm) || 15;
  const scale = BASE_PT[zone] || BASE_PT.footer;
  const base = block.kind === "wordmark" ? scale.mark
    : block.id === "company_name" ? scale.name
      : scale.line;
  const pt = base * (block.size || 1);
  return block.lines.length * pt * MM_PER_PT * LEADING;
}

/**
 * A composed zone's height in millimetres.
 *
 * TWO AXES, AND GETTING THIS WRONG COSTS A SHEET. Blocks in the same row but
 * different COLUMNS are abreast, so the row costs the tallest column and not
 * the sum — the reason the grid exists at all is that a logo beside four
 * identity lines is one 17mm row rather than 17mm plus four. Blocks in the same
 * row AND the same column stack, so that column costs their sum.
 *
 * The first cut of this function summed by row alone and reported an 8.7mm
 * header for the default layout, where the identity column alone is four lines
 * — it would have handed `fitScale` ~9mm of head to budget against a real 17,
 * and every instrument sheet with a full cargo table would have spilled onto a
 * second page. Measured per column, then maxed across the row.
 */
function measure(blocks, zone, { gapMm = 1.2 } = {}) {
  /** row → (column key → stacked height) */
  const rows = new Map();
  for (const b of blocks) {
    if (!b.visible || !b.lines.length) continue;
    if (!rows.has(b.row)) rows.set(b.row, new Map());
    const cols = rows.get(b.row);
    // Keyed on the column START. Two blocks that begin in the same column are
    // the same stack whatever their spans; two that begin in different columns
    // are side by side, which is the only distinction the height needs.
    cols.set(b.col, (cols.get(b.col) || 0) + blockHeightMm(b, zone));
  }
  if (!rows.size) return 0;
  const total = [...rows.values()]
    .reduce((sum, cols) => sum + Math.max(...cols.values()), 0);
  return Math.round((total + gapMm * (rows.size - 1)) * 10) / 10;
}

/* ── compose ───────────────────────────────────────────────────────────────
 * The entry point. Everything above is in service of this one function.
 */

/**
 * Build the resolved header and footer for one entity in one language.
 *
 * @param {object}   input.entity            corporate_entity row, already carrying
 *                                           `address_lines` and `identifiers` from
 *                                           `entity-letterhead.service`
 * @param {object}   [input.config]          entity_letterhead row
 * @param {object[]} [input.customLines]     entity_letterhead_line rows
 * @param {object}   [input.layout]          entity_letterhead.layout jsonb
 * @param {object[]} [input.treasuryAccounts] treasury_account rows
 * @param {object[]} [input.establishments]  entity_establishment rows
 * @param {object[]} [input.addresses]       entity_address rows
 * @param {object}   [input.doc]             { number, date, title, page, pages } for tokens
 * @param {string}   [lang]                  'fr' | 'en'
 */
function compose(input = {}, lang) {
  const entity = input.entity || {};
  const config = { ...lh.DEFAULT_CONFIG, ...(input.config || {}) };
  const language = lang === "fr" || lang === "en" ? lang : (entity.default_language || "en");
  const addresses = input.addresses || [];

  // The bundle every `derive` and every token reads. Assembled once: the
  // payment block and the address line are each a non-trivial precedence walk
  // and neither should run per block.
  const bundle = {
    entity,
    config,
    language,
    logo_url: input.logo_url || entity.logo_light_ref || null,
    address_line: lh.registeredAddress(entity, addresses),
    establishment_line: lh.establishmentLine(lh.issuingEstablishment(input.establishments || [])),
    payment: lh.paymentBlock(entity, input.treasuryAccounts || []),
    doc: input.doc || {},
    pick: (fr, en) => (language === "fr" ? fr || en : en || fr) || "",
  };

  const custom = (input.customLines || [])
    .filter((c) => c && c.is_active !== false)
    .map((c) => ({ ...c, id: `custom:${c.line_id}` }));
  const customByZone = (zone) => custom.filter((c) => String(c.zone || "footer").toLowerCase() === zone);

  const built = {};
  const emptyBlocks = [];

  for (const zone of ZONES) {
    const zoneCustom = customByZone(zone);
    const placements = mergeLayout(zone, input.layout, zoneCustom.map((c) => c.id));
    const customById = new Map(zoneCustom.map((c) => [c.id, c]));

    built[zone] = placements.map((p) => {
      const def = BY_ID.get(p.id);
      const cus = customById.get(p.id);
      if (!def && !cus) return null;

      // A `show_*` column set false switches the block off wherever it appears.
      // The toggles predate the layout and tenants have already set them; the
      // layout's own `visible` is a second, finer control, not a replacement.
      const toggledOff = def && def.toggle
        ? def.toggle.every((t) => config[t] === false)
        : false;

      let content;
      let empty = false;
      if (cus) {
        const t = resolveTokens(bundle.pick(cus.text_fr, cus.text_en), bundle);
        content = text(t);
        empty = !content.length;
      } else {
        content = def.derive(bundle) || [];
        if (!content.length && def.fallback) content = def.fallback(bundle) || [];
        empty = !content.length && !def.always;
      }

      // "Switched on, but empty" — the failure a picture alone hides, because a
      // block with nothing behind it looks exactly like one that is switched
      // off. Only reported for blocks the tenant actually asked to see.
      if (empty && p.visible && !toggledOff) emptyBlocks.push(p.id);

      return {
        ...p,
        zone,
        visible: p.visible && !toggledOff,
        kind: content.length && content[0].type === "image" ? "image"
          : content.length && content[0].type === "rule" ? "rule"
            : content.length && content[0].type === "wordmark" ? "wordmark" : "text",
        custom: Boolean(cus),
        label: cus ? { fr: cus.text_fr || "", en: cus.text_en || "" } : def.label,
        hint: cus ? { fr: "", en: "" } : def.hint,
        source: cus ? { tab: "Letterhead", field: `custom:${cus.line_id}` } : def.source,
        /*
         * The `show_*` column(s) governing this block, so the editor's one
         * visibility control can write the one the tenant already set rather
         * than adding a second, contradictory switch beside it. Two controls
         * for one outcome is the confusion this rebuild exists to remove.
         */
        toggle: (def && def.toggle) || null,
        authored: cus ? true : Boolean(def.authored),
        fixed: Boolean(def && def.fixed),
        empty,
        lines: content,
        /*
         * The mark's height, in millimetres, and it does NOT scale with the fit.
         *
         * Two spellings reach here and both are legitimate: `logo_height_mm` on
         * the entity_letterhead row (what the editor writes) and the kit's
         * merged `cfg.logo.height_mm` (what the Studio and the CSS use, passed
         * in as `input.logo_height_mm`). The caller's wins, because by the time
         * the kit calls this it has already resolved the two against each other
         * — and a mark measured at one height here and drawn at another there
         * is a page whose fit was solved against a letterhead that never
         * printed.
         */
        height_mm: p.id === "logo"
          ? (Number(input.logo_height_mm) || Number(config.logo_height_mm) || 15)
          : undefined,
      };
    }).filter(Boolean);
  }

  return {
    language,
    header: built.header,
    footer: built.footer,
    empty_blocks: [...new Set(emptyBlocks)],
    height: {
      header_mm: measure(built.header, "header"),
      footer_mm: measure(built.footer, "footer"),
    },
  };
}

/**
 * The catalogue as the editor needs it: what a tenant can add, what each block
 * derives from, and where to send them to fix it. Language-resolved so the
 * panel does not re-implement `pick`.
 */
function catalogue(lang = "en") {
  const pick = (pair) => (lang === "fr" ? pair.fr || pair.en : pair.en || pair.fr) || "";
  return CATALOGUE.map((b) => ({
    id: b.id,
    zone: b.zone,
    label: pick(b.label),
    hint: pick(b.hint || {}),
    source: b.source,
    toggle: b.toggle || null,
    authored: Boolean(b.authored),
    fixed: Boolean(b.fixed),
  }));
}

/** The token picker's list. */
function tokens(lang = "en") {
  const pick = (pair) => (lang === "fr" ? pair.fr || pair.en : pair.en || pair.fr) || "";
  return Object.entries(TOKENS).map(([name, t]) => ({ token: `{{${name}}}`, label: pick(t.label) }));
}

module.exports = {
  compose, measure, resolveTokens, catalogue, tokens, mergeLayout,
  CATALOGUE, TOKENS, DEFAULT_LAYOUT, ZONES, COLS,
};
