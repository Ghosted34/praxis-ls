/**
 * Client portal — the three role terminals: client, investor, auditor.
 *
 * Split out of `features/portal/portal-app.tsx` in Phase 4 (audit F7). Each
 * shows a deliberately different slice: shipments for a client, financials for
 * an investor, the audit room for an auditor.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui/panel";
import { num, dateFmt } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import {
  portalClientView,
  portalClientDocuments,
  portalClientDocumentDownload,
  portalClientOnboarding,
  portalClientMessages,
  portalClientMessageSend,
  portalClientMessagesExport,
  portalClientQuoteRequests,
  portalClientQuoteCreate,
  portalInvestorView,
  portalAuditorView,
  portalDataRoomList,
  portalDataRoomCreate,
  portalDataRoomDetail,
  portalDataRoomDownload,
  type PortalMe,
  type ClientView,
  type PortalDocument,
  type PortalOnboarding,
  type PortalMessage,
  type PortalQuoteRequest,
  type InvestorView,
  type AuditorView,
  type PortalDataRoom,
  type PortalDataRoomDetail,
  type PortalDataRoomDoc,
} from "@/lib/portal-api";
import { msg } from "./portal-chrome";
import { label } from "./portal-auth";
import { PortalShipment } from "./portal-shipment";

function Kpi({
  label: k,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {k}
      </p>
      <p className="num mt-2 text-2xl text-foreground">{num(value)}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Line({
  label: k,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${strong ? "border-t border-border font-semibold" : ""}`}
    >
      <span
        className={
          strong ? "text-sm text-foreground" : "text-sm text-muted-foreground"
        }
      >
        {k}
      </span>
      <span className="num text-sm text-foreground">{num(value)}</span>
    </div>
  );
}

export function InvestorTerminal({ me }: { me: PortalMe }) {
  // Only for the two sentences below: every label on this screen is a `tr()` of an
  // OHADA term the panel already prints. A hook is cheap; a French page with one
  // English paragraph in it is not fixable by the reader.
  const { t } = useTranslation();
  const [view, setView] = React.useState<InvestorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalInvestorView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!view) return <SkeletonTable />;

  const {
    kpis,
    income_statement: is,
    balance_sheet: bs,
    cash_position: cash,
  } = view;

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Financial position
        {me.portal_user.full_name
          ? `, ${me.portal_user.full_name.split(" ")[0]}`
          : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {dateFmt(view.period.from)} to {dateFmt(view.period.to)} · {view.basis}{" "}
        basis
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={tr("Revenue")}
          value={kpis.revenue}
          hint={tr("Produits for the period")}
        />
        <Kpi
          label={tr("Net result")}
          value={kpis.net_result}
          hint={tr("Produits less charges")}
        />
        <Kpi
          label={tr("Cash on hand")}
          value={kpis.cash_on_hand}
          hint={tr("Today, not period-end")}
        />
        <Kpi
          label={tr("Balance sheet total")}
          value={kpis.balance_sheet_total}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title={tr("Compte de résultat")}>
          <Line label={tr("Produits")} value={is.produits} />
          <Line label={tr("Charges")} value={is.charges} />
          {is.hao_net ? (
            <Line
              label={tr("Hors activités ordinaires (net)")}
              value={is.hao_net}
            />
          ) : null}
          <Line label={tr("Résultat net")} value={is.result} strong />
        </Panel>

        <Panel title={tr("Bilan")}>
          <Line label={tr("Actif")} value={bs.active} />
          <Line label={tr("Passif")} value={bs.passif} />
          <Line label={tr("Résultat")} value={bs.result} strong />
          {!bs.balanced ? (
            // Shown, not hidden: an unbalanced bilan means the books need
            // attention, and quietly rendering it as though it were final would
            // be the worse of the two failures.
            <p className="mt-2 text-xs text-warn">
              {t("portal.unbalancedHint")}
            </p>
          ) : null}
        </Panel>

        <Panel title={tr("Cash position")}>
          {cash.accounts.length === 0 ? (
            <EmptyState
              title={tr("No treasury accounts")}
              hint={tr("Class-5 balances will appear here.")}
            />
          ) : (
            <>
              {cash.accounts.map((a) => (
                <Line
                  key={a.account_code}
                  label={a.account_code}
                  value={a.balance}
                />
              ))}
              <Line label={tr("Total")} value={cash.total_cash} strong />
            </>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Read-only summary prepared on the {view.basis} basis. No operational
        detail is included.
      </p>
    </>
  );
}

/* ── auditor room ───────────────────────────────────────────────────────── */

