/**
 * The cash-request worksheet — a page on desktop, a sheet on a phone.
 *
 * ── WHY IT IS A ROUTE, AND WHY IT MIRRORS THE COSTING ──────────────────────
 *
 * The cash request was a `<Modal size="lg">` that could only be created, never
 * edited: the form posted and closed, and `PATCH /cash-requests/:id` — a route
 * the API has always exposed — had no caller at all. The same three arguments
 * that moved the costing onto its own route apply here: a document carrying a
 * file strip, a nine-column grid, a payments table and a workflow rail does not
 * fit in a dialog; a request awaiting approval has to be SENDABLE, which needs
 * an address; and the body must render from the RESPONSE, because a request
 * opened from a pasted link has a uuid and nothing else (FRONTEND_GUIDE §3.11).
 *
 * ── THE THING THIS SCREEN EXISTS TO SHOW ───────────────────────────────────
 *
 * A costing is the operations file's fulfilment budget, and this document draws
 * it down. So the grid is not a list of amounts — every row carries what the
 * budget authorised, what is already claimed against it, what this request
 * wants, and what would be left. Pick the file and the lines arrive already
 * defaulted to what remains; untick what this request is not for.
 *
 * Nothing here decides what is ALLOWED. The server re-derives every gate
 * (`assertFundable`) and a 422 is always the last word; this decides what to
 * offer, and explains a refusal before the person meets it.
 */
import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { Record360Page, Record360Header } from "@/components/record-360";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { MeterGroup } from "@/components/ui/meter";
import { EmptyState } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { DocButton } from "@/components/doc-button";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/costing-api";
import { CashLineGrid, CashTotalsFooter } from "./cash-request-lines";
import { COSTING_BASE } from "./costing-model";
import {
  CASH_REQUEST_BASE,
  computeTotals,
  fromSaved,
  isEditable,
  isOverBudget,
  pickedLines,
  statusLabel,
  statusTone,
  toPayload,
  type LineDraft,
} from "./cash-request-model";

/* ── The budget banner ─────────────────────────────────────────────────────── */

/**
 * The legacy's best idea, kept: the moment a file is chosen its costing is
 * checked, and the answer is a red STOP or a green go with the import beside
 * it. It is the clearest thing on that screen and it puts the refusal where the
 * person can still act on it.
 *
 * Ours adds the way forward — the costing is a LINK, so "request an unlock and
 * amend it" is one click rather than a hunt through another module.
 */
function BudgetBanner({ control }: { control: api.BudgetControl }) {
  const ref = control.costing_doc_number || tr("the costing");
  const link = control.costing_id ? (
    <Link className="underline underline-offset-2" to={`${COSTING_BASE}/${control.costing_id}`}>
      {ref}
    </Link>
  ) : (
    ref
  );

  if (control.can_fund === false) {
    return (
      <Callout tone="bad" title={tr("This file's budget is not approved")}>
        {link} {tr("is")} {statusLabel(control.costing_status)}.{" "}
        {tr("No cash can be raised against this file until its budget is approved.")}
      </Callout>
    );
  }
  if (control.is_over_budget) {
    return (
      <Callout tone="warn" title={tr("This request claims more than the budget has left")}>
        {control.breaches.length} {tr("line(s) exceed what")} {link} {tr("has available.")}{" "}
        {tr("Say why below — it can be submitted, but it cannot be approved until the costing is unlocked and amended.")}
      </Callout>
    );
  }
  if (control.unbudgeted_line_count > 0) {
    return (
      <Callout tone="warn" title={tr("Some lines are not drawn from the budget")}>
        {tr("Every spend on an operations file goes through its costing. Import the line from")}{" "}
        {link}, {tr("or request an unlock and add it to the sheet first.")}
      </Callout>
    );
  }
  return (
    <Callout tone="ok" title={tr("Budget approved")}>
      {link} — {money(control.remaining_before, control.currency)} {tr("available on this file.")}
    </Callout>
  );
}

