"use strict";

const { z } = require("zod");
const { body, query } = require("../../../shared/http/validate");

const dataUrl = z.string().min(20).max(40_000_000).refine((v) => /^data:[^;]+;base64,/i.test(v), "Expected a base64 data URL");

const issueShape = z.object({
  request_id: z.string().uuid().optional().nullable(),
  party_id: z.string().uuid().optional().nullable(),
  entity_ref: z.string().min(1).max(200),
  doc_type: z.string().min(1).max(80),
  document_vault_id: z.string().uuid().optional().nullable(),
}).strict();
const issue = body(issueShape);

const ingest = body(z.object({
  source: z.enum(["UPLOAD", "EMAIL", "MOBILE"]).default("UPLOAD"),
  source_ref: z.string().max(200).optional().nullable(),
  data_url: dataUrl,
}).strict());

const decode = body(z.object({
  doc_type_hint: z.string().min(1).max(80).optional().nullable(),
}).strict());

const empty = body(z.object({}).strict());

const bind = body(z.object({
  print_job_id: z.string().uuid(),
}).strict());

const reject = body(z.object({
  reason: z.string().min(1).max(500).optional().nullable(),
}).strict());

const listQueryShape = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();
const listQuery = query(listQueryShape);

// AI-facing: the raw shapes, so <module>.ai.js can declare payload schemas.
// The print job is in the URL for the HTTP routes; a copilot call has no URL.
const schemas = {
  issue: issueShape,
  listQuery: listQueryShape,
  aiPrinted: z.object({ print_job_id: z.string().uuid() }),
};

module.exports = { issue, ingest, decode, bind, reject, listQuery, empty, schemas };
