/**
 * The staff half of the client portal (redesign PR 1, migration 14150).
 *
 *   REQUESTS      what we asked a client for — a document or a piece of
 *                 information, against a shipment or not — and what they sent.
 *                 Operations (MOD-29) asks, opens the file, and accepts it or
 *                 sends it back WITH A REASON: the client reads that reason on
 *                 their phone, so "rejected" alone is not an answer.
 *   PAYMENT PROOFS  "I have paid" from the client's side. A claim, not money:
 *                 finance (MOD-52) opens the receipt, then confirms — which
 *                 drafts the receipt in Receivables — or rejects with a reason.
 *   PEOPLE & ONBOARDING  who at the client can sign in, and their checklist —
 *                 client-portal-people.tsx, composed into the tab below.
 *
 * Used in three places: the Client 360 "Portal" tab (one client), the
 * Receivables page (every client's proofs waiting for finance), and the
 * Clients list's "To review" queue (every upload waiting for operations).
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { tenant, tenantDownload } from "@/lib/api-client";
import { errMsg, useList } from "@/lib/use-resource";
import { money, dateFmt, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Segmented } from "@/components/ui/segmented";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { useToast } from "@/components/ui/toast";
import { useCanUseModule } from "@/lib/route-access";
import {
  ClientOnboarding,
  ClientPortalPeople,
  PortalSectionHeader,
  type ContactSuggestion,
} from "./client-portal-people";

/* ── shapes (portal_client.service.js requestView / proofView) ──────────── */

export type StaffRequest = {
  client_request_id: string;
  client_id: string;
  client_name: string | null;
  dossier_id: string | null;
  dossier_ref: string | null;
  source: "RULE" | "STAFF" | "CLIENT";
  kind: "DOCUMENT" | "INFO";
  doc_type_code: string | null;
  doc_type_en: string | null;
  doc_type_fr: string | null;
  title: string | null;
  note: string | null;
  due_on: string | null;
  status: "OPEN" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  answer_text: string | null;
  answer_doc_id: string | null;
  answer_doc_name: string | null;
  answered_at: string | null;
  /** Who at the client sent it: their login's name, and the address it came from. */
  answered_by_email?: string | null;
  answered_by_name?: string | null;
  review_note: string | null;
  created_at: string;
};

export type StaffProof = {
  payment_proof_id: string;
  client_id: string;
  client_name: string | null;
  amount: number;
  currency: string;
  method: "BANK" | "MOBILE_MONEY" | "CASH" | "CHEQUE";
  provider: string | null;
  paid_on: string;
  reference: string | null;
  note: string | null;
  dossier_ref: string | null;
  status: "SUBMITTED" | "CONFIRMED" | "REJECTED";
  review_note: string | null;
  submitted_by_email: string | null;
  submitted_by_name?: string | null;
  created_at: string;
  has_file: boolean;
  allocations: { invoice_id: string; doc_number: string | null; amount: number }[];
};

type DocType = { code: string; name_en: string | null; name_fr: string | null };

/** "by Paul Atiock (paul@goum.cm)" — who at the client sent it. */
function byLine(name: string | null | undefined, email: string | null | undefined): string | null {
  if (!name && !email) return null;
  return tv("by {{who}}", { who: name && email ? `${name} (${email})` : name || email || "" });
}

const REQ_TONE: Record<StaffRequest["status"], Tone> = {
  OPEN: "warn",
  REJECTED: "bad",
  SUBMITTED: "blue",
  ACCEPTED: "ok",
  CANCELLED: "mute",
};
const REQ_LABEL: Record<StaffRequest["status"], string> = {
  OPEN: "Waiting for client",
  REJECTED: "Sent back",
  SUBMITTED: "To review",
  ACCEPTED: "Accepted",
  CANCELLED: "Cancelled",
};
const PROOF_TONE: Record<StaffProof["status"], Tone> = { SUBMITTED: "blue", CONFIRMED: "ok", REJECTED: "bad" };
const PROOF_LABEL: Record<StaffProof["status"], string> = { SUBMITTED: "To confirm", CONFIRMED: "Confirmed", REJECTED: "Rejected" };
const METHOD_LABEL: Record<StaffProof["method"], string> = {
  BANK: "Bank transfer",
  MOBILE_MONEY: "Mobile money",
  CASH: "Cash",
  CHEQUE: "Cheque",
};

