"use strict";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

/** Render only the shared, already language-selected presentation model. */
function html({ presentation }) {
  const p = presentation;
  const body = p.sections.map((section) =>
    `<section><h2>${esc(section.title)}</h2><p>${esc(section.body)}</p></section>`).join("");
  const rows = p.lines.map((line) =>
    `<tr><td>${esc(line.label)}</td><td>${esc(line.quantity)}</td><td>${esc(line.unit_price_display)}</td><td>${esc(line.total_display)}</td></tr>`).join("");
  return `<!doctype html><html lang="${esc(p.language.toLowerCase())}"><head><meta charset="utf-8"><style>body{font-family:Roboto,'Noto Sans',sans-serif;color:#172033;margin:32px}header{border-bottom:2px solid #172033}section p{white-space:pre-wrap}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}@page{size:A4;margin:18mm}</style></head><body><header><h1>${esc(p.title)}</h1><p>${esc(p.client_name)} · ${esc(p.document_number)}</p></header><p>${esc(p.route)}</p>${body}<table><thead><tr><th>${esc(p.labels.service)}</th><th>${esc(p.labels.quantity)}</th><th>${esc(p.labels.unit)}</th><th>${esc(p.labels.total)}</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
module.exports = { html, esc };
