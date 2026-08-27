/**
 * Signing a document, wherever the document lives.
 *
 * ── Why this is not inside signatures.tsx ──────────────────────────────────
 * It was, and that made the signatures engine reachable from exactly one
 * screen: Vault → Signatures, which asks you to TYPE a document reference and a
 * doc type before it will do anything. Nobody raising a transit order goes
 * there, so in practice nothing was ever signed through the engine — the
 * feature was built, tested, documented and unreachable from the records it
 * exists for.
 *
 * These two components are the record-side surface. Drop `SignDocumentModal`
 * and `SignaturesOnRecord` onto any screen that owns a signable document and
 * that screen can sign and show signatures without knowing anything about the
 * engine beyond the entity ref.
 *
 * Everything the engine forbids is still forbidden here: the signer's identity
 * is resolved server-side from the session and cannot be typed, and the reason
 * is a controlled vocabulary rather than free text
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.12, §4.5).
 */

import { tr } from "@/lib/i18n";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
import { errMsg, useList, type Row } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { currentLocale } from "@/lib/i18n";
import { isGated } from "./shared";
import { SignatureCardGrid, type SignatureMenu } from "./signature-cards";
import { STATUS_WORDS, statusTone, look } from "./signature-vocab";

/**
 * Sign as the current user.
 *
 * The only inputs are WHICH METHOD and WHY. Everything else — who is signing,
 * what they are attesting to, the content fingerprint — is resolved server-side
 * from the session and the document.
 */
