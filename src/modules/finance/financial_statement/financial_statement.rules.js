/**
 * Statements aggregation (KB §12) — pure, no DB.
 * Input: trial-balance rows [{ account_code, debit, credit }] (validated GL only).
 * Produces the trial-balance totals, the Compte de résultat / P&L (classes 6, 7
 * AND 8 — ending at 131 Résultat net, KB §12.1) and a first-cut Bilan.
 */
"use strict";

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);
const classOf = (code) => parseInt(String(code)[0], 10);
const bal = (r) => num(r.debit) - num(r.credit); // debit-positive balance

function trialBalanceTotals(rows) {
  let debit = 0;
  let credit = 0;
  for (const r of rows) { debit += num(r.debit); credit += num(r.credit); }
  return { debit: round2(debit), credit: round2(credit), balanced: round2(debit) === round2(credit) };
}

/**
 * Compte de résultat (Income Statement / P&L), KB §12.1: built from classes 6, 7
 * and 8. Class 8 (HAO + income tax) is "mixed" — classified by balance sign
 * (debit → charge, e.g. 89 IS; credit → produit). result = produits - charges =
 * Résultat net (lands in 131). `hao` is the class-8 net for transparency.
 */
function incomeStatement(rows) {
  let charges = 0;
  let produits = 0;
  let haoNet = 0; // credit-positive
  for (const r of rows) {
    const c = classOf(r.account_code);
    if (c === 6) {
      charges += bal(r);
    } else if (c === 7) {
      produits += -bal(r);
    } else if (c === 8) {
      const b = bal(r);
      if (b >= 0) charges += b; else produits += -b; // debit=charge (IS), credit=produit
      haoNet += -b;
    }
  }
  charges = round2(charges);
  produits = round2(produits);
  return { charges, produits, hao_net: round2(haoNet), result: round2(produits - charges) };
}

/**
 * First-cut Bilan: classes 1-5 grouped by side, result folded into equity.
 * active = debit-balance accounts (2,3,5 + class-4 receivables); passif =
 * credit-balance accounts (1 + class-4 payables) + result.
 */
function balanceSheet(rows, result) {
  let active = 0;
  let passif = 0;
  for (const r of rows) {
    const c = classOf(r.account_code);
    if (c < 1 || c > 5) continue;
    const b = bal(r);
    if (b >= 0) active += b; else passif += -b;
  }
  active = round2(active);
  passif = round2(passif + num(result));
  return { active, passif, result: round2(num(result)), balanced: active === passif };
}


/** Grand livre with a running debit-positive balance per row. */
function runningBalance(rows, opening = 0) {
  let bal = round2(Number(opening) || 0);
  return rows.map((r) => {
    bal = round2(bal + num(r.debit) - num(r.credit));
    return { ...r, balance: bal };
  });
}

/** Cash-flow summary (TAFIRE foundation): closing = opening + inflows - outflows. */
function cashFlowSummary({ opening_cash, inflows, outflows }) {
  const net = round2(num(inflows) - num(outflows));
  return {
    opening_cash: round2(num(opening_cash)),
    inflows: round2(num(inflows)),
    outflows: round2(num(outflows)),
    net_change: net,
    closing_cash: round2(num(opening_cash) + net),
  };
}


/** OHADA TAFIRE: opening cash + operating/investing/financing = closing cash. */
function tafire({ opening_cash, operating, investing, financing }) {
  const op = round2(num(operating)), inv = round2(num(investing)), fin = round2(num(financing));
  const net = round2(op + inv + fin);
  return { opening_cash: round2(num(opening_cash)), operating: op, investing: inv, financing: fin, net_change: net, closing_cash: round2(num(opening_cash) + net) };
}

module.exports = { classOf, trialBalanceTotals, incomeStatement, balanceSheet, bal, runningBalance, cashFlowSummary, tafire };
