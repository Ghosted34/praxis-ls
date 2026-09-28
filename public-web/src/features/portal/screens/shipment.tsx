/**
 * One shipment — where it is, what it needs, and everything filed against it.
 *
 * The top is a picture, not a table: the route drawn between two places with
 * the mode travelling along it, the arrival date as a pill, progress as a bar.
 * The journey below is the file's client-visible steps as a timeline; every
 * step has a "?" that asks the team about THAT step. Details the old page
 * printed as a grid of labels (vessel, containers, BL) are behind the ⓘ.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  portalShipment,
  portalTickets,
  portalDocumentDownload,
  type Milestone,
  type ShipmentDetail,
  type PortalDocument,
  type ClientRequest,
  type InvoiceSummary,
  type PortalTicket,
} from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { dateFmt, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, useOpenChat, useSummary } from "../shell/portal-shell";
import { IconDisc, Pill, InfoButton, ErrorCard, Shimmer, SkeletonCards, EmptyState, useLoad, useToast, errorText, Busy } from "../ui/kit";
import { ChatIcon, UploadIcon, DocIcon, DownloadIcon, CheckIcon, AlertIcon, QuoteIcon, ContainerIcon, ShipIcon } from "../ui/icons";
import { relDay } from "../lib/when";
import { ModeIcon, RouteLine, ArrivalPill, Progress } from "./shipment-parts";
import { RequestRow, RequestSheet, ShareSheet, docTypeName } from "./request-parts";
import { InvoiceRow, InvoiceSheet } from "./billing";
import { AskSheet, TicketRow, TicketSheet } from "./ticket-parts";

type StepState = "done" | "current" | "upcoming" | "blocked" | "skipped";

function stepStates(ms: Milestone[]): StepState[] {
  const up = (s: string) => String(s || "").toUpperCase();
  let currentSet = false;
  const firstOpen = ms.findIndex((m) => !["DONE", "CANCELLED", "SKIPPED"].includes(up(m.status)));
  return ms.map((m, i) => {
    const s = up(m.status);
    if (s === "DONE") return "done";
    if (s === "CANCELLED" || s === "SKIPPED") return "skipped";
    if (s === "BLOCKED") return "blocked";
    if ((s === "IN_PROGRESS" || i === firstOpen) && !currentSet) {
      currentSet = true;
      return "current";
    }
    return "upcoming";
  });
}

export function ShipmentPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const lang = getLang();
  const portal = usePortal();
  const openChat = useOpenChat();
  const summary = useSummary();
  const data = useLoad(() => portalShipment(id, lang), `ship:${id}:${lang}`);
  const tickets = useLoad(portalTickets, `tickets:${id}`);
  const d = data.data;
  usePageChrome(d?.shipment.ref || t("portal.nav.shipments"), "/portal/shipments");

  const [request, setRequest] = React.useState<ClientRequest | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [ask, setAsk] = React.useState<{ step: Milestone | null } | null>(null);
  const [ticket, setTicket] = React.useState<PortalTicket | null>(null);
  const [invoice, setInvoice] = React.useState<InvoiceSummary | null>(null);

  const reload = () => {
    data.reload();
    summary?.reload();
  };

  if (data.error && !d) return <ErrorCard message={data.error} onRetry={data.reload} />;
  if (!d)
    return (
      <div className="grid gap-4">
        <Shimmer className="h-56 rounded-[28px]" />
        <SkeletonCards count={3} />
      </div>
    );

  const s = d.shipment;
  const asks = d.requests.filter((r) => r.status === "OPEN" || r.status === "REJECTED");
  const others = d.requests.filter((r) => !(r.status === "OPEN" || r.status === "REJECTED") && r.status !== "CANCELLED");
  const states = stepStates(d.milestones);
  const mine = (tickets.data || []).filter((tk) => tk.dossier_ref === s.ref);

  return (
    <div className="grid gap-6">
      {/* ── the picture ── */}
      <section className="pt-card pt-hero-card p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <IconDisc size={48}>
            <ModeIcon mode={s.mode} size={24} />
          </IconDisc>
          <div className="min-w-0 flex-1">
            <h1 className="pt-mono truncate text-[1.2rem] font-bold text-foreground sm:text-[1.5rem]">{s.ref}</h1>
            <p className="truncate text-sm text-muted-foreground">{s.title || s.service || t(`portal.mode.${s.mode}`)}</p>
          </div>
          <InfoButton label={t("portal.ship.details")} title={t("portal.ship.details")} className="-mr-2 -mt-1">
            <Facts d={d} />
          </InfoButton>
        </div>
        {s.origin || s.destination ? (
          <div className="mt-6">
            <RouteLine origin={s.origin} destination={s.destination} mode={s.mode} percent={s.progress.percent} big />
          </div>
        ) : null}
        {s.progress.total > 0 ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-foreground">{s.current_step || t("portal.ship.allDone")}</span>
              <span className="pt-num shrink-0 font-semibold text-muted-foreground">{s.progress.percent}%</span>
            </div>
            <Progress percent={s.progress.percent} />
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <ArrivalPill s={s} />
          {s.conveyance ? (
            <Pill plain>
              <ShipIcon size={13} />
              {s.conveyance}
            </Pill>
          ) : null}
          {s.transport_ref ? (
            <Pill plain>
              <DocIcon size={13} />
              <span className="pt-mono">{s.transport_ref}</span>
            </Pill>
          ) : null}
          {d.facts?.containers?.summary.boxes ? (
            <Pill plain>
              <ContainerIcon size={13} />
              {t("portal.ship.boxes", { count: d.facts.containers.summary.boxes })}
            </Pill>
          ) : null}
        </div>
      </section>

      {/* ── do something: three actions, one row on every screen ── */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
        <ActionTile primary icon={<ChatIcon size={22} />} label={t("portal.ship.messageShort")} onClick={() => openChat({ dossierId: s.dossier_id, ref: s.ref })} />
        <ActionTile icon={<QuoteIcon size={22} />} label={t("portal.ask.short")} onClick={() => setAsk({ step: null })} />
        <ActionTile icon={<UploadIcon size={22} />} label={t("portal.share.short")} onClick={() => setSharing(true)} />
      </div>

      {/* ── needs you ── */}
      {asks.length ? (
        <section aria-labelledby="pt-s-needs">
          <h2 id="pt-s-needs" className="pt-section-title mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[rgb(var(--warn))]" aria-hidden="true" />
            {t("portal.home.needsYou")}
          </h2>
          <div className="pt-card pt-rows overflow-hidden">
            {asks.map((r) => (
              <RequestRow key={r.client_request_id} r={r} onOpen={setRequest} showShipment={false} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        {/* ── journey ── */}
        <section aria-labelledby="pt-s-journey" className="pt-card p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="pt-s-journey" className="pt-section-title">
              {t("portal.ship.journey")}
            </h2>
            <span className="pt-num text-sm font-semibold text-muted-foreground">
              {s.progress.done}/{s.progress.total}
            </span>
          </div>
          {d.milestones.length ? (
            <ol className="pt-timeline">
              {d.milestones.map((m, i) => (
                <Step key={`${m.code}-${i}`} m={m} state={states[i]} onAsk={() => setAsk({ step: m })} />
              ))}
            </ol>
          ) : (
            <EmptyState icon={<ShipIcon size={28} />} title={t("portal.ship.settingUp")} />
          )}
        </section>

        <div className="grid gap-6">
          {/* ── questions ── */}
          {mine.length ? (
            <section aria-labelledby="pt-s-q">
              <h2 id="pt-s-q" className="pt-section-title mb-3">
                {t("portal.ask.yours")}
              </h2>
              <div className="pt-card pt-rows overflow-hidden">
                {mine.map((tk) => (
                  <TicketRow key={tk.q_ticket_id} tk={tk} onOpen={setTicket} />
                ))}
              </div>
            </section>
          ) : null}

          {/* ── documents ── */}
          <section aria-labelledby="pt-s-docs">
            <h2 id="pt-s-docs" className="pt-section-title mb-3">
              {t("portal.nav.documents")}
            </h2>
            {d.documents.length || others.length ? (
              <div className="pt-card pt-rows overflow-hidden">
                {d.documents.map((doc) => (
                  <DocumentRow key={doc.doc_id} doc={doc} />
                ))}
                {others.map((r) => (
                  <RequestRow key={r.client_request_id} r={r} onOpen={setRequest} showShipment={false} />
                ))}
              </div>
            ) : (
              <div className="pt-card">
                <EmptyState icon={<DocIcon size={28} />} title={t("portal.docs.none")} />
              </div>
            )}
          </section>

          {/* ── invoices ── */}
          {portal.canBilling && d.invoices.length ? (
            <section aria-labelledby="pt-s-inv">
              <h2 id="pt-s-inv" className="pt-section-title mb-3">
                {t("portal.bill.invoices")}
              </h2>
              <div className="pt-card pt-rows overflow-hidden">
                {d.invoices.map((inv) => (
                  <InvoiceRow key={inv.invoice_id} inv={inv} onOpen={setInvoice} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <RequestSheet r={request} onClose={() => setRequest(null)} onDone={reload} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} onDone={reload} shipments={[s]} dossierId={s.dossier_id} />
      <AskSheet
        open={!!ask}
        dossierId={s.dossier_id}
        step={ask?.step || null}
        onClose={() => setAsk(null)}
        onDone={tickets.reload}
        onChat={() => {
          const step = ask?.step;
          setAsk(null);
          openChat({
            dossierId: s.dossier_id,
            ref: s.ref,
            milestone: step && step.milestone_instance_id ? { id: step.milestone_instance_id, label: step.label } : null,
          });
        }}
      />
      <TicketSheet tk={ticket} onClose={() => setTicket(null)} onChanged={tickets.reload} />
      <InvoiceSheet inv={invoice} onClose={() => setInvoice(null)} />
    </div>
  );
}

/** On a phone, three square tiles in a row; on a desk, buttons. */
function ActionTile({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pt-btn !h-auto min-w-0 flex-col !gap-1.5 !px-2 !py-3 sm:!min-h-[48px] sm:flex-row sm:!gap-2 sm:!px-5 sm:!py-0",
        primary ? "pt-btn-primary" : "pt-btn-outline",
      )}
    >
      {icon}
      <span className="max-w-full truncate text-[0.8rem] sm:text-[0.9375rem]">{label}</span>
    </button>
  );
}

function Step({ m, state, onAsk }: { m: Milestone; state: StepState; onAsk: () => void }) {
  const { t } = useTranslation();
  const due = m.forecast_due || m.planned_due;
  const when =
    state === "done" && m.completed_at
      ? dateFmt(m.completed_at)
      : state === "skipped"
        ? t("portal.ship.skipped")
        : due
          ? t("portal.ship.expected", { when: relDay(due) })
          : null;
  return (
    <li className="pt-step" data-state={state === "skipped" ? "upcoming" : state}>
      <span className="pt-dot" aria-hidden="true">
        {state === "done" ? <CheckIcon size={15} /> : state === "blocked" ? <AlertIcon size={14} /> : null}
      </span>
      <div className={cn("min-w-0 pt-0.5", state === "skipped" && "opacity-50")}>
        <p className={cn("text-[0.95rem] leading-snug", state === "current" ? "font-bold text-foreground" : state === "upcoming" ? "font-medium text-muted-foreground" : "font-semibold text-foreground")}>
          {m.label}
        </p>
        {when ? <p className={cn("mt-0.5 text-xs", state === "blocked" ? "font-semibold text-[rgb(var(--warn))]" : "text-muted-foreground")}>{state === "blocked" ? t("portal.ship.onHold") : when}</p> : null}
      </div>
      <button type="button" className="pt-icon-btn -mr-2 -mt-1.5 text-muted-foreground" aria-label={t("portal.ask.aboutThis", { step: m.label })} onClick={onAsk}>
        <ChatIcon size={18} />
      </button>
    </li>
  );
}

function DocumentRow({ doc }: { doc: PortalDocument }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const name = doc.name_en || doc.name_fr ? docTypeName({ name_en: doc.name_en, name_fr: doc.name_fr, code: doc.doc_type_code }) : doc.original_name || t("portal.docs.document");
  async function get() {
    setBusy(true);
    try {
      await portalDocumentDownload(doc.doc_id, doc.original_name || `${doc.doc_type_code || "document"}.pdf`);
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
        <span className="block truncate text-xs text-muted-foreground">{doc.original_name || dateFmt(doc.created_at)}</span>
      </span>
      <span className="text-muted-foreground">
        <Busy busy={busy}>
          <DownloadIcon size={20} />
        </Busy>
      </span>
    </button>
  );
}

/** Everything the old page printed as a grid, now one tap away. */
function Facts({ d }: { d: ShipmentDetail }) {
  const { t } = useTranslation();
  const s = d.shipment;
  const facets = d.facts?.facet_order?.map((k) => [k, d.facts!.facets[k]] as const).filter(([, f]) => f && f.value) || [];
  const c = d.facts?.containers;
  const lang = getLang();
  return (
    <div className="grid gap-5">
      <dl className="pt-rows">
        <Fact label={t("portal.ship.service")} value={s.service} />
        <Fact label={t("portal.ship.from")} value={s.origin} />
        <Fact label={t("portal.ship.to")} value={s.destination} />
        <Fact label={t("portal.ship.vessel")} value={s.conveyance} />
        <Fact label={t("portal.ship.transportRef")} value={s.transport_ref} mono />
        {facets.map(([k, f]) => (
          <Fact key={k} label={f.label || k} value={f.value} />
        ))}
      </dl>
      {c && c.units.length ? (
        <div>
          <p className="pt-label">{t("portal.ship.containers")}</p>
          <p className="mb-2 text-sm text-muted-foreground">
            {t("portal.ship.boxes", { count: c.summary.boxes })} · {num(c.summary.teu)} TEU
          </p>
          <ul className="grid gap-2">
            {c.units.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--pt-soft)] px-3 py-2.5">
                <span className="pt-mono truncate text-sm font-semibold text-foreground">{u.container_no || "—"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{u.type}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.assumptions.length ? (
        <div>
          <p className="pt-label">{t("portal.ship.assumptions")}</p>
          <ul className="grid gap-2">
            {d.assumptions.map((a) => (
              <li key={a.code} className="rounded-[14px] bg-[var(--pt-soft)] p-3 text-sm text-foreground">
                {lang === "fr" ? a.text_fr : a.text_en || a.text_fr}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm font-semibold text-foreground", mono && "pt-mono")}>{value}</dd>
    </div>
  );
}
