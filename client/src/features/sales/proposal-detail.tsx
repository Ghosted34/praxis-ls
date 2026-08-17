/**
 * Proposals — the read/act drawer for a single proposal.
 *
 * Split from `proposal-forms.tsx` in Phase 4 (audit F7). Separate from the
 * editor because it is a different job: the form WRITES a proposal, this one
 * reads it back and drives its lifecycle (send, accept, decline), which is what
 * a salesperson actually opens twenty times a day.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Modal, Field } from "@/components/ui/modal";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { lineTotal } from "./proposal-forms";

export function ProposalDetail({
  proposal,
  entities,
  onClose,
  onChanged,
  onEdit,
}: {
  proposal: Row | null;
  entities: Row[] | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (p: Row) => void;
}) {
  const open = !!proposal;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [action, setAction] = React.useState<null | "send" | "accept">(null);
  const [entityId, setEntityId] = React.useState("");
  const [createQuotation, setCreateQuotation] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");

  React.useEffect(() => {
    if (!proposal) return;
    let live = true;
    setData(null);
    setError(null);
    setAction(null);
    setEntityId("");
    setCreateQuotation(false);
    tenant<Row>(`/proposals/${String(proposal.proposal_id)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [proposal]);

  const status = data ? String(data.status) : "";
  const lines = (data?.lines as Row[] | undefined) || [];
  const narratives = (data?.narratives as Row[] | undefined) || [];
  const total = lines.reduce((a, l) => a + lineTotal(l), 0);
  const entityLabel = (() => {
    const en = (entities || []).find((e) => String(e.entity_id) === entityId);
    return en
      ? en.code
        ? `${cell(en.code)} · ${cell(en.legal_name)}`
        : cell(en.legal_name)
      : null;
  })();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  const id = proposal ? String(proposal.proposal_id) : "";
  const transitionTo = (to: string, entity?: string) =>
    run(() =>
      tenant(`/proposals/${id}/transition`, {
        method: "POST",
        body: { to, entity_id: entity },
      }),
    );
  async function generateNarrative() {
    const client_operations=window.prompt("Client operations (leave blank to use meeting discovery)","")||"";
    const pain_points=window.prompt("Pain points (leave blank to use meeting discovery)","")||"";
    const proposed_strategy=window.prompt("Proposed strategy (leave blank to use meeting discovery)","")||"";
    const tone=window.prompt("Tone","Consultative and expert")||"Consultative and expert";
    await run(()=>tenant(`/proposals/${id}/generate`,{method:"POST",body:{client_operations,pain_points,proposed_strategy,tone}}));
  }
  async function shareProposal(){setBusy(true);setError(null);try{const out=await tenant<{path:string}>(`/proposals/${id}/share`,{method:"POST",body:{expires_in_days:30}});const url=`${window.location.origin}/public/proposals/${out.path.split("/").pop()}`;setShareUrl(url);await navigator.clipboard?.writeText(url);setBusy(false);}catch(e){setError(errMsg(e));setBusy(false);}}
  const doAccept = () =>
    run(() =>
      tenant(`/proposals/${id}/accept`, {
        method: "POST",
        body: {
          create_quotation: createQuotation,
          entity_id: createQuotation ? entityId : undefined,
        },
      }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={proposal ? cell(proposal.title) : "Proposal"}
      description="Review the proposal, then move it through its lifecycle."
      size="xl"
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading proposal…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={status || "DRAFT"} />
              {data?.doc_number ? (
                <span className="text-xs text-muted-foreground">
                  № {cell(data.doc_number)}
                </span>
              ) : null}
              {data?.ai_generated ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-ink">
                  AI-drafted
                </span>
              ) : null}
              <span className="ml-auto">
                <DocButton
                  docType="PROPOSAL"
                  id={id}
                  title={proposal?.title ? String(proposal.title) : "Proposal"}
                />
              </span>
            </div>

            {narratives.length > 0 && (
              <div className="space-y-2">
                {narratives.map((n) => (
                  <div key={String(n.proposal_narrative_id)}>
                    <p className="text-sm font-semibold text-foreground">
                      {cell(n.section)}
                    </p>
                    {n.body ? (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {cell(n.body)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {lines.length > 0 && (
              <div className="rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>{tr("Item")}</span>
                  <span className="w-12 text-right">{tr("Qty")}</span>
                  <span className="w-24 text-right">{tr("Unit")}</span>
                  <span className="w-28 text-right">{tr("Total")}</span>
                </div>
                {lines.map((l) => (
                  <div
                    key={String(l.proposal_line_id)}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 text-sm"
                  >
                    <span>{cell(l.label)}</span>
                    <span className="w-12 text-right">{cell(l.qty)}</span>
                    <span className="w-24 text-right">
                      {money(l.unit_price)}
                    </span>
                    <span className="w-28 text-right">
                      {money(lineTotal(l))}
                    </span>
                  </div>
                ))}
                <div className="border-t px-3 py-2 text-right text-sm font-semibold">
                  Total (HT): {money(total)}
                </div>
              </div>
            )}

            {/* Inline action panels */}
            {action === "send" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <Field
                  label={tr("Entity")}
                  hint="Numbers the proposal on send"
                  required
                >
                  <SearchSelect
                    path="/entities"
                    value={entityLabel}
                    placeholder={tr("Search entities…")}
                    getLabel={(en) =>
                      en.code
                        ? `${String(en.code)} · ${String(en.legal_name ?? "")}`
                        : String(en.legal_name ?? "")
                    }
                    getKey={(en) => String(en.entity_id)}
                    onSelect={(en) => setEntityId(String(en.entity_id))}
                  />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={!entityId}
                    onClick={() => transitionTo("SENT", entityId)}
                  >
                    Confirm send
                  </Button>
                </div>
              </div>
            )}
            {action === "accept" && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={createQuotation}
                    onChange={(e) => setCreateQuotation(e.target.checked)}
                  />
                  Create a quotation from these lines
                </label>
                {createQuotation && (
                  <Field label={tr("Entity")} required>
                    <SearchSelect
                      path="/entities"
                      value={entityLabel}
                      placeholder={tr("Search entities…")}
                      getLabel={(en) =>
                        en.code
                          ? `${String(en.code)} · ${String(en.legal_name ?? "")}`
                          : String(en.legal_name ?? "")
                      }
                      getKey={(en) => String(en.entity_id)}
                      onSelect={(en) => setEntityId(String(en.entity_id))}
                    />
                  </Field>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={createQuotation && !entityId}
                    onClick={doAccept}
                  >
                    Confirm accept
                  </Button>
                </div>
              </div>
            )}

            {/* Lifecycle actions */}
            {!action && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                {status === "SENT" && <><Button variant="outline" loading={busy} onClick={()=>void shareProposal()}>Share link</Button>{shareUrl&&<><Button variant="ghost" onClick={()=>void navigator.clipboard?.writeText(shareUrl)}>Copy link</Button><Button variant="ghost" onClick={()=>window.open(`https://wa.me/?text=${encodeURIComponent(`Please review our proposal: ${shareUrl}`)}`,"_blank")}>WhatsApp</Button></>}</>}
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {status === "DRAFT" && proposal && (
                  <>
                    <Button variant="outline" loading={busy} onClick={()=>void generateNarrative()}>Generate bilingual narrative</Button>
                    <Button
                      variant="outline"
                      onClick={() => onEdit(data ?? proposal)}
                    >
                      Edit
                    </Button>
                    <Button
                      loading={busy}
                      onClick={() => transitionTo("IN_REVIEW")}
                    >
                      Submit for review
                    </Button>
                  </>
                )}
                {status === "IN_REVIEW" && (
                  <>
                    <Button
                      variant="ghost"
                      loading={busy}
                      onClick={() => transitionTo("DRAFT")}
                    >
                      Back to draft
                    </Button>
                    <Button onClick={() => setAction("send")}>Send…</Button>
                  </>
                )}
                {status === "SENT" && (
                  <>
                    <Button
                      variant="ghost"
                      loading={busy}
                      onClick={() => transitionTo("REJECTED")}
                    >
                      Reject
                    </Button>
                    <Button onClick={() => setAction("accept")}>Accept…</Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
