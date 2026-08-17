"use strict";

/**
 * The public proposal and its vaulted PDF are two renderers of this one model.
 * All selected-language copy (headings, narrative selection and formatted
 * amounts) is resolved here so the browser cannot drift from the document the
 * client downloads.
 */
const TEXT = {
  EN: {
    service: "Service", quantity: "Qty", unit: "Unit", total: "Total",
    sections: {
      client_context: "Client context",
      operational_strategy: "Operational strategy",
      service_scope: "Service scope",
      service_levels: "Service levels",
      case_study: "Relevant experience",
    },
  },
  FR: {
    service: "Service", quantity: "Qté", unit: "Unité", total: "Total",
    sections: {
      client_context: "Contexte client",
      operational_strategy: "Stratégie opérationnelle",
      service_scope: "Périmètre des services",
      service_levels: "Niveaux de service",
      case_study: "Expérience pertinente",
    },
  },
};

function selectedLanguage(proposal, requested) {
  const own = String(proposal && proposal.language || "BILINGUAL").toUpperCase();
  const candidate = String(requested || (own === "FR" ? "FR" : "EN")).toUpperCase();
  if (!["EN", "FR"].includes(candidate)) return own === "FR" ? "FR" : "EN";
  if (own !== "BILINGUAL" && candidate !== own) return own;
  return candidate;
}

const sectionTitle = (key, language) =>
  TEXT[language].sections[key] || String(key || "").replace(/_/g, " ");

function build({ proposal, lines = [], narratives = [], client = null, language = null }) {
  const lang = selectedLanguage(proposal, language);
  const locale = lang === "FR" ? "fr-FR" : "en-GB";
  const currency = proposal.currency || "XAF";
  const money = (value) => new Intl.NumberFormat(locale, {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(Number(value) || 0);
  const labels = TEXT[lang];

  return {
    language: lang,
    locale,
    currency,
    title: proposal.title || "",
    document_number: proposal.doc_number || "",
    client_name: client && (client.legal_name || client.name) || "",
    origin: proposal.origin_location || "",
    destination: proposal.destination_location || "",
    route: [proposal.origin_location, proposal.destination_location].filter(Boolean).join(" → "),
    labels: {
      service: labels.service,
      quantity: labels.quantity,
      unit: labels.unit,
      total: labels.total,
    },
    sections: narratives
      .filter((row) => String(row.language || "").toUpperCase() === lang)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((row) => ({
        key: row.section,
        title: sectionTitle(row.section, lang),
        body: row.body || "",
      })),
    lines: lines.map((row) => {
      const total = (Number(row.qty) || 0) * (Number(row.unit_price) || 0);
      return {
        label: row.label || "",
        quantity: Number(row.qty) || 0,
        unit_price: Number(row.unit_price) || 0,
        total,
        unit_price_display: money(row.unit_price),
        total_display: money(total),
      };
    }),
  };
}

module.exports = { build, selectedLanguage, sectionTitle, TEXT };
