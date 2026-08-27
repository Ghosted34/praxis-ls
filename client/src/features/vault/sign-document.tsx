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
