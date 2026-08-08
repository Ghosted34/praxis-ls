"use strict";
const service = require("./currency.service");
const { asyncHandler } = require("../../../utils/errors");

const codeOf = (req) => String(req.params.code || "").toUpperCase();

module.exports = {
  // Currency master. Active-only by default (dropdowns rely on that); the
  // Currencies page passes ?all=1&usage=1 for the full, usage-ranked list.
  currencies: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listCurrenciesRich(c, req.query)) })),
  dossier: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.dossier(c, codeOf(req))) })),
  addCurrency: asyncHandler(async (req, res) => {
    const b = req.body;
    const row = await req.tenantDb((c) => service.addCurrency(c, { code: b.code, name: b.name, symbol: b.symbol, decimals: b.decimals, actor: req.user || {} }));
    res.status(201).json({ data: row });
  }),
  editCurrency: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.editCurrency(c, codeOf(req), req.body, req.user || {})) })),
  setBase: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setBase(c, req.body.code, req.user || {})) })),
  removeCurrency: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.removeCurrency(c, codeOf(req), req.user || {})) })),
  syncNow: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.syncNow(c, req.user || {})) })),

  // FX rates.
  rates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listRates(c, req.query)) })),
  rate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.rateFor(c, { base: req.query.base, quote: req.query.quote, date: req.query.date })) })),
  convert: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.convertAmount(c, { amount: Number(req.query.amount), base: req.query.base, quote: req.query.quote, date: req.query.date })) })),
  setRate: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.setRate(c, { base: b.base, quote: b.quote, rate: b.rate, asOfDate: b.as_of_date, actor: req.user || { user_id: null } }));
    res.status(201).json({ data: r });
  }),
};
