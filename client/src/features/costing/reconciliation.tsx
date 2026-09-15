/**
 * Budget Reconciliation (MOD-76) — what an operations file actually cost.
 *
 * ONE sheet per file, for ever. It does not close; it settles, and re-opens when
 * the costing is amended or more cash goes out (owner decision Q6). The grid is
 * PROJECTED from the file's approved costing lines, so a budget line added five
 * minutes ago is already here and a line nobody has touched still renders.
 *
 * Everything is TTC, because the question is a cash question: we disbursed
 * 119 250 — is that what you spent? The actual arrives pre-filled with the
 * disbursed amount as a hypothesis; confirming is one keystroke, and typing only
 * happens where the system is wrong.
 *
 * The footer and the meters re-compute on every keystroke, with no round trip —
 * the one thing the legacy's screen did that was worth copying wholesale
 * (`updateLine()` → `calculateTotals()`, operational-cost-reconciliation.php).
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { MeterGroup } from "@/components/ui/meter";
import { Panel } from "@/components/ui/panel";
import { Pill, type Tone } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { useUpload } from "@/lib/use-upload";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { useResource, errMsg } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { uploadVaultFile } from "@/lib/masterdata-api";
import * as api from "@/lib/costing-api";

/** Signed money, sign carrying the verdict: positive is under budget. */
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${money(n)}`;

const statusTone = (s: api.ReconStatus): Tone =>
  s === "SETTLED" ? "ok" : s === "SUBMITTED" ? "warn" : "mute";

/** What a cost proof may be (Q8) — whatever the supplier actually sent. The
 *  server sniffs the bytes; this is the courtesy that stops a slow upload of
 *  something that was never going to be accepted. */
const PROOF_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx";
const PROOF_MAX_BYTES = 15 * 1024 * 1024;

/* ══════════════════════════ The line modal (Q5) ═══════════════════════════ */

/**
 * One budget line's whole story: where the money was authorised, what has been
 * claimed and paid against it, what was actually spent — and the documents that
 * prove it, MANY per line (Q8), because the first demurrage invoice covers one
 * day and the second covers two.
 */
function LineModal({
  dossierId,
  line,
  editable,
  onClose,
  onChanged,
}: {
  dossierId: string;
  line: api.ReconLine;
  editable: boolean;
  onClose: () => void;
  onChanged: (sheet: api.ReconSheet) => void;
}) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [spentOn, setSpentOn] = React.useState(line.spent_on || "");
  const [note, setNote] = React.useState("");

  /**
   * `autoStart: false` — the note is typed after the file is picked, and the
   * document is attached to the line only once the vault has answered with an
   * id. `profile: "document"` is required and is not cosmetic: auto-levelling a
   * customs scan makes it stop matching the paper, and document_signature takes
   * its artifact_hash from the vault row's content_hash.
   */
  const upload = useUpload({
    profile: "document",
    multiple: true,
    maxBytes: PROOF_MAX_BYTES,
    autoStart: false,
    send: async (file, ctx) =>
      uploadVaultFile(
        file,
        { dossier_id: dossierId, doc_type: "COST_PROOF", original_name: file.name },
        { onProgress: ctx.onProgress, signal: ctx.signal },
      ),
    onAllComplete: async (docs) => {
      try {
        let sheet: api.ReconSheet | null = null;
        for (const d of docs) {
          sheet = await api.attachReconDocument(dossierId, line.costing_line_id, d.doc_id, note || undefined);
        }
        upload.reset();
        setNote("");
        if (sheet) onChanged(sheet);
        toast.success(tr("Proof attached"));
      } catch (e) {
        setError(errMsg(e));
      }
    },
  });

  async function saveDate() {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await api.patchReconLine(dossierId, line.costing_line_id, {
          spent_on: spentOn || null,
        }),
      );
      toast.success(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function detach(docId: string) {
    const ok = await confirm({
      title: tr("Remove this proof from the line?"),
      body: tr(
        "The document stays in the file's vault — this only unlinks it from this budget line.",
      ),
      confirmLabel: tr("Remove from line"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      onChanged(await api.detachReconDocument(dossierId, line.costing_line_id, docId));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="lg" onClose={onClose} title={cell(line.label)} description={tr("What this budget line authorised, what went out against it, and what proves it.")}>
      <div className="space-y-5">
        <KpiRow>
          <KpiTile label="Budget" value={money(line.budget_ttc)} hint={tr("Approved costing, TTC")} />
          <KpiTile label="Disbursed" value={money(line.disbursed)} hint={tr("Cash actually paid out")} />
          <KpiTile
            label="Actual"
            value={money(line.actual_ttc)}
            hint={
              line.actual_source === "DERIVED"
                ? tr("Nobody has confirmed this yet")
                : line.actual_source === "CONFIRMED"
                  ? tr("Confirmed as spent")
                  : tr("Entered by hand")
            }
          />
          <KpiTile
            label="To account for"
            value={money(line.outstanding)}
            hint={tr("Disbursed less what was spent and returned")}
            tone={line.outstanding > 0 ? "warn" : "accent"}
          />
        </KpiRow>

        {line.over_budget && (
          <Callout tone={line.reason_missing ? "bad" : "warn"}>
            <p>
              {tr("Over budget by")} <strong>{money(-line.variance)}</strong>.{" "}
              {line.variance_reason
                ? cell(line.variance_reason)
                : line.reason_required
                  ? tr("This needs a reason before the sheet can be submitted.")
                  : tr("Within the tenant's overspend allowance, so no reason is required.")}
            </p>
          </Callout>
        )}

        {editable && (
          <Field
            label={tr("When the money actually left")}
            hint={tr("Not when the paperwork was done — a receipt handed in on Friday for a Tuesday payment is dated Tuesday.")}
          >
            <div className="flex items-end gap-2">
              <DateField value={spentOn} onChange={setSpentOn} />
              <Button variant="outline" onClick={saveDate} loading={busy} disabled={spentOn === (line.spent_on || "")}>
                {tr("Save")}
              </Button>
            </div>
          </Field>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">
            {tr("Supporting documents")}
            {line.justification_required && (
              <Pill tone={line.proof_missing ? "bad" : "ok"} className="ml-2">
                {line.proof_missing ? tr("Required") : tr("Provided")}
              </Pill>
            )}
          </h3>
          {line.documents?.length ? (
            <ul className="mb-3 space-y-2">
              {line.documents.map((d) => (
                <li
                  key={d.recon_document_id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">
                      {cell(d.note || d.doc_type || tr("Document"))}
                    </span>
                    <span className="micro">
                      {cell(d.uploaded_by_name ?? "")} · {dateFmt(d.uploaded_at)}
                    </span>
                  </span>
                  {editable && (
                    <button
                      type="button"
                      className="micro shrink-0 text-primary-ink underline"
                      onClick={() => detach(d.doc_id)}
                      disabled={busy}
                    >
                      {tr("Remove")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="micro mb-3">{tr("Nothing attached to this line yet.")}</p>
          )}

          {editable && (
            <div className="space-y-2">
              <FilePicker
                accept={PROOF_ACCEPT}
                multiple
                onPick={upload.pick}
                label={tr("Attach an invoice or receipt")}
                hint={tr("PDF, image, Word or Excel — up to 15 MB. Evidence arrives in rounds, so adding another later is normal.")}
              />
              <UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
              {upload.items.length > 0 && (
                <>
                  <Field label={tr("What this document is")} hint={tr("Optional — 'Maersk demurrage, days 1–2'")}>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <Button onClick={upload.start} loading={upload.busy}>
                    {tr("Upload and attach")}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Close")}
          </Button>
        </div>
      </div>
      {confirmEl}
    </Modal>
  );
}

/* ═══════════════════ One reason, several lines (Q12) ══════════════════════ */

/**
 * A customs network outage holds a container an extra day and demurrage, port
 * storage and yard occupancy all move together. That is one sentence, typed
 * once, applied to the lines it explains.
 */
function ReasonModal({
  dossierId,
  lines,
  seed,
  onClose,
  onChanged,
}: {
  dossierId: string;
  lines: api.ReconLine[];
  seed: api.ReconLine;
  onClose: () => void;
  onChanged: (sheet: api.ReconSheet) => void;
}) {
  const [reason, setReason] = React.useState(seed.variance_reason || "");
  const [picked, setPicked] = React.useState<string[]>([seed.costing_line_id]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Offer every other line that is over budget — those are the ones a shared
  // cause plausibly explains. A line that came in under budget is not something
  // anybody needs to account for.
  const candidates = lines.filter((l) => l.over_budget);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.applyReconReason(dossierId, reason, picked));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Why did this cost more than budgeted?")}
      description={tr("One cause often moves several lines. Write it once and tick the lines it explains.")}
    >
      <div className="space-y-4">
        <Field label={tr("Reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
        {candidates.length > 1 && (
          <Field label={tr("Lines this explains")}>
            <ul className="space-y-1">
              {candidates.map((l) => (
                <li key={l.costing_line_id}>
                  <Checkbox
                    checked={picked.includes(l.costing_line_id)}
                    onCheckedChange={() => toggle(l.costing_line_id)}
                    label={
                      <span className="flex items-center gap-2">
                        <span className="text-foreground">{cell(l.label)}</span>
                        <span className="micro">{signed(l.variance)}</span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </Field>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={save} loading={busy} disabled={reason.trim().length < 3 || !picked.length}>
            {tr("Save reason")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════ The grid row ══════════════════════════════ */

function LineRow({
  line,
  editable,
  draft,
  onDraft,
  onCommit,
  onOpen,
  onReason,
}: {
  line: api.ReconLine;
  editable: boolean;
  draft: string | undefined;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onOpen: () => void;
  onReason: () => void;
}) {
  const shown = draft !== undefined ? Number(draft || 0) : line.actual_ttc;
  const variance = Math.round((line.budget_ttc - shown) * 100) / 100;
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-3">
        <button type="button" className="text-left font-medium text-foreground hover:text-primary-ink" onClick={onOpen}>
          {cell(line.label)}
        </button>
        <span className="micro block">
          {cell(line.item_code ?? "")}
          {line.container_type_code ? ` · ${line.container_type_code}` : ""}
          {line.is_disbursement ? ` · ${tr("débours")}` : ""}
          {line.actual_source === "DERIVED" && line.funded ? ` · ${tr("not confirmed")}` : ""}
        </span>
      </td>
      <td className="num py-2 pr-3 text-right tabular-nums text-muted-foreground">{money(line.budget_ttc)}</td>
      <td className="num py-2 pr-3 text-right tabular-nums text-muted-foreground">{money(line.disbursed)}</td>
      <td className="py-2 pr-3 text-right">
        {editable ? (
          <Input
            type="number"
            min="0"
            step="0.01"
            className="num ml-auto max-w-[9rem] text-right"
            value={draft !== undefined ? draft : String(line.actual_ttc)}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={onCommit}
            aria-label={`${tr("Actual spent")} — ${line.label}`}
          />
        ) : (
          <span className="num tabular-nums">{money(line.actual_ttc)}</span>
        )}
      </td>
      <td
        className={`num py-2 pr-3 text-right tabular-nums ${variance < 0 ? "text-[rgb(var(--bad))]" : "text-foreground"}`}
      >
        {signed(variance)}
      </td>
      <td className="py-2 pr-3 text-center">
        {line.justification_required ? (
          line.document_count > 0 ? (
            <button type="button" className="micro text-primary-ink underline" onClick={onOpen}>
              {line.document_count}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-sm text-primary-ink hover:bg-muted"
              onClick={onOpen}
              aria-label={`${tr("Attach proof")} — ${line.label}`}
            >
              +
            </button>
          )
        ) : (
          <span className="micro">—</span>
        )}
      </td>
      <td className="py-2 text-sm">
        {line.variance_reason ? (
          <button type="button" className="text-left text-muted-foreground hover:text-primary-ink" onClick={onReason}>
            <span className="line-clamp-2">{cell(line.variance_reason)}</span>
          </button>
        ) : line.reason_required ? (
          <Button size="sm" variant="outline" onClick={onReason} disabled={!editable}>
            {tr("Add reason")}
          </Button>
        ) : (
          <span className="micro">—</span>
        )}
      </td>
    </tr>
  );
}

/* ═══════════════════════════════ The page ════════════════════════════════ */

export function ReconciliationPage() {
  const [dossierId, setDossierId] = React.useState("");
  const [dossierLabel, setDossierLabel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [openLine, setOpenLine] = React.useState<string | null>(null);
  const [reasonLine, setReasonLine] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  /**
   * Local edits, keyed by budget line.
   *
   * The footer and the meters read THESE, so the sheet re-foots on every
   * keystroke with no round trip. The server is told on blur. A refetch merges
   * rather than clobbering — overwriting a half-typed number because a
   * colleague disbursed a tranche is worse than not refreshing at all.
   */
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const sheet = useResource(
    () => (dossierId ? api.getReconciliation(dossierId) : Promise.resolve(null)),
    [dossierId],
  );

  /**
   * The sheet the screen is actually rendering.
   *
   * Every mutation returns the WHOLE sheet, so applying it locally saves a
   * round trip and — more importantly — keeps the grid from flickering back to
   * its previous totals between the PATCH and the refetch. The resource stays
   * the source for loading and error; this is the live copy on top of it.
   */
  const [local, setLocal] = React.useState<api.ReconSheet | null>(null);
  React.useEffect(() => { setLocal(sheet.data ?? null); }, [sheet.data]);
  const s = local;
  const apply = React.useCallback((next: api.ReconSheet) => setLocal(next), []);

  // Q16 — "live" is the form re-footing as you type, plus a refetch when the
  // facts can have moved while you were elsewhere. Dirty fields survive it.
  React.useEffect(() => {
    if (!dossierId) return;
    const onFocus = () => sheet.reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dossierId, sheet]);

  // Memoised because the live footer's useMemo depends on it — a fresh []
  // every render would re-foot the sheet on every keystroke anywhere on it.
  const lines = React.useMemo(() => s?.lines ?? [], [s]);
  const editable = s?.status === "OPEN" && s?.can_reconcile === true;

  /** Totals recomputed from the drafts, so the footer moves with the typing. */
  const live = React.useMemo(() => {
    const actual = lines.reduce((sum, l) => {
      const d = drafts[l.costing_line_id];
      return sum + (d !== undefined ? Number(d || 0) : l.actual_ttc);
    }, 0);
    const budget = s?.totals.budget_ttc ?? 0;
    const disbursed = s?.totals.disbursed ?? 0;
    const returned = s?.totals.returned ?? 0;
    return {
      actual: Math.round(actual * 100) / 100,
      budget,
      disbursed,
      variance: Math.round((budget - actual) * 100) / 100,
      outstanding: Math.round((disbursed - actual - returned) * 100) / 100,
    };
  }, [lines, drafts, s]);

  async function run(fn: () => Promise<api.ReconSheet>) {
    setBusy(true);
    setActionError(null);
    try {
      apply(await fn());
      return true;
    } catch (e) {
      setActionError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commitLine(line: api.ReconLine) {
    const draft = drafts[line.costing_line_id];
    if (draft === undefined) return;
    const value = Number(draft || 0);
    setDrafts((d) => {
      const { [line.costing_line_id]: _drop, ...rest } = d;
      return rest;
    });
    if (value === line.actual_ttc && line.actual_source !== "DERIVED") return;
    await run(() => api.patchReconLine(dossierId, line.costing_line_id, { actual_ttc: value }));
  }

  const current = lines.find((l) => l.costing_line_id === openLine) || null;
  const reasonSeed = lines.find((l) => l.costing_line_id === reasonLine) || null;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Costing" to="/costing" />}
        title={tr("Budget Reconciliation")}
        description={tr(
          "What this file actually cost, per budget line, evidenced — and the cash not spent, returned to the vault. All amounts TTC.",
        )}
      />
      <HubTabs />

      <Panel title={tr("Operations file")} className="mb-4">
        <div className="max-w-md">
          <SearchSelect
            path="/operations"
            label={tr("Operations file")}
            value={dossierLabel}
            placeholder={tr("Search files…")}
            getLabel={(d) => cell((d.ref as string | null) ?? String(d.dossier_id))}
            getKey={(d) => String(d.dossier_id)}
            onSelect={(d) => {
              setDrafts({});
              setDossierLabel(cell((d.ref as string | null) ?? String(d.dossier_id)));
              setDossierId(String(d.dossier_id));
            }}
          />
        </div>
      </Panel>

      {!dossierId ? (
        <EmptyState
          title={tr("Pick an operations file")}
          hint={tr("The sheet reads the file's approved costing and every cash request raised against it.")}
        />
      ) : sheet.error ? (
        <ErrorState message={sheet.error} />
      ) : sheet.loading || !s ? (
        <div className="py-10 text-center micro">{tr("Loading…")}</div>
      ) : !s.can_reconcile ? (
        /* Q11 — no spend on an operations file without an approved costing, so
           there is nothing to reconcile against. Say so, and point at the fix. */
        <EmptyState
          title={tr("No approved budget on this file")}
          hint={s.blocked_reason ?? ""}
          action={
            <Button variant="outline" onClick={() => navigate("/costing/costing")}>
              {tr("Open the costing")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                {tr("Budget vs actual")}
                <Pill tone={statusTone(s.status)}>{s.status}</Pill>
                {(s.revision ?? 1) > 1 && <Pill tone="mute">{`rev ${s.revision}`}</Pill>}
              </span>
            }
            subtitle={
              s.status === "SETTLED"
                ? `${tr("Settled")} ${dateFmt(s.settled_at)} · ${money(s.returned_total)} ${tr("returned to the vault")}`
                : s.reject_reason
                  ? `${tr("Sent back")}: ${cell(s.reject_reason)}`
                  : s.reopened_reason
                    ? `${tr("Re-opened")}: ${cell(s.reopened_reason)}`
                    : tr("Prepared by Operations, settled by Finance.")
            }
            action={
              <div className="flex gap-2">
                {s.status === "OPEN" && (
                  <Button
                    loading={busy}
                    onClick={() => run(() => api.submitReconciliation(dossierId))}
                  >
                    {tr("Submit to Finance")}
                  </Button>
                )}
                {s.status === "SUBMITTED" && (
                  <>
                    <Button loading={busy} onClick={() => setSettleOpen(true)}>
                      {tr("Settle")}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}>
                      {tr("Send back")}
                    </Button>
                  </>
                )}
              </div>
            }
          >
            <KpiRow>
              <KpiTile label="Budget" value={money(live.budget)} hint={tr("Approved costing, TTC")} />
              <KpiTile label="Disbursed" value={money(live.disbursed)} hint={tr("Cash actually paid out")} />
              <KpiTile label="Actual" value={money(live.actual)} hint={tr("What was really spent")} />
              <KpiTile
                label="Variance"
                value={signed(live.variance)}
                hint={tr("Budget less actual")}
                tone={live.variance < 0 ? "warn" : "accent"}
              />
              <KpiTile
                label="To account for"
                value={money(live.outstanding)}
                hint={tr("Cash out, not yet spent or returned")}
                tone={live.outstanding > 0 ? "warn" : "accent"}
              />
            </KpiRow>

            {/*
              Budget · Disbursed · Actual on ONE shared scale, so Actual is read
              AGAINST the budget rather than stretched to fill its own track.
              Redrawn on every keystroke from `live`. The richer interactive
              charts land with the chart library in PR 3.
            */}
            <div className="mt-4">
              <MeterGroup
                ariaLabel={`${tr("Budget")} ${live.budget}, ${tr("disbursed")} ${live.disbursed}, ${tr("actual")} ${live.actual}`}
                rows={[
                  { label: tr("Budget"), value: live.budget, display: money(live.budget), tone: "neutral" as const },
                  { label: tr("Disbursed"), value: live.disbursed, display: money(live.disbursed), tone: "accent" as const },
                  {
                    label: tr("Actual"),
                    value: live.actual,
                    display: money(live.actual),
                    tone: live.variance < 0 ? ("bad" as const) : ("ok" as const),
                    hint: live.variance < 0 ? tr("over budget") : tr("within budget"),
                  },
                ]}
              />
            </div>
          </Panel>

          {actionError && <ErrorState message={actionError} />}

          {editable && (s.totals.reasons_missing > 0 || s.totals.proofs_missing > 0) && (
            <Callout tone="warn" title={tr("Before this can go to Finance")}>
              <ul className="list-disc pl-5">
                {s.totals.reasons_missing > 0 && (
                  <li>{`${s.totals.reasons_missing} ${tr("line(s) are over budget and need a reason")}`}</li>
                )}
                {s.totals.proofs_missing > 0 && (
                  <li>{`${s.totals.proofs_missing} ${tr("line(s) need a supporting document")}`}</li>
                )}
              </ul>
            </Callout>
          )}

          <Panel
            title={tr("Lines")}
            subtitle={tr("Every line on the approved costing, débours included. Type what was actually spent; the sheet re-foots as you go.")}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-micro uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{tr("Line")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr("Budget")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr("Disbursed")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr("Actual")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr("Variance")}</th>
                    <th className="py-2 pr-3 text-center font-medium">{tr("Proof")}</th>
                    <th className="py-2 font-medium">{tr("Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <LineRow
                      key={l.costing_line_id}
                      line={l}
                      editable={editable}
                      draft={drafts[l.costing_line_id]}
                      onDraft={(v) => setDrafts((d) => ({ ...d, [l.costing_line_id]: v }))}
                      onCommit={() => commitLine(l)}
                      onOpen={() => setOpenLine(l.costing_line_id)}
                      onReason={() => setReasonLine(l.costing_line_id)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <td className="py-2 pr-3">{tr("Total")}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums">{money(live.budget)}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums">{money(live.disbursed)}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums">{money(live.actual)}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums">{signed(live.variance)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/*
              Q11 — a line cannot be invented here. The costing IS the budget, so
              the fix is upstream and this says where, in one sentence.
            */}
            <p className="micro mt-3">
              {tr("Missing a line? The costing is the budget — request an unlock, add it there and re-approve, and it appears here.")}{" "}
              <Link to="/costing/costing" className="text-primary-ink underline">
                {tr("Open the costing")}
              </Link>
            </p>
          </Panel>
        </div>
      )}

      {current && (
        <LineModal
          dossierId={dossierId}
          line={current}
          editable={editable}
          onClose={() => setOpenLine(null)}
          onChanged={apply}
        />
      )}
      {reasonSeed && (
        <ReasonModal
          dossierId={dossierId}
          lines={lines}
          seed={reasonSeed}
          onClose={() => setReasonLine(null)}
          onChanged={apply}
        />
      )}
      {rejectOpen && (
        <SendBackModal
          busy={busy}
          onClose={() => setRejectOpen(false)}
          onSend={async (reason) => {
            if (await run(() => api.rejectReconciliation(dossierId, reason))) setRejectOpen(false);
          }}
        />
      )}
      {settleOpen && s && (
        <SettleModal
          lines={lines}
          busy={busy}
          onClose={() => setSettleOpen(false)}
          onSettle={async (returned) => {
            if (await run(() => api.settleReconciliation(dossierId, returned))) {
              setSettleOpen(false);
              toast.success(tr("File reconciled"));
            }
          }}
        />
      )}
    </section>
  );
}

function SendBackModal({
  busy,
  onClose,
  onSend,
}: {
  busy: boolean;
  onClose: () => void;
  onSend: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Send this back to Operations")}
      description={tr("They get the reason verbatim — say what is wrong with the figures.")}
    >
      <div className="space-y-4">
        <Field label={tr("Reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => onSend(reason)} loading={busy} disabled={reason.trim().length < 3}>
            {tr("Send back")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Finance's settlement: record what came back to the vault, per line.
 *
 * Seeded with each line's outstanding amount, because that is the answer when
 * the holder hands back everything they did not spend — which is the normal
 * case and should not need retyping.
 */
function SettleModal({
  lines,
  busy,
  onClose,
  onSettle,
}: {
  lines: api.ReconLine[];
  busy: boolean;
  onClose: () => void;
  onSettle: (returned: Record<string, number>) => void;
}) {
  const owing = lines.filter((l) => l.outstanding > 0);
  const [returned, setReturned] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(owing.map((l) => [l.costing_line_id, String(l.outstanding)])),
  );
  const total = Object.values(returned).reduce((s, v) => s + Number(v || 0), 0);

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={tr("Settle this file")}
      description={tr("Record the cash handed back to the vault. The MD is told; there is no further approval.")}
    >
      <div className="space-y-4">
        {owing.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{tr("Line")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tr("Still out")}</th>
                  <th className="py-2 text-right font-medium">{tr("Returned")}</th>
                </tr>
              </thead>
              <tbody>
                {owing.map((l) => (
                  <tr key={l.costing_line_id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">{cell(l.label)}</td>
                    <td className="num py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {money(l.outstanding)}
                    </td>
                    <td className="py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="num ml-auto max-w-[9rem] text-right"
                        value={returned[l.costing_line_id] ?? "0"}
                        onChange={(e) =>
                          setReturned((r) => ({ ...r, [l.costing_line_id]: e.target.value }))
                        }
                        aria-label={`${tr("Returned")} — ${l.label}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-2 pr-3">{tr("Total returned")}</td>
                  <td />
                  <td className="num py-2 text-right tabular-nums">{money(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Callout tone="ok">
            {tr("Every franc disbursed on this file is accounted for. Nothing to return.")}
          </Callout>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button
            onClick={() =>
              onSettle(
                Object.fromEntries(
                  Object.entries(returned).map(([k, v]) => [k, Number(v || 0)]),
                ),
              )
            }
            loading={busy}
          >
            {tr("Settle")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
