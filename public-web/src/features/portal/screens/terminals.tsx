/**
 * The other two people a portal login can be: an investor (read-only OHADA
 * statements, no operational detail — enforced by what the server fetches) and
 * an auditor (statements, trial balance, audit trail, and a data room to ask
 * for documents). Same kit as the client's screens, so the portal is one app
 * whoever signs in.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalInvestorView,
  portalAuditorView,
  portalDataRoomList,
  portalDataRoomCreate,
  portalDataRoomDetail,
  portalDataRoomDownload,
  type PortalDataRoom,
  type PortalDataRoomDoc,
} from "@/lib/portal-api";
import { amount, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, PageHeader } from "../shell/portal-shell";
import { IconDisc, Pill, Sheet, EmptyState, ErrorCard, Shimmer, TextArea, useLoad, useToast, errorText, Busy } from "../ui/kit";
import { WalletIcon, ReceiptIcon, BankIcon, AlertIcon, FolderIcon, DocIcon, DownloadIcon, PlusIcon, ChevronRightIcon, CheckCircleIcon, ClockIcon, ShieldIcon } from "../ui/icons";

function Kpi({ icon, label, value, tone = "brand" }: { icon: React.ReactNode; label: string; value: number; tone?: "brand" | "ok" | "bad" | "info" }) {
  return (
    <div className="pt-card flex flex-col gap-3 p-4 sm:p-5">
      <IconDisc tone={tone} size={38}>
        {icon}
      </IconDisc>
      <div className="min-w-0">
        <p className="pt-display pt-num truncate text-[1.35rem] sm:text-[1.6rem]">{amount(value)}</p>
        <p className="truncate text-xs font-semibold text-muted-foreground sm:text-sm">{label}</p>
      </div>
    </div>
  );
}

function Statement({ title, rows, total, warn }: { title: string; rows: [string, number][]; total: [string, number]; warn?: string | null }) {
  return (
    <section className="pt-card p-5">
      <h2 className="pt-section-title mb-2">{title}</h2>
      <dl className="pt-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="pt-num font-semibold text-foreground">{amount(v)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 py-3 text-base font-bold">
          <dt className="text-foreground">{total[0]}</dt>
          <dd className="pt-num text-foreground">{amount(total[1])}</dd>
        </div>
      </dl>
      {warn ? (
        <p className="mt-2 flex items-start gap-2 rounded-[14px] bg-[rgb(var(--warn)/0.1)] p-3 text-xs text-foreground">
          <AlertIcon size={16} className="mt-0.5 text-[rgb(var(--warn))]" />
          {warn}
        </p>
      ) : null}
    </section>
  );
}

export function InvestorTerminal() {
  const { t } = useTranslation();
  usePageChrome(null);
  const view = useLoad(() => portalInvestorView(), "investor");
  const v = view.data;
  return (
    <div>
      <PageHeader
        title={t("portal.fin.title")}
        sub={v ? t("portal.fin.period", { from: dateFmt(v.period.from), to: dateFmt(v.period.to) }) : null}
      />
      {view.error && !v ? <ErrorCard message={view.error} onRetry={view.reload} /> : null}
      {!v && !view.error ? <Shimmer className="h-64 rounded-[28px]" /> : null}
      {v ? (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={<ReceiptIcon />} label={t("portal.fin.revenue")} value={v.kpis.revenue} />
            <Kpi icon={<WalletIcon />} label={t("portal.fin.netResult")} value={v.kpis.net_result} tone={v.kpis.net_result < 0 ? "bad" : "ok"} />
            <Kpi icon={<BankIcon />} label={t("portal.fin.cash")} value={v.kpis.cash_on_hand} tone="info" />
            <Kpi icon={<ShieldIcon />} label={t("portal.fin.bsTotal")} value={v.kpis.balance_sheet_total} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Statement
              title={t("portal.fin.incomeStatement")}
              rows={[
                [t("portal.fin.produits"), v.income_statement.produits],
                [t("portal.fin.charges"), v.income_statement.charges],
                ...(v.income_statement.hao_net ? ([[t("portal.fin.hao"), v.income_statement.hao_net]] as [string, number][]) : []),
              ]}
              total={[t("portal.fin.netResult"), v.income_statement.result]}
            />
            <Statement
              title={t("portal.fin.balanceSheet")}
              rows={[
                [t("portal.fin.actif"), v.balance_sheet.active],
                [t("portal.fin.passif"), v.balance_sheet.passif],
              ]}
              total={[t("portal.fin.result"), v.balance_sheet.result]}
              warn={!v.balance_sheet.balanced ? t("portal.fin.unbalanced") : null}
            />
          </div>
          <section className="pt-card p-5">
            <h2 className="pt-section-title mb-2">{t("portal.fin.cashPosition")}</h2>
            {v.cash_position.accounts.length ? (
              <dl className="pt-rows">
                {v.cash_position.accounts.map((a) => (
                  <div key={a.account_code} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <dt className="pt-mono text-muted-foreground">{a.account_code}</dt>
                    <dd className="pt-num font-semibold text-foreground">{amount(a.balance)}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 py-3 text-base font-bold">
                  <dt>{t("portal.fin.total")}</dt>
                  <dd className="pt-num">{amount(v.cash_position.total_cash)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState icon={<BankIcon size={28} />} title={t("portal.fin.noTreasury")} />
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function AuditorTerminal() {
  const { t } = useTranslation();
  const portal = usePortal();
  usePageChrome(null);
  const view = useLoad(() => portalAuditorView(), "auditor");
  const v = view.data;
  const until = portal.me.grants.AUDITOR?.expires_at;
  const actionLabel = (a: string) => (a || "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
  return (
    <div>
      <PageHeader
        title={t("portal.audit.title")}
        sub={v ? t("portal.fin.period", { from: dateFmt(v.period.from), to: dateFmt(v.period.to) }) : null}
        action={until ? <Pill tone="warn">{t("portal.audit.until", { date: dateFmt(until) })}</Pill> : null}
      />
      {view.error && !v ? <ErrorCard message={view.error} onRetry={view.reload} /> : null}
      {!v && !view.error ? <Shimmer className="h-64 rounded-[28px]" /> : null}
      {v ? (
        <div className="grid gap-5">
          {v.disclosure ? <p className="rounded-[16px] bg-[var(--pt-soft)] p-4 text-xs text-muted-foreground">{v.disclosure}</p> : null}
          <div className="grid gap-5 lg:grid-cols-2">
            <Statement
              title={t("portal.fin.incomeStatement")}
              rows={[
                [t("portal.fin.produits"), v.income_statement.produits],
                [t("portal.fin.charges"), v.income_statement.charges],
              ]}
              total={[t("portal.fin.netResult"), v.income_statement.result]}
            />
            <Statement
              title={t("portal.fin.balanceSheet")}
              rows={[
                [t("portal.fin.actif"), v.balance_sheet.active],
                [t("portal.fin.passif"), v.balance_sheet.passif],
              ]}
              total={[t("portal.fin.result"), v.balance_sheet.result]}
              warn={!v.balance_sheet.balanced ? t("portal.fin.unbalanced") : null}
            />
          </div>

          <section className="pt-card overflow-hidden">
            <h2 className="pt-section-title px-5 pb-2 pt-5">{t("portal.audit.trialBalance")}</h2>
            {v.trial_balance.rows.length ? (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--pt-surface)] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-semibold">{t("portal.audit.account")}</th>
                      <th className="px-5 py-2 text-right font-semibold">{t("portal.audit.debit")}</th>
                      <th className="px-5 py-2 text-right font-semibold">{t("portal.audit.credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.trial_balance.rows.map((r) => (
                      <tr key={r.account_code} className="border-t border-[var(--pt-line)]">
                        <td className="pt-mono px-5 py-2.5 text-foreground">{r.account_code}</td>
                        <td className="pt-num px-5 py-2.5 text-right text-foreground">{amount(r.debit)}</td>
                        <td className="pt-num px-5 py-2.5 text-right text-foreground">{amount(r.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--pt-line-strong)] font-bold">
                      <td className="px-5 py-3">{t("portal.fin.total")}</td>
                      <td className="pt-num px-5 py-3 text-right">{amount(v.trial_balance.totals.debit)}</td>
                      <td className="pt-num px-5 py-3 text-right">{amount(v.trial_balance.totals.credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState icon={<ReceiptIcon size={28} />} title={t("portal.audit.noMovements")} />
            )}
          </section>

          <section className="pt-card overflow-hidden">
            <h2 className="pt-section-title px-5 pb-2 pt-5">{t("portal.audit.trail")}</h2>
            {v.audit_trail.length ? (
              <ul className="pt-rows max-h-96 overflow-auto">
                {v.audit_trail.map((e) => (
                  <li key={e.ledger_id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{actionLabel(e.action)}</p>
                      <p className="pt-mono truncate text-xs text-muted-foreground">{e.entity_ref || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm text-foreground">{e.actor_name || t("portal.audit.system")}</p>
                      <p className="text-xs text-muted-foreground">{dateFmt(e.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<ClockIcon size={28} />} title={t("portal.audit.noPostings")} />
            )}
          </section>

          <DataRoom />
        </div>
      ) : null}
    </div>
  );
}

function DataRoom() {
  const { t } = useTranslation();
  const toast = useToast();
  const rooms = useLoad(portalDataRoomList, "rooms");
  const [asking, setAsking] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<PortalDataRoom | null>(null);

  async function create() {
    setBusy(true);
    try {
      await portalDataRoomCreate(note.trim());
      setNote("");
      setAsking(false);
      toast(t("portal.audit.asked"));
      rooms.reload();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="pt-section-title flex items-center gap-2">
          <FolderIcon size={20} className="text-primary-ink" />
          {t("portal.audit.dataRoom")}
        </h2>
        <button type="button" className="pt-btn pt-btn-soft pt-btn-sm" onClick={() => setAsking(true)}>
          <PlusIcon size={18} />
          {t("portal.audit.ask")}
        </button>
      </div>
      <div className="pt-card pt-rows overflow-hidden">
        {(rooms.data || []).map((r) => (
          <button key={r.room_id} type="button" className="pt-row" onClick={() => setOpen(r)}>
            <IconDisc tone={r.status === "ANSWERED" ? "ok" : "warn"}>{r.status === "ANSWERED" ? <CheckCircleIcon /> : <ClockIcon />}</IconDisc>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.95rem] font-semibold text-foreground">{r.request_note}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <Pill tone={r.status === "ANSWERED" ? "ok" : "warn"}>{t(`portal.audit.room.${r.status}`)}</Pill>
                <Pill plain>
                  <DocIcon size={13} />
                  {r.doc_count}
                </Pill>
                <Pill plain>{dateFmt(r.created_at)}</Pill>
              </span>
            </span>
            <ChevronRightIcon size={18} className="text-muted-foreground" />
          </button>
        ))}
        {rooms.data && !rooms.data.length ? <EmptyState icon={<FolderIcon size={28} />} title={t("portal.audit.noRequests")} /> : null}
        {!rooms.data && !rooms.error ? (
          <div className="p-4">
            <Shimmer className="h-12" />
          </div>
        ) : null}
      </div>

      <Sheet
        open={asking}
        onClose={() => setAsking(false)}
        title={t("portal.audit.ask")}
        footer={
          <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!note.trim() || busy} onClick={() => void create()}>
            <Busy busy={busy} />
            {t("portal.audit.send")}
          </button>
        }
      >
        <TextArea label={t("portal.audit.what")} value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} />
      </Sheet>
      <RoomSheet room={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function RoomSheet({ room, onClose }: { room: PortalDataRoom | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const detail = useLoad(() => (room ? portalDataRoomDetail(room.room_id) : Promise.resolve(null)), room ? `room:${room.room_id}` : "none");
  const [busy, setBusy] = React.useState<string | null>(null);
  async function get(doc: PortalDataRoomDoc) {
    if (!room) return;
    setBusy(doc.doc_id);
    try {
      await portalDataRoomDownload(room.room_id, doc.doc_id, doc.original_name || `${doc.doc_type_code || doc.doc_type || "document"}.pdf`);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }
  const docs = detail.data?.docs || [];
  return (
    <Sheet open={!!room} onClose={onClose} title={t("portal.audit.dataRoom")}>
      {room ? <p className="mb-4 whitespace-pre-wrap rounded-[16px] bg-[var(--pt-soft)] p-4 text-sm text-foreground">{room.request_note}</p> : null}
      {!detail.data && !detail.error ? <Shimmer className="h-12" /> : null}
      {detail.data && !docs.length ? <EmptyState icon={<ClockIcon size={28} />} title={t("portal.audit.noDocs")} /> : null}
      <div className={cn("pt-rows", docs.length && "pt-card overflow-hidden")}>
        {docs.map((d) => (
          <button key={d.doc_id} type="button" className="pt-row" onClick={() => void get(d)} disabled={busy === d.doc_id}>
            <IconDisc tone="info">
              <DocIcon />
            </IconDisc>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{d.original_name || d.doc_type_code || "—"}</span>
              <span className="block text-xs text-muted-foreground">{dateFmt(d.created_at)}</span>
            </span>
            <Busy busy={busy === d.doc_id}>
              <DownloadIcon size={20} className="text-muted-foreground" />
            </Busy>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
