"use strict";
/**
 * Trial balance from the validated general ledger: per-account Σdebit/Σcredit.
 * Optional filters: entityId, periodId, from/to dates. Validated entries only —
 * drafts never appear in statements.
 */
async function trialBalance(client, { entityId = null, periodId = null, from = null, to = null } = {}) {
  const params = [];
  const wh = ["je.status = 'validated'"];
  if (entityId) { params.push(entityId); wh.push("je.entity_id = $" + params.length); }
  if (periodId) { params.push(periodId); wh.push("je.period_id = $" + params.length); }
  if (from) { params.push(from); wh.push("je.entry_date >= $" + params.length); }
  if (to) { params.push(to); wh.push("je.entry_date <= $" + params.length); }
  const { rows } = await client.query(
    "SELECT jl.account_code, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit " +
      "FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
      "WHERE " + wh.join(" AND ") +
      " GROUP BY jl.account_code ORDER BY jl.account_code",
    params,
  );
  return rows.map((r) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}


/** Grand livre: validated movements for one account, oldest first. */
async function accountMovements(client, { accountCode, entityId = null, from = null, to = null }) {
  const params = [accountCode];
  const wh = ["jl.account_code = $1", "je.status = 'validated'"];
  if (entityId) { params.push(entityId); wh.push("je.entity_id = $" + params.length); }
  if (from) { params.push(from); wh.push("je.entry_date >= $" + params.length); }
  if (to) { params.push(to); wh.push("je.entry_date <= $" + params.length); }
  const { rows } = await client.query(
    "SELECT je.entry_date::text AS entry_date, je.entry_no, je.description, jl.debit, jl.credit, jl.dossier_id " +
      "FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id WHERE " + wh.join(" AND ") +
      " ORDER BY je.entry_date ASC, je.entry_no ASC",
    params,
  );
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Cash (class 5) movement summary for a period — the TAFIRE foundation. */
async function cashFlow(client, { entityId = null, from, to }) {
  const openParams = [];
  let openWh = "account_code LIKE '5%' AND je.status = 'validated'";
  if (entityId) { openParams.push(entityId); openWh += " AND je.entity_id = $" + openParams.length; }
  if (from) { openParams.push(from); openWh += " AND je.entry_date < $" + openParams.length; }
  const opening = await client.query(
    "SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS bal FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id WHERE " + openWh,
    openParams,
  );
  const pParams = [];
  let pWh = "account_code LIKE '5%' AND je.status = 'validated'";
  if (entityId) { pParams.push(entityId); pWh += " AND je.entity_id = $" + pParams.length; }
  if (from) { pParams.push(from); pWh += " AND je.entry_date >= $" + pParams.length; }
  if (to) { pParams.push(to); pWh += " AND je.entry_date <= $" + pParams.length; }
  const period = await client.query(
    "SELECT COALESCE(SUM(jl.debit),0) AS inflow, COALESCE(SUM(jl.credit),0) AS outflow FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id WHERE " + pWh,
    pParams,
  );
  return {
    opening_cash: Number(opening.rows[0].bal),
    inflows: Number(period.rows[0].inflow),
    outflows: Number(period.rows[0].outflow),
  };
}


/**
 * TAFIRE sections (KB §12.1): each validated entry that touches cash (class 5) is
 * classified by its non-cash counterpart — class 2 -> investing, class 1 ->
 * financing, else operating — and its net cash change summed into that section.
 */
async function cashFlowSections(client, { entityId = null, from = null, to = null }) {
  const params = [];
  const wh = ["je.status = 'validated'"];
  if (entityId) { params.push(entityId); wh.push("je.entity_id = $" + params.length); }
  if (from) { params.push(from); wh.push("je.entry_date >= $" + params.length); }
  if (to) { params.push(to); wh.push("je.entry_date <= $" + params.length); }
  const { rows } = await client.query(
    "WITH ce AS (" +
      "  SELECT je.entry_id," +
      "    SUM(CASE WHEN jl.account_code LIKE '5%' THEN jl.debit - jl.credit ELSE 0 END) AS cash_net," +
      "    BOOL_OR(jl.account_code LIKE '2%') AS has2," +
      "    BOOL_OR(jl.account_code LIKE '1%') AS has1" +
      "  FROM journal_entry je JOIN journal_line jl ON jl.entry_id = je.entry_id" +
      "  WHERE " + wh.join(" AND ") +
      "  GROUP BY je.entry_id" +
      "  HAVING SUM(CASE WHEN jl.account_code LIKE '5%' THEN 1 ELSE 0 END) > 0)" +
      " SELECT" +
      "  COALESCE(SUM(CASE WHEN has2 THEN cash_net ELSE 0 END),0) AS investing," +
      "  COALESCE(SUM(CASE WHEN has1 AND NOT has2 THEN cash_net ELSE 0 END),0) AS financing," +
      "  COALESCE(SUM(CASE WHEN NOT has1 AND NOT has2 THEN cash_net ELSE 0 END),0) AS operating" +
      " FROM ce",
    params,
  );
  const r = rows[0] || {};
  return { operating: Number(r.operating || 0), investing: Number(r.investing || 0), financing: Number(r.financing || 0) };
}

/** Accounting periods for an entity (or all), newest first. */
async function listPeriods(client, { entityId = null } = {}) {
  const params = [];
  let wh = "";
  if (entityId) { params.push(entityId); wh = "WHERE entity_id = $1"; }
  const { rows } = await client.query(
    "SELECT period_id, entity_id, code, starts_on::text AS starts_on, ends_on::text AS ends_on, status, created_at " +
      "FROM accounting_period " + wh + " ORDER BY starts_on DESC",
    params,
  );
  return rows;
}

const getPeriod = async (client, periodId) => {
  const { rows } = await client.query("SELECT * FROM accounting_period WHERE period_id = $1", [periodId]);
  return rows[0] || null;
};

/** Trial balance restricted to one period's validated entries (close gate). */
async function trialBalanceForPeriod(client, periodId) {
  const { rows } = await client.query(
    "SELECT jl.account_code, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit " +
      "FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
      "WHERE je.period_id = $1 AND je.status = 'validated' " +
      "GROUP BY jl.account_code ORDER BY jl.account_code",
    [periodId],
  );
  return rows.map((r) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function setPeriodStatus(client, periodId, status) {
  const { rows } = await client.query(
    "UPDATE accounting_period SET status = $2 WHERE period_id = $1 RETURNING *",
    [periodId, status],
  );
  return rows[0] || null;
}

module.exports = {
  trialBalance, accountMovements, cashFlow, cashFlowSections,
  listPeriods, getPeriod, trialBalanceForPeriod, setPeriodStatus,
};
