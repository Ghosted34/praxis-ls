/**
 * A costing as `template.service.loadRecord('COSTING')` projects it, modelled
 * on SBX-CST-2026-0001 — the sheet that printed six seals, two languages and
 * a page and a half. Shared by the costing document tests and
 * scripts/dev/measure-costing.js, so the measured page and the tested page are
 * the same page.
 */
"use strict";

const ENTITY = {
  legal_name: "SMART LOGISTICS SANDBOX SARL",
  address_lines: ["Zone Industrielle de Bonabéri, Rue de la Douane", "BP 4521, Douala, Littoral, Cameroon"],
  identifiers: [
    { kind: "NIU", number: "M0209SBX0001" },
    { kind: "RCCM", number: "RC/DLA/2019/B/1234" },
  ],
  niu: "M0209SBX0001",
  rccm: "RC/DLA/2019/B/1234",
  email: "contact@smartlogistics.example",
  phone: "+237 233 42 10 10",
  default_currency_decimals: 0,
};

// [code, en, fr, container, qty, unit, disbursement, supplier VAT]
const REAL = [
  ["#D132", "Customs Clearance", "Dédouanement", null, 1, 150000, true, 5],
  ["#D031", "Customs Duties & Taxes", "Droits et taxes de douane", null, 1, 12000000, true, null],
  ["#D028", "Documentation Fee", "Frais de documentation", null, 1, 75000, false, null],
  ["#R004", "File Opening", "Ouverture de dossier", null, 1, 25000, false, null],
  ["#D073", "Inland Freight", "Transport terrestre", null, 2, 250000, true, null],
  ["#D081", "Ocean Freight", "Fret maritime", "FT45HC", 1, 1800000, true, null],
  ["#D081", "Ocean Freight", "Fret maritime", "FT40HC", 1, 1800000, true, null],
  ["#D096", "Port Charges", "Frais portuaires", "FT45HC", 1, 150000, true, null],
  ["#D096", "Port Charges", "Frais portuaires", "FT40HC", 1, 142000, true, null],
  ["#D114", "Terminal Handling Charges (THC)", "Frais de manutention terminal (THC)", "FT45HC", 1, 150000, true, null],
  ["#D114", "Terminal Handling Charges (THC)", "Frais de manutention terminal (THC)", "FT40HC", 1, 132000, true, null],
];
// The worst descriptions the Dictionary actually carries, for LONG.
const LONG = [
  ["#D114", "Terminal Handling Charges (THC) at destination terminal", "Frais de manutention au terminal de destination (THC)", "FT45HC", 1, 150000, true, 28875],
  ["#D205", "Container demurrage beyond free time — per day", "Surestaries conteneur au-delà de la franchise — par jour", "FT40HC", 12, 35000, true, 80850],
];

function line(row, i) {
  const [code, en, fr, box, qty, unit, pt, vat] = row;
  return {
    label: en,
    label_i18n: { en, fr },
    item_code: code,
    container_type: box,
    qty,
    unit: unit + (i >= REAL.length ? 1000 * i : 0),
    tax: pt ? null : 19.25,
    is_disbursement: pt,
    upstream_vat: pt ? vat : null,
    amount: qty * unit,
  };
}

function seals(qrSvg, language) {
  const fr = language === "fr";
  const s = (code, reason, at, verify) => ({
    reasonCode: code, reason,
    signerName: "Jean-Baptiste Sandjong", signerRole: fr ? "Directeur des opérations" : "Operations Manager",
    signedAt: at, method: fr ? "Vérifié par passkey" : "Verified by passkey",
    code: verify, qrSvg, docRef: "SBX-CST-2026-0001",
  });
  return fr
    ? [
      s("ACKNOWLEDGED", "Accusé de réception", "03 sept. 2026, 14:54 UTC+1", "TFQB5KV05XY2"),
      s("REVIEWED_ACCEPTED", "Examiné et accepté", "03 sept. 2026, 16:48 UTC+1", "AWC6V53RZSTY"),
      s("APPROVED_DISPATCH", "Approuvé pour expédition", "04 sept. 2026, 16:47 UTC+1", "SA9RWVC7VC5T"),
    ]
    : [
      s("ACKNOWLEDGED", "Acknowledged", "03 Sep 2026, 14:54 UTC+1", "TFQB5KV05XY2"),
      s("REVIEWED_ACCEPTED", "Reviewed and accepted", "03 Sep 2026, 16:48 UTC+1", "AWC6V53RZSTY"),
      s("APPROVED_DISPATCH", "Approved for dispatch", "04 Sep 2026, 16:47 UTC+1", "SA9RWVC7VC5T"),
    ];
}

