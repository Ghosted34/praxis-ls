"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * Query bounds for an anonymous search.
 *
 * `q` is capped well below anything a place name needs: the provider is paid
 * per request and a 4 kB query string is not somebody looking for a port. The
 * country filter is two letters or nothing — the same constraint
 * `geoapify.searchPlaces` relies on to stop a value smuggling a second clause
 * into the provider's own filter grammar.
 */
const schemas = {
  search: z.object({
    q: z.string().trim().min(1).max(120),
    country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(8).optional(),
  }).strict(),
};

const mw = (key) => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req.query);
  if (!parsed.success) {
    return next(new AppError(
      "VALIDATION_ERROR",
      "Invalid search",
      422,
      parsed.error.flatten().fieldErrors,
    ));
  }
  req.validatedQuery = parsed.data;
  return next();
};

module.exports = { schemas, search: mw("search") };
