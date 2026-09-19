"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  // SEC H3 guard + SEC H1. POST /actions/:id/confirm carries the EDITED payload
  // for a confirmed AI action, and nothing validated it. The orchestrator does
  // re-validate it against the catalogue's payload_schema before executing —
  // which is the substantive check — but that happens after the body has been
  // read, and only when `edited` is an object. A non-object, an array or a
  // 50 MB blob got that far unexamined.
  //
  // Bounded rather than shaped: the payload's real schema is per-action and
  // lives in ai_action_catalogue, so duplicating it here would give two places
  // to change and one of them would drift.
  confirm: z.object({
    payload: z.record(z.string().max(64), z.unknown()).optional(),
  }).strict(),
  // Bounded message length (audit 3.7). A very long message inflates the
  // embedding cost, the system prompt, and every replayed turn. 10,000 chars
  // is ~2,500 tokens — enough for a detailed question with pasted context,
  // short enough that a runaway client can't burn the budget on embeddings
  // alone. The streaming endpoint shares this schema.
  ask: z.object({
    message: z.string().min(1).max(10000),
    conversation_id: z.string().uuid().optional(),
    // The composer's posture (Ask/Draft/Analyse/Act) and the chosen Space. These
    // were sent by the client and silently stripped, so all four modes behaved
    // identically (audit D1/D5). Accepted here so the orchestrator can honour
    // them. `scope` is an area key (or "all"); free-form-bounded, not enumerated,
    // because the area list lives in the client.
    mode: z.enum(["ask", "draft", "analyse", "act"]).optional(),
    scope: z.string().max(64).optional(),
  }),
  // ── Conversation management (audit J1-J3) ────────────────────────────────
  //
  // ONE PATCH FOR THE THREE MUTABLE PROPERTIES. Pin, rename and archive are
  // three things a person does to one row, not three features; sending only
  // what changed keeps the API idempotent and lets the server answer with one
  // row version rather than leaving the client to reconcile three.
  //
  // `.strict()`, so an unknown key is a 422 rather than a silent no-op, and
  // `.refine()` rejects `{}` — a PATCH that asks for nothing is a client bug,
  // and answering 200 to it would hide that bug behind a successful-looking
  // round trip.
  //
  // `pinned` / `archived` carry the INTENDED STATE, not a toggle. A toggle
  // makes the outcome depend on the state the client believed it was in, so
  // two rails open in two tabs disagree about what one click does. Sending the
  // state makes the call idempotent and the last writer simply right.
  //
  // The conversation id is a PATH parameter on these routes, not a body field
  // — cast by Postgres and scoped to the caller in the SQL, the same way
  // `/actions/:id/confirm` treats its id.
  //
  // 120 chars for a title: the column is `text` and the rail renders one line,
  // with the derived fallback already capped at 80. A longer title would only
  // ever be truncated on screen, so refusing it is more honest than storing
  // something the product will not show. EMPTY IS ALLOWED and means "give me
  // the derived title back" (`assistant.repo.updateConversation`).
  conversationPatch: z
    .object({
      title: z.string().max(120).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, {
      message: "at least one of title, pinned or archived is required",
    }),
  // AI answer feedback (thumbs up/down). Bounded comment, required vote.
  feedback: z.object({
    conversation_id: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    question: z.string().max(10000).optional(),
    answer: z.string().max(50000).optional(),
    vote: z.enum(["up", "down"]),
    comment: z.string().max(2000).optional(),
    action_keys: z.array(z.string().max(100)).max(20).optional(),
  }).strict(),
  // Excel export of an answer's tables. Bounded rather than shaped-in-detail:
  // the rows are markdown cells lifted from a reply the caller already has on
  // screen, so nothing here widens what they can read — the limits are about
  // refusing to build an unbounded workbook, not about access.
  exportTables: z.object({
    tables: z
      .array(
        z.object({
          title: z.string().max(200).optional(),
          header: z.array(z.string().max(500)).min(1).max(60),
          rows: z.array(z.array(z.string().max(2000)).max(60)).max(5000),
        }),
      )
      .min(1)
      .max(25),
  }).strict(),
};
const validate = (key) => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
  }
  req.body = parsed.data;
  return next();
};
module.exports = { validate, schemas };
