/**
 * The costing worksheet — a page on desktop, a sheet on a phone.
 *
 * ── WHY IT IS A ROUTE AND NO LONGER A MODAL ────────────────────────────────
 *
 * The costing was a `<Modal size="lg">` that could only be created, never
 * edited: `CostingForm` posted and closed, `CostingDetail` rendered read-only,
 * and the `PATCH /costings/:id` the API has always exposed had no caller at all.
 * A worksheet that carries a shipment strip, a fourteen-row grid, a VAT panel
 * and a workflow rail does not fit in a dialog, and a costing under review is
 * something a colleague should be able to be SENT — which needs an address.
 *
 * Same chrome as the operations file, the transit order and the delivery note
 * (FRONTEND_GUIDE §3.11): one body, a `<Record360Page>` for desktop and a
 * `<Dialog>` for phones, and the body renders from the RESPONSE because a sheet
 * opened from a pasted link has a uuid and nothing else.
 *
 * ── WHAT THE SCREEN IS FOR ─────────────────────────────────────────────────
 *
 * Pick the file, and the service type, the client, the carrier, the route and
 * the equipment all arrive with it. Press Suggest and the service's standard
 * charge set lands, priced. Fix the quantities and the two rates nobody could
 * know. Submit, validate, approve. If a carrier bills you three weeks later,
 * request an unlock, add the line, and the approver sees exactly what moved.
 */
import * as React from "react";
import { useParams, Link } from "react-router-dom";
import {
  Record360Page,
  Record360Header,
} from "@/components/record-360";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, Select } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { SkeletonTable } from "@/components/ui/skeleton";
import { DraftBanner } from "@/components/ui/draft-banner";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { DocButton } from "@/components/doc-button";
import { ShipmentDetailsPanel } from "@/features/operations/shipment-details";
import { useFormDraft } from "@/lib/form-draft";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { listSalesTaxCodes } from "@/lib/masterdata-api";
import * as api from "@/lib/costing-api";
import { LineGrid, VatPanel, TotalsFooter } from "./costing-lines";
import {
  BLANK_LINE,
  COSTING_BASE,
  lineKey,
  fromSaved,
  fromSuggestion,
  statusLabel,
  toPayload,
  type LineDraft,
} from "./costing-model";
import { SuggestDialog } from "./costing-suggest";

const TONES: Record<string, Tone> = {
  DRAFT: "mute",
  SUBMITTED_FOR_VALIDATION: "warn",
  SUBMITTED_FOR_APPROVAL: "warn",
  APPROVED_LOCKED: "ok",
  UNLOCK_REQUESTED: "orange",
  REJECTED: "bad",
};
const tone = (s?: string | null): Tone => TONES[String(s || "")] || "mute";

/* ── The amendment block ───────────────────────────────────────────────────── */

/**
 * What moved since the last approval.
 *
 * The point is that it is SHORT. An approver asked to re-approve a sheet after
 * an unlock should read three rows, not fourteen — so unchanged lines are
 * counted, never listed.
 */
function AmendmentBlock({
  a,
  currency,
}: {
  a: NonNullable<api.Costing["amendment"]>;
  currency: string;
}) {
  const row = (
    l: api.CostingAmendmentLine,
    kind: "added" | "changed" | "removed",
  ) => (
    <li key={`${kind}-${l.key}`} className="flex flex-wrap items-baseline gap-2 py-1">
      <Pill tone={kind === "added" ? "ok" : kind === "removed" ? "bad" : "warn"}>
        {tr(kind === "added" ? "Added" : kind === "removed" ? "Removed" : "Changed")}
      </Pill>
      <span className="text-sm text-foreground">
        {l.label}
        {l.container_type_ref_id ? "" : ""}
      </span>
      <span className="num micro">
        {kind === "changed" && l.was_amount !== undefined
          ? `${money(l.was_amount, currency)} → ${money(l.amount, currency)}`
          : money(l.amount, currency)}
      </span>
      <span
        className={`num micro ${l.delta >= 0 ? "text-warn-ink" : "text-ok-ink"}`}
      >
        {l.delta >= 0 ? "+" : ""}
        {money(l.delta, currency)}
      </span>
    </li>
  );

  return (
    <Panel title={tr("Changed since it was approved")}>
      <p className="micro mb-2">
        {tr("Revision")} {a.since_revision} · {tr("approved")} {dateFmt(a.approved_at)}
      </p>
      <ul className="divide-y">
        {a.changed.map((l) => row(l, "changed"))}
        {a.added.map((l) => row(l, "added"))}
        {a.removed.map((l) => row(l, "removed"))}
      </ul>
      <div className="mt-2 flex flex-wrap items-baseline gap-3 border-t pt-2">
        <span className="micro">
          {a.unchanged_count} {tr("line(s) unchanged")}
        </span>
        <span className="num text-sm text-foreground">
          {money(a.before_ht, currency)} → {money(a.after_ht, currency)}
        </span>
        <span className="num text-sm font-medium">
          {a.delta_ht >= 0 ? "+" : ""}
          {money(a.delta_ht, currency)}
          {a.delta_percent != null ? ` (${a.delta_percent > 0 ? "+" : ""}${a.delta_percent}%)` : ""}
        </span>
      </div>
    </Panel>
  );
}

