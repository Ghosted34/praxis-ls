/**
 * Documents — what we need from them, what they sent, and everything we hold.
 *
 *   TO SEND     the documents and answers we are waiting for, oldest due first,
 *               each a tap from the camera. A document sent back is here too,
 *               with the reason on it.
 *   SENT        what they sent that is being checked, and what was accepted.
 *   LIBRARY     every document we have shared with them, grouped by shipment,
 *               a tap to download.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { portalRequests, portalDocuments, portalDocumentDownload, type ClientRequest, type PortalDocument } from "@/lib/portal-api";
import { dateFmt } from "@/lib/format";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import { Seg, SkeletonCards, EmptyState, ErrorCard, IconDisc, useLoad, useToast, errorText, Busy } from "../ui/kit";
import { UploadIcon, DocIcon, DownloadIcon, CheckCircleIcon, SearchIcon, ShipIcon, FolderIcon } from "../ui/icons";
import { RequestRow, RequestSheet, ShareSheet, docTypeName } from "./request-parts";

type Tab = "send" | "sent" | "library";

export function DocumentsPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const summary = useSummary();
  const requests = useLoad(portalRequests, "requests");
  const docs = useLoad(portalDocuments, "docs");
  const [tab, setTab] = React.useState<Tab>("send");
  const [request, setRequest] = React.useState<ClientRequest | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [q, setQ] = React.useState("");

  const all = requests.data || [];
  const toSend = all
    .filter((r) => r.status === "OPEN" || r.status === "REJECTED")
    .sort((a, b) => String(a.due_on || "9999").localeCompare(String(b.due_on || "9999")));
  const sent = all.filter((r) => r.status === "SUBMITTED" || r.status === "ACCEPTED");

  const reload = () => {
    requests.reload();
    docs.reload();
    summary?.reload();
  };

  return (
    <div>
      <PageHeader
        title={t("portal.nav.documents")}
        action={
          <button type="button" className="pt-btn pt-btn-primary pt-btn-sm sm:!min-h-[44px] sm:!px-5 sm:!text-[0.9375rem]" onClick={() => setSharing(true)}>
            <UploadIcon size={18} />
            <span className="hidden sm:inline">{t("portal.share.title")}</span>
            <span className="sm:hidden">{t("portal.share.short")}</span>
          </button>
        }
      />
      <Seg<Tab>
        className="mb-4"
        label={t("portal.docs.filter")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "send", label: t("portal.docs.toSend"), count: toSend.length },
          { value: "sent", label: t("portal.docs.sent") },
          { value: "library", label: t("portal.docs.library") },
        ]}
      />

      {tab !== "library" ? (
        requests.error && !requests.data ? (
          <ErrorCard message={requests.error} onRetry={requests.reload} />
        ) : !requests.data ? (
          <SkeletonCards count={3} />
        ) : (tab === "send" ? toSend : sent).length ? (
          <div className="pt-card pt-rows overflow-hidden">
            {(tab === "send" ? toSend : sent).map((r) => (
              <RequestRow key={r.client_request_id} r={r} onOpen={setRequest} />
            ))}
          </div>
        ) : (
          <div className="pt-card">
            <EmptyState
              tone={tab === "send" ? "ok" : "brand"}
              icon={tab === "send" ? <CheckCircleIcon size={28} /> : <FolderIcon size={28} />}
              title={tab === "send" ? t("portal.docs.nothingToSend") : t("portal.docs.nothingSent")}
            />
          </div>
        )
      ) : docs.error && !docs.data ? (
        <ErrorCard message={docs.error} onRetry={docs.reload} />
      ) : !docs.data ? (
        <SkeletonCards count={4} />
      ) : (
        <Library docs={docs.data} q={q} setQ={setQ} />
      )}

      <RequestSheet r={request} onClose={() => setRequest(null)} onDone={reload} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} onDone={reload} shipments={summary?.data?.shipments?.items || []} />
    </div>
  );
}

function Library({ docs, q, setQ }: { docs: PortalDocument[]; q: string; setQ: (v: string) => void }) {
  const { t } = useTranslation();
  const query = q.trim().toLowerCase();
  const shown = docs.filter((d) =>
    !query ? true : [d.original_name, d.name_en, d.name_fr, d.dossier_ref, d.doc_type_code].filter(Boolean).some((v) => String(v).toLowerCase().includes(query)),
  );
  const groups = new Map<string, PortalDocument[]>();
  for (const d of shown) {
    const key = d.dossier_ref || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  if (!docs.length)
    return (
      <div className="pt-card">
        <EmptyState icon={<DocIcon size={28} />} title={t("portal.docs.none")} />
      </div>
    );
  return (
    <div className="grid gap-5">
      <div className="relative sm:w-80">
        <SearchIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          className="pt-field !min-h-[44px] !rounded-full !py-2 pl-11"
          placeholder={t("portal.docs.search")}
          aria-label={t("portal.docs.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {[...groups.entries()].map(([ref, list]) => (
        <section key={ref || "none"}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {ref ? <ShipIcon size={16} /> : <FolderIcon size={16} />}
            <span className={ref ? "pt-mono" : undefined}>{ref || t("portal.docs.general")}</span>
          </h2>
          <div className="pt-card pt-rows overflow-hidden">
            {list.map((d) => (
              <LibraryRow key={d.doc_id} d={d} />
            ))}
          </div>
        </section>
      ))}
      {!shown.length ? <EmptyState icon={<SearchIcon size={28} />} title={t("portal.ship.noMatch")} /> : null}
    </div>
  );
}

function LibraryRow({ d }: { d: PortalDocument }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const name = d.name_en || d.name_fr ? docTypeName({ name_en: d.name_en, name_fr: d.name_fr, code: d.doc_type_code }) : d.original_name || t("portal.docs.document");
  async function get() {
    setBusy(true);
    try {
      await portalDocumentDownload(d.doc_id, d.original_name || `${d.doc_type_code || "document"}.pdf`);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="pt-row" onClick={() => void get()} disabled={busy}>
      <IconDisc tone="info">
        <DocIcon />
      </IconDisc>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.95rem] font-semibold text-foreground">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {dateFmt(d.created_at)}
          {d.original_name && d.original_name !== name ? ` · ${d.original_name}` : ""}
        </span>
      </span>
      <span className="text-muted-foreground" aria-label={t("portal.common.download")}>
        <Busy busy={busy}>
          <DownloadIcon size={20} />
        </Busy>
      </span>
    </button>
  );
}
