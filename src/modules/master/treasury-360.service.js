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

/** Return the raw balance metrics: all-time, MTD, and YTD in one query (Audit #17). */
async function _balances(client, accountCode, mtdDate, ytdDate) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(jl.debit),0)::numeric AS debit_all, " +
    "       COALESCE(SUM(jl.credit),0)::numeric AS credit_all, " +
    "       COALESCE(SUM(CASE WHEN je.entry_date >= $2 THEN jl.debit ELSE 0 END),0)::numeric AS debit_mtd, " +
    "       COALESCE(SUM(CASE WHEN je.entry_date >= $2 THEN jl.credit ELSE 0 END),0)::numeric AS credit_mtd, " +
    "       COALESCE(SUM(CASE WHEN je.entry_date >= $3 THEN jl.debit ELSE 0 END),0)::numeric AS debit_ytd, " +
    "       COALESCE(SUM(CASE WHEN je.entry_date >= $3 THEN jl.credit ELSE 0 END),0)::numeric AS credit_ytd " +
    "  FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    " WHERE jl.account_code = $1 AND je.status = 'validated'",
    [accountCode, mtdDate, ytdDate],
  );
  const r = rows[0] || {};
  return {
    all: { debit: Number(r.debit_all || 0), credit: Number(r.credit_all || 0) },
    mtd: { debit: Number(r.debit_mtd || 0), credit: Number(r.credit_mtd || 0) },
    ytd: { debit: Number(r.debit_ytd || 0), credit: Number(r.credit_ytd || 0) },
  };
}



/** Recent journal lines that hit this account with reversal links (Audit #5, #16). */
async function _recentLines(client, accountCode, limit = 50) {
  const { rows } = await client.query(
    "SELECT jl.line_id, jl.entry_id, jl.debit, jl.credit, jl.currency, jl.dossier_id, " +
    "       je.entry_date, je.entry_no, je.description, je.source_doc_ref, je.status, " +
    "       je.corrects_entry_id, " +
    "       rev.entry_no AS reversed_by_entry_no, rev.entry_id AS reversed_by_entry_id, " +
    "       orig.entry_no AS reverses_entry_no, " +
    "       j.code AS journal_code " +
    "  FROM journal_line jl " +
    "  JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "  JOIN journal j ON j.journal_id = je.journal_id " +
    "  LEFT JOIN journal_entry rev ON rev.corrects_entry_id = je.entry_id AND rev.status = 'validated' " +
    "  LEFT JOIN journal_entry orig ON orig.entry_id = je.corrects_entry_id " +
    " WHERE jl.account_code = $1 " +
    " ORDER BY je.entry_date DESC, je.entry_no DESC " +
    " LIMIT $2",
    [accountCode, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)],
  );
  return rows;
}

/** The single most recent debit and credit on this account. Filtered to validated status (Audit #16). */
async function _lastMovements(client, accountCode) {
  const { rows } = await client.query(
    "(SELECT jl.debit AS amount, je.entry_date, je.description, je.entry_no, j.code AS journal_code, 'D' AS side " +
    "   FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "   JOIN journal j ON j.journal_id = je.journal_id " +
    "  WHERE jl.account_code = $1 AND jl.debit > 0 AND je.status = 'validated' " +
    "  ORDER BY je.entry_date DESC, je.entry_no DESC LIMIT 1) " +
    "UNION ALL " +
    "(SELECT jl.credit AS amount, je.entry_date, je.description, je.entry_no, j.code AS journal_code, 'C' AS side " +
    "   FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
    "   JOIN journal j ON j.journal_id = je.journal_id " +
    "  WHERE jl.account_code = $1 AND jl.credit > 0 AND je.status = 'validated' " +
    "  ORDER BY je.entry_date DESC, je.entry_no DESC LIMIT 1)",
    [accountCode],
  );
  const deb = rows.find((r) => r.side === "D") || null;
  const cr = rows.find((r) => r.side === "C") || null;
  return { last_debit: deb, last_credit: cr };
}

