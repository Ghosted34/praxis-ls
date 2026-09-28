/**
 * Home — the answer to "anything I need to know?" in one screen.
 *
 *   1. A greeting by name, and the company they are signed in for.
 *   2. NEEDS YOU: the documents and answers we are waiting for, and any
 *      invoice past its date — each with the one button that deals with it.
 *      Absent entirely when there is nothing, which is the good day.
 *   3. Three tiles: on the move, to pay, to send.
 *   4. The shipments on the move, as cards.
 *   5. The four things a client comes to do, one tap each.
 *
 * Built from the summary the shell already loaded (it counts the tab badges
 * from the same data), so Home costs no request of its own.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { ClientRequest } from "@/lib/portal-api";
import { money } from "@/lib/format";
import { currentLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, useSummary, useOpenChat } from "../shell/portal-shell";
import { IconDisc, SkeletonCards, ErrorCard, EmptyState, Shimmer } from "../ui/kit";
import { ShipIcon, WalletIcon, FolderIcon, QuoteIcon, UploadIcon, ChatIcon, ChevronRightIcon, ReceiptIcon, CheckCircleIcon, SparkIcon } from "../ui/icons";
import { partOfDay, relDay } from "../lib/when";
import { ShipmentCardView } from "./shipment-parts";
import { RequestRow, RequestSheet, ShareSheet } from "./request-parts";

export function HomePage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const portal = usePortal();
  const summary = useSummary();
  const navigate = useNavigate();
  const openChat = useOpenChat();
  const [request, setRequest] = React.useState<ClientRequest | null>(null);
  const [sharing, setSharing] = React.useState(false);

  const s = summary?.data;
  const part = partOfDay();
  const greeting = portal.firstName ? t(`portal.home.greet.${part}`, { name: portal.firstName }) : t(`portal.home.hello.${part}`);

  const asks = (s?.requests?.items || []).filter((r) => r.status === "OPEN" || r.status === "REJECTED");
  const overdue = s?.billing?.next_due && s.billing.next_due.state === "OVERDUE" ? s.billing.next_due : null;
  const offers = s?.proposals?.pending_count || 0;
  const needs = asks.length > 0 || !!overdue || offers > 0;
  const ships = s?.shipments?.items || [];
  const dueTotals = (s?.billing?.totals || []).filter((x) => x.due > 0);

  const reload = () => summary?.reload();

  return (
    <div>
      {/* ── greeting ── */}
      <div className="mb-6 flex items-end justify-between gap-4 lg:mb-8">
        <div className="min-w-0">
          <h1 className="pt-display text-[1.95rem] sm:text-[2.4rem]">{greeting}</h1>
          {portal.company ? <p className="mt-1 truncate text-[0.95rem] text-muted-foreground">{portal.company}</p> : null}
        </div>
        {portal.canOps ? (
          <Link to="/portal/quotes?new=1" className="pt-btn pt-btn-primary hidden shrink-0 sm:inline-flex">
            <QuoteIcon size={20} />
            {t("portal.quote.request")}
          </Link>
        ) : null}
      </div>

      {summary?.error && !s ? <ErrorCard message={summary.error} onRetry={summary.reload} /> : null}

      {!s && !summary?.error ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Shimmer className="h-24 rounded-[22px]" />
            <Shimmer className="h-24 rounded-[22px]" />
            <Shimmer className="h-24 rounded-[22px]" />
          </div>
          <SkeletonCards count={2} />
        </div>
      ) : null}

      {s ? (
        <div className="grid gap-7">
          {/* ── needs you ── */}
          {needs ? (
            <section aria-labelledby="pt-needs">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="pt-needs" className="pt-section-title flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[rgb(var(--warn))]" aria-hidden="true" />
                  {t("portal.home.needsYou")}
                </h2>
                {asks.length > 3 ? (
                  <Link to="/portal/documents" className="text-sm font-semibold text-primary-ink">
                    {t("portal.common.seeAll")}
                  </Link>
                ) : null}
              </div>
              <div className="pt-card pt-rows overflow-hidden">
                {overdue ? (
                  <button type="button" className="pt-row" onClick={() => navigate(`/portal/billing?invoice=${encodeURIComponent(overdue.invoice_id)}`)}>
                    <IconDisc tone="bad">
                      <ReceiptIcon />
                    </IconDisc>
                    <span className="min-w-0 flex-1">
                      <span className="pt-num block truncate text-[0.95rem] font-semibold text-foreground">
                        {money(overdue.outstanding, overdue.currency)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        <span className="pt-mono">{overdue.doc_number}</span>
                        {" · "}
                        <span className="font-semibold text-[rgb(var(--bad))]">{t("portal.bill.wasDue", { when: relDay(overdue.payment_due_on, 60) })}</span>
                      </span>
                    </span>
                    <span className="pt-btn pt-btn-soft pt-btn-sm shrink-0">{t("portal.bill.pay")}</span>
                  </button>
                ) : null}
                {offers ? (
                  <button type="button" className="pt-row" onClick={() => navigate("/portal/quotes?tab=proposals")}>
                    <IconDisc tone="brand">
                      <QuoteIcon />
                    </IconDisc>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.95rem] font-semibold text-foreground">{t("portal.prop.awaiting")}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t("portal.prop.awaitingCount", { count: offers })}</span>
                    </span>
                    <span className="pt-btn pt-btn-soft pt-btn-sm shrink-0">{t("portal.prop.review")}</span>
                  </button>
                ) : null}
                {asks.slice(0, 3).map((r) => (
                  <RequestRow key={r.client_request_id} r={r} onOpen={setRequest} />
                ))}
              </div>
            </section>
          ) : null}

          {/* ── tiles ── */}
          <section className={cn("grid gap-3", portal.canOps && portal.canBilling ? "grid-cols-3" : "grid-cols-2")} aria-label={t("portal.home.glance")}>
            {portal.canOps ? (
              <Tile to="/portal/shipments" icon={<ShipIcon />} value={String(s.shipments?.active_count ?? 0)} label={t("portal.home.onTheMove")} />
            ) : null}
            {portal.canBilling ? (
              <Tile
                to="/portal/billing"
                icon={<WalletIcon />}
                tone={s.billing?.overdue_count ? "bad" : "brand"}
                value={dueTotals.length ? compact(dueTotals[0].due) : "0"}
                unit={dueTotals.length ? dueTotals[0].currency : undefined}
                label={t("portal.home.toPay")}
              />
            ) : null}
            {portal.canOps ? (
              <Tile
                to="/portal/documents"
                icon={<FolderIcon />}
                tone={s.requests?.open_count ? "warn" : "brand"}
                value={String(s.requests?.open_count ?? 0)}
                label={t("portal.home.toSend")}
              />
            ) : null}
          </section>

          {/* ── on the move ── */}
          {portal.canOps ? (
            <section aria-labelledby="pt-moving">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="pt-moving" className="pt-section-title">
                  {t("portal.home.moving")}
                </h2>
                {ships.length ? (
                  <Link to="/portal/shipments" className="text-sm font-semibold text-primary-ink">
                    {t("portal.common.seeAll")}
                  </Link>
                ) : null}
              </div>
              {ships.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {ships.slice(0, 4).map((x) => (
                    <ShipmentCardView key={x.dossier_id} s={x} />
                  ))}
                </div>
              ) : (
                <div className="pt-card">
                  <EmptyState
                    icon={<ShipIcon size={28} />}
                    title={t("portal.home.noneMoving")}
                    action={
                      <Link to="/portal/quotes?new=1" className="pt-btn pt-btn-soft">
                        <QuoteIcon size={20} />
                        {t("portal.quote.request")}
                      </Link>
                    }
                  />
                </div>
              )}
            </section>
          ) : null}

          {/* ── all caught up (billing-only people, nothing owed) ── */}
          {!portal.canOps && !needs && !dueTotals.length ? (
            <div className="pt-card">
              <EmptyState tone="ok" icon={<CheckCircleIcon size={28} />} title={t("portal.home.allClear")} />
            </div>
          ) : null}

          {/* ── shortcuts ── */}
          <section aria-labelledby="pt-do">
            <h2 id="pt-do" className="pt-section-title mb-3">
              {t("portal.home.shortcuts")}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {portal.canOps ? (
                <Shortcut to="/portal/quotes?new=1" icon={<SparkIcon />} label={t("portal.quote.request")} />
              ) : null}
              {portal.canOps ? <Shortcut onClick={() => setSharing(true)} icon={<UploadIcon />} label={t("portal.share.title")} tone="info" /> : null}
              {portal.canBilling ? <Shortcut to="/portal/billing" icon={<WalletIcon />} label={t("portal.bill.ivePaid")} tone="ok" /> : null}
              <Shortcut onClick={() => openChat(null)} icon={<ChatIcon />} label={t("portal.chat.title")} tone="warn" />
            </div>
          </section>
        </div>
      ) : null}

      <RequestSheet r={request} onClose={() => setRequest(null)} onDone={reload} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} onDone={reload} shipments={ships} />
    </div>
  );
}

