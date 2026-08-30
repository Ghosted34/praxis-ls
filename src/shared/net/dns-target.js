"use strict";

/**
 * Does a host actually point at us yet?
 *
 * Registering a custom domain in the platform console writes the row that makes
 * it serve the public site — but the DNS lives at the CLIENT's registrar, in a
 * zone we have no credentials for and no authority over. That step cannot be
 * automated by us or by anyone: it is the one part of onboarding that is
 * genuinely someone else's to do. What we CAN do is stop guessing whether they
 * have done it.
 *
 * Without this the flow is a conversation — "did you add the record?", "I think
 * so", "it still doesn't work" — and the only way to tell was to load the site
 * and read a TLS error. This answers it directly, per host, on demand.
 *
 * The lookup is injected rather than imported so the classification is testable
 * without a network: CI must not depend on somebody else's zone resolving, and
 * a test that does is a test that fails on a train.
 */

/**
 * States, and what each one means to the person reading the console:
 *
 *   ok            — the record is live and points here. Nothing left to do.
 *   wrong_target  — it resolves, but somewhere else. Usually the record was
 *                   added to the wrong zone, or an old host still holds it.
 *                   Distinguished from `unresolved` on purpose: "you pointed it
 *                   at the wrong box" and "you have not pointed it anywhere"
 *                   need different replies, and collapsing them into "not
 *                   working" is what makes support threads long.
 *   unresolved    — no A record yet. Either not added, or still propagating.
 *   unconfigured  — WE do not know our own ingress IP (PUBLIC_INGRESS_IP unset),
 *                   so no verdict is possible. Saying so is honest; saying
 *                   "not working" would blame the client for our gap.
 */
const STATES = Object.freeze({
  OK: "ok",
  WRONG_TARGET: "wrong_target",
  UNRESOLVED: "unresolved",
  UNCONFIGURED: "unconfigured",
});

/**
 * @param {string[]} resolved  A records found for the host
 * @param {string}   expected  the ingress IP we tell clients to point at
 * @returns {{state: string, ok: boolean}}
 */
function classify(resolved, expected) {
  if (!expected) return { state: STATES.UNCONFIGURED, ok: false };
  const found = Array.isArray(resolved) ? resolved.filter(Boolean) : [];
  if (found.length === 0) return { state: STATES.UNRESOLVED, ok: false };
  // Membership, not equality. A zone may legitimately carry more than one A
  // record for a host, and requiring an exact single match would report a
  // correctly-pointed domain as broken the moment someone adds a second.
  if (found.includes(expected)) return { state: STATES.OK, ok: true };
  return { state: STATES.WRONG_TARGET, ok: false };
}

/**
 * Resolve one host and classify it. Never throws: a DNS failure IS the answer
 * here (NXDOMAIN, SERVFAIL and a timeout all mean "not pointing at us yet"),
 * and turning it into a 500 would make a normal, expected onboarding state look
 * like an outage.
 *
 * @param {string} host
 * @param {string} expected
 * @param {(host: string) => Promise<string[]>} resolveA
 */
async function checkHost(host, expected, resolveA) {
  let resolved = [];
  try {
    resolved = await resolveA(host);
  } catch {
    resolved = [];
  }
  return { host, resolved, expected: expected || null, ...classify(resolved, expected) };
}

module.exports = { STATES, classify, checkHost };
