/**
 * Vault — signatures on a document.
 *
 * Rewritten for the multi-tier signature model
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §4.6). The page this replaced asked the
 * user to TYPE A SIGNER NAME and picked between DIGITAL and PHYSICAL — both of
 * which the new model forbids outright:
 *
 *   · A signer's identity is resolved from the session, server-side, and the
 *     API now REJECTS a body carrying signer_name rather than ignoring it. So
 *     there is no name field here, and there never should be again.
 *   · The method a signature carries is a card from the tenant's own catalogue,
 *     resolved through the eligibility funnel — not a two-value dropdown.
 *
 * Search-first by design: it fetches nothing until a reference is entered, so
 * its "empty" IS its arrival state.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
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
function SignForm({
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
                    {String(r.label_en ?? r.reason_code)}
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

function RevokeForm({
  open,
  signature,
  onClose,
  onSaved,
}: {
  open: boolean;
  signature: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!signature) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/signatures/${encodeURIComponent(String(signature.signature_id))}/revoke`, {
        method: "POST",
        body: { reason: reason.trim() },
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
      title={tr("Revoke this signature")}
      description="The signature is kept on record. Anyone scanning a printed copy will be told it was revoked, and why."
      size="md"
    >
      <div className="space-y-4">
        <Field label={tr("Reason")} hint="Shown on the public verification page.">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr("Signed against the wrong revision")}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            loading={busy}
            disabled={reason.trim().length < 3 || busy}
          >
            {tr("Revoke")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Who has verified this signature, when, and from how many distinct addresses.
 *
 * This is the internal half of the public portal, and it is what replaced the
 * deleted "paste a hash" screen (guide §5.7, addition i). That screen asked an
 * operator to type a fingerprint into a box; this one answers the question they
 * actually have — did the counterparty ever check the document I sent them?
 *
 * Addresses are MASKED here as well as on the portal. §3.13 grants MOD-64
 * `view` the full value, but as a deliberate reveal that is itself audited — a
 * list rendering forty full addresses on open is not that reveal, it is a
 * standing disclosure nobody asked for. The masking happens server-side, so
 * this component never receives one.
 */
