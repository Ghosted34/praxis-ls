/**
 * Régie d'avance — the detail surface (Landing B).
 *
 * WHAT THIS EXISTS TO FIX. Landing A (10717) built the whole retirement half of
 * KB §6.8 — retire, query, write off, un-age — and shipped it over HTTP only.
 * `costing-api.ts` exported exactly `listRegie` and `issueRegie`, so the UI
 * could put money INTO 581 and had no way to take it out. An advance could be
 * opened and never closed from the product, which is the same shape of defect
 * as costing's `APPROVED_LOCKED` (a lock with no key).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS FILE FOLLOWS THROUGHOUT: derive nothing that the server
 * already derived.
 *
 * `GET /regie/:id` returns `open_balance`, `days_to_window`, `is_aged`,
 * `is_due_soon` and — the important one — `next`, which is `rules.NEXT[state]`.
 * Every action below is enabled from `next` and from the server's own
 * preconditions, never from a state comparison written here. A second copy of
 * the state machine in TSX is how the two drift, and the drift always shows up
 * as the UI offering an action the API then refuses.
 *
 * The same goes for the balance: `open = amount - justified - returned` is the
 * number aging keys off and the ledger posts against. Recomputing it here would
 * create a second implementation of the only figure that matters.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { Pill, type Tone } from "@/components/ui/pill";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/costing-api";

const STATE_TONE: Record<string, Tone> = {
  ISSUED: "blue",
  PARTIALLY_JUSTIFIED: "warn",
  JUSTIFIED: "ok",
  AGED_UNJUSTIFIED: "bad",
  QUERIED: "orange",
};
export const regieTone = (s?: string | null): Tone =>
  STATE_TONE[String(s || "").toUpperCase()] || "mute";

const KIND_LABEL: Record<api.RegieRetirementKind, string> = {
  RECEIPT: "Receipt",
  CASH_RETURN: "Cash returned",
  WRITE_OFF: "Written off",
};

/**
 * Days-to-window as a sentence, from the ROW's own `policy_window_days`.
 *
 * The window is frozen onto each advance at issue precisely so that changing
 * the tenant default cannot retroactively age advances already in flight — so
 * this reads what the server sent and never a constant of its own.
 */
export function WindowPill({
  days,
  aged,
}: {
  days?: number | null;
  aged?: boolean;
}) {
  if (aged) return <Pill tone="bad">{tr("Aged")}</Pill>;
  if (days == null) return <span className="text-muted-foreground">—</span>;
  if (days < 0)
    return <Pill tone="bad">{`${num(Math.abs(days))} ${tr("days overdue")}`}</Pill>;
  if (days === 0) return <Pill tone="warn">{tr("Due today")}</Pill>;
  return (
    <Pill tone={days <= 2 ? "warn" : "mute"}>
      {`${num(days)} ${tr("days left")}`}
    </Pill>
  );
}

