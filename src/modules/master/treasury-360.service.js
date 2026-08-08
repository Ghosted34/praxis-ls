/**
 * Treasury account dossier (MOD-09).
 *
 * One call returns everything /master/treasury-accounts/:id renders: the
 * account (joined with its category and its CoA leaf), a KPI band with the
 * live balance and last debit/credit + this-month-vs-last, the last N
 * journal lines that hit its CoA leaf, a 12-month movement series, the
 * custodian card for petty cash, sub-account information (a treasury account
 * OWNS ONE leaf, not many, so this is the leaf's own record plus any drilled
 * children a treasurer added by hand under the same code), a documents stub,
 * and a timeline of audit-log events keyed on this account.
 *
 * Modelled on entity-360.service.js — same top-level `dossier(c, id)` shape,
 * so the frontend can reuse the same fetch/render loop pattern.
 *
 * READ-ONLY. Everything here computes from journal_line + treasury_account +
 * audit_log; it never writes. Actions (record deposit, transfer, verify) go
 * through the treasury_account service.
 */
"use strict";
// treasury_account.repo is loaded lazily from load() so that the require graph
// stays a DAG (this file lives in master/, its consumer is treasury_account/
// two levels down, and pre-loading would circle).

/** Return the raw balance metric: SUM(debit) - SUM(credit). For a class-5
 *  account (normal balance D), this IS the balance. */
async function _balance(client, accountCode, sinceDate) {
  const params = [accountCode];
  let dateClause = "";
  if (sinceDate) { params.push(sinceDate); dateClause = " AND je.entry_date >= $2"; }
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(jl.debit),0)::numeric AS debit_sum, " +
    "       COALESCE(SUM(jl.credit),0)::numeric AS credit_sum " +
    "  FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    " WHERE jl.account_code = $1 AND je.status = 'validated'" + dateClause,
    params,
  );
  const r = rows[0] || { debit_sum: 0, credit_sum: 0 };
  return { debit: Number(r.debit_sum), credit: Number(r.credit_sum) };
}

/** Recent journal lines that hit this account, most recent first. */
async function _recentLines(client, accountCode, limit = 50) {
  const { rows } = await client.query(
    "SELECT jl.line_id, jl.entry_id, jl.debit, jl.credit, jl.currency, jl.dossier_id, " +
    "       je.entry_date, je.entry_no, je.description, je.source_doc_ref, je.status, " +
    "       j.code AS journal_code " +
    "  FROM journal_line jl " +
    "  JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "  JOIN journal j ON j.journal_id = je.journal_id " +
    " WHERE jl.account_code = $1 " +
    " ORDER BY je.entry_date DESC, je.entry_no DESC " +
    " LIMIT $2",
    [accountCode, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)],
  );
  return rows;
}

/** The single most recent debit and credit on this account. Rendered as the
 *  "Last debit / Last credit" tiles on the Overview. */
async function _lastMovements(client, accountCode) {
  const debQ = client.query(
    "SELECT jl.debit AS amount, je.entry_date, je.description, je.entry_no, j.code AS journal_code " +
    "  FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "  JOIN journal j ON j.journal_id = je.journal_id " +
    " WHERE jl.account_code = $1 AND jl.debit > 0 " +
    " ORDER BY je.entry_date DESC, je.entry_no DESC LIMIT 1",
    [accountCode],
  );
  const crQ = client.query(
    "SELECT jl.credit AS amount, je.entry_date, je.description, je.entry_no, j.code AS journal_code " +
    "  FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "  JOIN journal j ON j.journal_id = je.journal_id " +
    " WHERE jl.account_code = $1 AND jl.credit > 0 " +
    " ORDER BY je.entry_date DESC, je.entry_no DESC LIMIT 1",
    [accountCode],
  );
  const [d, c] = await Promise.all([debQ, crQ]);
  return { last_debit: d.rows[0] || null, last_credit: c.rows[0] || null };
}

/** 12-month movement series (calendar month, per side). */
async function _monthlySeries(client, accountCode) {
  const { rows } = await client.query(
    "SELECT to_char(date_trunc('month', je.entry_date), 'YYYY-MM') AS period_code, " +
    "       COALESCE(SUM(jl.debit),0)::numeric  AS debit_sum, " +
    "       COALESCE(SUM(jl.credit),0)::numeric AS credit_sum " +
    "  FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    " WHERE jl.account_code = $1 AND je.status = 'validated' " +
    "   AND je.entry_date >= (CURRENT_DATE - INTERVAL '12 months') " +
    " GROUP BY 1 ORDER BY 1",
    [accountCode],
  );
  return rows.map((r) => ({
    period_code: r.period_code,
    debit: Number(r.debit_sum),
    credit: Number(r.credit_sum),
    net: Number(r.debit_sum) - Number(r.credit_sum),
  }));
}

/** The custodian card for petty cash (`u.full_name`, email, phone…). */
async function _custodian(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query(
    "SELECT user_id, full_name, email, phone, is_active FROM app_user WHERE user_id = $1",
    [userId],
  );
  return rows[0] || null;
}

/** The verifier stamp — same shape as the custodian card. */
async function _verifier(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query(
    "SELECT user_id, full_name, email FROM app_user WHERE user_id = $1",
    [userId],
  );
  return rows[0] || null;
}

