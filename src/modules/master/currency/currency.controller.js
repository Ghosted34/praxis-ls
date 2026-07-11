"use strict";
const service = require("./currency.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  currencies: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listCurrencies(c)) })),
  rates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listRates(c, req.query)) })),
  rate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.rateFor(c, { base: req.query.base, quote: req.query.quote, date: req.query.date })) })),
  convert: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.convertAmount(c, { amount: Number(req.query.amount), base: req.query.base, quote: req.query.quote, date: req.query.date })) })),
  setRate: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.setRate(c, { base: b.base, quote: b.quote, rate: b.rate, asOfDate: b.as_of_date, actor: req.user || { user_id: null } }));
    res.status(201).json({ data: r });
  }),
};
