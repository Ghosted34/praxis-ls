/**
 * Cash request — the money half of the workflow.
 *
 * WHAT THIS EXISTS TO FIX. `cash_request` had six routes and the UI reached
 * exactly one of them: `submitCr`. There was no client function for `disburse`
 * or `justify` at all — and `cash_request.ai.js` exposed BOTH, so the assistant
 * could disburse cash and justify a request while a person at a screen could
 * not. An AI-only capability on the two actions that move money is a worse
 * failure than a missing feature.
 *
 * It also mattered more after Landing A: `justify` is now what RETIRES the
 * linked régie advance. Unreachable from the UI, advances get issued through the
 * product and can only be closed through the API — which is exactly the ageing
 * trap (581 never clearing, then a false 4211 receivable) that Landing A was
 * written to remove.
 *
 * WHY DISBURSE TAKES NO AMOUNT. The server disburses `cash_request.amount` in
 * full, and `cash_request.regie_advance_id` (0342:71) is a single uuid — one
 * request, one advance. An amount field here would imply a partial disbursement
 * that nothing can record: `insertPayment` is dead code and `disburse` has no
 * amount parameter. See §3.2 of the implementation plan for what real partial
 * disbursement would require.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { useList, errMsg } from "@/lib/use-resource";
import { money, todayISO } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/costing-api";

/**
 * Disburse an APPROVED request — issues the régie advance.
 *
 * `treasury_coa` is deliberately not offered: the server resolves it from
 * ('finance','accounts'), and letting the browser name a GL account would put
 * an account number in the client and bypass the postable-account guard.
 */
export function DisburseForm({
  request,
  onClose,
  onSaved,
}: {
  request: api.CashRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({
    entity_id: "",
    entry_date: todayISO(),
    source_doc_ref: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.disburseCashRequest(request.cash_request_id, {
        entity_id: f.entity_id,
        entry_date: f.entry_date,
        source_doc_ref: f.source_doc_ref || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Disburse cash request")}
      description="Issues a régie advance to the requester (Dr 581 / Cr treasury) and links it to this request."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Callout tone="info">
          {tr(
            "The full requested amount is disbursed as one advance. The holder then justifies it with receipts, and any unspent cash is returned on the advance itself.",
          )}
        </Callout>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={tr("Entity")} required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={f.entry_date}
              onChange={(e) => set("entry_date", e.target.value)}
            />
          </Field>
          <Field
            label={tr("Source doc ref")}
            hint="Defaults to this cash request's own reference."
          >
            <Input
              value={f.source_doc_ref}
              onChange={(e) => set("source_doc_ref", e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !f.entity_id || !f.entry_date}
          onCancel={onClose}
          saveLabel={tr("Disburse")}
        />
      </form>
    </Modal>
  );
}

/**
 * Justify a DISBURSED request: actual spend per line, which retires the linked
 * advance in the same transaction.
 *
 * The lines are loaded from the request so the user fills in `spent_amount`
 * against the budget they asked for, rather than retyping the breakdown. The
 * budget column is shown read-only beside it because "what did you actually
 * spend against what you asked for" is the whole question this form answers.
 */
export function JustifyForm({
  request,
  onClose,
  onSaved,
}: {
  request: api.CashRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = React.useState<api.CashRequestDetail | null>(null);
  const [lines, setLines] = React.useState<api.CashLine[]>([]);
  const [entryDate, setEntryDate] = React.useState(todayISO());
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    api
      .getCashRequest(request.cash_request_id)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setLines(
          (d.lines || []).map((l) => ({
            ...l,
            spent_amount: l.spent_amount ?? l.budget_amount ?? 0,
          })),
        );
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [request.cash_request_id]);

  const setLine = (i: number, spent: number) =>
    setLines((ls) =>
      ls.map((l, j) => (j === i ? { ...l, spent_amount: spent } : l)),
    );

  const budget = lines.reduce((s, l) => s + Number(l.budget_amount || 0), 0);
  const spent = lines.reduce((s, l) => s + Number(l.spent_amount || 0), 0);
  const advanced = Number(detail?.amount ?? request.total_budget ?? 0);
  const unspent = Math.round((advanced - spent) * 100) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.justifyCashRequest(request.cash_request_id, {
        lines: lines.map((l) => ({
          dictionary_item_id: l.dictionary_item_id ?? null,
          label: l.label,
          budget_amount: Number(l.budget_amount || 0),
          spent_amount: Number(l.spent_amount || 0),
          is_disbursement: l.is_disbursement === true,
        })),
        entry_date: entryDate,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title={tr("Justify cash request")}
      description="Records what was actually spent and retires the régie advance this request drew on."
    >
      <form className="space-y-4" onSubmit={submit}>
        {unspent > 0 && (
          <Callout tone="warn">
            {tr(
              "This leaves unspent cash on the advance. A fully justified advance must net to zero, so record the remainder as cash returned on the advance before justifying — otherwise the server will refuse.",
            )}
          </Callout>
        )}
        {loading ? (
          <div className="text-muted-foreground">{tr("Loading…")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{tr("Line")}</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {tr("Budget")}
                  </th>
                  <th className="py-2 text-right font-medium">{tr("Spent")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">{l.label || "—"}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {money(l.budget_amount)}
                    </td>
                    <td className="py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="num ml-auto max-w-[10rem] text-right"
                        value={String(l.spent_amount ?? 0)}
                        onChange={(e) => setLine(i, Number(e.target.value))}
                        aria-label={`${tr("Spent")} — ${l.label || i + 1}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-2 pr-3">{tr("Total")}</td>
                  <td className="num py-2 pr-3 text-right tabular-nums">
                    {money(budget)}
                  </td>
                  <td className="num py-2 text-right tabular-nums">
                    {money(spent)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || loading || lines.length === 0}
          onCancel={onClose}
          saveLabel={tr("Justify")}
        />
      </form>
    </Modal>
  );
}

/**
 * The row actions a cash request offers, chosen by its status.
 *
 * Mirrors `cash_request.rules.js` NEXT: DRAFT→SUBMITTED, SUBMITTED→APPROVED
 * /REJECTED, APPROVED→DISBURSED, DISBURSED→JUSTIFIED. The server re-checks every
 * one via `assertTransition`, so this decides what to OFFER, never what is
 * allowed — a 422 from the API is still the authority.
 */
export function CashRequestActions({
  request,
  busy,
  onTransition,
  onDisburse,
  onJustify,
}: {
  request: api.CashRequest;
  busy: boolean;
  onTransition: (to: "SUBMITTED" | "APPROVED" | "REJECTED") => void;
  onDisburse: () => void;
  onJustify: () => void;
}) {
  const st = String(request.status || "DRAFT").toUpperCase();
  return (
    <>
      {st === "DRAFT" && (
        <Button
          size="sm"
          variant="outline"
          loading={busy}
          onClick={() => onTransition("SUBMITTED")}
        >
          {tr("Submit")}
        </Button>
      )}
      {st === "SUBMITTED" && (
        <>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => onTransition("APPROVED")}
          >
            {tr("Approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => onTransition("REJECTED")}
          >
            {tr("Reject")}
          </Button>
        </>
      )}
      {st === "APPROVED" && (
        <Button size="sm" variant="outline" onClick={onDisburse}>
          {tr("Disburse")}
        </Button>
      )}
      {st === "DISBURSED" && (
        <Button size="sm" variant="outline" onClick={onJustify}>
          {tr("Justify")}
        </Button>
      )}
    </>
  );
}