/** The CoA leaf record — includes label_fr, is_active, is_postable so the
 *  Sub-accounts tab can show it. */
async function _leaf(client, code) {
  if (!code) return null;
  const { rows } = await client.query(
    "SELECT code, parent_code, label_fr, label_en, class, is_postable, is_active, entity_id " +
    "  FROM chart_of_accounts WHERE code = $1",
    [code],
  );
  return rows[0] || null;
}

/**
 * Audit-log entries scoped to this treasury account. Same pattern
 * (`entity_ref = 'treasury_account:<id>'`) that emit.js uses everywhere.
 */
async function _timeline(client, id, limit = 25) {
  const { rows } = await client.query(
    "SELECT audit_id, action, actor_user_id, before_snapshot, after_snapshot, occurred_at " +
    "  FROM audit_log WHERE entity_ref = $1 " +
    " ORDER BY occurred_at DESC LIMIT $2",
    ["treasury_account:" + id, Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200)],
  );
  return rows;
}

/**
 * Return the account (joined with category and leaf) plus every rollup the
 * dossier page renders.
 */
async function load(client, { id }) {
  const accRepo = require("./treasury_account/treasury_account.repo");
  const acc = await accRepo.getWithCategory(client, id);
  if (!acc) return null;

  const code = acc.coa_code;

  // Every one of these runs on the SAME tenant client (a pg client cannot
  // execute two queries at once), so it's sequential. If a page gets slow, add
  // a materialised view on the finance side rather than parallelising here.
  const balanceAll = code ? await _balance(client, code, null) : { debit: 0, credit: 0 };
  const balanceMtd = code
    ? await _balance(client, code, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
    : { debit: 0, credit: 0 };
  const balanceYtd = code
    ? await _balance(client, code, new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10))
    : { debit: 0, credit: 0 };
  const lastMovements = code ? await _lastMovements(client, code) : { last_debit: null, last_credit: null };
  const monthly = code ? await _monthlySeries(client, code) : [];
  const recentLines = code ? await _recentLines(client, code, 50) : [];
  const leaf = code ? await _leaf(client, code) : null;
  const custodian = await _custodian(client, acc.custodian_user_id);
  const verifier = await _verifier(client, acc.verified_by);
  const timeline = await _timeline(client, id, 25);

  const opening = Number(acc.opening_balance || 0);
  const posted = balanceAll.debit - balanceAll.credit;
  const balance = opening + posted;

  return {
    account: acc,
    category: acc.category_id ? {
      treasury_category_id: acc.category_id,
      code: acc.category_code,
      label: acc.category_label,
      requires_custodian: acc.category_requires_custodian,
      is_bank_identity: acc.category_is_bank_identity,
      is_momo_identity: acc.category_is_momo_identity,
      coa_parent_code: acc.category_coa_parent_code,
    } : null,
    coa_leaf: leaf,
    custodian, verifier,
    kpis: {
      opening_balance: opening,
      posted_net: posted,
      balance,
      currency: acc.currency,
      debit_total: balanceAll.debit,
      credit_total: balanceAll.credit,
      mtd: { debit: balanceMtd.debit, credit: balanceMtd.credit, net: balanceMtd.debit - balanceMtd.credit },
      ytd: { debit: balanceYtd.debit, credit: balanceYtd.credit, net: balanceYtd.debit - balanceYtd.credit },
      unreconciled_count: null,  // stub — filled in when the reconciliation feature lands
    },
    last_debit: lastMovements.last_debit,
    last_credit: lastMovements.last_credit,
    monthly_series: monthly,
    recent_lines: recentLines,
    documents: [],   // stub — treasury docs come in a follow-up
    timeline,
    readiness: buildReadiness(acc),
  };
}

/**
 * A per-account readiness checklist, same idea as entity-360: an empty
 * account renders it as its empty state, and it explains what to do next
 * rather than showing "—".
 */
function buildReadiness(acc) {
  const items = [];
  const push = (key, label, ok, hint) => items.push({ key, label, ok: ok === true, hint: hint || null });

  push("label", "Label", !!acc.label);
  push("category", "Category selected", !!acc.category_id, "Pick a category so the CoA leaf can be minted");
  push("coa_code", "CoA leaf minted", !!acc.coa_code);
  push("currency", "Currency", !!acc.currency);

  if (acc.category_is_bank_identity) {
    push("bank_name", "Bank name", !!acc.bank_name);
    push("account_number", "Account number", !!acc.account_number);
    push("iban", "IBAN", !!acc.iban, "Some jurisdictions accept the account number without an IBAN");
    push("swift_bic", "SWIFT / BIC", !!acc.swift_bic);
  }
  if (acc.category_is_momo_identity) {
    push("momo_number", "MoMo number", !!acc.momo_number);
  }
  if (acc.category_requires_custodian) {
    push("custodian", "Custodian", !!acc.custodian_user_id);
    push("float_limit", "Float limit", acc.float_limit !== null && acc.float_limit !== undefined);
  }
  push("opening_balance", "Opening balance recorded", acc.opening_date !== null, "Record an opening balance so the 360 can reconcile against a starting point");
  push("verified", "Verified against bank letter", acc.is_verified === true, "Have a treasurer confirm the numbers");

  const total = items.length;
  const done = items.filter((i) => i.ok).length;
  return { items, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

module.exports = { load, buildReadiness };
