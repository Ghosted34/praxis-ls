"use strict";
const { legalForms, countries } = require("@praxis/shared");
const { asyncHandler, AppError } = require("../../../utils/errors");

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const searchable = (form) =>
  normalize(
    [
      form.code,
      form.name,
      form.abbreviation,
      form.jurisdiction_code,
      form.jurisdiction_name,
      ...(form.aliases || []),
    ].join(" "),
  );

module.exports = {
  list: asyncHandler(async (req, res) => {
    const country = String(req.query.country || "").toUpperCase();
    if (country && !countries.byCode(country)) {
      throw new AppError("VALIDATION_ERROR", "Unknown country code", 422, {
        country: ["Choose a country from the list."],
      });
    }
    let rows = country
      ? [...legalForms.forCountry(country)]
      : [...legalForms.CATALOGUE];
    if (req.query.source)
      rows = rows.filter((form) => form.source === req.query.source);
    if (req.query.jurisdiction)
      rows = rows.filter(
        (form) => form.jurisdiction_code === req.query.jurisdiction,
      );
    if (req.query.q) {
      const needle = normalize(req.query.q);
      rows = rows.filter((form) => searchable(form).includes(needle));
    }
    res.json({
      data: rows,
      meta: {
        count: rows.length,
        gleif_version: legalForms.GLEIF_VERSION,
        gleif_released_on: legalForms.GLEIF_RELEASED_ON,
        ohada_version: legalForms.OHADA_VERSION,
      },
    });
  }),

  get: asyncHandler(async (req, res) => {
    const form = legalForms.byReference({
      source: req.params.source,
      countryCode: req.params.country,
      code: req.params.code,
      jurisdictionCode: req.query.jurisdiction,
    });
    if (!form) throw new AppError("NOT_FOUND", "Unknown legal form", 404);
    res.json({ data: form });
  }),
};