const requestName = (r: StaffRequest) => r.title || r.doc_type_en || r.doc_type_fr || r.doc_type_code || tr("Information");

/* ── requests ───────────────────────────────────────────────────────────── */

type ReqView = "review" | "waiting" | "done";

/**
 * What we asked a client for. With `clientId` it is one client's list and
 * offers "Ask the client"; without it, it is the operations queue across
 * every client, opening on what is waiting for review.
 */
export function ClientRequestsPanel({
  clientId,
  dossiers = [],
}: {
  clientId?: string;
  dossiers?: { dossier_id: string; ref: string }[];
}) {
  const path = `/portal/client-requests${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`;
  const { rows, error, loading, reload } = useList<StaffRequest>(path);
  const [view, setView] = React.useState<ReqView>("review");
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [prompt, promptDialog] = usePrompt();
  const toast = useToast();

  const all = rows || [];
  const review = all.filter((r) => r.status === "SUBMITTED");
  const waiting = all.filter((r) => r.status === "OPEN" || r.status === "REJECTED");
  const done = all.filter((r) => r.status === "ACCEPTED" || r.status === "CANCELLED");
  const shown = view === "review" ? review : view === "waiting" ? waiting : done;

  async function decide(r: StaffRequest, decision: "ACCEPT" | "REJECT" | "CANCEL") {
    let note: string | null = null;
    if (decision === "REJECT") {
      note = await prompt({
        title: tr("Send this back to the client?"),
        description: tr("They see your reason on the request and can send a new file."),
        label: tr("What is wrong with it"),
        placeholder: tr("Page 2 is missing"),
        multiline: true,
        confirmLabel: tr("Send back"),
        validate: (v) => (v.trim() ? null : tr("Tell the client what to fix.")),
      });
      if (note === null) return;
    }
    if (decision === "CANCEL") {
      const ok = await confirm({
        title: tr("Stop asking for this?"),
        body: tr("The request disappears from the client's list. You can ask again later."),
        confirmLabel: tr("Cancel request"),
        cancelLabel: tr("Keep it"),
      });
      if (!ok) return;
    }
    setBusy(r.client_request_id);
    try {
      await tenant(`/portal/client-requests/${r.client_request_id}/review`, { method: "POST", body: { decision, note } });
      toast.success(decision === "ACCEPT" ? tr("Accepted — filed on the shipment.") : decision === "REJECT" ? tr("Sent back to the client.") : tr("Request cancelled."));
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function open(r: StaffRequest) {
    try {
      await tenantDownload(`/portal/client-requests/${r.client_request_id}/file`, r.answer_doc_name || `${requestName(r)}.pdf`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented<ReqView>
          label={tr("Requests")}
          value={view}
          onChange={setView}
          options={[
            { value: "review", label: `${tr("To review")} · ${review.length}` },
            { value: "waiting", label: `${tr("Waiting for client")} · ${waiting.length}` },
            { value: "done", label: tr("Done") },
          ]}
        />
        {clientId ? <Button onClick={() => setAsking(true)}>{tr("Ask the client")}</Button> : null}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : loading && !rows ? (
        <SkeletonTable />
      ) : shown.length === 0 ? (
        <EmptyState
          title={view === "review" ? tr("Nothing to review") : view === "waiting" ? tr("Nothing outstanding") : tr("Nothing yet")}
          hint={view === "waiting" && clientId ? tr("Ask for a document or a piece of information — the client gets it on their phone.") : undefined}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {shown.map((r) => (
            <li key={r.client_request_id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{requestName(r)}</p>
                  <Pill tone={REQ_TONE[r.status]}>{tr(REQ_LABEL[r.status])}</Pill>
                  {r.source === "RULE" ? <Pill tone="mute">{tr("Automatic")}</Pill> : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[
                    !clientId ? r.client_name : null,
                    r.dossier_ref,
                    r.due_on ? `${tr("Due")} ${dateFmt(r.due_on)}` : null,
                    r.answered_at ? `${tr("Sent")} ${dateFmt(r.answered_at)}` : null,
                    byLine(r.answered_by_name, r.answered_by_email),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {r.status === "SUBMITTED" && r.answer_text ? (
                  <p className="mt-1 rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">{r.answer_text}</p>
                ) : null}
                {r.status === "REJECTED" && r.review_note ? <p className="mt-1 text-xs text-[rgb(var(--bad))]">{r.review_note}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.status === "SUBMITTED" && r.answer_doc_id ? (
                  <Button size="sm" variant="outline" onClick={() => void open(r)}>
                    {tr("Open file")}
                  </Button>
                ) : null}
                {r.status === "SUBMITTED" ? (
                  <>
                    <Button size="sm" variant="outline" loading={busy === r.client_request_id} onClick={() => void decide(r, "REJECT")}>
                      {tr("Send back")}
                    </Button>
                    <Button size="sm" loading={busy === r.client_request_id} onClick={() => void decide(r, "ACCEPT")}>
                      {tr("Accept")}
                    </Button>
                  </>
                ) : null}
                {r.status === "OPEN" || r.status === "REJECTED" ? (
                  <Button size="sm" variant="ghost" loading={busy === r.client_request_id} onClick={() => void decide(r, "CANCEL")}>
                    {tr("Cancel")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {clientId ? (
        <AskModal
          open={asking}
          clientId={clientId}
          dossiers={dossiers}
          onClose={() => setAsking(false)}
          onSaved={() => {
            setView("waiting");
            reload();
          }}
        />
      ) : null}
      {confirmDialog}
      {promptDialog}
    </section>
  );
}

function AskModal({
  open,
  clientId,
  dossiers,
  onClose,
  onSaved,
}: {
  open: boolean;
  clientId: string;
  dossiers: { dossier_id: string; ref: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: types } = useList<DocType>(open ? "/portal/client-requests/document-types" : null);
  const toast = useToast();
  const [kind, setKind] = React.useState<"DOCUMENT" | "INFO">("DOCUMENT");
  const [docType, setDocType] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [dossierId, setDossierId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [dueOn, setDueOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKind("DOCUMENT");
    setDocType("");
    setTitle("");
    setDossierId(dossiers.length === 1 ? dossiers[0].dossier_id : "");
    setNote("");
    setDueOn("");
    setError(null);
  }, [open, dossiers]);

  const ready = kind === "DOCUMENT" ? !!docType || !!title.trim() : !!title.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/portal/client-requests", {
        method: "POST",
        body: {
          client_id: clientId,
          dossier_id: dossierId || null,
          kind,
          doc_type_code: kind === "DOCUMENT" ? docType || null : null,
          title: title.trim() || null,
          note: note.trim() || null,
          due_on: dueOn || null,
        },
      });
      toast.success(tr("Sent — the client sees it on their portal."));
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
      open={open}
      onClose={onClose}
      title={tr("Ask the client")}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" form="pt-ask-client" loading={busy} disabled={!ready}>
            {tr("Send request")}
          </Button>
        </div>
      }
    >
      <form id="pt-ask-client" onSubmit={(e) => void save(e)} className="grid gap-4">
        <Segmented<"DOCUMENT" | "INFO">
          label={tr("What you need")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "DOCUMENT", label: tr("A document") },
            { value: "INFO", label: tr("Information") },
          ]}
        />
        {kind === "DOCUMENT" ? (
          <Field label={tr("Document")} htmlFor="pt-ask-type">
            <Select id="pt-ask-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">{tr("Choose…")}</option>
              {(types || []).map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name_en || d.name_fr || d.code}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={kind === "DOCUMENT" ? tr("Title (optional)") : tr("What you need to know")} htmlFor="pt-ask-title">
          <Input id="pt-ask-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "INFO" ? tr("Consignee tax number (NIU)") : undefined} />
        </Field>
        {dossiers.length ? (
          <Field label={tr("Shipment")} htmlFor="pt-ask-dossier">
            <Select id="pt-ask-dossier" value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
              <option value="">{tr("Not about one shipment")}</option>
              {dossiers.map((d) => (
                <option key={d.dossier_id} value={d.dossier_id}>
                  {d.ref}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={tr("Due by (optional)")} htmlFor="pt-ask-due">
          <DateField id="pt-ask-due" value={dueOn} onChange={setDueOn} min={todayISO()} />
        </Field>
        <Field label={tr("Note to the client (optional)")} htmlFor="pt-ask-note">
          <Textarea id="pt-ask-note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <ErrorState message={error} /> : null}
      </form>
    </Modal>
  );
}

/* ── payment proofs ─────────────────────────────────────────────────────── */

type TreasuryAccount = { treasury_account_id: string; kind: string; label: string };
const KIND_FOR_METHOD: Record<StaffProof["method"], string> = { BANK: "BANK", CHEQUE: "BANK", MOBILE_MONEY: "MOMO", CASH: "CASH" };

/**
 * "I have paid" claims. Finance confirms (drafting the receipt) or rejects
 * with a reason the client reads. `compact` renders only what is waiting and
 * nothing at all when nothing is — the Receivables page's strip.
 */
export function PaymentProofQueue({ clientId, compact = false, onChanged }: { clientId?: string; compact?: boolean; onChanged?: () => void }) {
  const qs = new URLSearchParams();
  if (clientId) qs.set("client_id", clientId);
  if (compact) qs.set("status", "SUBMITTED");
  const path = `/portal/payment-proofs${qs.toString() ? `?${qs}` : ""}`;
  const { rows, error, loading, reload } = useList<StaffProof>(path);
  const [confirming, setConfirming] = React.useState<StaffProof | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [prompt, promptDialog] = usePrompt();
  const toast = useToast();

  async function reject(p: StaffProof) {
    const note = await prompt({
      title: tr("Reject this payment?"),
      description: tr("The client sees your reason and can send a new proof."),
      label: tr("Why"),
      placeholder: tr("No transfer with this reference has reached our account"),
      multiline: true,
      confirmLabel: tr("Reject payment"),
      validate: (v) => (v.trim() ? null : tr("Tell the client why.")),
    });
    if (note === null) return;
    setBusy(p.payment_proof_id);
    try {
      await tenant(`/portal/payment-proofs/${p.payment_proof_id}/reject`, { method: "POST", body: { note } });
      toast.success(tr("Rejected — the client has been told why."));
      reload();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function file(p: StaffProof) {
    try {
      await tenantDownload(`/portal/payment-proofs/${p.payment_proof_id}/file`, `payment-proof-${p.paid_on}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const list = rows || [];
  if (compact && !list.length) return null;

  return (
    <section className={compact ? "mb-5 rounded-lg border border-[rgb(var(--brand-blue))]/40 bg-[rgb(var(--brand-blue))]/5 p-3" : undefined}>
      {compact ? (
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-sm font-medium">{tr("Payments clients say they made")}</span>
          <Pill tone="blue">{`${list.length} ${tr("to confirm")}`}</Pill>
        </div>
      ) : null}
      {error ? (
        <ErrorState message={error} />
      ) : loading && !rows ? (
        <SkeletonTable />
      ) : !list.length ? (
        <EmptyState title={tr("No payment proofs")} hint={tr("When the client taps “I’ve paid” in their portal, the proof lands here.")} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((p) => (
            <li key={p.payment_proof_id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="num text-sm font-semibold text-foreground">{money(p.amount, p.currency)}</p>
                  <Pill tone={PROOF_TONE[p.status]}>{tr(PROOF_LABEL[p.status])}</Pill>
                  <Pill tone="mute">{tr(METHOD_LABEL[p.method])}{p.provider ? ` · ${p.provider}` : ""}</Pill>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[
                    !clientId ? p.client_name : null,
                    `${tr("Paid")} ${dateFmt(p.paid_on)}`,
                    p.reference,
                    p.allocations.map((a) => a.doc_number).filter(Boolean).join(", ") || null,
                    byLine(p.submitted_by_name, p.submitted_by_email),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.note ? <p className="mt-1 text-xs text-foreground">{p.note}</p> : null}
                {p.status === "REJECTED" && p.review_note ? <p className="mt-1 text-xs text-[rgb(var(--bad))]">{p.review_note}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {p.has_file ? (
                  <Button size="sm" variant="outline" onClick={() => void file(p)}>
                    {tr("Open receipt")}
                  </Button>
                ) : null}
                {p.status === "SUBMITTED" ? (
                  <>
                    <Button size="sm" variant="outline" loading={busy === p.payment_proof_id} onClick={() => void reject(p)}>
                      {tr("Reject")}
                    </Button>
                    <Button size="sm" loading={busy === p.payment_proof_id} onClick={() => setConfirming(p)}>
                      {tr("Confirm")}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmProofModal
        proof={confirming}
        onClose={() => setConfirming(null)}
        onDone={() => {
          reload();
          onChanged?.();
        }}
      />
      {promptDialog}
    </section>
  );
}

function ConfirmProofModal({ proof, onClose, onDone }: { proof: StaffProof | null; onClose: () => void; onDone: () => void }) {
  const { rows: treasury } = useList<TreasuryAccount>(proof ? "/treasury-accounts" : null);
  const toast = useToast();
  const [account, setAccount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setAccount(""), [proof]);
  if (!proof) return null;
  const accounts = (treasury || []).filter((t) => t.kind === KIND_FOR_METHOD[proof.method]);
  const drafts = proof.allocations.length > 0;

  async function go() {
    if (!proof) return;
    setBusy(true);
    try {
      await tenant(`/portal/payment-proofs/${proof.payment_proof_id}/confirm`, {
        method: "POST",
        body: { treasury_account_id: account || null },
      });
      toast.success(drafts ? tr("Confirmed — a draft receipt is waiting in Receivables.") : tr("Confirmed."));
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!proof}
      onClose={onClose}
      title={tr("Confirm this payment?")}
      description={`${money(proof.amount, proof.currency)} · ${proof.client_name || ""}`}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button loading={busy} onClick={() => void go()}>
            {tr("Confirm payment")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {drafts
            ? tr("A draft receipt is created for the invoices the client named. It is posted from Receivables, like any other receipt.")
            : tr("The client did not name an invoice, so no receipt is drafted — allocate it from Receivables.")}
        </p>
        {drafts && proof.method !== "CASH" ? (
          <Field label={tr("Received into")} htmlFor="pt-proof-account">
            <Select id="pt-proof-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">{tr("Choose later")}</option>
              {accounts.map((a) => (
                <option key={a.treasury_account_id} value={a.treasury_account_id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/* ── the Client 360 tab ─────────────────────────────────────────────────── */

export function ClientPortalTab({
  clientId,
  dossiers,
  contacts = [],
}: {
  clientId: string;
  dossiers: { dossier_id: string; ref: string }[];
  contacts?: ContactSuggestion[];
}) {
  // Each section follows its own grant, so nobody meets a panel that only
  // ever answers 403: people, onboarding and requests are the client portal
  // (MOD-29); payment claims are receivables (MOD-52).
  const canPortal = useCanUseModule("MOD-29");
  const canProofs = useCanUseModule("MOD-52");
  return (
    // `grid-cols-1`, not a bare `grid`: an implicit column is sized `auto`, so
    // one long unbreakable email grew it past a phone's width and pushed the
    // Invite button off the screen. minmax(0, 1fr) lets `truncate` do its job.
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {/* Full width, one section under another, like every other tab of this
          360: the people table needs its five columns, and half a pane is a
          horizontal scroll at any width a desktop actually has. */}
      {canPortal ? <ClientPortalPeople clientId={clientId} contacts={contacts} /> : null}
      {canPortal ? <ClientOnboarding clientId={clientId} /> : null}
      {canPortal ? (
        <section className="min-w-0">
          <PortalSectionHeader title={tr("Documents and information")} />
          <ClientRequestsPanel clientId={clientId} dossiers={dossiers} />
        </section>
      ) : null}
      {canProofs ? (
        <section className="min-w-0">
          <PortalSectionHeader title={tr("Payments reported")} />
          <PaymentProofQueue clientId={clientId} />
        </section>
      ) : null}
    </div>
  );
}
