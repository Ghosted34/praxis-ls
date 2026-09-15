"use strict";

/**
 * The two kinds `ck_insight_kind` (migration 13784) admits, in one file that
 * requires nothing.
 *
 * ── WHY A FILE OF ITS OWN, FOR TWO STRINGS ─────────────────────────────────
 *
 * The validator needs the list, and so does the service. The service is the
 * natural home — except that requiring it pulls `document_vault.service`, which
 * pulls the identity cache, which pulls Redis. A validator that cannot be
 * loaded without a Redis client is a validator that cannot be unit-tested, and
 * the cycle it creates (validator → service → …) is the kind that only reveals
 * itself as an undefined export at run time.
 *
 * Retyping the strings in both places was the alternative, and it is worse: the
 * constraint is the authority, and a copy of it is a copy that drifts the first
 * time a third kind is added.
 */

const KINDS = ["article", "announcement"];
const ANNOUNCEMENT = "announcement";

module.exports = { KINDS, ANNOUNCEMENT };
