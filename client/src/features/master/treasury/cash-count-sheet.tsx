/**
 * Petty-cash count sheet — reconciliation for the accounts nobody issues a
 * statement for.
 *
 * A bank tells you what it holds. Nobody tells you what is in the tin, so the
 * external truth has to be manufactured: someone opens the box, counts it, and
 * puts their name to the number. This screen is that act.
 *
 * WHY A DENOMINATION GRID AND NOT A TOTAL BOX. Because a total is an assertion
 * and a breakdown is evidence. "There is 155,000 in the drawer" cannot be
 * checked by anyone who was not standing there; "fourteen 10,000 notes, three
 * 5,000s" can be re-performed tomorrow, and a recount either reproduces the
 * tally or does not. It is also harder to write down a number you wish were
 * true when you have to say which notes make it up.
 *
 * The total is COMPUTED from the grid and is not typable. That is deliberate
 * and matches the server, which rejects a sheet whose stated total disagrees
 * with its own denominations: a count sheet whose arithmetic is done by the
 * person being counted is not a control.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import * as recon from "@/lib/reconciliation-api";

/**
 * BEAC notes and coins, largest first.
 *
 * Hard-coded to XAF because that is the currency of every account this screen
 * will meet in the CEMAC franc zone, and a tenant counting a second currency
 * needs a different list rather than a longer one. When that day comes this
 * becomes a lookup keyed on the account's currency; until then a fabricated
 * generality would be a worse lie than the constant.
 */
const XAF_DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5];

const num = (v: unknown) => Number(v ?? 0);

export function CashCountSheet({
  accountId, currency, floatLimit,
}: {
  accountId: string;
  currency: string;
  /** From treasury_account.float_limit — the ceiling this float is meant to stay under. */
  floatLimit?: number | null;
}) {
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [history, setHistory] = React.useState<recon.CashCount[] | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setHistory(await recon.listCashCounts(accountId));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [accountId]);

  React.useEffect(() => { void load(); }, [load]);

  const denominations = XAF_DENOMINATIONS
    .map((note) => ({ note, qty: Math.max(0, Math.floor(Number(counts[note] || 0))) }))
    .filter((d) => Number.isFinite(d.qty));

  const countedTotal = denominations.reduce((sum, d) => sum + d.note * d.qty, 0);
  const anyCounted = denominations.some((d) => d.qty > 0);
  const overFloat = floatLimit != null && countedTotal > Number(floatLimit);

  // The most recent count carries the ledger balance the server computed, which
  // is what a new count will be measured against. Shown so the person counting
  // knows what the books expect BEFORE they finish — hiding it would be worse
  // (it invites a count that quietly matches) but so would making them find it.
  const latest = history && history.length ? history[0] : null;

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const row = await recon.recordCashCount({
        treasury_account_id: accountId,
        denominations: denominations.filter((d) => d.qty > 0),
        variance_reason: reason || null,
      });
      const diff = num(row.difference);
      setNotice(
        diff === 0
          ? tr("Count recorded and it agrees with the ledger.")
          : `${tr("Count recorded.")} ${diff > 0 ? tr("Over") : tr("Short")} ${money(Math.abs(diff), currency)} — ${tr("the custodian must explain the variance before attesting.")}`,
      );
      setCounts({});
      setReason("");
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">{tr("Count the cash")}</h3>
          <p className="micro text-muted-foreground">
            {tr("Nobody issues a statement for petty cash, so the count is the external truth. Enter the notes and coins you can see; the total is worked out from them.")}
          </p>
        </div>

        {latest && (
          <p className="micro text-muted-foreground">
            {tr("Last counted")} {dateFmt(latest.counted_on)} · {tr("ledger balance then")} {money(num(latest.ledger_balance), currency)}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-right font-medium">{tr("Denomination")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Quantity")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {XAF_DENOMINATIONS.map((note) => {
                const qty = Math.max(0, Math.floor(Number(counts[note] || 0)));
                return (
                  <tr key={note} className="border-t">
                    <td className="px-3 py-1 text-right tabular-nums">{money(note, currency)}</td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        aria-label={`${tr("Quantity of")} ${note}`}
                        value={counts[note] ?? ""}
                        onChange={(e) => setCounts({ ...counts, [note]: e.target.value })}
                        className="w-24 rounded-md border bg-background px-2 py-1 text-right text-sm text-foreground"
                      />
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                      {qty > 0 ? money(note * qty, currency) : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t bg-muted/30">
                <td className="px-3 py-2 text-right font-medium" colSpan={2}>{tr("Counted total")}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{money(countedTotal, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {overFloat && (
          <Callout tone="warn" title={tr("Over the float limit")}>
            {tr("This float is set to")} {money(Number(floatLimit), currency)}. {tr("The count is above it — bank the excess or have the limit raised.")}
          </Callout>
        )}

        <div>
          <label className="micro text-muted-foreground" htmlFor="cash-variance">
            {tr("Explanation, if the count will not agree with the books")}
          </label>
          <textarea
            id="cash-variance"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr("e.g. 5 000 advanced to the driver, receipt not yet filed")}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {error && <ErrorState message={error} />}
        {notice && <Callout tone="ok">{notice}</Callout>}

        <Button onClick={save} disabled={busy || !anyCounted}>
          {busy ? tr("Saving…") : tr("Record this count")}
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">{tr("Counts")}</h3>
        {history === null ? (
          <LoadingRow />
        ) : history.length === 0 ? (
          <EmptyState
            title={tr("No counts recorded yet")}
            hint={tr("The first count establishes what the drawer actually holds against what the books say.")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{tr("Date")}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr("Counted")}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr("Ledger")}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr("Difference")}</th>
                  <th className="px-3 py-2 text-left font-medium">{tr("Status")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const diff = num(row.difference);
                  return (
                    <tr key={row.cash_count_id} className="border-t">
                      <td className="px-3 py-1.5 whitespace-nowrap">{dateFmt(row.counted_on)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(num(row.counted_total), row.currency)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(num(row.ledger_balance), row.currency)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${diff === 0 ? "" : "text-bad"}`}>
                        {money(diff, row.currency)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Pill tone={row.status === "DRAFT" ? "warn" : "ok"}>{row.status.toLowerCase()}</Pill>
                        {row.over_float_limit && <span className="micro ml-2 text-muted-foreground">{tr("over float")}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {row.status === "DRAFT" ? (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => void act(
                              () => recon.attestCashCount(row.cash_count_id, row.variance_reason || reason || undefined),
                              tr("Count attested."),
                            )}
                          >
                            {tr("Attest")}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => void act(
                              () => recon.renderCashCountDocument(row.cash_count_id),
                              tr("Count sheet issued and filed in the vault."),
                            )}
                          >
                            {tr("Issue sheet")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="micro text-muted-foreground">
          {tr("Attesting is the custodian saying the money was there. A count that disagrees with the books cannot be attested until the difference is explained.")}
        </p>
      </section>
    </div>
  );
}
