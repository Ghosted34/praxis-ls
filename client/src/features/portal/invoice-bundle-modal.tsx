/**
 * "Share with client" — a final invoice and its supporting documents, sent to
 * the client's portal in one act (client portal redesign PR 2, 14160).
 *
 * The documents are the ones the file's reconciliation already holds. Those a
 * cash request marked as owing a receipt start ticked; finance unticks anything
 * internal and publishes. The client then downloads the invoice and every
 * ticked document from their portal — one at a time or all together as a ZIP.
 * Publishing again replaces what is shared; withdrawing takes it back without
 * touching the documents on the file.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";

type Candidate = {
  doc_id: string;
  name: string;
  line_label: string | null;
  file_name: string | null;
  ext: string;
  justification_required: boolean;
  in_bundle: boolean;
};

type BundleView = {
  invoice: {
    invoice_id: string;
    doc_number: string | null;
    status: string;
    issued: boolean;
    currency: string | null;
    total_ttc: number;
    client_name: string | null;
    dossier_ref: string | null;
  };
  published: { published_at: string; published_by_name: string | null; items: { doc_id: string }[] } | null;
  candidates: Candidate[];
};

export function InvoiceBundleModal({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [view, setView] = React.useState<BundleView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<"publish" | "withdraw" | null>(null);

  React.useEffect(() => {
    if (!invoiceId) return;
    let live = true;
    setView(null);
    setError(null);
    tenant<BundleView>(`/portal/invoice-bundles/${invoiceId}`)
      .then((v) => {
        if (!live) return;
        setView(v);
        setPicked(new Set(v.candidates.filter((c) => c.in_bundle).map((c) => c.doc_id)));
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function publish() {
    if (!invoiceId || !view) return;
    setBusy("publish");
    try {
      const v = await tenant<BundleView>(`/portal/invoice-bundles/${invoiceId}`, {
        method: "POST",
        body: { doc_ids: [...picked] },
      });
      setView(v);
      toast.success(
        picked.size
          ? `${tr("Shared — the client can download the invoice and its documents")} (${picked.size})`
          : tr("Shared — the client can download the invoice"),
      );
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    if (!invoiceId) return;
    const ok = await confirm({
      title: tr("Stop sharing these documents?"),
      body: tr("The client no longer sees them with this invoice. The documents stay on the file."),
      confirmLabel: tr("Stop sharing"),
      cancelLabel: tr("Keep sharing"),
    });
    if (!ok) return;
    setBusy("withdraw");
    try {
      const v = await tenant<BundleView>(`/portal/invoice-bundles/${invoiceId}/withdraw`, { method: "POST", body: {} });
      setView(v);
      toast.success(tr("No longer shared with the client."));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const inv = view?.invoice;
  const all = view?.candidates || [];

  return (
    <>
      <Modal
        open={!!invoiceId}
        onClose={onClose}
        size="lg"
        title={tr("Share with client")}
        description={inv ? [inv.doc_number, inv.client_name, inv.dossier_ref].filter(Boolean).join(" · ") : undefined}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {view?.published ? (
                <Button variant="ghost" loading={busy === "withdraw"} onClick={() => void withdraw()}>
                  {tr("Stop sharing")}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {tr("Cancel")}
              </Button>
              <Button loading={busy === "publish"} disabled={!inv || !inv.issued} onClick={() => void publish()}>
                {view?.published ? tr("Update what is shared") : tr("Share with client")}
              </Button>
            </div>
          </div>
        }
      >
        {error ? (
          <ErrorState message={error} />
        ) : !view ? (
          <SkeletonTable />
        ) : (
          <div className="grid gap-4">
            {!view.invoice.issued ? (
              <Callout tone="warn" title={tr("Issue the invoice first")}>
                {tr("The client only sees an invoice once it is issued.")}
              </Callout>
            ) : view.published ? (
              <Callout tone="ok" title={tr("Shared with the client")}>
                {`${dateFmt(view.published.published_at)}${view.published.published_by_name ? ` · ${view.published.published_by_name}` : ""} · ${view.published.items.length} ${tr("documents")}`}
              </Callout>
            ) : null}

            <ul className="divide-y rounded-xl border bg-card">
              <li className="flex items-center gap-3 p-3">
                <Checkbox checked onCheckedChange={() => {}} disabled label={<span className="font-semibold">{inv?.doc_number || tr("Invoice")}</span>} />
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="num">{money(inv?.total_ttc, inv?.currency)}</span>
                  <Pill tone="blue">{tr("Invoice")}</Pill>
                </span>
              </li>
              {all.map((c) => (
                <li key={c.doc_id} className="flex items-center gap-3 p-3">
                  <Checkbox
                    checked={picked.has(c.doc_id)}
                    onCheckedChange={(on) => toggle(c.doc_id, on)}
                    label={
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[c.line_label, c.file_name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    }
                  />
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {c.justification_required ? <Pill tone="ok">{tr("Receipt owed")}</Pill> : <Pill tone="mute">{tr("Optional")}</Pill>}
                    <span className="text-[11px] uppercase text-muted-foreground">{c.ext}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!all.length ? (
              <p className="text-sm text-muted-foreground">
                {tr("This file's reconciliation holds no documents yet — the invoice can still be shared on its own.")}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}