/* ── The body ──────────────────────────────────────────────────────────────── */

export function CostingSheet360({
  id,
  variant = "page",
  onChanged,
}: {
  id: string;
  variant?: "page" | "modal";
  onChanged?: () => void;
}) {
  const res = useResource(() => api.getCosting(id), [id]);
  const c = res.data;
  const vat = useResource(() => listSalesTaxCodes(), []);
  const vatCodes = React.useMemo(() => vat.data?.codes || [], [vat.data]);
  const { rows: users } = useList<{
    user_id: string;
    full_name?: string | null;
    email?: string;
  }>("/users");

  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);

  // The edit buffer. Null until the sheet is loaded, then seeded once.
  const [lines, setLines] = React.useState<LineDraft[] | null>(null);
  const [remarks, setRemarks] = React.useState("");
  const [validatorId, setValidatorId] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [dirty, setDirty] = React.useState(false);

  const editable = c?.status === "DRAFT";

  React.useEffect(() => {
    if (!c) return;
    setLines((c.lines || []).map(fromSaved));
    setRemarks(c.remarks || "");
    setValidatorId(c.validator_id || "");
    setCurrency(c.currency || "XAF");
    setDirty(false);
  }, [c]);

  /*
   * Unsaved-work rescue (Q25).
   *
   * A DRAFT costing is already a server row, so the ordinary save path is the
   * PATCH below. This covers the gap that path cannot: the browser closing, a
   * tab crash, or a drop between edits. `useFormDraft` never restores silently
   * — it offers, through `<DraftBanner>` — which is what keeps it from becoming
   * the "autosave landing after a discard" defect CLAUDE.md records.
   */
  const draft = useFormDraft({
    key: `costing:${id}`,
    values: { lines, remarks, validatorId, currency },
    label: c?.doc_number || tr("Costing sheet"),
    enabled: Boolean(editable && lines),
  });

  const { reload } = res;
  const refresh = React.useCallback(() => {
    reload();
    onChanged?.();
  }, [reload, onChanged]);

  async function save() {
    if (!lines) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateCosting(id, {
        currency,
        remarks: remarks.trim() || null,
        validator_id: validatorId || null,
        lines: lines.filter((l) => l.label || l.dictionary_item_id).map(toPayload),
      });
      draft.clear();
      setDirty(false);
      toast.success(tr("Costing saved"));
      refresh();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: api.CostingAction, label: string) {
    setBusy(true);
    setError(null);
    try {
      await api.setCostingStatus(id, to);
      toast.success(label);
      refresh();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestUnlock() {
    // A written reason is required by the server, and it is the audit answer to
    // "why is this approved costing open again" — so it is asked for properly,
    // never through a browser prompt.
    setUnlocking(true);
  }
  const [unlocking, setUnlocking] = React.useState(false);

  if (res.loading && !c) return <SkeletonTable rows={6} cols={4} />;
  if (res.error)
    return (
      <ScreenError message={res.error} what="Costing sheet" onRetry={res.reload} />
    );
  if (!c)
    return (
      <EmptyState
        title={tr("Not found")}
        hint="This costing could not be loaded."
      />
    );

  const ccy = currency || c.currency || "XAF";
  const file = c.file;
  const validatorName = (uid?: string | null) => {
    if (!uid) return null;
    const u = (users || []).find((x) => x.user_id === uid);
    return u ? u.full_name || u.email || uid.slice(0, 8) : uid.slice(0, 8);
  };

  const existingKeys = new Set((lines || []).map(lineKey));

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <DocButton
        docType="COSTING"
        id={c.costing_id}
        title={c.doc_number || tr("Costing sheet")}
        label={tr("Print / preview")}
      />
      {editable && (
        <>
          <Button variant="outline" onClick={() => setSuggesting(true)} disabled={!c.dossier_id}>
            {tr("Suggest charges")}
          </Button>
          <Button onClick={save} loading={busy} disabled={!dirty}>
            {tr("Save")}
          </Button>
          <Button
            variant="outline"
            loading={busy}
            onClick={async () => {
              if (dirty) {
                const ok = await confirm({
                  title: tr("Submit without saving your changes?"),
                  body: tr(
                    "The lines you have edited are not saved yet. Save first, then submit.",
                  ),
                  confirmLabel: tr("Save and submit"),
                  cancelLabel: tr("Go back"),
                });
                if (!ok) return;
                await save();
              }
              await transition("SUBMIT_VALIDATION", tr("Sent for validation"));
            }}
          >
            {tr("Submit for validation")}
          </Button>
        </>
      )}
      {c.status === "SUBMITTED_FOR_VALIDATION" && (
        <Button
          loading={busy}
          onClick={() => transition("SUBMIT_APPROVAL", tr("Validated — sent for approval"))}
        >
          {tr("Validate")}
        </Button>
      )}
      {c.status === "SUBMITTED_FOR_APPROVAL" && (
        <Button
          loading={busy}
          onClick={async () => {
            const ok = await confirm({
              title: tr("Approve this costing?"),
              body: `${tr("It becomes the file's approved budget at")} ${money(
                c.totals?.total_ttc,
                ccy,
              )}${tr(". Correcting it afterwards needs an unlock.")}`,
              confirmLabel: tr("Approve costing"),
            });
            if (ok) await transition("APPROVE", tr("Costing approved"));
          }}
        >
          {tr("Approve")}
        </Button>
      )}
      {["SUBMITTED_FOR_VALIDATION", "SUBMITTED_FOR_APPROVAL"].includes(c.status) && (
        <Button
          variant="outline"
          loading={busy}
          onClick={async () => {
            const ok = await confirm({
              title: tr("Reject this costing?"),
              body: tr("It goes back to the author, who can correct and resubmit it."),
              confirmLabel: tr("Reject costing"),
              destructive: true,
            });
            if (ok) await transition("REJECT", tr("Costing rejected"));
          }}
        >
          {tr("Reject")}
        </Button>
      )}
      {c.status === "APPROVED_LOCKED" && (
        <Button variant="outline" onClick={requestUnlock}>
          {tr("Request unlock")}
        </Button>
      )}
      {c.status === "UNLOCK_REQUESTED" && (
        <>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.unlockCosting(id, "UNLOCK");
                toast.success(tr("Reopened for editing"));
                refresh();
              } catch (err) {
                setError(errMsg(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr("Grant unlock")}
          </Button>
          <Button
            variant="outline"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.unlockCosting(id, "DENY_UNLOCK");
                toast.info(tr("Unlock refused — the costing stays approved"));
                refresh();
              } catch (err) {
                setError(errMsg(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr("Refuse")}
          </Button>
        </>
      )}
    </div>
  );

  const body = (
    <div className="space-y-4">
      {variant === "modal" && <div className="flex justify-end">{actions}</div>}

      {draft.pending && (
        <DraftBanner
          savedAt={draft.pending.savedAt}
          what={tr("costing")}
          onRestore={() => {
            const v = draft.restore();
            if (!v) return;
            setLines(v.lines);
            setRemarks(v.remarks);
            setValidatorId(v.validatorId);
            setCurrency(v.currency);
            setDirty(true);
          }}
          onDiscard={draft.discard}
        />
      )}

      {error && <ScreenError message={error} what="This action" />}

      {/* Why the sheet is open again, and what it cost last time. */}
      {c.unlock_reason && c.status !== "APPROVED_LOCKED" && (
        <Panel title={tr("Reopened")}>
          <p className="text-sm text-foreground">{c.unlock_reason}</p>
          {c.unlock_requested_at && (
            <p className="micro mt-1">{dateFmt(c.unlock_requested_at)}</p>
          )}
        </Panel>
      )}

      {c.amendment && <AmendmentBlock a={c.amendment} currency={ccy} />}

      {/* The SSDC. A pricer prices the SHIPMENT, not a list of codes — and an
          approved sheet shows what it was approved WITH, not what the file says
          today, which is what `shipment_details_source` reports. */}
      {c.shipment_details && (
        <ShipmentDetailsPanel
          data={c.shipment_details}
          variant="facets"
          title={
            c.shipment_details_source === "SNAPSHOT"
              ? tr("Shipment as approved")
              : tr("Shipment")
          }
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <Panel
            title={tr("Charges")}
            action={
              editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLines([...(lines || []), { ...BLANK_LINE }]);
                    setDirty(true);
                  }}
                >
                  {tr("+ Add line")}
                </Button>
              ) : undefined
            }
          >
            {(lines || []).length === 0 ? (
              <EmptyState
                title={tr("No charges yet")}
                hint={
                  editable
                    ? "Press Suggest charges to load the standard set for this file's service, then adjust it."
                    : "This costing has no lines."
                }
                action={
                  editable && c.dossier_id ? (
                    <Button onClick={() => setSuggesting(true)}>
                      {tr("Suggest charges")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <LineGrid
                lines={lines || []}
                dossierId={c.dossier_id}
                serviceTypeId={file?.service_type_id}
                currency={ccy}
                vatCodes={vatCodes}
                readOnly={!editable}
                onChange={(next) => {
                  setLines(next);
                  setDirty(true);
                }}
              />
            )}
          </Panel>

          <TotalsFooter lines={lines || []} currency={ccy} />
          <VatPanel lines={lines || []} currency={ccy} />
        </div>

        <div className="space-y-4">
          <Panel title={tr("Sheet")}>
            <div className="space-y-3">
              <Field label={tr("Currency")}>
                {editable ? (
                  <Select
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setDirty(true);
                    }}
                  >
                    <option value="XAF">XAF</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </Select>
                ) : (
                  <p className="num text-sm text-foreground">{ccy}</p>
                )}
              </Field>
              {ccy !== "XAF" && (
                <p className="micro">
                  {tr("Rate to XAF")}:{" "}
                  <span className="num">{String(c.exchange_rate_to_xaf ?? 1)}</span>
                  {" — "}
                  {tr("defaulted from Currencies & FX on the sheet's date.")}
                </p>
              )}
              <Field
                label={tr("Validator")}
                hint={tr("Who this sheet is submitted to")}
              >
                {editable ? (
                  <Select
                    value={validatorId}
                    onChange={(e) => {
                      setValidatorId(e.target.value);
                      setDirty(true);
                    }}
                  >
                    <option value="">—</option>
                    {(users || []).map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.full_name || u.email || u.user_id.slice(0, 8)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm text-foreground">
                    {validatorName(c.validator_id) || "—"}
                  </p>
                )}
              </Field>
              <Field label={tr("Remarks")} hint={tr("Context for the validator")}>
                {editable ? (
                  <Textarea
                    rows={3}
                    value={remarks}
                    onChange={(e) => {
                      setRemarks(e.target.value);
                      setDirty(true);
                    }}
                  />
                ) : (
                  <p className="text-sm text-foreground">{c.remarks || "—"}</p>
                )}
              </Field>
            </div>
          </Panel>

          <Panel title={tr("Trail")}>
            <dl className="space-y-1.5 text-sm">
              {c.validated_at && (
                <div className="flex justify-between gap-2">
                  <dt className="micro">{tr("Validated")}</dt>
                  <dd className="text-right">
                    {validatorName(c.validated_by) || "—"}
                    <span className="micro block">{dateFmt(c.validated_at)}</span>
                  </dd>
                </div>
              )}
              {c.approved_at && (
                <div className="flex justify-between gap-2">
                  <dt className="micro">{tr("Approved")}</dt>
                  <dd className="text-right">
                    {validatorName(c.approver_id) || "—"}
                    <span className="micro block">{dateFmt(c.approved_at)}</span>
                  </dd>
                </div>
              )}
              {!c.validated_at && !c.approved_at && (
                <p className="micro">{tr("Not yet submitted.")}</p>
              )}
            </dl>
          </Panel>
        </div>
      </div>

      {suggesting && c.dossier_id && (
        <SuggestDialog
          dossierId={c.dossier_id}
          currency={ccy}
          existingKeys={existingKeys}
          onClose={() => setSuggesting(false)}
          onImport={(picked) => {
            // Tops up (Q2): only charges not already on the sheet arrive, and a
            // line you have typed into is never touched.
            setLines([...(lines || []), ...picked.map(fromSuggestion)]);
            setDirty(true);
            toast.success(
              `${picked.length} ${picked.length === 1 ? tr("charge added") : tr("charges added")}`,
            );
          }}
        />
      )}

      {unlocking && (
        <UnlockDialog
          id={id}
          onClose={() => setUnlocking(false)}
          onDone={() => {
            setUnlocking(false);
            refresh();
          }}
        />
      )}

      {confirmUi}
    </div>
  );

  if (variant === "modal") return body;

  return (
    <div className="space-y-4">
      <Record360Header
        title={c.doc_number || tr("Costing — unnumbered draft")}
        titleClassName="num"
        pills={
          <>
            <Pill tone={tone(c.status)}>{statusLabel(c.status)}</Pill>
            {ccy !== "XAF" && <Pill tone="orange">{ccy}</Pill>}
          </>
        }
        subtitle={
          file ? (
            <Link className="underline-offset-2 hover:underline" to={`/operations/files/${file.dossier_id}`}>
              {file.ref}
              {file.client_name ? ` · ${file.client_name}` : ""}
            </Link>
          ) : undefined
        }
        meta={[
          file?.service_name_en || file?.service_type_key,
          file?.rate_provider_name,
          c.totals ? `${tr("Total")} ${money(c.totals.total_ttc, ccy)}` : null,
          c.created_at ? `${tr("Raised")} ${dateFmt(c.created_at)}` : null,
        ]}
        actions={actions}
      />
      {body}
    </div>
  );
}

/* ── The unlock dialog ─────────────────────────────────────────────────────── */

/**
 * Asking to reopen an approved costing.
 *
 * The reason is required by the server and is the audit answer to "why is this
 * approved costing open again", so it is a labelled field in a real dialog —
 * never `window.prompt`, which the browser draws, cannot translate, and blocks
 * the event loop while it is open.
 */
function UnlockDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Reopen this costing?")}
      description={tr(
        "An approver decides. Say what changed — a carrier bill that arrived late, a rate that was wrong — so they can judge it.",
      )}
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.unlockCosting(id, "REQUEST_UNLOCK", reason.trim());
            toast.success(tr("Unlock requested"));
            onDone();
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={tr("Why does it need reopening?")} required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr("Maersk detention — container held 3 days past free time")}
          />
        </Field>
        {error && <ScreenError message={error} what="The unlock request" />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!reason.trim()}>
            {tr("Request unlock")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ── The two shells ────────────────────────────────────────────────────────── */

export function CostingSheet360Modal({
  id,
  reference,
  onClose,
  onChanged,
}: {
  id: string;
  reference?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`${tr("Costing")} · ${reference || ""}`.trim()}
      description={tr("What this file will cost — HT / VAT / TTC.")}
    >
      <CostingSheet360 id={id} variant="modal" onChanged={onChanged} />
    </Dialog>
  );
}

export function CostingSheet360Page() {
  const { costingId = "" } = useParams();
  return (
    <Record360Page basePath={COSTING_BASE} backLabel={tr("Costing")} id={costingId}>
      <CostingSheet360 id={costingId} variant="page" />
    </Record360Page>
  );
}