export function SignDocumentModal({
  open,
  entityRef,
  docType,
  onClose,
  onSaved,
}: {
  open: boolean;
  entityRef: string;
  docType: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [menu, setMenu] = React.useState<SignatureMenu | null>(null);
  const [preset, setPreset] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [reasons, setReasons] = React.useState<Row[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !docType) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMenu(null);
    (async () => {
      try {
        const m = await tenant<SignatureMenu>(
          `/signatures/menu?doc_type=${encodeURIComponent(docType)}`,
        );
        if (cancelled) return;
        setMenu(m);
        setPreset(m.default ?? m.cards[0]?.preset_code ?? null);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, docType]);

  React.useEffect(() => {
    if (!open) return;
    setReason("");
    // The signing reason is a controlled vocabulary, never free text — free
    // text on a legal seal is a liability field.
    // The reason is printed on the seal, so it is offered in the language the
    // operator is working in — the catalogue carries both, and picking
    // `label_en` unconditionally put "Approved for dispatch" in a French
    // dropdown and then on a French document.
    tenant<Row[]>("/signatures/reasons")
      .then((r) => setReasons(Array.isArray(r) ? r : []))
      .catch(() => setReasons([]));
  }, [open]);

  async function submit() {
    if (!preset) return;
    setBusy(true);
    setError(null);
    try {
      await tenant("/signatures/internal", {
        method: "POST",
        body: {
          entity_ref: entityRef,
          doc_type: docType,
          preset_code: preset,
          ...(reason ? { sign_reason: reason } : {}),
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Sign this document")}
      description="You are signing as yourself. Your name and role come from your account — they cannot be typed in."
      size="lg"
    >
      <div className="space-y-4">
        {loading ? (
          <SkeletonTable />
        ) : menu ? (
          <>
            <Field label={tr("How do you want to sign?")}>
              <SignatureCardGrid menu={menu} value={preset} onChange={setPreset} />
            </Field>
            <Field
              label={tr("Reason")}
              hint="Printed on the signature stamp."
            >
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">{tr("No reason given")}</option>
                {reasons.map((r) => (
                  <option key={String(r.reason_code)} value={String(r.reason_code)}>
                    {String(
                      (currentLocale().startsWith("fr") ? r.label_fr : r.label_en) ??
                        r.reason_code,
                    )}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} loading={busy} disabled={!preset || busy}>
            {tr("Sign")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


/**
 * The signatures already on one record, as the seals they print as.
 *
 * Deliberately NOT the vault page's table. On a record screen the question is
 * "is this document attested, by whom, and does the signature still cover what
 * it says now?" — three facts, not eight columns. AMENDED is called out in
 * words rather than shown as a status chip among others, because it is the one
 * state that means somebody must do something.
 *
 * Renders nothing at all when the tenant does not have signatures switched on,
 * or when there is nothing to show: a record screen must not sprout an empty
 * panel for a feature its tenant never bought.
 */
export function SignaturesOnRecord({
  entityRef,
  title,
}: {
  entityRef: string;
  /** Rendered as a heading, by this component, ONLY when there is something to
   *  head. The caller cannot wrap it in a section of its own: it would print an
   *  empty panel for a tenant whose signatures are switched off, which is worse
   *  than saying nothing. */
  title?: string;
}) {
  const { rows, error, errorCode } = useList(
    entityRef ? `/signatures?entity_ref=${encodeURIComponent(entityRef)}` : null,
  );
  if (isGated(errorCode) || error) return null;
  if (rows === null) return <SkeletonTable />;
  if (!rows.length) return null;

  return (
    <div className="space-y-2">
      {title ? <div className="micro text-muted-foreground">{title}</div> : null}
      {rows.map((r: Row) => {
        const status = String(r.status || "");
        const amended = status === "AMENDED";
        return (
          <div
            key={String(r.signature_id)}
            className="rounded-lg border border-[rgb(var(--ink)/0.1)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {String(r.signer_name || "—")}
              </span>
              {r.signer_role ? (
                <span className="text-sm text-muted-foreground">
                  {String(r.signer_role)}
                </span>
              ) : null}
              <Pill tone={statusTone(status)}>
                {look(STATUS_WORDS, status, status)}
              </Pill>
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {r.sign_reason_words ? (
                <span>{String(r.sign_reason_words)} · </span>
              ) : null}
              {dateFmt(r.signed_at)}
              {r.assurance_words ? (
                <span> · {String(r.assurance_words)}</span>
              ) : null}
            </div>
            {amended ? (
              <p className="mt-1 text-sm text-[rgb(var(--bad))]">
                {tr(
                  "The document changed after this was signed, so the signature no longer covers what it says now.",
                )}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── Asking somebody ELSE to sign ─────────────────────────────────────────── */

type Candidate = {
  source: "ON_FILE";
  source_ref: string;
  full_name: string;
  party_role: string | null;
  email: string;
  language: string | null;
  is_primary: boolean;
};
type Candidates = {
  counterparty: {
    party_id: string;
    party_name: string;
    party_language: string | null;
    signatories: Candidate[];
  } | null;
  internal: Candidate[];
  max_overrides: number;
};
/** A party as the request will store it. `override_reason` only ever on an OVERRIDE. */
type PartyDraft = {
  party_kind: "ISSUER" | "COUNTERPARTY" | "WITNESS";
  source: "ON_FILE" | "OVERRIDE";
  source_ref?: string;
  full_name: string;
  party_role?: string;
  email: string;
  language?: "fr" | "en";
  override_reason?: string;
};

const keyOf = (p: PartyDraft) => `${p.source}:${p.source_ref || p.email}`;

/**
 * Send a document out for signature.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  THE SENDER PICKS PEOPLE, NOT ADDRESSES.
 *
 *    Q7 = C is forbidden (guide §6.3): there is no path where a signer
 *    supplies the address their own OTP is sent to, and the sender typing it
 *    for them is the same disclosure wearing a different hat. So the list on
 *    the left is `GET /signature-requests/candidates` — rows the tenant
 *    already holds, returned with the `source_ref` the request stores.
 *
 *    The hand-entered signatory is available, capped at ONE, and REQUIRES A
 *    REASON — which the Certificate of Completion prints beside the sender's
 *    own name, so a reader can weigh the address. It is not a fallback for a
 *    lazy afternoon; it is the documented escape hatch for the client whose
 *    signatory genuinely is not on file yet.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Order is the signing order ─────────────────────────────────────────────
 * Position in the list IS `sequence_no` — the server takes it from the array
 * and there is no second field to disagree with it. The chain dispatches one
 * link at a time, so "who goes first" is a real decision and the list is
 * reorderable rather than sorted for us.
 *
 * ── The two sender booleans ────────────────────────────────────────────────
 * Certified and paper, and nothing else (§1.5(a)). Every digital card is
 * AES_OTP: STAMP and DRAWN differ in appearance and never in legal weight, so
 * a sender choosing between them would be picking a LOOK on the signer's
 * behalf — the one choice the signer was meant to make.
 */
export function SendForSignatureModal({
  open,
  entityRef,
  docType,
  onClose,
  onSent,
}: {
  open: boolean;
  entityRef: string;
  docType: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [cands, setCands] = React.useState<Candidates | null>(null);
  const [parties, setParties] = React.useState<PartyDraft[]>([]);
  const [message, setMessage] = React.useState("");
  const [requireCertified, setRequireCertified] = React.useState(false);
  const [allowPaper, setAllowPaper] = React.useState(true);
  const [expiresInDays, setExpiresInDays] = React.useState("14");
  const [manual, setManual] = React.useState<PartyDraft | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !entityRef || !docType) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setParties([]);
    setManual(null);
    setMessage("");
    (async () => {
      try {
        const r = await tenant<Candidates>(
          `/signature-requests/candidates?entity_ref=${encodeURIComponent(entityRef)}&doc_type=${encodeURIComponent(docType)}`,
        );
        if (cancelled) return;
        setCands(r);
        /*
         * Pre-select the counterparty's primary contact, and nobody else.
         *
         * It is right almost every time and it is one click to change — but an
         * internal countersignature is NOT pre-selected, because adding our own
         * name to a chain is a decision, and a chain that silently includes us
         * is one somebody has to notice to remove.
         */
        const primary = r.counterparty?.signatories.find((c) => c.is_primary)
          || r.counterparty?.signatories[0];
        if (primary) {
          setParties([{
            party_kind: "COUNTERPARTY",
            source: "ON_FILE",
            source_ref: primary.source_ref,
            full_name: primary.full_name,
            ...(primary.party_role ? { party_role: primary.party_role } : {}),
            email: primary.email,
            ...(primary.language === "fr" || primary.language === "en"
              ? { language: primary.language }
              : {}),
          }]);
        }
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entityRef, docType]);

  const has = (c: Candidate) => parties.some((p) => p.source_ref === c.source_ref);

  function toggle(c: Candidate, kind: PartyDraft["party_kind"]) {
    setParties((prev) =>
      prev.some((p) => p.source_ref === c.source_ref)
        ? prev.filter((p) => p.source_ref !== c.source_ref)
        : [
          ...prev,
          {
            party_kind: kind,
            source: "ON_FILE",
            source_ref: c.source_ref,
            full_name: c.full_name,
            ...(c.party_role ? { party_role: c.party_role } : {}),
            email: c.email,
            ...(c.language === "fr" || c.language === "en" ? { language: c.language } : {}),
          },
        ],
    );
  }

  function move(i: number, by: number) {
    setParties((prev) => {
      const next = [...prev];
      const j = i + by;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const overrides = parties.filter((p) => p.source === "OVERRIDE").length;
  const manualReady =
    manual !== null
    && manual.full_name.trim().length > 0
    && /.+@.+\..+/.test(manual.email)
    && (manual.override_reason || "").trim().length >= 3;

  async function submit() {
    if (!parties.length) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Create, then dispatch. Two calls because they are two acts: a DRAFT
       * request is a chain nobody has been emailed about yet, and the service
       * keeps that state deliberately (you can void a draft without anybody
       * ever having seen a link). The screen does both because "send for
       * signature" is one intention — but if the dispatch fails the request
       * survives as a draft on the record rather than vanishing, and the
       * chain panel offers "Send next link".
       */
      const created = await tenant<{ request_id: string }>("/signature-requests", {
        method: "POST",
        body: {
          entity_ref: entityRef,
          doc_type: docType,
          parties,
          ...(message.trim() ? { message: message.trim() } : {}),
          require_certified: requireCertified,
          allow_paper: allowPaper,
          ...(Number(expiresInDays) > 0 ? { expires_in_days: Number(expiresInDays) } : {}),
        },
      });
      await tenant(`/signature-requests/${encodeURIComponent(created.request_id)}/dispatch`, {
        method: "POST",
        body: {},
      });
      onSent();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const fr = currentLocale().startsWith("fr");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Send for signature")}
      description="Each signatory gets their own link, in order. They confirm a code sent to the address we hold — you never type it for them."
      size="lg"
    >
      <div className="space-y-4">
        {loading ? (
          <SkeletonTable />
        ) : (
          <>
            {cands?.counterparty ? (
              <Field
                label={`${tr("Signatories at")} ${cands.counterparty.party_name}`}
                hint="From your records. Add someone here on the client's file rather than typing an address."
              >
                <div className="space-y-1">
                  {cands.counterparty.signatories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {tr("Nobody on this client's file has an email address yet.")}
                    </p>
                  ) : (
                    cands.counterparty.signatories.map((c) => (
                      <CandidateRow
                        key={c.source_ref}
                        c={c}
                        checked={has(c)}
                        onToggle={() => toggle(c, "COUNTERPARTY")}
                      />
                    ))
                  )}
                </div>
              </Field>
            ) : null}

            <Field
              label={tr("Countersign from your side")}
              hint="Optional. Adds one of your own people to the chain."
            >
              <Select
                value=""
                onChange={(e) => {
                  const c = cands?.internal.find((x) => x.source_ref === e.target.value);
                  if (c && !has(c)) toggle(c, "ISSUER");
                }}
              >
                <option value="">{tr("Add a colleague…")}</option>
                {(cands?.internal || [])
                  .filter((c) => !has(c))
                  .map((c) => (
                    <option key={c.source_ref} value={c.source_ref}>
                      {c.full_name}
                      {c.party_role ? ` · ${c.party_role}` : ""}
                    </option>
                  ))}
              </Select>
            </Field>

            {/* The one hand-entered signatory. Capped, attributed, and it costs
                a reason — which the certificate prints. */}
            {manual === null ? (
              overrides < (cands?.max_overrides ?? 1) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setManual({
                      party_kind: "COUNTERPARTY",
                      source: "OVERRIDE",
                      full_name: "",
                      email: "",
                      override_reason: "",
                    })
                  }
                >
                  {tr("Someone not on file…")}
                </Button>
              ) : null
            ) : (
              <div className="space-y-2 rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn-fill)/0.08)] p-3">
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "You are vouching for this address. Your name and the reason below are printed on the certificate of completion.",
                  )}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={tr("Full name")}>
                    <Input
                      value={manual.full_name}
                      onChange={(e) => setManual({ ...manual, full_name: e.target.value })}
                    />
                  </Field>
                  <Field label={tr("Role")}>
                    <Input
                      value={manual.party_role || ""}
                      onChange={(e) => setManual({ ...manual, party_role: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={tr("Email")}>
                  <Input
                    type="email"
                    value={manual.email}
                    onChange={(e) => setManual({ ...manual, email: e.target.value })}
                  />
                </Field>
                <Field label={tr("Why is this address not on file?")} required>
                  <Input
                    value={manual.override_reason || ""}
                    onChange={(e) => setManual({ ...manual, override_reason: e.target.value })}
                    placeholder="e.g. New signatory named by the client on today's call"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!manualReady}
                    onClick={() => {
                      setParties((prev) => [...prev, manual]);
                      setManual(null);
                    }}
                  >
                    {tr("Add to the chain")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setManual(null)}>
                    {tr("Cancel")}
                  </Button>
                </div>
              </div>
            )}

            <Field
              label={tr("Signing order")}
              hint="Each link is sent when the one before it is signed."
            >
              {parties.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {tr("Choose at least one signatory.")}
                </p>
              ) : (
                <ol className="space-y-1">
                  {parties.map((p, i) => (
                    <li
                      key={keyOf(p)}
                      className="flex items-center gap-2 rounded-lg border border-[rgb(var(--ink)/0.1)] px-3 py-1.5 text-sm"
                    >
                      <span className="num w-5 text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{p.full_name}</span>
                        <span className="text-muted-foreground"> · {p.email}</span>
                      </span>
                      {p.source === "OVERRIDE" ? (
                        <Pill tone="warn">{tr("Entered by hand")}</Pill>
                      ) : null}
                      <Pill tone="mute">
                        {p.party_kind === "ISSUER" ? tr("Us") : tr("Client")}
                      </Pill>
                      <button
                        type="button"
                        aria-label={tr("Move up")}
                        className="px-1 text-muted-foreground disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={tr("Move down")}
                        className="px-1 text-muted-foreground disabled:opacity-30"
                        disabled={i === parties.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={tr("Remove")}
                        className="px-1 text-muted-foreground"
                        onClick={() => setParties((prev) => prev.filter((x) => keyOf(x) !== keyOf(p)))}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Field>

            <Field label={tr("Message to the signatories")} hint="Optional. Appears in the email.">
              <Textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  fr
                    ? "Merci de signer l'ordre de transit ci-joint."
                    : "Please sign the attached transit order."
                }
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requireCertified}
                  onChange={(e) => setRequireCertified(e.target.checked)}
                />
                {tr("Require a certified signature")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowPaper}
                  onChange={(e) => setAllowPaper(e.target.checked)}
                />
                {tr("Allow printing and signing by hand")}
              </label>
              <Field label={tr("Expires after (days)")}>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                />
              </Field>
            </div>
          </>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} loading={busy} disabled={!parties.length || busy}>
            {tr("Send")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CandidateRow({
  c,
  checked,
  onToggle,
}: {
  c: Candidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[rgb(var(--ink)/0.04)]">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{c.full_name}</span>
        {c.party_role ? (
          <span className="text-muted-foreground"> · {c.party_role}</span>
        ) : null}
        <span className="block text-xs text-muted-foreground">{c.email}</span>
      </span>
      {c.is_primary ? <Pill tone="mute">{tr("Primary")}</Pill> : null}
    </label>
  );
}


/**
 * The signature chains on one record: who was ASKED, and where it got to.
 *
 * Deliberately separate from `SignaturesOnRecord`, which shows who HAS signed.
 * They answer different questions and the pair is what makes a mid-chain state
 * legible — a request `PARTIALLY_SIGNED` with one signature on the document is
 * normal, and either view alone reads as something having gone wrong.
 *
 * Renders nothing when the tenant has no external signing (`signatures.external`
 * is its own switch, separate from the portal) or when nothing has been sent.
 */
export function SignatureChainOnRecord({
  entityRef,
  title,
  refreshKey = 0,
}: {
  entityRef: string;
  title?: string;
  /** Bump to re-read after sending — the list is not otherwise told. */
  refreshKey?: number;
}) {
  const { rows, error, errorCode, reload } = useList(
    entityRef ? `/signature-requests?entity_ref=${encodeURIComponent(entityRef)}` : null,
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (refreshKey) reload();
    // `reload` is stable per resource; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const run = async (id: string, path: string) => {
    setBusy(id);
    setFailed(null);
    try {
      await tenant(`/signature-requests/${encodeURIComponent(id)}/${path}`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setFailed(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (isGated(errorCode) || error) return null;
  if (rows === null) return null;
  if (!rows.length) return null;

  return (
    <div className="space-y-2">
      {title ? <div className="micro text-muted-foreground">{title}</div> : null}
      {failed ? <ErrorState message={failed} /> : null}
      {rows.map((r: Row) => {
        const id = String(r.request_id);
        const status = String(r.status || "");
        const open = ["DRAFT", "SENT", "PARTIALLY_SIGNED"].includes(status);
        return (
          <div key={id} className="rounded-lg border border-[rgb(var(--ink)/0.1)] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={chainTone(status)}>{status.replace(/_/g, " ")}</Pill>
              <span className="text-sm text-muted-foreground">
                {String(r.signed_count ?? 0)} / {String(r.party_count ?? 0)} {tr("signed")}
              </span>
              {r.expires_at ? (
                <span className="text-sm text-muted-foreground">
                  · {tr("expires")} {dateFmt(r.expires_at)}
                </span>
              ) : null}
              <span className="ml-auto flex gap-1">
                {open ? (
                  <Button size="sm" variant="ghost" loading={busy === id} onClick={() => run(id, "dispatch")}>
                    {tr("Send next link")}
                  </Button>
                ) : null}
                {status === "COMPLETED" ? (
                  <Button size="sm" variant="ghost" loading={busy === id} onClick={() => run(id, "certificate")}>
                    {tr("Certificate")}
                  </Button>
                ) : null}
                {open ? (
                  <Button size="sm" variant="ghost" loading={busy === id} onClick={() => run(id, "void")}>
                    {tr("Void")}
                  </Button>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Tone for a chain status. Unknown input is neutral, never a crash. */
function chainTone(status: string): "ok" | "warn" | "bad" | "mute" {
  const map: Record<string, "ok" | "warn" | "bad" | "mute"> = Object.assign(
    Object.create(null) as Record<string, "ok" | "warn" | "bad" | "mute">,
    {
      COMPLETED: "ok",
      SENT: "warn",
      PARTIALLY_SIGNED: "warn",
      DRAFT: "mute",
      DECLINED: "bad",
      AMENDED: "bad",
      EXPIRED: "bad",
      VOIDED: "mute",
    },
  );
  return Object.prototype.hasOwnProperty.call(map, status) ? map[status] : "mute";
}
