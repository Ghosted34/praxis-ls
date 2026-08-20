/**
 * Collapse per-record checks into the row the dashboard stores.
 * PURE given the check results.
 */
"use strict";

function toRow(domain, record, check, { selector = null } = {}) {
  const ok = check && check.ok;
  const verdict = ok === true ? "PASS" : ok === false ? "FAIL" : "UNKNOWN";
  return {
    domain,
    record,
    selector: selector || check.selector || null,
    verdict,
    value: valueOf(check),
    suggestion: check.hint || check.reading || (check.suggest && check.suggest[0]) || null,
  };
}

function valueOf(check) {
  if (!check) return null;
  if (check.record) return check.record;
  if (check.raw) return check.raw;
  if (check.names) return check.names.join(", ");
  if (Array.isArray(check.records)) {
    return check.records.map((r) => (r.host ? `${r.priority} ${r.host}` : r)).join(", ");
  }
  if (check.listings) {
    return check.listings.filter((l) => l.listed).map((l) => l.host).join(", ") || "not listed";
  }
  return null;
}

function regression(prev, next) {
  if (!prev || !next) return false;
  return prev.verdict === "PASS" && next.verdict === "FAIL";
}

module.exports = { toRow, regression, valueOf };