function ScansModal({
  signature,
  onClose,
}: {
  signature: Row | null;
  onClose: () => void;
}) {
  const id = signature ? String(signature.signature_id) : null;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    tenant<Row>(`/signatures/${encodeURIComponent(id)}/scans`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const scans = (data?.scans as Row[] | undefined) ?? [];

  return (
    <Modal
      open={Boolean(signature)}
      onClose={onClose}
      title={tr("Verifications")}
      description="Every time someone scanned this document's QR code or typed its verification code."
      size="lg"
    >
      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <SkeletonTable />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {String(data.total ?? 0)} verification
            {Number(data.total ?? 0) === 1 ? "" : "s"} from{" "}
            {String(data.distinct_ips ?? 0)} distinct network
            {Number(data.distinct_ips ?? 0) === 1 ? "" : "s"}
            {data.last_scan_at ? `, last ${dateFmt(data.last_scan_at)}` : ""}.
          </p>
          {scans.length === 0 ? (
            <EmptyState
              title={tr("Nobody has verified this yet")}
              hint="A verification is recorded the first time someone scans the printed QR code or types the code beneath it."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{tr("When")}</TH>
                  <TH>{tr("How")}</TH>
                  <TH>{tr("Network")}</TH>
                  <TH>{tr("Device")}</TH>
                </TR>
              </THead>
              <TBody>
                {scans.map((r) => (
                  <TR key={String(r.scan_id)}>
                    <TD className="text-sm">{dateFmt(r.scanned_at)}</TD>
                    <TD className="text-sm">
                      {r.via === "CODE" ? "Typed code" : "Scanned QR"}
                      {r.is_new_ip ? (
                        <span className="block text-xs text-muted-foreground">
                          First time from this network
                        </span>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-xs">{cell(r.ip)}</TD>
                    <TD className="text-sm">{cell(r.device)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </Modal>
  );
}

export function SignaturesPage() {
  const [refInput, setRefInput] = React.useState("");
  const [typeInput, setTypeInput] = React.useState("");
  const [activeRef, setActiveRef] = React.useState("");
  const [activeType, setActiveType] = React.useState("");
  const reload = useRefresh();
  const { rows, error, errorCode } = useList(
    activeRef ? `/signatures?entity_ref=${encodeURIComponent(activeRef)}` : null,
  );
  const [signOpen, setSignOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<Row | null>(null);
  const [scanning, setScanning] = React.useState<Row | null>(null);
  const gated = isGated(errorCode);

  const amended = (rows ?? []).filter((r) => r.status === "AMENDED");

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />}
        title={tr("Signatures")}
        description="A signature is bound to what the document said when it was signed. Change the document and the signature stops covering it."
      />
      <HubTabs />
      <form
        className="mb-5 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveRef(refInput.trim());
          setActiveType(typeInput.trim().toUpperCase());
        }}
      >
        <Field label={tr("Document reference")} className="min-w-64 flex-1">
          <Input
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            placeholder="invoice:FCT-2026-0001"
          />
        </Field>
        <Field label={tr("Document type")} className="min-w-56">
          <Input
            value={typeInput}
            onChange={(e) => setTypeInput(e.target.value)}
            placeholder="FINAL_INVOICE"
          />
        </Field>
        <Button type="submit" disabled={!refInput.trim()}>
          {tr("Look up")}
        </Button>
      </form>

      {!activeRef ? (
        <EmptyState
          title={tr("Enter a reference")}
          hint="Type a document reference above to see its signatures."
        />
      ) : gated ? (
        <EmptyState
          title={tr("Signatures aren't enabled")}
          hint="The signatures feature is off for this workspace, or you don't have access."
        />
      ) : error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <>
          {amended.length > 0 ? (
            <Callout tone="bad" title={tr("This document changed after it was signed")}>
              {amended.length === 1 ? "A signature" : `${amended.length} signatures`} on{" "}
              <span className="font-medium">{activeRef}</span> no longer cover what the document says
              now. The signatures are kept on record, and anyone verifying a printed copy is told the
              document was modified.
            </Callout>
          ) : null}

          <div className="mb-3 mt-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {rows.length} signature{rows.length === 1 ? "" : "s"} on{" "}
              <span className="font-medium text-foreground">{activeRef}</span>
            </p>
            <Button size="sm" onClick={() => setSignOpen(true)} disabled={!activeType}>
              {tr("Sign")}
            </Button>
          </div>
          {!activeType ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Enter the document type as well to sign — it decides which methods are available.
            </p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title={tr("No signatures yet")}
              hint="Nobody has signed this document."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{tr("Signer")}</TH>
                  <TH>{tr("Method")}</TH>
                  <TH>{tr("Status")}</TH>
                  <TH>{tr("Signed")}</TH>
                  <TH>{tr("Verification code")}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={String(r.signature_id)}>
                    <TD className="text-sm">
                      <span className="font-medium">{cell(r.signer_name)}</span>
                      {r.signer_role ? (
                        <span className="block text-xs text-muted-foreground">
                          {String(r.signer_role)}
                        </span>
                      ) : null}
                      {r.identity_source === "DECLARED" ? (
                        <span className="block text-xs text-muted-foreground">
                          Name as stated by the signer
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-sm">
                      {cell(r.assurance_words)}
                      {r.sign_reason ? (
                        <span className="block text-xs text-muted-foreground">
                          {String(r.sign_reason).toLowerCase().replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-sm">
                      <StatusPill
                        status={look(STATUS_WORDS, r.status, String(r.status))}
                        tone={statusTone(r.status)}
                      />
                      {r.revoke_reason ? (
                        <span className="block text-xs text-muted-foreground">
                          {String(r.revoke_reason)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-sm">{dateFmt(r.signed_at)}</TD>
                    <TD className="font-mono text-xs">{cell(r.verify_code)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setScanning(r)}>
                        {tr("Verifications")}
                      </Button>
                      {r.revoked_at ? null : (
                        <Button size="sm" variant="ghost" onClick={() => setRevoking(r)}>
                          {tr("Revoke")}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <SignForm
        open={signOpen}
        entityRef={activeRef}
        docType={activeType}
        onClose={() => setSignOpen(false)}
        onSaved={reload}
      />
      <ScansModal signature={scanning} onClose={() => setScanning(null)} />
      <RevokeForm
        open={Boolean(revoking)}
        signature={revoking}
        onClose={() => setRevoking(null)}
        onSaved={reload}
      />
    </section>
  );
}