/** The four numbers a validator and an approver need, in one block. */
function BudgetControlPanel({ control }: { control: api.BudgetControl }) {
  const ccy = control.currency || "XAF";
  const row = (label: string, value: number, tone?: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="micro">{label}</span>
      <span className={`num text-sm tabular-nums ${tone || "text-foreground"}`}>
        {money(value, ccy)}
      </span>
    </div>
  );
  return (
    <Panel title={tr("Budgetary control")}>
      <div className="space-y-1.5">
        {row(tr("Budget on this file"), control.budget_total)}
        {row(tr("Committed by other requests"), control.committed_elsewhere)}
        {row(tr("Available to this request"), control.remaining_before)}
        {row(tr("Claimed here"), control.claimed_here)}
        {row(
          tr("Remaining after this"),
          control.remaining_after,
          control.remaining_after < 0 ? "font-medium text-[rgb(var(--bad))]" : undefined,
        )}
      </div>
      {control.is_over_budget && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {control.breaches.map((b) => (
            <li key={b.costing_line_id} className="flex flex-wrap items-baseline gap-2">
              <Pill tone="bad">{tr("Over")}</Pill>
              <span className="text-sm text-foreground">{b.label || "—"}</span>
              <span className="num micro">
                {money(b.claim, ccy)} {tr("of")} {money(b.remaining, ccy)}
              </span>
              <span className="num micro text-[rgb(var(--bad))]">+{money(b.excess, ccy)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── The payments table ────────────────────────────────────────────────────── */

/**
 * Every instalment, and who took it.
 *
 * Partial disbursement has been recorded correctly since 10719 and surfaced as
 * a single number. A request the treasury funded in two tranches is two
 * movements of money, two régie advances and two acknowledgements, and this is
 * where they become visible.
 */
function PaymentsPanel({
  request,
  currency,
  onAcknowledge,
  busy,
}: {
  request: api.CashRequestDetail;
  currency: string;
  onAcknowledge: (paymentId: string) => void;
  busy: boolean;
}) {
  const payments = request.payments || [];
  const requested = Number(request.amount || 0);
  const paid = Number(request.disbursed_amount || 0);
  const outstanding = Math.round((requested - paid) * 100) / 100;

  return (
    <Panel title={tr("Disbursement")}>
      {/* One scale, so "paid" and "outstanding" are read against the request
          rather than against each other. */}
      <MeterGroup
        ariaLabel={tr("How much of this request has been disbursed")}
        max={requested || 1}
        rows={[
          { label: tr("Requested"), value: requested, display: money(requested, currency), tone: "neutral" },
          { label: tr("Disbursed"), value: paid, display: money(paid, currency), tone: "accent" },
          {
            label: tr("Outstanding"),
            value: outstanding,
            display: money(outstanding, currency),
            tone: outstanding > 0 ? "warn" : "ok",
          },
        ]}
      />

      {payments.length === 0 ? (
        <p className="micro mt-3">{tr("Nothing has been paid out yet.")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>{tr("Paid on")}</TH>
                <TH className="text-right">{tr("Amount")}</TH>
                <TH>{tr("Received")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {payments.map((p) => (
                <TR key={p.cash_request_payment_id}>
                  <TD className="num">{dateFmt(p.paid_on)}</TD>
                  <TD className="num text-right tabular-nums">{money(p.amount, currency)}</TD>
                  <TD>
                    {p.received_at ? (
                      <span className="micro">
                        {dateFmt(p.received_at)}
                        {p.received_ack_kind === "WET_SCAN" ? ` · ${tr("signed on paper")}` : ""}
                      </span>
                    ) : (
                      <Pill tone="warn">{tr("Not acknowledged")}</Pill>
                    )}
                  </TD>
                  <TD className="text-right">
                    {!p.received_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy}
                        onClick={() => onAcknowledge(p.cash_request_payment_id)}
                      >
                        {tr("Acknowledge receipt")}
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

/* ── A reason, asked properly ──────────────────────────────────────────────── */

/**
 * Three of this document's acts need a written reason — rejecting, claiming
 * over budget, and settling a request short — and the server refuses without
 * one. Asked in a `<Dialog>` with a real `<Field>`, never through a browser
 * prompt: a native dialog is drawn by the browser, so it discards the tenant's
 * branding at the exact moment the product asks them to explain themselves
 * (CLAUDE.md, FRONTEND_GUIDE §3.10).
 */
function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onConfirm(reason.trim());
        }}
      >
        <Field label={tr("Reason")} required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={tr("What should the next person know?")}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!reason.trim()}
            variant={destructive ? "destructive" : "default"}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ── The body ──────────────────────────────────────────────────────────────── */

export function CashRequest360({
  id,
  variant = "page",
  onChanged,
}: {
  id: string;
  variant?: "page" | "modal";
  onChanged?: () => void;
}) {
  const res = useResource(() => api.getCashRequest(id), [id]);
  const cr = res.data;

  const [lines, setLines] = React.useState<LineDraft[] | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reasonFor, setReasonFor] = React.useState<null | "REJECT" | "OVER_BUDGET" | "CLOSE">(null);

  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();

  const editable = isEditable(cr?.status);
  const control = cr?.budget_control || null;

  /*
   * The budget the lines are measured against. Loaded for THIS request, so the
   * ledger leaves its own claims out — otherwise an approved request would be
   * measured against a balance it is itself inside, and every line would read
   * as over budget.
   */
  const budgetRes = useResource(
    () => (cr?.costing_id ? api.getCostingBudget(cr.costing_id, id) : Promise.resolve(null)),
    [cr?.costing_id, id],
  );

  React.useEffect(() => {
    if (!cr) return;
    const byLine = new Map(
      (budgetRes.data?.lines || []).map((b) => [b.costing_line_id, b]),
    );
    setLines((cr.lines || []).map((l) => fromSaved(l, l.costing_line_id ? byLine.get(l.costing_line_id) : undefined)));
    setDirty(false);
  }, [cr, budgetRes.data]);

  const { reload } = res;
  const refresh = React.useCallback(() => {
    reload();
    budgetRes.reload();
    onChanged?.();
  }, [reload, budgetRes, onChanged]);

  const ccy = cr?.currency || budgetRes.data?.currency || "XAF";
  const totals = React.useMemo(() => computeTotals(lines || []), [lines]);
  const overBudget = (lines || []).some(isOverBudget);

  /** Run one action, surfacing its refusal rather than swallowing it. */
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(success);
      refresh();
      return true;
    } catch (err) {
      setError(errMsg(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!lines) return false;
    return act(
      () => api.updateCashRequest(id, { lines: pickedLines(lines).map(toPayload) }),
      tr("Saved"),
    );
  }

  /** Seed the sheet from the budget, defaulted to what each line has LEFT. */
  async function importFromBudget() {
    await act(() => api.importCostingLines(id), tr("Budget lines loaded"));
  }

  async function submit() {
    if (dirty && !(await save())) return;
    if (overBudget) {
      setReasonFor("OVER_BUDGET");
      return;
    }
    await act(() => api.transitionCashRequest(id, "SUBMITTED"), tr("Submitted"));
  }

  if (res.loading && !cr) return <SkeletonTable rows={6} cols={5} />;
  if (res.error)
    return <ScreenError message={res.error} what="Cash request" onRetry={res.reload} />;
  if (!cr)
    return <EmptyState title={tr("Not found")} hint="This cash request could not be loaded." />;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <DocButton
        docType="CASH_REQUEST"
        id={cr.cash_request_id}
        title={cr.doc_number || tr("Cash request")}
        label={tr("Print / preview")}
      />
      {editable && (
        <>
          {cr.costing_id && (
            <Button variant="outline" loading={busy} onClick={importFromBudget}>
              {tr("Load from budget")}
            </Button>
          )}
          <Button onClick={save} loading={busy} disabled={!dirty}>
            {tr("Save")}
          </Button>
          <Button variant="outline" loading={busy} onClick={submit}>
            {tr("Submit")}
          </Button>
        </>
      )}
      {cr.status === "SUBMITTED" && (
        <>
          <Button
            loading={busy}
            onClick={() => act(() => api.transitionCashRequest(id, "VALIDATED"), tr("Validated"))}
          >
            {tr("Validate")}
          </Button>
          <Button variant="outline" loading={busy} onClick={() => setReasonFor("REJECT")}>
            {tr("Reject")}
          </Button>
        </>
      )}
      {cr.status === "VALIDATED" && (
        <>
          <Button
            loading={busy}
            onClick={async () => {
              if (control?.is_over_budget) {
                await confirm({
                  title: tr("This request is over budget"),
                  body: tr(
                    "It cannot be approved until the costing is unlocked and amended. Open the costing to request an unlock.",
                  ),
                  confirmLabel: tr("I understand"),
                });
                return;
              }
              await act(() => api.transitionCashRequest(id, "APPROVED"), tr("Approved"));
            }}
          >
            {tr("Approve")}
          </Button>
          <Button variant="outline" loading={busy} onClick={() => setReasonFor("REJECT")}>
            {tr("Reject")}
          </Button>
        </>
      )}
      {cr.status === "REJECTED" && (
        <Button
          variant="outline"
          loading={busy}
          onClick={() => act(() => api.transitionCashRequest(id, "DRAFT"), tr("Reopened"))}
        >
          {tr("Reopen and correct")}
        </Button>
      )}
      {cr.status === "PARTIALLY_DISBURSED" && (
        <Button variant="outline" loading={busy} onClick={() => setReasonFor("CLOSE")}>
          {tr("Settle at what was paid")}
        </Button>
      )}
    </div>
  );

  const body = (
    <div className="space-y-4">
      {variant === "modal" && <div className="flex justify-end">{actions}</div>}
      {error && <ScreenError message={error} what="This action" />}

      {/* Why the request came back, and what to fix. */}
      {cr.rejection_reason && cr.status !== "REJECTED" && (
        <Callout tone="warn" title={tr("This was rejected once")}>
          {cr.rejection_reason}
        </Callout>
      )}
      {cr.status === "REJECTED" && cr.rejection_reason && (
        <Callout tone="bad" title={tr("Rejected")}>
          {cr.rejection_reason}
          {cr.rejected_at ? ` · ${dateFmt(cr.rejected_at)}` : ""}
        </Callout>
      )}
      {cr.settlement_reason && (
        <Callout tone="info" title={tr("Settled short")}>
          {cr.settlement_reason}
        </Callout>
      )}
      {cr.over_budget_reason && (
        <Callout tone="warn" title={tr("Raised over budget")}>
          {cr.over_budget_reason}
        </Callout>
      )}

      {control && <BudgetBanner control={control} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Panel title={tr("What the money is for")}>
            {(lines || []).length === 0 ? (
              <EmptyState
                title={tr("No lines yet")}
                hint={
                  cr.costing_id
                    ? "Press Load from budget to bring in this file's approved costing, already defaulted to what each line has left."
                    : "This request has no linked costing."
                }
                action={
                  editable && cr.costing_id ? (
                    <Button onClick={importFromBudget} loading={busy}>
                      {tr("Load from budget")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <CashLineGrid
                lines={lines || []}
                currency={ccy}
                readOnly={!editable}
                onChange={(next) => {
                  setLines(next);
                  setDirty(true);
                }}
              />
            )}
          </Panel>
          {(lines || []).length > 0 && <CashTotalsFooter lines={lines || []} currency={ccy} />}
        </div>

        <div className="space-y-4">
          {control && <BudgetControlPanel control={control} />}
          <PaymentsPanel
            request={cr}
            currency={ccy}
            busy={busy}
            onAcknowledge={(paymentId) =>
              act(() => api.acknowledgeCashReceipt(id, paymentId), tr("Receipt acknowledged"))
            }
          />
          <Panel title={tr("Request")}>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="micro">{tr("Beneficiary")}</span>
                <span className="text-sm text-foreground">{cr.beneficiary || "—"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="micro">{tr("Method")}</span>
                <span className="text-sm text-foreground">{cr.disbursement_method || "—"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="micro">{tr("Currency")}</span>
                <span className="num text-sm text-foreground">{ccy}</span>
              </div>
              {cr.approved_at && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="micro">{tr("Approved")}</span>
                  <span className="num text-sm text-foreground">{dateFmt(cr.approved_at)}</span>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <ReasonDialog
        open={reasonFor === "REJECT"}
        title={tr("Reject this request")}
        description={tr("The requester needs to know what to fix — a rejection with no reason is a status they cannot act on.")}
        confirmLabel={tr("Reject")}
        destructive
        busy={busy}
        onClose={() => setReasonFor(null)}
        onConfirm={async (reason) => {
          setReasonFor(null);
          await act(() => api.transitionCashRequest(id, "REJECTED", { reason }), tr("Rejected"));
        }}
      />
      <ReasonDialog
        open={reasonFor === "OVER_BUDGET"}
        title={tr("This claims more than the budget has left")}
        description={tr("Say why. It can be submitted with a reason, but it cannot be approved until the costing is unlocked and amended.")}
        confirmLabel={tr("Submit anyway")}
        busy={busy}
        onClose={() => setReasonFor(null)}
        onConfirm={async (reason) => {
          setReasonFor(null);
          await act(
            () => api.transitionCashRequest(id, "SUBMITTED", { over_budget_reason: reason }),
            tr("Submitted"),
          );
        }}
      />
      <ReasonDialog
        open={reasonFor === "CLOSE"}
        title={tr("Settle this request at what was paid")}
        description={tr("The balance will not be paid, and the unspent commitment returns to the file's budget.")}
        confirmLabel={tr("Settle")}
        busy={busy}
        onClose={() => setReasonFor(null)}
        onConfirm={async (reason) => {
          setReasonFor(null);
          await act(() => api.closeCashRequestBalance(id, reason), tr("Settled"));
        }}
      />
      {confirmUi}
    </div>
  );

  if (variant === "modal") return body;

  return (
    <Record360Page basePath={CASH_REQUEST_BASE} backLabel={tr("Cash requests")} id={id}>
      <Record360Header
        title={cr.doc_number || `${tr("Cash request")} ${cr.cash_request_id.slice(0, 8)}`}
        titleClassName="num"
        pills={<Pill tone={statusTone(cr.status)}>{statusLabel(cr.status)}</Pill>}
        meta={[
          cr.beneficiary,
          cr.category === "OVH" ? tr("Overhead") : tr("Operations"),
          `${money(totals.total_payable, ccy)} ${tr("requested")}`,
        ]}
        actions={actions}
      />
      {body}
    </Record360Page>
  );
}

/** Route entry. The id comes from the URL, so a pasted link lands on the sheet. */
export function CashRequest360Page() {
  const { cashRequestId } = useParams();
  if (!cashRequestId) return <EmptyState title={tr("Not found")} hint="No cash request id in the URL." />;
  return <CashRequest360 id={cashRequestId} />;
}
