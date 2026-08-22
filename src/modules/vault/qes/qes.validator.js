/**
 * QES validators (MOD-64). Both endpoints here are READS — the write side of
 * Tier 3 is the signing handoff on the public page and the provider's own
 * webhook, and neither takes a body this module decides on:
 *
 *   · the handoff takes what the signing page already validated (the token,
 *     the chosen card) and resolves everything else server-side;
 *   · the webhook body is the provider's, and it is signature-verified before
 *     any field of it is read — a zod schema would validate the shape of an
 *     untrusted event AFTER the signature question, which is the wrong order.
 *
 * What is validated here is the query: the doc type the quote asks about,
 * and the language.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const quoteQuery = z.object({
  doc_type: z.string().min(1).max(64).optional(),
  lang: z.enum(["fr", "en"]).optional(),
});

const usageQuery = z.object({
  lang: z.enum(["fr", "en"]).optional(),
});

module.exports = {
  quote: (req, _res, next) => {
    const p = quoteQuery.safeParse(req.query);
    if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
    req.validatedQuery = p.data;
    return next();
  },
  usage: (req, _res, next) => {
    const p = usageQuery.safeParse(req.query);
    if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
    req.validatedQuery = p.data;
    return next();
  },
};