export function AuditorTerminal({ me }: { me: PortalMe }) {
  const { t } = useTranslation();
  const [view, setView] = React.useState<AuditorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Data room state — the auditor's document requests (PRD §5.2).
  const [rooms, setRooms] = React.useState<PortalDataRoom[] | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PortalDataRoomDetail | null>(null);
  const [note, setNote] = React.useState("");
  const [roomBusy, setRoomBusy] = React.useState<
    "list" | "create" | "detail" | "download" | null
  >(null);
  const [roomError, setRoomError] = React.useState<string | null>(null);
  const [dlDocId, setDlDocId] = React.useState<string | null>(null);

  const loadRooms = React.useCallback(() => {
    portalDataRoomList()
      .then((r) => setRooms(r))
      .catch((e) => setRoomError(msg(e)));
  }, []);

  React.useEffect(() => {
    let alive = true;
    portalAuditorView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    portalDataRoomList()
      .then((r) => alive && setRooms(r))
      .catch(() => alive && setRooms([]));
    return () => {
      alive = false;
    };
  }, []);

  async function createRoom() {
    const trimmed = note.trim();
    if (!trimmed) return setRoomError("Describe the document you need first.");
    setRoomBusy("create");
    setRoomError(null);
    try {
      await portalDataRoomCreate(trimmed);
      setNote("");
      loadRooms();
    } catch (e) {
      setRoomError(msg(e));
    } finally {
      setRoomBusy(null);
    }
  }

  async function openRoom(id: string) {
    setOpenId(id);
    setDetail(null);
    setRoomBusy("detail");
    setRoomError(null);
    try {
      setDetail(await portalDataRoomDetail(id));
    } catch (e) {
      setRoomError(msg(e));
    } finally {
      setRoomBusy(null);
    }
  }

  async function downloadDoc(doc: PortalDataRoomDoc) {
    if (!openId) return;
    setDlDocId(doc.doc_id);
    setRoomError(null);
    try {
      const name =
        doc.original_name ||
        (doc.doc_type_code || doc.doc_type || "document") + ".pdf";
      await portalDataRoomDownload(openId, doc.doc_id, name);
    } catch (e) {
      setRoomError(msg(e));
    } finally {
      setDlDocId(null);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!view) return <SkeletonTable />;

  const {
    income_statement: is,
    balance_sheet: bs,
    trial_balance: tb,
    audit_trail: trail,
  } = view;
  const actionLabel = (a: string) =>
    (a || "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        {t("portal.auditRoom")}
        {me.portal_user.full_name
          ? `, ${me.portal_user.full_name.split(" ")[0]}`
          : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {dateFmt(view.period.from)} to {dateFmt(view.period.to)} · {view.basis}{" "}
        basis
        {me.grants.AUDITOR?.expires_at
          ? ` · access to ${dateFmt(me.grants.AUDITOR.expires_at)}`
          : ""}
      </p>
      <p className="mt-3 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
        {view.disclosure}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title={tr("Compte de résultat")}>
          <Line label={tr("Produits")} value={is.produits} />
          <Line label={tr("Charges")} value={is.charges} />
          <Line label={tr("Résultat net")} value={is.result} strong />
        </Panel>
        <Panel title={tr("Bilan")}>
          <Line label={tr("Actif")} value={bs.active} />
          <Line label={tr("Passif")} value={bs.passif} />
          <Line label={tr("Résultat")} value={bs.result} strong />
          {!bs.balanced ? (
            <p className="mt-2 text-xs text-warn">
              {t("portal.unbalancedHint")}
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title={tr("Trial balance")}>
          {tb.rows.length === 0 ? (
            <EmptyState
              title={tr("No movements")}
              hint={tr("No ledger movements for this period.")}
            />
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left font-medium">
                      {tr("Account")}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {tr("Debit")}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {tr("Credit")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tb.rows.map((r) => (
                    <tr key={r.account_code}>
                      <td className="py-2 text-foreground">{r.account_code}</td>
                      <td className="num py-2 text-right text-foreground">
                        {num(r.debit)}
                      </td>
                      <td className="num py-2 text-right text-foreground">
                        {num(r.credit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border">
                  <tr>
                    <td className="py-2 font-semibold text-foreground">
                      {tr("Total")}
                    </td>
                    <td className="num py-2 text-right font-semibold text-foreground">
                      {num(tb.totals.debit)}
                    </td>
                    <td className="num py-2 text-right font-semibold text-foreground">
                      {num(tb.totals.credit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title={tr("Audit trail")}>
          {trail.length === 0 ? (
            <EmptyState
              title={tr("No postings")}
              hint={tr(
                "Financial and document postings for the period will appear here.",
              )}
            />
          ) : (
            <div className="max-h-96 overflow-auto">
              <ul className="divide-y divide-border">
                {trail.map((t) => (
                  <li
                    key={t.ledger_id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {actionLabel(t.action)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.entity_ref || "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm text-foreground">
                        {t.actor_name || "System"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateFmt(t.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title={t("portal.dataRoom")}>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("portal.dataRoomHint")}
          </p>

          {roomError && (
            <div className="mb-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              {roomError}
            </div>
          )}

          <form
            className="mb-6 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createRoom();
            }}
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={tr(
                "What document do you need, and for which period/file?",
              )}
              className="w-full field"
            />
            <button
              type="submit"
              disabled={roomBusy === "create"}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {roomBusy === "create" ? "Requesting…" : "Request document"}
            </button>
          </form>

          {rooms === null ? (
            <SkeletonTable />
          ) : rooms.length === 0 ? (
            <EmptyState
              title={tr("No requests yet")}
              hint={tr(
                "Requests you make and the documents shared in answer appear here.",
              )}
            />
          ) : (
            <ul className="divide-y divide-border">
              {rooms.map((r) => (
                <li key={r.room_id} className="py-3">
                  <button
                    type="button"
                    onClick={() => void openRoom(r.room_id)}
                    className="flex w-full items-center justify-between gap-4 text-left hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {r.request_note}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateFmt(r.created_at)} · {r.doc_count} document
                        {r.doc_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {r.status === "ANSWERED"
                        ? t("portal.answered")
                        : t("portal.open")}
                    </span>
                  </button>

                  {openId === r.room_id && (
                    <div className="mt-3 rounded-lg border border-border bg-card/60 p-3">
                      {roomBusy === "detail" ? (
                        <p className="text-sm text-muted-foreground">
                          {tr("Loading…")}
                        </p>
                      ) : detail && detail.room.room_id === r.room_id ? (
                        detail.docs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {t("portal.noDocsShared")}
                          </p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {detail.docs.map((doc) => {
                              const name =
                                doc.original_name ||
                                (doc.doc_type_code ||
                                  doc.doc_type ||
                                  "document") + ".pdf";
                              return (
                                <li
                                  key={doc.doc_id}
                                  className="flex items-center justify-between gap-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm text-foreground">
                                      {name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Shared {dateFmt(doc.created_at)}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={dlDocId === doc.doc_id}
                                    onClick={() => void downloadDoc(doc)}
                                    className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:opacity-80 disabled:opacity-50"
                                  >
                                    {dlDocId === doc.doc_id
                                      ? t("portal.downloading")
                                      : t("common.download")}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Read-only, prepared on the {view.basis} basis for the period shown. HR,
        payroll and security events are excluded.
      </p>
    </>
  );
}

/* ── client view ────────────────────────────────────────────────────────── */

export function ClientTerminal({ me }: { me: PortalMe }) {
  const { t } = useTranslation();
  // Which shipment the client has opened, if any. Kept here rather than in the
  // router because the portal shell is deliberately a single authenticated view.
  const [openDossier, setOpenDossier] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ClientView | null>(null);
  const [docs, setDocs] = React.useState<PortalDocument[] | null>(null);
  const [dlBusy, setDlBusy] = React.useState<string | null>(null);
  const [dlError, setDlError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Onboarding command centre (PRD §11.1).
  const [onb, setOnb] = React.useState<PortalOnboarding | null>(null);

  // Secure messaging (PRD §11.1).
  const [msgs, setMsgs] = React.useState<PortalMessage[]>([]);
  const [msgDraft, setMsgDraft] = React.useState("");
  const [msgBusy, setMsgBusy] = React.useState<"send" | "export" | null>(null);
  const [msgError, setMsgError] = React.useState<string | null>(null);

  // Self-service quoting (PRD §11.1).
  const [quotes, setQuotes] = React.useState<PortalQuoteRequest[] | null>(null);
  const [quoteForm, setQuoteForm] = React.useState({
    service_category: "",
    service_type: "",
    origin_location: "",
    destination_location: "",
    estimated_weight: "",
    cargo_description: "",
    incoterm: "",
  });
  const [quoteBusy, setQuoteBusy] = React.useState(false);
  const [quoteError, setQuoteError] = React.useState<string | null>(null);

  const reloadMessages = React.useCallback(() => {
    portalClientMessages()
      .then((m) => setMsgs(m))
      .catch((e) => setMsgError(msg(e)));
  }, []);

  React.useEffect(() => {
    let alive = true;
    portalClientView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    // The document vault is the client's own; loaded beside the summary.
    portalClientDocuments()
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setDocs([]));
    portalClientOnboarding()
      .then((o) => alive && setOnb(o))
      .catch(() => alive && setOnb(null));
    portalClientMessages()
      .then((m) => alive && setMsgs(m))
      .catch(() => alive && setMsgs([]));
    portalClientQuoteRequests()
      .then((q) => alive && setQuotes(q))
      .catch(() => alive && setQuotes([]));
    return () => {
      alive = false;
    };
  }, []);

  async function sendMessage() {
    const body = msgDraft.trim();
    if (!body) return;
    setMsgBusy("send");
    setMsgError(null);
    try {
      await portalClientMessageSend(body);
      setMsgDraft("");
      reloadMessages();
    } catch (e) {
      setMsgError(msg(e));
    } finally {
      setMsgBusy(null);
    }
  }

  async function exportChat() {
    setMsgBusy("export");
    setMsgError(null);
    try {
      await portalClientMessagesExport();
    } catch (e) {
      setMsgError(msg(e));
    } finally {
      setMsgBusy(null);
    }
  }

  async function submitQuote(e: React.FormEvent) {
    e.preventDefault();
    setQuoteBusy(true);
    setQuoteError(null);
    try {
      await portalClientQuoteCreate({
        service_category: quoteForm.service_category,
        service_type: quoteForm.service_type || undefined,
        origin_location: quoteForm.origin_location,
        destination_location: quoteForm.destination_location,
        estimated_weight: quoteForm.estimated_weight
          ? Number(quoteForm.estimated_weight)
          : undefined,
        cargo_description: quoteForm.cargo_description || undefined,
        incoterm: quoteForm.incoterm || undefined,
      });
      setQuoteForm({
        service_category: "",
        service_type: "",
        origin_location: "",
        destination_location: "",
        estimated_weight: "",
        cargo_description: "",
        incoterm: "",
      });
      const q = await portalClientQuoteRequests();
      setQuotes(q);
    } catch (e) {
      setQuoteError(msg(e));
    } finally {
      setQuoteBusy(false);
    }
  }

  async function downloadDoc(doc: PortalDocument) {
    setDlBusy(doc.doc_id);
    setDlError(null);
    try {
      const label =
        doc.original_name ||
        (doc.doc_type_code || doc.doc_type || "document") + ".pdf";
      await portalClientDocumentDownload(doc.doc_id, label);
    } catch (e) {
      setDlError(msg(e));
    } finally {
      setDlBusy(null);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (openDossier)
    return (
      <PortalShipment
        dossierId={openDossier}
        onBack={() => setOpenDossier(null)}
      />
    );

  const dossiers = view?.dossiers ?? [];
  const invoices = view?.invoices ?? [];

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        {t("portal.welcome")}
        {me.portal_user.full_name
          ? `, ${me.portal_user.full_name.split(" ")[0]}`
          : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {me.grants.CLIENT.expires_at
          ? `Your access runs to ${dateFmt(me.grants.CLIENT.expires_at)}.`
          : "Your current shipments and invoices."}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title={t("portal.shipments")}>
          {!view ? (
            <SkeletonTable />
          ) : dossiers.length === 0 ? (
            <EmptyState
              title={t("portal.noShipments")}
              hint={t("portal.noShipmentsHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {dossiers.map((d) => (
                <li key={d.dossier_id}>
                  {/* The row opens the file's progress and the conditions its
                      dates rest on — previously a client could see that a
                      shipment existed and nothing about where it had got to. */}
                  <button
                    type="button"
                    onClick={() => setOpenDossier(d.dossier_id)}
                    className="flex w-full items-center justify-between py-3 text-left hover:opacity-80"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {d.ref}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Opened {dateFmt(d.created_at)}
                      </p>
                    </div>
                    <span className="status">{label(d.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("portal.invoices")}>
          {!view ? (
            <SkeletonTable />
          ) : invoices.length === 0 ? (
            <EmptyState
              title={t("portal.nothingOutstanding")}
              hint={t("portal.nothingOutstandingHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {invoices.map((i) => (
                <li
                  key={i.invoice_id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {i.doc_number || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Due {dateFmt(i.payment_due_on)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm text-foreground">
                      {num(i.total_ttc)}
                    </p>
                    <span className="status">{label(i.status)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title={t("portal.onboarding")}>
          {!onb ? (
            <SkeletonTable />
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("portal.accountComplete")}
                  </span>
                  <span className="font-medium text-foreground">
                    {onb.progress}% {t("portal.complete")}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${onb.progress}%` }}
                  />
                </div>
              </div>
              <ul className="space-y-2">
                {onb.steps.map((s) => (
                  <li
                    key={s.step_key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        s.done
                          ? "bg-[rgb(var(--ok))] text-white"
                          : "border border-border text-muted-foreground"
                      }`}
                    >
                      {s.done ? "✓" : ""}
                    </span>
                    <span
                      className={
                        s.done
                          ? "text-sm text-muted-foreground line-through"
                          : "text-sm text-foreground"
                      }
                    >
                      {s.label_en}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title={t("portal.messages")}>
          {msgError && (
            <div className="mb-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              {msgError}
            </div>
          )}
          <div className="mb-3 max-h-56 space-y-2 overflow-auto">
            {msgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("portal.noMessages")}
              </p>
            ) : (
              msgs.map((m) => (
                <div
                  key={m.message_id}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    m.direction === "CLIENT"
                      ? "ml-6 bg-accent text-foreground"
                      : "mr-6 bg-background text-foreground"
                  }`}
                >
                  <div className="mb-0.5 text-[11px] text-muted-foreground">
                    {m.direction === "STAFF"
                      ? m.author_name || "Account team"
                      : "You"}{" "}
                    · {dateFmt(m.created_at)}
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <textarea
              value={msgDraft}
              onChange={(e) => setMsgDraft(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder={t("portal.writeMessage")}
              className="min-w-0 flex-1 field"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!msgDraft.trim() || msgBusy === "send"}
              onClick={() => void sendMessage()}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {msgBusy === "send" ? t("portal.sending") : t("common.send")}
            </button>
            <button
              type="button"
              disabled={msgs.length === 0 || msgBusy === "export"}
              onClick={() => void exportChat()}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {msgBusy === "export"
                ? t("portal.exporting")
                : t("portal.exportChat")}
            </button>
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title={t("portal.requestQuote")}>
          {quoteError && (
            <div className="mb-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              {quoteError}
            </div>
          )}
          <form onSubmit={(e) => void submitQuote(e)} className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                required
                value={quoteForm.service_category}
                onChange={(e) =>
                  setQuoteForm((f) => ({
                    ...f,
                    service_category: e.target.value,
                  }))
                }
                placeholder={t("portal.service")}
                className="w-full field"
              />
              <input
                value={quoteForm.service_type}
                onChange={(e) =>
                  setQuoteForm((f) => ({
                    ...f,
                    service_type: e.target.value,
                  }))
                }
                placeholder={t("portal.serviceType")}
                className="w-full field"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                required
                value={quoteForm.origin_location}
                onChange={(e) =>
                  setQuoteForm((f) => ({
                    ...f,
                    origin_location: e.target.value,
                  }))
                }
                placeholder={t("portal.origin")}
                className="w-full field"
              />
              <input
                required
                value={quoteForm.destination_location}
                onChange={(e) =>
                  setQuoteForm((f) => ({
                    ...f,
                    destination_location: e.target.value,
                  }))
                }
                placeholder={t("portal.destination")}
                className="w-full field"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={quoteForm.estimated_weight}
                onChange={(e) =>
                  setQuoteForm((f) => ({
                    ...f,
                    estimated_weight: e.target.value,
                  }))
                }
                type="number"
                min="0"
                step="0.0001"
                placeholder={t("portal.weight")}
                className="w-full field"
              />
              <input
                value={quoteForm.incoterm}
                onChange={(e) =>
                  setQuoteForm((f) => ({ ...f, incoterm: e.target.value }))
                }
                placeholder={t("portal.incoterm")}
                className="w-full field"
              />
            </div>
            <textarea
              value={quoteForm.cargo_description}
              onChange={(e) =>
                setQuoteForm((f) => ({
                  ...f,
                  cargo_description: e.target.value,
                }))
              }
              rows={2}
              maxLength={2000}
              placeholder={t("portal.cargo")}
              className="w-full field"
            />
            <button
              type="submit"
              disabled={quoteBusy}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {quoteBusy ? t("portal.submitting") : t("portal.requestQuote")}
            </button>
          </form>
        </Panel>

        <Panel title={t("portal.myQuotes")}>
          {quotes === null ? (
            <SkeletonTable />
          ) : quotes.length === 0 ? (
            <EmptyState
              title={t("portal.noQuotes")}
              hint={t("portal.noQuotesHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {quotes.map((q) => (
                <li key={q.quote_request_id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {q.public_ref || "Quote request"}
                    </p>
                    <span className="status">{label(q.status)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {q.origin_location || "—"} → {q.destination_location || "—"}
                    {q.estimated_weight
                      ? ` · ${q.estimated_weight} kg`
                      : ""} · {dateFmt(q.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title={t("portal.documents")}>
          {dlError && (
            <div className="mb-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              {dlError}
            </div>
          )}
          {docs === null ? (
            <SkeletonTable />
          ) : docs.length === 0 ? (
            <EmptyState
              title={t("portal.noDocuments")}
              hint={t("portal.noDocumentsHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {docs.map((doc) => {
                const name =
                  doc.original_name ||
                  (doc.doc_type_code || doc.doc_type || "document") + ".pdf";
                return (
                  <li
                    key={doc.doc_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {doc.dossier_ref ? `${doc.dossier_ref} · ` : ""}
                        Filed {dateFmt(doc.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={dlBusy === doc.doc_id}
                      onClick={() => void downloadDoc(doc)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:opacity-80 disabled:opacity-50"
                    >
                      {dlBusy === doc.doc_id
                        ? t("portal.downloading")
                        : t("common.download")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * Routes a signed-in portal user to whichever terminal(s) their grants allow.
 *
 * A single login can legitimately hold more than one grant (a CFO who is both a
 * client contact and on the board, or an auditor also given the investor view),
 * so this picks the first allowed in CLIENT → INVESTOR → AUDITOR order and offers
 * a switch when there's more than one. All three terminals are live.
 */