/** A costing with `n` lines. `long` = the worst case for every variable block. */
function costing(n, { long = false, seals: withSeals = true, qrSvg = "", language = "en" } = {}) {
  const rows = long ? LONG.concat(REAL) : REAL;
  const lines = Array.from({ length: n }, (_, i) => line(rows[i % rows.length], i));
  const ht = lines.reduce((a, l) => a + l.amount, 0);
  const deb = lines.filter((l) => l.is_disbursement).reduce((a, l) => a + l.amount, 0);
  const up = lines.reduce((a, l) => a + (l.upstream_vat || 0), 0);
  const vat = Math.round((ht - deb) * 0.1925) + up;
  return {
    number: "SBX-CST-2026-0001",
    date: "2026-09-03",
    status: "APPROVED_LOCKED",
    status_words: { fr: "Approuvée", en: "Approved" },
    dossier_ref: "SL3213P44RG55ZSM",
    service: { fr: "Fret maritime import", en: "Sea freight import" },
    carrier: "Maersk",
    incoterm: "DDP",
    bl_mawb: "233254252",
    pol: "Lagos",
    pod: "Douala",
    eta: "2026-09-21",
    party: { name: "CIMENCAM", lines: ["NIU M0100CL0004"] },
    client_block: {
      code: "SLAS-CL-0004",
      niu: "M0100CL0004",
      rccm: long ? "RC/DLA/1963/B/0041" : null,
      address: "Zone Industrielle de Bonabéri, Douala, CM",
      po_box: "1323",
      phone: "+237 233 39 11 11",
      email: long ? "logistics.procurement@cimencam.example" : "logistics@cimencam.example",
      attn: "Marie Ngo Bassa · Logistics Manager",
    },
    client: "CIMENCAM",
    shipment: {
      facets: {
        TRANSPORT_REF: { label: "Transport reference", value: "233254252" },
        CARRIER: { label: "Carrier", value: "Maersk" },
        CONVEYANCE: { label: "Conveyance", value: "Rasa Parks / 342R" },
        ORIGIN: { label: "Origin", value: "Lagos" },
        DESTINATION: { label: "Destination", value: "Douala" },
        ARRIVAL_DATE: { label: "Arrival", value: "2026-09-21" },
        CARGO_DESC: { label: "Commodity", value: long ? "Used passenger vehicles, right-hand drive, in 40' and 45' HC" : "Cars" },
        CARGO_WEIGHT: { label: "Weight", value: "120000 KG" },
        CARGO_VOLUME: { label: "Volume", value: "125000 m³" },
        CARGO_PACKAGES: { label: "Packages", value: "4" },
        CARGO_MARKS: { label: "Marks & numbers", value: "03*45'HC, 02*40'HC" },
        INCOTERM: { label: "Incoterm", value: "DDP — Delivered Duty Paid" },
        CUSTOMS_REGIME: { label: "Customs regime", value: "IM7 — Customs warehouse" },
        CUSTOMS_REF: { label: "Declaration", value: "214552214552145" },
      },
      facets_fr: {
        TRANSPORT_REF: { label: "Référence de transport", value: "233254252" },
        CARRIER: { label: "Transporteur", value: "Maersk" },
        CONVEYANCE: { label: "Moyen de transport", value: "Rasa Parks / 342R" },
        ORIGIN: { label: "Origine", value: "Lagos" },
        DESTINATION: { label: "Destination", value: "Douala" },
        ARRIVAL_DATE: { label: "Arrivée", value: "2026-09-21" },
        CARGO_DESC: { label: "Marchandise", value: long ? "Véhicules d'occasion, conduite à droite, en 40' et 45' HC" : "Voitures" },
        CARGO_WEIGHT: { label: "Poids", value: "120000 KG" },
        CARGO_VOLUME: { label: "Volume", value: "125000 m³" },
        CARGO_PACKAGES: { label: "Colis", value: "4" },
        CARGO_MARKS: { label: "Marques & numéros", value: "03*45'HC, 02*40'HC" },
        INCOTERM: { label: "Incoterm", value: "DDP — Rendu droits acquittés" },
        CUSTOMS_REGIME: { label: "Régime douanier", value: "IM7 — Entrepôt de douane" },
        CUSTOMS_REF: { label: "Déclaration", value: "214552214552145" },
      },
      facet_order: [
        "TRANSPORT_REF", "CARRIER", "CONVEYANCE", "ORIGIN", "DESTINATION", "ARRIVAL_DATE",
        "CARGO_DESC", "CARGO_WEIGHT", "CARGO_VOLUME", "CARGO_PACKAGES", "CARGO_MARKS",
        "INCOTERM", "CUSTOMS_REGIME", "CUSTOMS_REF",
      ],
    },
    remarks: long
      ? "Carrier rate confirmed on 25/09 and valid for 14 days. Storage beyond the free period is billed at the terminal's published tariff, and any inspection ordered by customs is re-billed at cost."
      : null,
    amendment: null,
    exchange_rate: 1,
    lines,
    totals: { total_ht: ht, vat_total: vat, total_ttc: ht + vat, disbursement_total: deb, upstream_vat_total: up },
    amount_in_words: ht + vat,
    currency: "XAF",
    currency_decimals: 0,
    seals: withSeals ? seals(qrSvg, language) : [],
  };
}

module.exports = { ENTITY, costing };
