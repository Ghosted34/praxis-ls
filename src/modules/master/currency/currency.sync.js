/**
 * Live FX sync core (MOD-08) — ONE implementation shared by the "Sync now"
 * button (runs in-request via req.tenantDb) and the daily midnight cron (runs in
 * the fx-sync worker via withTenantConnection). Both hand it a tenant client, so
 * the fetch/upsert logic and the key-resolution order never drift between them.
 *
 * The key is resolved in priority order (BUILD_CONVENTIONS §7 — NOT .env-only):
 *   1. encrypted integration_secret 'fx_exchangerate' (Settings, AES-256-GCM)
 *   2. legacy plaintext setting fx.exchangerate_api_key (back-compat)
 *   3. config.EXCHANGERATE_API_KEY (deploy default)
 *
 * Rates are written with source 'exchangerate-api' and is_override=false, so a
 * manual override (source 'manual', is_override=true) always wins in the
 * resolver and a failed/late feed can never corrupt a hand-set rate.
 */
"use strict";
const axios = require("axios");
const repo = require("./currency.repo");
const { getSetting } = require("../../../shared/config/settings");
const settingService = require("../../security/setting/setting.service");
const { config } = require("../../../config/env");

async function resolveKey(client) {
  return (
    (await settingService.readSecret(client, "fx_exchangerate")) ||
    (await getSetting(client, "fx", "exchangerate_api_key", null)) ||
    config.EXCHANGERATE_API_KEY ||
    null
  );
}

/**
 * Fetch base→quotes from exchangerate-api.com and upsert each as today's feed
 * rate. Resolves base (the tenant's base currency) and quotes (all other active
 * currencies) from the DB when the caller does not pass them.
 *
 * @returns { base, as_of_date, fetched_at, source, updated: [{quote, rate}], unsupported: [code] }
 *          on a real run, or { skipped: true, reason } when the run was a no-op
 *          (no key configured, no active quote currencies).
 *
 * `skipped` is ALWAYS a boolean — the sentinel that says "no HTTP call was
 * made, no rows were written". Quote codes the provider returned no rate for
 * live on `unsupported` on a success payload. This split matters: callers
 * check `if (result.skipped === true)` (or the negation) to gate audit,
 * event-emission and the UI banner. The previous shape overloaded `skipped`
 * as an array on success — and an empty array is truthy in JS, so a fully
 * successful sync (four rates for XAF against CNY/EUR/NGN/USD → `skipped: []`)
 * looked like a skip to every caller: `service.syncNow` never emitted its
 * `RATE_SYNCED` audit, and the client's "Sync now" banner permanently read
 * "Sync skipped — no API key configured." even though rates were being
 * written. Boolean-only sentinel keeps the two states unambiguously distinct.
 */
async function syncRates(client, { base, quotes } = {}) {
  const baseCode = base || (await repo.getBaseCode(client)) || "XAF";
  const quoteCodes = (quotes || (await repo.listActiveCodes(client))).filter((q) => q && q !== baseCode);

  const key = await resolveKey(client);
  if (!key) {
    return {
      skipped: true,
      reason:
        "No exchangerate-api key configured (integration_secret 'fx_exchangerate', fx.exchangerate_api_key, or EXCHANGERATE_API_KEY).",
    };
  }
  if (!quoteCodes.length) {
    return { skipped: true, base: baseCode, reason: "no active quote currencies" };
  }

  const url = "https://v6.exchangerate-api.com/v6/" + key + "/latest/" + baseCode;

  // `validateStatus: () => true` — axios must NOT throw on a non-2xx here.
  //
  // It did, and that made the friendly branch below unreachable for exactly the
  // failures worth naming. The nightly job surfaced as a bare
  // `AxiosError: Request failed with status code 404` with the provider's own
  // explanation discarded, which says nothing about whether the key is wrong,
  // the plan lapsed, or the base currency is unsupported.
  //
  // The status codes matter and are distinct:
  //   404 — the KEY SEGMENT is not a known key. exchangerate-api puts the key in
  //         the PATH, so a stale, blank or truncated key makes the whole URL a
  //         404 rather than an auth error. This is the one that fired.
  //   200 + {result:"error"} — key recognised, request rejected (invalid-key on a
  //         revoked key, inactive-account, quota-reached, unsupported-code).
  const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  const data = res.data;

  if (res.status === 404) {
    // NEVER interpolate `url` — the API key is a path segment, and this message
    // is stored in platform.error_event and rendered in the Error Center.
    throw new Error(
      "exchangerate-api: 404 — the API key in the request path was not recognised. "
      + "Check integration_secret 'fx_exchangerate', the fx.exchangerate_api_key setting, "
      + `or EXCHANGERATE_API_KEY (base was ${baseCode}).`,
    );
  }
  if (res.status !== 200) {
    throw new Error(`exchangerate-api: HTTP ${res.status}${data && data["error-type"] ? ` — ${data["error-type"]}` : ""}`);
  }
  if (data && data.result === "error") {
    throw new Error("exchangerate-api: " + (data["error-type"] || "unknown error"));
  }
  const rates = (data && data.conversion_rates) || {};
  const fetchedAt = new Date().toISOString();
  const asOf = fetchedAt.slice(0, 10);

  const updated = [];
  const unsupported = [];
  for (const quote of quoteCodes) {
    const rate = Number(rates[quote]);
    if (!(rate > 0)) {
      unsupported.push(quote);
      continue;
    }
    await repo.upsertRate(client, { base: baseCode, quote, rate, asOfDate: asOf, source: "exchangerate-api", isOverride: false });
    updated.push({ quote, rate });
  }
  // Explicit `skipped: false` — the object always carries the sentinel so a
  // consumer can trust `result.skipped` without a `typeof` check.
  return { skipped: false, base: baseCode, as_of_date: asOf, fetched_at: fetchedAt, source: "exchangerate-api", updated, unsupported };
}

module.exports = { resolveKey, syncRates };
