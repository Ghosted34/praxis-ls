/**
 * The AI write-execution contract, and the ratchet that enforces it.
 *
 * Every AI-proposed write runs through the generic write adapter
 * (`action-registrar.writeAdapter`), which invokes a manifest's `service` as:
 *
 *     service(client, payload, actor)
 *
 * where `payload` is the AI's snake_case object and `actor` is the FULL
 * authenticated user. A write therefore CONFORMS to the contract only when its
 * manifest entry maps the payload to the service's real argument shape AND
 * forwards the actor — i.e. it is an inline wrapper that declares three
 * parameters (`(c, p, actor) => service.x(c, { …, actor })`), or a service whose
 * own positional signature is `(client, payload, actor)`. A bare service
 * reference cannot conform: its second parameter is `{ data, actor }` (or
 * camelCase args), so the flat payload lands in the wrong slot and the actor is
 * dropped — the exact defects the audit filed as C1–C3.
 *
 * Actions in the hand-vetted `action-registry` bridge the payload themselves and
 * always pass `actor: user`, so they conform by construction.
 *
 * `classifyWrites()` splits every catalogued write into conforming vs.
 * non-conforming by this rule. `KNOWN_UNMIGRATED` (in the sibling JSON) is the
 * inventory of writes that predate the contract; the gate in
 * `tests/unit/ai-write-contract.test.js` fails if a NEW non-conforming write
 * appears outside that list, and fails if a listed write has since been migrated
 * (so the backlog only ever shrinks). Migrating a write = make its manifest
 * entry a 3-arg wrapper, then delete its key from the JSON. See AI_ARCHITECTURE
 * §2 and doc/PRAXIS_AI_AUDIT.md finding C.
 */
"use strict";

const { loadManifests } = require("./action-registrar");
const { registry } = require("./action-registry");
const KNOWN_UNMIGRATED = require("./write-contract-baseline.json");

/**
 * Top-level parameter count of a function, from its source — handles arrow and
 * `function` forms and nested destructuring/defaults (a `{ data, actor = {} }`
 * param counts as one). This is exactly what decides whether the generic adapter
 * can hand the wrapper an `actor` argument it will forward.
 */
function paramCount(fn) {
  if (typeof fn !== "function") return 0;
  const src = fn.toString().trim();
  const open = src.indexOf("(");
  if (open === -1) return 0;
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const inner = src.slice(open + 1, end).trim();
  if (!inner) return 0;
  let d = 0;
  let parts = 1;
  for (const ch of inner) {
    if ("([{".includes(ch)) d++;
    else if (")]}".includes(ch)) d--;
    else if (ch === "," && d === 0) parts++;
  }
  return parts;
}

/** A write conforms iff it is vetted OR its manifest service forwards an actor
 *  (declares ≥ 3 parameters). */
function isConforming(key, service) {
  if (registry[key]) return true;
  return paramCount(service) >= 3;
}

/** Walk every manifest write and split into { conforming, nonConforming } keys. */
function classifyWrites(manifests = loadManifests()) {
  const conforming = [];
  const nonConforming = [];
  const seen = new Set();
  for (const { manifest } of manifests) {
    for (const w of (manifest && manifest.writes) || []) {
      if (!w || !w.key || seen.has(w.key)) continue;
      seen.add(w.key);
      (isConforming(w.key, w.service) ? conforming : nonConforming).push(w.key);
    }
  }
  conforming.sort();
  nonConforming.sort();
  return { conforming, nonConforming };
}

module.exports = { paramCount, isConforming, classifyWrites, KNOWN_UNMIGRATED };