/** 3 910 500 → "3.9M" / "3,9 M" — a tile has room for a glance, not a ledger. */
const compact = (n: number) => new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Tile({
  to,
  icon,
  value,
  unit,
  label,
  tone = "brand",
}: {
  to: string;
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
  tone?: "brand" | "bad" | "warn";
}) {
  return (
    <Link to={to} className="pt-card pt-card-press flex min-w-0 flex-col gap-3 p-3.5 sm:p-5">
      <IconDisc tone={tone} size={38}>
        {icon}
      </IconDisc>
      <div className="min-w-0">
        <p className="pt-display pt-num truncate text-[1.6rem] sm:text-[2rem]">{value}</p>
        <p className="truncate text-xs font-semibold text-muted-foreground sm:text-sm">{unit ? `${label} · ${unit}` : label}</p>
      </div>
    </Link>
  );
}

function Shortcut({
  to,
  onClick,
  icon,
  label,
  tone = "brand",
}: {
  to?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: "brand" | "info" | "ok" | "warn";
}) {
  const inner = (
    <>
      <IconDisc tone={tone}>{icon}</IconDisc>
      <span className="min-w-0 flex-1 text-left text-sm font-semibold leading-snug text-foreground">{label}</span>
      <ChevronRightIcon size={18} className="hidden text-muted-foreground sm:block" />
    </>
  );
  const cls = "pt-card pt-card-press flex items-center gap-3 p-3.5";
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}