/** One figure in the balance header. */
function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-micro uppercase text-muted-foreground">{label}</div>
      <div
        className={
          strong
            ? "num text-title font-semibold tabular-nums text-foreground"
            : "num tabular-nums text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}

/* ─────────────────────────── The holder's own view ─────────────────────── */

/**
 * "My advances" — the missing half of the flow.
 *
 * Every other régie surface is finance-facing, but the person who owes the
 * receipts is the holder, and nothing asked them for any. An advance nobody
 * chases ages by default, which makes the 4211 reclassification routine instead
 * of exceptional — so this panel exists to make the obligation visible to the
 * one person who can discharge it.
 *
 * Self-scoped server-side (`GET /regie/mine` reads the session, not a
 * parameter), so it renders for any authenticated user with no MOD-49 grant.
 * Renders nothing at all when the holder owes nothing — an empty card on every
 * dashboard in the company would be noise.
 */
export function MyAdvances({
  onManage,
}: {
  /** Open the detail view. Omit on surfaces where the holder only needs to see
   *  what is outstanding (a dashboard) rather than act on it. */
  onManage?: (id: string) => void;
}) {
  const { data, error } = useResource(() => api.myRegie(), []);
  const rows = data || [];
  if (error) return <ErrorState message={error} />;
  if (rows.length === 0) return null;

  const owed = rows.reduce((s, r) => s + (Number(r.open_balance) || 0), 0);

  return (
    <Panel
      title={tr("My advances")}
      subtitle={`${num(rows.length)} open · ${money(owed)} ${tr("to justify")}`}
    >
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.regie_advance_id}
            className="flex flex-wrap items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <div className="num font-medium text-foreground">
                {r.doc_number || r.ref || r.regie_advance_id.slice(0, 8)}
              </div>
              <div className="text-micro text-muted-foreground">
                {tr("Issued")} {dateFmt(r.issued_on)}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="num tabular-nums text-foreground">
                {money(r.open_balance, r.currency)}
              </span>
              <WindowPill days={r.days_to_window} aged={r.is_aged} />
              {onManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onManage(r.regie_advance_id)}
                >
                  {tr("File receipt")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ───────────────────────── Retire (receipt / cash return) ──────────────── */

/**
 * Recording a receipt or returned cash.
 *
 * `dossier_id` is required for a RECEIPT and meaningless otherwise: 4731 is
 * `requires_analytic`, so the ledger trigger refuses a NULL dossier on that
 * leg. The form mirrors the server's refinement rather than inventing a rule —
 * and deliberately does NOT enforce proof, because whether an undocumented
 * receipt is refused is `finance.regie.require_proof_for_receipt`, a tenant
 * setting. Hardcoding it here would take that decision away from the tenant.
 *
 * WRITE_OFF is not offered here even though the API accepts it as a `kind`; it
 * has its own `approve`-gated action, because it gives up on money rather than
 * accounting for it.
 */
function RetireForm({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.RegieDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: dossiers } = useList<Dossier>("/dossiers");
  const open = Number(advance.open_balance ?? 0);
  const [f, setF] = React.useState({
    kind: "RECEIPT" as api.RegieRetirementKind,
    amount: "",
    dossier_id: "",
    proof_vault_id: "",
    memo: "",
    entry_date: todayISO(),
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const amt = Number(f.amount);
  const overRetired = f.amount !== "" && amt > open;
  const needsDossier = f.kind === "RECEIPT" && !f.dossier_id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.retireRegie(advance.regie_advance_id, {
        kind: f.kind,
        amount: amt,
        dossier_id: f.kind === "RECEIPT" ? f.dossier_id : undefined,
        proof_vault_id: f.proof_vault_id || undefined,
        memo: f.memo || undefined,
        entry_date: f.entry_date,
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
      title={tr("Retire advance")}
      description={`Open balance ${money(open, advance.currency)}. A receipt posts Dr 4731 per dossier; returned cash posts Dr 571. Both credit 581.`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={tr("Kind")} required>
            <Select
              value={f.kind}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="RECEIPT">{KIND_LABEL.RECEIPT}</option>
              <option value="CASH_RETURN">{KIND_LABEL.CASH_RETURN}</option>
            </Select>
          </Field>
          <Field
            label={tr("Amount")}
            required
            error={
              overRetired
                ? `Cannot retire more than the open balance (${money(open, advance.currency)})`
                : undefined
            }
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          {f.kind === "RECEIPT" && (
            <Field
              label={tr("Dossier")}
              required
              hint="4731 is analytical — a receipt must say which dossier it belongs to."
            >
              <Select
                value={f.dossier_id}
                onChange={(e) => set("dossier_id", e.target.value)}
              >
                <option value="">—</option>
                {(dossiers || []).map((d) => (
                  <option key={d.dossier_id} value={d.dossier_id}>
                    {d.ref}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={f.entry_date}
              onChange={(e) => set("entry_date", e.target.value)}
            />
          </Field>
          {f.kind === "RECEIPT" && (
            <Field
              label={tr("Proof document id")}
              hint="Required unless the tenant has relaxed require_proof_for_receipt."
            >
              <Input
                value={f.proof_vault_id}
                onChange={(e) => set("proof_vault_id", e.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label={tr("Memo")}>
          <Textarea
            rows={2}
            value={f.memo}
            onChange={(e) => set("memo", e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || f.amount === "" || amt <= 0 || overRetired || needsDossier}
          onCancel={onClose}
          saveLabel={tr("Record retirement")}
        />
      </form>
    </Modal>
  );
}

/* ───────────────────────── Query / write-off / un-age ──────────────────── */

/** A hold placed on an advance pending justification. No posting. */
function QueryForm({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.RegieDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.queryRegie(advance.regie_advance_id, reason);
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
      title={tr("Query advance")}
      description="A hold, not a verdict: a queried advance can still be justified, or written off if it proves unrecoverable. Nothing is posted."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Reason")} required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !reason.trim()}
          onCancel={onClose}
          saveLabel={tr("Place query")}
        />
      </form>
    </Modal>
  );
}

/**
 * Write-off — Dr 658 / Cr 581, reachable only from QUERIED.
 *
 * `approve`-gated and may open the tenant's workflow chain, so the response can
 * legitimately come back pending rather than posted; the caller reloads either
 * way and the state pill tells the truth.
 */
function WriteOffForm({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.RegieDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = Number(advance.open_balance ?? 0);
  const [f, setF] = React.useState({
    amount: "",
    memo: "",
    entry_date: todayISO(),
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const amt = f.amount === "" ? open : Number(f.amount);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.writeOffRegie(advance.regie_advance_id, {
        amount: f.amount === "" ? undefined : Number(f.amount),
        memo: f.memo || undefined,
        entry_date: f.entry_date,
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
      title={tr("Write off advance")}
      description="Gives up on recovering the money: Dr 658 sundry charges / Cr 581. This is an approval, and may route through the tenant's chain."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label={tr("Amount")}
            hint={`Leave blank to write off the whole open balance (${money(open, advance.currency)}).`}
            error={
              amt > open
                ? `Cannot write off more than the open balance (${money(open, advance.currency)})`
                : undefined
            }
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              placeholder={String(open)}
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={f.entry_date}
              onChange={(e) => set("entry_date", e.target.value)}
            />
          </Field>
        </div>
        <Field label={tr("Memo")}>
          <Textarea
            rows={2}
            value={f.memo}
            onChange={(e) => set("memo", e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || amt <= 0 || amt > open}
          onCancel={onClose}
          saveLabel={tr("Write off")}
        />
      </form>
    </Modal>
  );
}

/**
 * Un-age — reverses the aging reclassification (Dr 581 / Cr 4211) when the
 * holder produces receipts late.
 *
 * Advances aged before 10717 carry no `aged_entry_id`; the server refuses those
 * explicitly rather than posting a second, unlinked entry, and that refusal is
 * surfaced here as the server's own message.
 */
function UnageForm({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.RegieDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({ reason: "", entry_date: todayISO() });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.unageRegie(advance.regie_advance_id, {
        reason: f.reason || undefined,
        entry_date: f.entry_date,
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
      title={tr("Un-age advance")}
      description="The holder justified late: move the balance back out of the 4211 receivable and into 581 so receipts can post against it again."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={tr("Date")} required>
            <Input
              type="date"
              value={f.entry_date}
              onChange={(e) => set("entry_date", e.target.value)}
            />
          </Field>
        </div>
        <Field label={tr("Reason")}>
          <Textarea
            rows={2}
            value={f.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          onCancel={onClose}
          saveLabel={tr("Un-age")}
        />
      </form>
    </Modal>
  );
}

/* ───────────────────────────── The detail view ─────────────────────────── */

type Dialog = "retire" | "query" | "writeoff" | "unage" | null;

/**
 * Balance header + retirement ledger + the actions the SERVER says are
 * available.
 *
 * Action gating reads `advance.next` (the server's `NEXT[state]`) plus the two
 * preconditions the rules module documents:
 *   - write-off is reachable only from QUERIED (KB §6.8 step 5 writes off only
 *     what was first held as a query);
 *   - un-age only makes sense while the balance is sitting in 4211.
 * Everything else — over-retirement, missing proof, a closed advance — is left
 * to the server, which refuses with a message this renders verbatim.
 */
export function RegieDetail({
  advanceId,
  onChanged,
}: {
  advanceId: string;
  onChanged?: () => void;
}) {
  const { data, error, loading, reload } = useResource(
    () => api.getRegie(advanceId),
    [advanceId],
  );
  const [dialog, setDialog] = React.useState<Dialog>(null);

  const done = () => {
    reload();
    onChanged?.();
  };

  if (loading) return <div className="text-muted-foreground">{tr("Loading…")}</div>;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState title={tr("Advance not found")} />;

  const a = data;
  const next = a.next || [];
  const closed = a.state === "JUSTIFIED";
  const canRetire = !closed && next.length > 0;
  const canQuery = next.includes("QUERIED");
  const canWriteOff = a.state === "QUERIED";
  const canUnage = a.state === "AGED_UNJUSTIFIED";
  const rows = a.retirements || [];

  return (
    <div className="space-y-5">
      <Panel
        title={a.doc_number || a.ref || a.regie_advance_id.slice(0, 8)}
        subtitle={`Régie d'avance · ${a.currency || "XAF"}`}
        action={<Pill tone={regieTone(a.state)}>{a.state || "—"}</Pill>}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Figure label={tr("Issued")} value={money(a.amount, a.currency)} />
          <Figure
            label={tr("Justified")}
            value={money(a.justified_amount, a.currency)}
          />
          <Figure
            label={tr("Returned")}
            value={money(a.returned_amount, a.currency)}
          />
          <Figure
            label={tr("Open")}
            value={money(a.open_balance, a.currency)}
            strong
          />
          <div>
            <div className="text-micro uppercase text-muted-foreground">
              {tr("Window")}
            </div>
            <div className="mt-1">
              <WindowPill days={a.days_to_window} aged={a.is_aged} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {canRetire && (
            <Button onClick={() => setDialog("retire")}>
              {tr("Retire")}
            </Button>
          )}
          {canQuery && (
            <Button variant="outline" onClick={() => setDialog("query")}>
              {tr("Query")}
            </Button>
          )}
          {canWriteOff && (
            <Button variant="outline" onClick={() => setDialog("writeoff")}>
              {tr("Write off")}
            </Button>
          )}
          {canUnage && (
            <Button variant="outline" onClick={() => setDialog("unage")}>
              {tr("Un-age")}
            </Button>
          )}
          {closed && (
            <span className="text-sm text-muted-foreground">
              {tr("Fully justified and closed — 581 is flat for this advance.")}
            </span>
          )}
        </div>
      </Panel>

      <Panel
        title={tr("Retirement ledger")}
        subtitle={`${num(rows.length)} ${rows.length === 1 ? tr("entry") : tr("entries")}`}
      >
        {rows.length === 0 ? (
          <EmptyState
            title={tr("Nothing retired yet")}
            hint={tr(
              "Receipts, returned cash and write-offs appear here as they are recorded.",
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{tr("Date")}</th>
                  <th className="py-2 pr-3 font-medium">{tr("Kind")}</th>
                  <th className="py-2 pr-3 font-medium">{tr("Dossier")}</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {tr("Amount")}
                  </th>
                  <th className="py-2 font-medium">{tr("Proof")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.regie_retirement_id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      {dateFmt(r.retired_on || r.created_at)}
                    </td>
                    <td className="py-2 pr-3">
                      <Pill tone={r.kind === "WRITE_OFF" ? "bad" : "mute"}>
                        {KIND_LABEL[r.kind] || r.kind}
                      </Pill>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {r.dossier_id ? r.dossier_id.slice(0, 8) : "—"}
                    </td>
                    <td className="num py-2 pr-3 text-right tabular-nums">
                      {money(r.amount, a.currency)}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {r.proof_vault_id ? tr("Attached") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog === "retire" && (
        <RetireForm
          advance={a}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog === "query" && (
        <QueryForm advance={a} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog === "writeoff" && (
        <WriteOffForm
          advance={a}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog === "unage" && (
        <UnageForm advance={a} onClose={() => setDialog(null)} onSaved={done} />
      )}
    </div>
  );
}