/** Unreconciled count: unmatched statement lines + open reconciliations (Audit #14). */
async function _unreconciledCount(client, accountId) {
  try {
    const { rows: lines } = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM bank_statement_line WHERE treasury_account_id = $1 AND match_status = 'UNMATCHED'",
      [accountId],
    );
    const { rows: recons } = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM reconciliation WHERE treasury_account_id = $1 AND status <> 'APPROVED_LOCKED'",
      [accountId],
    );
    return Number(lines[0]?.cnt || 0) + Number(recons[0]?.cnt || 0);
  } catch {
    return 0;
  }
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
 * Audit entries scoped to this treasury account, from `immutable_ledger`.
 *
 * THIS QUERIED `audit_log`, WHICH HAS NEVER EXISTED — no tenant migration has
 * ever created it. And because `load()` awaits this unconditionally while ONE
 * 360 call feeds every tab, `relation "audit_log" does not exist` 500'd the
 * entire dossier for every treasury account, every time.
 *
 * `immutable_ledger` (0130) is what `audit_log` was meant to be, and the match
 * is near-exact — which is the evidence that this is the right table rather
 * than a convenient one:
 *
 *   audit_log (never built)   immutable_ledger (real)
 *   ───────────────────────   ────────────────────────
 *   audit_id                  ledger_id
 *   action                    action            ← same name, same meaning
 *   actor_user_id             actor_user_id     ← same
 *   before_snapshot           before_json
 *   after_snapshot            after_json
 *   occurred_at               created_at
 *   entity_ref                entity_ref        ← same, and INDEXED
 *
 * NOT `event_log`, which was the first choice and the wrong one. Both tables
 * carry `entity_ref` and both are written on every treasury mutation, but
 * `event_log` is the workflow/notification stream — `event_type_key`, no
 * before/after — whereas `audit()` in emit.js writes the actual audit trail
 * here, with `before`/`after` payloads. `treasury_account.service.js` calls
 * BOTH; the
 * one this tab means by "every change to this account" is the ledger.
 *
 * `ix_ledger_entity` indexes `entity_ref`, and `trg_ledger_ro` forbids UPDATE
 * and DELETE — so this is append-only history, which is what a timeline wants.
 *
 * Aliased to the shape the client already reads (`client/src/lib/treasury-api.ts`),
 * so nothing downstream changes.
 */
async function _timeline(client, id, limit = 25) {
  const { rows } = await client.query(
    "SELECT il.ledger_id AS audit_id, il.action, il.actor_user_id, " +
    "       COALESCE(u.full_name, u.email, 'System') AS actor_name, u.email AS actor_email, " +
    "       il.before_json AS before_snapshot, il.after_json AS after_snapshot, " +
    "       il.created_at AS occurred_at " +
    "  FROM immutable_ledger il " +
    "  LEFT JOIN app_user u ON u.user_id = il.actor_user_id " +
    " WHERE il.entity_ref = $1 " +
    " ORDER BY il.created_at DESC LIMIT $2",
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

  const mtdDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const ytdDate = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  // Consolidated balances in one query (Audit #17)
  const balances = code ? await _balances(client, code, mtdDate, ytdDate) : {
    all: { debit: 0, credit: 0 },
    mtd: { debit: 0, credit: 0 },
    ytd: { debit: 0, credit: 0 },
  };

  const lastMovements = code ? await _lastMovements(client, code) : { last_debit: null, last_credit: null };
  const monthly = code ? await _monthlySeries(client, code) : [];
  const recentLines = code ? await _recentLines(client, code, 50) : [];
  const leaf = code ? await _leaf(client, code) : null;
  const custodian = await _custodian(client, acc.custodian_user_id);
  const verifier = await _verifier(client, acc.verified_by);
  const documents = await accRepo.listDocuments(client, id);
  const signatories = await accRepo.listSignatories(client, id);
  const timeline = await _timeline(client, id, 25);
  const unreconciledCount = await _unreconciledCount(client, id);

  const opening = Number(acc.opening_balance || 0);
  const posted = balances.all.debit - balances.all.credit;
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
      debit_total: balances.all.debit,
      credit_total: balances.all.credit,
      mtd: { debit: balances.mtd.debit, credit: balances.mtd.credit, net: balances.mtd.debit - balances.mtd.credit },
      ytd: { debit: balances.ytd.debit, credit: balances.ytd.credit, net: balances.ytd.debit - balances.ytd.credit },
      unreconciled_count: unreconciledCount,
    },
    last_debit: lastMovements.last_debit,
    last_credit: lastMovements.last_credit,
    monthly_series: monthly,
    recent_lines: recentLines,
    documents,
    signatories,
    timeline,
    readiness: buildReadiness(acc, documents),
  };
}

/**
 * A per-account readiness checklist, same idea as entity-360: an empty
 * account renders it as its empty state, and it explains what to do next
 * rather than showing "—".
 */
function buildReadiness(acc, docs = []) {
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
    const hasRib = (docs || []).some(
      (d) => d.document_type === "BANK_RIB" && (!d.expiry_date || new Date(d.expiry_date) >= new Date())
    );
    push("bank_rib", "Bank RIB / attestation", hasRib, "Attach a bank confirmation letter or RIB in Documents");
  }
  if (acc.category_is_momo_identity) {
    push("momo_number", "MoMo number", !!acc.momo_number);
    push("momo_network", "MoMo network", !!acc.momo_network);
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

// `_timeline` is exported for tests only. It queried `audit_log` — a table no
// tenant migration has ever created — and because `load()` awaits it
// unconditionally and one 360 call feeds every tab, that 500'd the whole
// dossier for every treasury account. Reachable only through `load`, it could
// not be asserted without standing up the other nine sub-queries; exporting it
// is cheaper than leaving the regression untested.
module.exports = { load, buildReadiness, _timeline };
