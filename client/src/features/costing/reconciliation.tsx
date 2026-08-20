/**
 * Costing — dossier reconciliation (§2.1, the merged record).
 *
 * ONE screen answering three questions in sequence: did we quote it right
 * (quoted − budget), did we execute to plan (budget − actual), did we make
 * money (quoted − actual) — with the offending line visible. Quoted lives at
 * header level only (a quoted "Transit Hinterland" can cover eight cost
 * lines); budget and actual are per dictionary item. All HT; débours are
 * pass-through and shown as their own total, never in the variance.
 *
 * AI pre-fill: lines arrive pre-filled with what can be proven (cost entries
 * that named their dictionary item). Untagged actuals sit in the UNMATCHED
 * bucket with the assistant's PROPOSED mappings below — a person confirms or
 * dismisses each one; the assistant never does.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Modal, Field } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Panel } from "@/components/ui/panel";
import { Pill, StatusPill, type Tone } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/costing-api";

const flagTone = (flag: string | null | undefined): Tone =>
  flag === "GREEN" ? "ok" : flag === "YELLOW" ? "warn" : flag === "RED" ? "bad" : "mute";

/** Signed money with the sign carrying the verdict (positive = good). */
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${money(n)}`;

function RejectModal({
  open,
  busy,
  onClose,
  onReject,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Reject reconciliation")}
      description="The submitter gets the reason verbatim — say what is wrong with the figures."
    >
      <div className="space-y-4">
        <Field label={tr("Reason")} required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button
            onClick={() => onReject(reason)}
            loading={busy}
            disabled={reason.trim().length < 3}
          >
            {tr("Reject")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ReconciliationPage() {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  // Latest reconciliation header for the file, then the full record.
  const latest = useResource(
    () =>
      dossierId
        ? api.latestReconciliation(dossierId)
        : Promise.resolve(null),
    [dossierId],
  );
  const reconId = latest.data?.reconciliation_id ?? null;
  const recon = useResource(
    () => (reconId ? api.getReconciliation(reconId) : Promise.resolve(null)),
    [reconId],
  );
  const r = recon.data;

  function refreshAll() {
    latest.reload();
    recon.reload();
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      refreshAll();
      return true;
    } catch (e) {
      setActionError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const dossierLabel = (() => {
    const d = (dossiers || []).find((x) => String(x.dossier_id) === dossierId);
    return d ? cell(d.ref ?? d.dossier_id) : null;
  })();

  const lineColumns: Column<api.ReconLine>[] = [
    {
      key: "item",
      label: "Item",
      render: (l) => (
        <span className="font-medium text-foreground">
          {cell(l.item_code ?? "—")}
          <span className="ml-2 text-xs text-muted-foreground">
            {cell(l.item_label ?? "")}
          </span>
        </span>
      ),
    },
    {
      key: "budget_ht",
      label: "Budget (HT)",
      className: "num text-right",
      render: (l) => money(l.budget_ht),
    },
    {
      key: "actual_ht",
      label: "Actual (HT)",
      className: "num text-right",
      render: (l) => money(l.actual_ht),
    },
    {
      key: "variance",
      label: "Variance",
      className: "num text-right",
      render: (l) => signed((Number(l.budget_ht) || 0) - (Number(l.actual_ht) || 0)),
    },
    {
      key: "match_status",
      label: "Provenance",
      render: (l) =>
        l.match_status === "UNMATCHED" ? (
          <Pill tone="warn">{tr("Unmatched")}</Pill>
        ) : (
          <Pill tone="ok">{tr("Proven")}</Pill>
        ),
    },
    {
      key: "doc",
      label: "Proof",
      render: (l) =>
        l.doc_required ? (
          l.doc_ref ? (
            cell(l.doc_ref)
          ) : (
            <Pill tone="orange">{tr("Required")}</Pill>
          )
        ) : (
          "—"
        ),
    },
  ];

  const proposed = (r?.suggestions || []).filter((s) => s.status === "PROPOSED");
  const v = r?.variance;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title={tr("Reconciliation")}
        description="Quoted vs budget vs actual per file — the controlled document that closes a dossier financially. Débours are pass-through and stay out of the variance."
      />
      <HubTabs />

      <Panel title={tr("Operations file")} className="mb-4">
        <div className="max-w-md">
          <SearchSelect
            path="/operations"
            value={dossierLabel}
            placeholder={tr("Search files…")}
            getLabel={(d) => cell(d.ref ?? d.dossier_id)}
            getKey={(d) => String(d.dossier_id)}
            onSelect={(d) => setDossierId(String(d.dossier_id))}
          />
        </div>
      </Panel>

      {!dossierId ? (
        <EmptyState
          title={tr("Pick an operations file")}
          hint="The reconciliation reads the file's approved costing, its posted actuals and its accepted quotation."
        />
      ) : latest.error ? (
        <ErrorState message={latest.error} />
      ) : recon.error ? (
        <ErrorState message={recon.error} />
      ) : !latest.loading && !reconId ? (
        <EmptyState
          title={tr("No reconciliation yet")}
          hint="Drafting pre-fills every line from proven actuals and proposes mappings for the rest."
          action={
            <Button
              loading={busy}
              onClick={() => run(() => api.draftReconciliation(dossierId))}
            >
              {tr("Draft reconciliation")}
            </Button>
          }
        />
      ) : !r ? null : (
        <div className="space-y-4">
          {/* Header: status + the three questions */}
          <Panel
            title={
              <span className="flex items-center gap-2">
                {tr("Reconciliation")}
                <StatusPill status={r.status} />
                {v?.flag && <Pill tone={flagTone(v.flag)}>{v.flag}</Pill>}
              </span>
            }
            subtitle={
              r.status === "VALIDATED"
                ? `Validated ${dateFmt(r.validated_at)} — ${money(r.ocr_amount)} stamped on the file`
                : r.status === "REJECTED"
                  ? `Rejected: ${cell(r.reject_reason ?? "")}`
                  : `Drafted ${dateFmt(r.created_at)}`
            }
            action={
              <div className="flex gap-2">
                {r.status === "DRAFT" && (
                  <Button
                    loading={busy}
                    onClick={() =>
                      run(() => api.submitReconciliation(r.reconciliation_id))
                    }
                  >
                    {tr("Submit")}
                  </Button>
                )}
                {r.status === "SUBMITTED" && (
                  <>
                    <Button
                      loading={busy}
                      onClick={() =>
                        run(() =>
                          api.validateReconciliation(r.reconciliation_id),
                        )
                      }
                    >
                      {tr("Validate")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setRejectOpen(true)}
                    >
                      {tr("Reject")}
                    </Button>
                  </>
                )}
                {["VALIDATED", "REJECTED"].includes(r.status) && (
                  <Button
                    variant="outline"
                    loading={busy}
                    onClick={() => run(() => api.draftReconciliation(dossierId))}
                  >
                    {tr("New draft")}
                  </Button>
                )}
              </div>
            }
          >
            <KpiRow>
              <KpiTile
                label="Quoted (HT, services)"
                value={v?.quoted_ht != null ? money(v.quoted_ht) : "—"}
                hint={
                  v?.quoted_ht != null
                    ? "From the accepted quotation"
                    : "No accepted quotation on this file"
                }
              />
              <KpiTile
                label="Budget (HT)"
                value={money(v?.budget_ht)}
                hint="Approved costing, débours excluded"
              />
              <KpiTile
                label="Actual (HT)"
                value={money(v?.actual_ht)}
                hint="Posted cost entries, débours excluded"
              />
            </KpiRow>
            <KpiRow>
              <KpiTile
                label="Did we quote it right?"
                value={signed(v?.quote_vs_budget)}
                hint="Quoted − budget"
                tone={v?.quote_vs_budget != null && v.quote_vs_budget < 0 ? "warn" : "accent"}
              />
              <KpiTile
                label="Did we execute to plan?"
                value={signed(v?.budget_vs_actual)}
                hint="Budget − actual"
                tone={v?.budget_vs_actual != null && v.budget_vs_actual < 0 ? "warn" : "accent"}
              />
              <KpiTile
                label="Did we make money?"
                value={signed(v?.quote_vs_actual)}
                hint={
                  v?.margin_percent != null
                    ? `Quoted − actual · margin ${v.margin_percent}%`
                    : "Quoted − actual"
                }
                tone={v?.quote_vs_actual != null && v.quote_vs_actual < 0 ? "warn" : "accent"}
              />
            </KpiRow>
          </Panel>

          {actionError && <ErrorState message={actionError} />}

          {/* The offending line, visible. */}
          <Panel title={tr("Lines")} subtitle="Service costs per dictionary item — budget vs actual, HT">
            <DataList
              columns={lineColumns}
              rows={r.lines || []}
              error={null}
              loading={false}
              rowKey={(l) => l.line_id}
              empty={{
                title: tr("No lines"),
                hint: "The file has no approved costing lines or posted actuals yet.",
              }}
            />
          </Panel>

          {/* AI proposals — the human decides. */}
          {proposed.length > 0 && (
            <Panel
              title={tr("Proposed matches")}
              subtitle="Actuals that named no cost item. The assistant proposes; confirming is yours."
            >
              <ul className="space-y-2">
                {proposed.map((s) => (
                  <li
                    key={s.suggestion_id}
                    className="lux-card flex flex-wrap items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {cell(s.entry_category ?? "Untagged entry")} ·{" "}
                        <span className="num">{money(s.entry_amount)}</span>
                        <span className="mx-2 text-muted-foreground">→</span>
                        {cell(s.suggested_item_code ?? "")}{" "}
                        <span className="text-muted-foreground">
                          {cell(s.suggested_item_label ?? "")}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cell(s.reason ?? "")}
                        {s.confidence != null &&
                          ` · confidence ${Math.round(Number(s.confidence) * 100)}%`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={busy}
                        disabled={r.status !== "DRAFT"}
                        onClick={() =>
                          run(() =>
                            api.confirmReconSuggestion(
                              r.reconciliation_id,
                              s.suggestion_id,
                            ),
                          )
                        }
                      >
                        {tr("Confirm")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || r.status !== "DRAFT"}
                        onClick={() =>
                          run(() =>
                            api.rejectReconSuggestion(
                              r.reconciliation_id,
                              s.suggestion_id,
                            ),
                          )
                        }
                      >
                        {tr("Dismiss")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* Débours — real money, never variance. */}
          <Panel
            title={tr("Débours (pass-through)")}
            subtitle="Handled for the client — excluded from margin and variance (OHADA)"
          >
            <KpiRow>
              <KpiTile
                label="Débours budgeted"
                value={money(r.disbursement_budget_ht)}
              />
              <KpiTile
                label="Débours handled"
                value={money(r.disbursement_actual_ht)}
              />
              <KpiTile
                label="Total actually paid out"
                value={money(r.total_actual_ht)}
                hint="Services + débours — what validation stamps on the file"
              />
            </KpiRow>
          </Panel>
        </div>
      )}

      <RejectModal
        open={rejectOpen}
        busy={busy}
        onClose={() => setRejectOpen(false)}
        onReject={(reason) => {
          if (!r) return;
          void run(() =>
            api.rejectReconciliation(r.reconciliation_id, reason),
          ).then((ok) => {
            if (ok) setRejectOpen(false);
          });
        }}
      />
    </section>
  );
}
