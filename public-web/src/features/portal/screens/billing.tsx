/**
 * Billing — what is owed, what is paid, and "I have paid".
 *
 * The page opens on the one number a client comes for: what they owe, in each
 * currency they are billed in, with the overdue part in red. Below it, the
 * invoices as rows that say their state in a pill ("Due in 3 days", "In
 * review"), each one a tap from its lines, its PDF, and paying it.
 *
 * "I've paid" is a proof, not a payment: three short steps — which invoices,
 * how and when, the receipt — and finance confirms it. Until they do, the
 * invoice reads "In review" rather than "Paid", because that is the truth.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  portalBilling,
  portalInvoice,
  portalInvoicePdf,
  portalInvoiceDocumentsZip,
  portalInvoiceDocument,
  portalSubmitProof,
  portalProofFile,
  type PortalBilling,
  type InvoiceSummary,
  type PaymentProof,
  type PayTo,
  type InvoiceState,
  type InvoiceDocuments,
} from "@/lib/portal-api";
import { getLang, currentLocale } from "@/lib/i18n";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DateField } from "@/components/ui/date-field";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import {
  Sheet,
  Seg,
  Pill,
  IconDisc,
  SkeletonCards,
  EmptyState,
  ErrorCard,
  TextField,
  TextArea,
  StepDots,
  CopyRow,
  InfoButton,
  useLoad,
  useToast,
  errorText,
  Busy,
  Shimmer,
  type Tone,
} from "../ui/kit";
import { FileChooser, UploadProgress, type Picked } from "../ui/upload";
import {
  ReceiptIcon,
  WalletIcon,
  BankIcon,
  PhoneIcon,
  CashIcon,
  ChequeIcon,
  DownloadIcon,
  CheckCircleIcon,
  ClockIcon,
  ShipIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  AlertIcon,
  PaperclipIcon,
  ArchiveIcon,
} from "../ui/icons";
import { relDay, relDayTitle } from "../lib/when";
import { parseAmount } from "../lib/numbers";

const STATE_TONE: Record<InvoiceState, Tone> = {
  DUE: "info",
  OVERDUE: "bad",
  PART_PAID: "warn",
  PAID: "ok",
  IN_REVIEW: "brand",
  CANCELLED: "mute",
};

/** "Overdue 5 days" / "Due tomorrow" / "In review" / "Paid". */
export function InvoiceStatePill({ inv }: { inv: InvoiceSummary }) {
  const { t } = useTranslation();
  if ((inv.state === "DUE" || inv.state === "PART_PAID") && inv.payment_due_on)
    return <Pill tone={STATE_TONE[inv.state]}>{t("portal.bill.dueWhen", { when: relDay(inv.payment_due_on) })}</Pill>;
  if (inv.state === "OVERDUE" && inv.payment_due_on)
    return <Pill tone="bad">{t("portal.bill.wasDue", { when: relDay(inv.payment_due_on, 60) })}</Pill>;
  return <Pill tone={STATE_TONE[inv.state]}>{t(`portal.bill.state.${inv.state}`)}</Pill>;
}

export function InvoiceRow({ inv, onOpen }: { inv: InvoiceSummary; onOpen: (i: InvoiceSummary) => void }) {
  const { t } = useTranslation();
  const open = inv.state !== "PAID" && inv.state !== "CANCELLED";
  return (
    <button type="button" className="pt-row" onClick={() => onOpen(inv)}>
      <IconDisc tone={STATE_TONE[inv.state]}>{inv.state === "PAID" ? <CheckCircleIcon /> : <ReceiptIcon />}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="pt-mono min-w-0 truncate text-[0.95rem] font-bold text-foreground">{inv.doc_number || t("portal.bill.invoice")}</span>
          <span className="pt-num shrink-0 text-[0.95rem] font-bold text-foreground">{money(open ? inv.outstanding : inv.total, inv.currency)}</span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <InvoiceStatePill inv={inv} />
          {inv.dossier_ref ? (
            <Pill plain>
              <ShipIcon size={13} />
              <span className="pt-mono">{inv.dossier_ref}</span>
            </Pill>
          ) : null}
          {inv.documents_count ? (
            <Pill plain>
              <PaperclipIcon size={13} />
              <span className="pt-num" aria-hidden="true">
                {inv.documents_count}
              </span>
              <span className="sr-only">{t("portal.bill.docs.count", { count: inv.documents_count })}</span>
            </Pill>
          ) : null}
          {open && inv.paid > 0 ? <span className="pt-num text-xs text-muted-foreground">{t("portal.bill.ofTotal", { total: money(inv.total, inv.currency) })}</span> : null}
        </span>
      </span>
    </button>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

type Tab = "open" | "paid" | "payments";

export function BillingPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const summary = useSummary();
  const [params, setParams] = useSearchParams();
  const data = useLoad(portalBilling, "billing");
  const [tab, setTab] = React.useState<Tab>("open");
  const [invoice, setInvoice] = React.useState<InvoiceSummary | null>(null);
  const [pay, setPay] = React.useState<{ invoiceIds: string[] } | null>(null);

  // A link from Home ("Pay" on an overdue invoice) opens that invoice here.
  const wanted = params.get("invoice");
  React.useEffect(() => {
    if (!wanted || !data.data) return;
    const hit = data.data.invoices.find((i) => i.invoice_id === wanted);
    if (hit) setInvoice(hit);
    params.delete("invoice");
    setParams(params, { replace: true });
  }, [wanted, data.data, params, setParams]);

  const reload = () => {
    data.reload();
    summary?.reload();
  };

  const b = data.data;
  const openInv = (b?.invoices || []).filter((i) => i.state !== "PAID" && i.state !== "CANCELLED");
  const paidInv = (b?.invoices || []).filter((i) => i.state === "PAID");
  const payable = openInv.filter((i) => i.state !== "IN_REVIEW");

  return (
    <div>
      <PageHeader
        title={t("portal.nav.billing")}
        action={
          b?.how_to_pay ? (
            <InfoButton label={t("portal.bill.howToPay")} title={t("portal.bill.howToPay")}>
              <HowToPay to={b.how_to_pay} />
            </InfoButton>
          ) : null
        }
      />

      {data.error && !b ? <ErrorCard message={data.error} onRetry={data.reload} /> : null}

      {!b && !data.error ? (
        <div className="grid gap-4">
          <Shimmer className="h-40 rounded-[28px]" />
          <SkeletonCards count={3} />
        </div>
      ) : null}

      {b ? (
        <>
          <BalanceCard billing={b} onPay={() => setPay({ invoiceIds: payable.map((i) => i.invoice_id) })} canPay={payable.length > 0} />

          <div className="mt-6 flex items-center justify-between gap-3">
            <Seg<Tab>
              label={t("portal.bill.filter")}
              value={tab}
              onChange={setTab}
              items={[
                { value: "open", label: t("portal.bill.tab.open"), count: openInv.length },
                { value: "paid", label: t("portal.bill.tab.paid") },
                { value: "payments", label: t("portal.bill.tab.payments"), count: b.proofs.filter((p) => p.status === "SUBMITTED").length },
              ]}
            />
          </div>

          <div className="mt-4">
            {tab === "payments" ? (
              <ProofList proofs={b.proofs} />
            ) : (tab === "open" ? openInv : paidInv).length ? (
              <div className="pt-card pt-rows overflow-hidden">
                {(tab === "open" ? openInv : paidInv).map((inv) => (
                  <InvoiceRow key={inv.invoice_id} inv={inv} onOpen={setInvoice} />
                ))}
              </div>
            ) : (
              <div className="pt-card">
                <EmptyState
                  tone={tab === "open" ? "ok" : "brand"}
                  icon={tab === "open" ? <CheckCircleIcon size={28} /> : <ReceiptIcon size={28} />}
                  title={tab === "open" ? t("portal.bill.allClear") : t("portal.bill.noPaid")}
                />
              </div>
            )}
          </div>
        </>
      ) : null}

      <InvoiceSheet
        inv={invoice}
        onClose={() => setInvoice(null)}
        onPay={(i) => {
          setInvoice(null);
          setPay({ invoiceIds: [i.invoice_id] });
        }}
      />
      {b ? (
        <PaySheet
          open={!!pay}
          billing={b}
          preselect={pay?.invoiceIds || []}
          onClose={() => setPay(null)}
          onDone={() => {
            reload();
            setTab("payments");
          }}
        />
      ) : null}
    </div>
  );
}

/** The balance: what is owed per currency, the overdue part, one button. */
function BalanceCard({ billing, onPay, canPay }: { billing: PortalBilling; onPay: () => void; canPay: boolean }) {
  const { t } = useTranslation();
  const totals = billing.totals.filter((x) => x.due > 0 || x.overdue > 0);
  const inReview = billing.invoices.filter((i) => i.state === "IN_REVIEW").length;
  return (
    <section className="pt-card pt-hero-card p-5 sm:p-7" aria-label={t("portal.bill.toPay")}>
      <div>
        <p className="text-sm font-semibold text-muted-foreground">{t("portal.bill.toPay")}</p>
        {totals.length ? (
          <div className="mt-1 grid gap-1">
            {totals.map((x) => (
              <div key={x.currency} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="pt-display pt-num text-[2.2rem] sm:text-[2.6rem]">{money(x.due, x.currency)}</p>
                {x.overdue > 0 ? <Pill tone="bad">{t("portal.bill.overdueAmount", { amount: money(x.overdue, x.currency) })}</Pill> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="pt-display mt-1 flex items-center gap-2 text-[2rem] text-[rgb(var(--ok))]">
            <CheckCircleIcon size={30} />
            {t("portal.bill.nothingDue")}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canPay ? (
            <button type="button" className="pt-btn pt-btn-primary" onClick={onPay}>
              <WalletIcon size={20} />
              {t("portal.bill.ivePaid")}
            </button>
          ) : null}
          {inReview ? (
            <Pill tone="brand">
              <ClockIcon size={14} />
              {t("portal.bill.inReviewCount", { count: inReview })}
            </Pill>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HowToPay({ to }: { to: PayTo }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-3">
        <IconDisc>
          <BankIcon />
        </IconDisc>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{to.bank_name || to.label}</p>
          {to.branch ? <p className="truncate text-sm text-muted-foreground">{to.branch}</p> : null}
        </div>
      </div>
      <div className="pt-rows mt-3">
        <CopyRow label={t("portal.bill.holder")} value={to.holder_name} mono={false} />
        <CopyRow label={t("portal.bill.account")} value={to.account_number} />
        <CopyRow label={t("portal.bill.iban")} value={to.iban} />
        <CopyRow label={t("portal.bill.swift")} value={to.swift_bic} />
      </div>
      <p className="mt-3 rounded-2xl bg-[var(--pt-soft)] p-4 text-sm text-muted-foreground">{t("portal.bill.howToPayHint")}</p>
    </div>
  );
}

function ProofList({ proofs }: { proofs: PaymentProof[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!proofs.length)
    return (
      <div className="pt-card">
        <EmptyState icon={<WalletIcon size={28} />} title={t("portal.bill.noProofs")} />
      </div>
    );
  const tone: Record<PaymentProof["status"], Tone> = { SUBMITTED: "brand", CONFIRMED: "ok", REJECTED: "bad" };
  async function file(p: PaymentProof) {
    setBusy(p.payment_proof_id);
    try {
      await portalProofFile(p.payment_proof_id, `${t("portal.bill.receiptFile")}-${p.paid_on}.pdf`);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="pt-card pt-rows overflow-hidden">
      {proofs.map((p) => (
        <div key={p.payment_proof_id} className="pt-row">
          <IconDisc tone={tone[p.status]}>{p.status === "CONFIRMED" ? <CheckCircleIcon /> : p.status === "REJECTED" ? <AlertIcon /> : <ClockIcon />}</IconDisc>
          <div className="min-w-0 flex-1">
            <p className="pt-num truncate text-[0.95rem] font-bold text-foreground">{money(p.amount, p.currency)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pill tone={tone[p.status]}>{t(`portal.bill.proof.${p.status}`)}</Pill>
              <Pill plain>{relDayTitle(p.paid_on, 2)}</Pill>
              {p.allocations.map((a) => (
                <Pill key={a.invoice_id} plain>
                  <span className="pt-mono">{a.doc_number}</span>
                </Pill>
              ))}
            </div>
            {p.status === "REJECTED" && p.review_note ? <p className="mt-1.5 text-sm text-[rgb(var(--bad))]">{p.review_note}</p> : null}
          </div>
          {p.has_file ? (
            <button type="button" className="pt-icon-btn shrink-0 text-muted-foreground" aria-label={t("portal.common.download")} onClick={() => void file(p)} disabled={busy === p.payment_proof_id}>
              <Busy busy={busy === p.payment_proof_id}>
                <DownloadIcon size={20} />
              </Busy>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ── one invoice ────────────────────────────────────────────────────────── */

export function InvoiceSheet({ inv, onClose, onPay }: { inv: InvoiceSummary | null; onClose: () => void; onPay?: (i: InvoiceSummary) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const lang = getLang();
  const detail = useLoad(
    () => (inv ? portalInvoice(inv.invoice_id, lang) : Promise.resolve(null)),
    inv ? `inv:${inv.invoice_id}:${lang}` : "none",
  );
  const [downloading, setDownloading] = React.useState(false);
  const d = detail.data;
  const cur = inv?.currency || d?.invoice.currency || "XAF";
  const open = !!inv && inv.state !== "PAID" && inv.state !== "CANCELLED";

  async function pdf() {
    if (!inv) return;
    setDownloading(true);
    try {
      await portalInvoicePdf(inv.invoice_id, `${inv.doc_number || "invoice"}.pdf`, lang);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Sheet
      open={!!inv}
      onClose={onClose}
      title={<span className="pt-mono">{inv?.doc_number || t("portal.bill.invoice")}</span>}
      footer={
        inv ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="pt-btn pt-btn-outline" onClick={() => void pdf()} disabled={downloading}>
              <Busy busy={downloading}>
                <DownloadIcon size={20} />
              </Busy>
              {t("portal.common.pdf")}
            </button>
            {open && inv.state !== "IN_REVIEW" && onPay ? (
              <button type="button" className="pt-btn pt-btn-primary" onClick={() => onPay(inv)}>
                <WalletIcon size={20} />
                {t("portal.bill.ivePaid")}
              </button>
            ) : (
              <span />
            )}
          </div>
        ) : null
      }
    >
      {inv ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <InvoiceStatePill inv={inv} />
            {inv.dossier_ref ? (
              <Pill plain>
                <ShipIcon size={13} />
                <span className="pt-mono">{inv.dossier_ref}</span>
              </Pill>
            ) : null}
          </div>
          <p className="mt-4 text-sm font-semibold text-muted-foreground">{open ? t("portal.bill.leftToPay") : t("portal.bill.total")}</p>
          <p className="pt-display pt-num text-[2.2rem]">{money(open ? inv.outstanding : inv.total, cur)}</p>
          {open && (inv.paid > 0 || inv.in_review > 0) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {inv.paid > 0 ? <Pill tone="ok">{t("portal.bill.paidAmount", { amount: money(inv.paid, cur) })}</Pill> : null}
              {inv.in_review > 0 ? <Pill tone="brand">{t("portal.bill.inReviewAmount", { amount: money(inv.in_review, cur) })}</Pill> : null}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-[16px] bg-[var(--pt-soft)] p-3">
              <p className="text-xs font-semibold text-muted-foreground">{t("portal.bill.issued")}</p>
              <p className="mt-0.5 font-semibold text-foreground">{relDayTitle(inv.issued_on, 1)}</p>
            </div>
            <div className="rounded-[16px] bg-[var(--pt-soft)] p-3">
              <p className="text-xs font-semibold text-muted-foreground">{t("portal.bill.dueOn")}</p>
              <p className="mt-0.5 font-semibold text-foreground">{relDayTitle(inv.payment_due_on, 1)}</p>
            </div>
          </div>

          {d?.documents && d.documents.items.length ? (
            <SupportingDocs inv={inv} docs={d.documents} />
          ) : !d && !detail.error && inv.documents_count ? (
            <Shimmer className="mt-5 h-[140px] w-full rounded-[18px]" />
          ) : null}

          <p className="pt-section-title mt-6">{t("portal.bill.lines")}</p>
          {detail.error ? <p className="mt-2 text-sm text-[rgb(var(--bad))]">{detail.error}</p> : null}
          {!d && !detail.error ? (
            <div className="mt-3 grid gap-2">
              <Shimmer className="h-5 w-4/5" />
              <Shimmer className="h-5 w-3/5" />
              <Shimmer className="h-5 w-2/3" />
            </div>
          ) : null}
          {d ? (
            <div className="mt-2">
              <ul className="pt-rows">
                {d.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-2.5">
                    <span className="min-w-0 text-sm text-foreground">
                      {l.label}
                      {l.is_disbursement ? <span className="ml-1.5 text-xs text-muted-foreground">{t("portal.bill.atCost")}</span> : null}
                    </span>
                    <span className="pt-num shrink-0 text-sm font-semibold text-foreground">{money(l.amount, cur)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 grid gap-1.5 rounded-[16px] bg-[var(--pt-soft)] p-4 text-sm">
                <TotalLine label={t("portal.bill.services")} value={money(d.invoice.service_ht, cur)} />
                {d.invoice.disbursement_total ? <TotalLine label={t("portal.bill.disbursements")} value={money(d.invoice.disbursement_total, cur)} /> : null}
                <TotalLine label={t("portal.bill.vat")} value={money(d.invoice.vat_total, cur)} />
                <div className="my-1 border-t border-[var(--pt-line-strong)]" />
                <TotalLine strong label={t("portal.bill.total")} value={money(d.invoice.total_ttc, cur)} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * The documents finance shared with a final invoice (14160). The one button a
 * client needs is "download all" — the invoice and every receipt behind it, as
 * one ZIP numbered in the order of the lines — so it leads; the single files
 * are one tap further, for the client who wants just the port receipt.
 */
function SupportingDocs({ inv, docs }: { inv: InvoiceSummary; docs: InvoiceDocuments }) {
  const { t } = useTranslation();
  const toast = useToast();
  const lang = getLang();
  const [showFiles, setShowFiles] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const listId = React.useId();

  async function run(key: string, download: () => Promise<void>) {
    setBusy(key);
    try {
      await download();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }
  const zipName = `${inv.doc_number || t("portal.bill.invoice")}-${t("portal.bill.docs.zipName")}.zip`;

  return (
    <section className="mt-5 rounded-[18px] border border-[var(--pt-line)] bg-[var(--pt-surface)] p-4" aria-label={t("portal.bill.docs.title")}>
      <div className="flex items-center gap-3">
        {/* The count rides on the paperclip, so the title keeps its width on a phone. */}
        <span className="relative shrink-0">
          <IconDisc tone="brand" size={40}>
            <PaperclipIcon size={20} />
          </IconDisc>
          <span
            aria-hidden="true"
            className="pt-num absolute -right-1.5 -top-1.5 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-[var(--pt-surface)] bg-[var(--primary)] px-1 text-[0.6875rem] font-bold text-[var(--primary-foreground)]"
          >
            {docs.items.length}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-foreground">
            {t("portal.bill.docs.title")}
            <span className="sr-only">{` (${t("portal.bill.docs.count", { count: docs.items.length })})`}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{t("portal.bill.docs.shared", { when: relDay(docs.published_at) })}</p>
        </div>
        <InfoButton title={t("portal.bill.docs.title")} label={t("portal.bill.docs.about")}>
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{t("portal.bill.docs.info")}</p>
        </InfoButton>
      </div>

      <button
        type="button"
        className="pt-btn pt-btn-soft pt-btn-block mt-3"
        onClick={() => void run("zip", () => portalInvoiceDocumentsZip(inv.invoice_id, zipName, lang))}
        disabled={busy === "zip"}
      >
        <Busy busy={busy === "zip"}>
          <ArchiveIcon size={20} />
        </Busy>
        {t("portal.bill.docs.all")}
      </button>

      <button
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded-[10px] py-2 text-sm font-semibold text-[var(--primary-ink)]"
        aria-expanded={showFiles}
        aria-controls={listId}
        onClick={() => setShowFiles((v) => !v)}
      >
        {showFiles ? t("portal.bill.docs.hide") : t("portal.bill.docs.show")}
        <ChevronDownIcon size={18} className={cn("transition-transform", showFiles && "rotate-180")} />
      </button>
      {showFiles ? (
        <ul id={listId} className="pt-rows">
          {docs.items.map((doc) => (
            <li key={doc.doc_id} className="flex items-center gap-3 py-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-[var(--pt-soft)] text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
                {doc.ext}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{doc.name}</span>
                {doc.label ? <span className="block truncate text-xs text-muted-foreground">{doc.label}</span> : null}
              </span>
              <button
                type="button"
                className="pt-icon-btn shrink-0 text-muted-foreground"
                aria-label={t("portal.bill.docs.downloadOne", { name: doc.name })}
                onClick={() => void run(doc.doc_id, () => portalInvoiceDocument(inv.invoice_id, doc.doc_id, `${doc.name}.${doc.ext}`))}
                disabled={busy === doc.doc_id}
              >
                <Busy busy={busy === doc.doc_id}>
                  <DownloadIcon size={20} />
                </Busy>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TotalLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong ? "text-base font-bold text-foreground" : "text-muted-foreground")}>
      <span>{label}</span>
      <span className="pt-num text-foreground">{value}</span>
    </div>
  );
}

/* ── "I've paid" — three steps ──────────────────────────────────────────── */

type Method = PaymentProof["method"];
const METHODS: { value: Method; icon: React.ReactNode }[] = [
  { value: "BANK", icon: <BankIcon size={20} /> },
  { value: "MOBILE_MONEY", icon: <PhoneIcon size={20} /> },
  { value: "CASH", icon: <CashIcon size={20} /> },
  { value: "CHEQUE", icon: <ChequeIcon size={20} /> },
];
/** Names on a phone's screen, not words to translate. */
const WALLETS = ["MTN MoMo", "Orange Money"];

const grouped = (n: number) => n.toLocaleString(currentLocale(), { maximumFractionDigits: 2 });

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function PaySheet({
  open,
  billing,
  preselect,
  onClose,
  onDone,
}: {
  open: boolean;
  billing: PortalBilling;
  preselect: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const payable = billing.invoices.filter((i) => ["DUE", "OVERDUE", "PART_PAID"].includes(i.state));
  const [step, setStep] = React.useState(0);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [amount, setAmount] = React.useState("");
  const [amountTouched, setAmountTouched] = React.useState(false);
  const [amountFocus, setAmountFocus] = React.useState(false);
  const [method, setMethod] = React.useState<Method | null>(null);
  const [provider, setProvider] = React.useState("");
  const [when, setWhen] = React.useState<"today" | "yesterday" | "other">("today");
  const [otherDay, setOtherDay] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [file, setFile] = React.useState<Picked | null>(null);
  const [note, setNote] = React.useState("");
  const [pct, setPct] = React.useState(0);
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setPicked(preselect.filter((id) => payable.some((i) => i.invoice_id === id)));
    setAmountTouched(false);
    setMethod(null);
    setProvider("");
    setWhen("today");
    setOtherDay("");
    setReference("");
    setFile(null);
    setNote("");
    setPct(0);
    setState("idle");
    setError(null);
    // Only on opening: `payable` is derived fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselect]);

  const chosen = payable.filter((i) => picked.includes(i.invoice_id));
  const currency = chosen[0]?.currency || payable[0]?.currency || billing.totals[0]?.currency || "XAF";
  const sum = Math.round(chosen.reduce((s, i) => s + i.outstanding, 0) * 100) / 100;

  // The amount follows the invoices picked until the person types their own.
  React.useEffect(() => {
    if (!amountTouched) setAmount(sum ? String(sum) : "");
  }, [sum, amountTouched]);

  const paid = parseAmount(amount);
  const paidOn = when === "today" ? isoDay(0) : when === "yesterday" ? isoDay(-1) : otherDay;
  const mixed = new Set(chosen.map((i) => i.currency)).size > 1;

  const canNext = [
    paid > 0 && !mixed,
    !!method && !!paidOn && (method !== "MOBILE_MONEY" || !!provider.trim()),
    !!file,
  ][step];

  function toggle(id: string) {
    const inv = payable.find((i) => i.invoice_id === id);
    setPicked((l) => {
      if (l.includes(id)) return l.filter((x) => x !== id);
      // One proof, one currency: picking a different currency starts over.
      const others = payable.filter((i) => l.includes(i.invoice_id));
      return others.length && inv && others[0].currency !== inv.currency ? [id] : [...l, id];
    });
  }

  async function submit() {
    if (!file || !method) return;
    setError(null);
    setState("sending");
    // Spread the amount over the invoices in the order they fall due, so a
    // part-payment settles the oldest first — what finance would do anyway.
    let left = paid;
    const allocations = [...chosen]
      .sort((a, b) => String(a.payment_due_on || "").localeCompare(String(b.payment_due_on || "")))
      .map((i) => {
        const a = Math.min(left, i.outstanding);
        left = Math.round((left - a) * 100) / 100;
        return { invoice_id: i.invoice_id, amount: Math.round(a * 100) / 100 };
      })
      .filter((a) => a.amount > 0);
    try {
      await portalSubmitProof(
        {
          amount: paid,
          currency,
          method,
          provider: method === "MOBILE_MONEY" ? provider.trim() : null,
          paid_on: paidOn,
          reference: reference.trim() || null,
          note: note.trim() || null,
          dossier_id: chosen.length === 1 ? chosen[0].dossier_id : null,
          allocations,
        },
        file.file,
        setPct,
      );
      setState("done");
      toast(t("portal.pay.sent"));
      window.setTimeout(() => {
        onDone();
        onClose();
      }, 900);
    } catch (e) {
      setError(errorText(e));
      setState("idle");
    }
  }

  const titles = [t("portal.pay.step1"), t("portal.pay.step2"), t("portal.pay.step3")];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={titles[step]}
      footer={
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={state !== "idle"}>
              {t("portal.common.back")}
            </button>
          ) : null}
          <button
            type="button"
            className="pt-btn pt-btn-primary flex-1"
            disabled={!canNext || state !== "idle"}
            onClick={() => (step < 2 ? setStep((s) => s + 1) : void submit())}
          >
            <Busy busy={state === "sending"}>{step === 2 ? <CheckIcon size={20} /> : null}</Busy>
            {step < 2 ? t("portal.common.next") : t("portal.pay.send")}
            {step < 2 ? <ChevronRightIcon size={20} /> : null}
          </button>
        </div>
      }
    >
      <StepDots count={3} at={step} label={t("portal.pay.progress", { step: step + 1, total: 3 })} />

      {step === 0 ? (
        <div className="mt-5">
          {payable.length ? (
            <>
              <p className="pt-label">{t("portal.pay.which")}</p>
              <div className="grid gap-2">
                {payable.map((i) => {
                  const on = picked.includes(i.invoice_id);
                  return (
                    <button
                      key={i.invoice_id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(i.invoice_id)}
                      className={cn("pt-chip !h-auto justify-between !py-3 text-left", on && "!border-[var(--primary)]")}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--pt-line-strong)]")}>
                          {on ? <CheckIcon size={14} /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="pt-mono block truncate text-sm font-bold">{i.doc_number}</span>
                          <span className="block text-xs text-muted-foreground">{i.dossier_ref || relDayTitle(i.payment_due_on)}</span>
                        </span>
                      </span>
                      <span className="pt-num shrink-0 text-sm font-bold">{money(i.outstanding, i.currency)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          <div className="mt-5">
            <label htmlFor="pt-pay-amount" className="pt-label">
              {t("portal.pay.amount")}
            </label>
            <div className="relative">
              <input
                id="pt-pay-amount"
                className="pt-field pt-num pr-20 !text-[1.35rem] !font-bold"
                inputMode="decimal"
                // Grouped while it is read ("3,270,500"), raw while it is typed.
                value={amountFocus || !(paid > 0) ? amount : grouped(paid)}
                onFocus={() => setAmountFocus(true)}
                onBlur={() => setAmountFocus(false)}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmount(e.target.value.replace(/[^\d.,]/g, ""));
                }}
                aria-invalid={(amount !== "" && !(paid > 0)) || undefined}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">{currency}</span>
            </div>
            {mixed ? <p className="mt-2 text-sm text-[rgb(var(--bad))]">{t("portal.pay.oneCurrency")}</p> : null}
            {paid > sum && sum > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("portal.pay.moreThanPicked")}</p> : null}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-5">
          <p className="pt-label">{t("portal.pay.how")}</p>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button key={m.value} type="button" className="pt-chip !h-14 justify-start" aria-pressed={method === m.value} onClick={() => setMethod(m.value)}>
                <span className="text-primary-ink">{m.icon}</span>
                {t(`portal.pay.method.${m.value}`)}
              </button>
            ))}
          </div>

          {method === "MOBILE_MONEY" ? (
            <div className="mt-4">
              <p className="pt-label">{t("portal.pay.wallet")}</p>
              <div className="flex flex-wrap gap-2">
                {WALLETS.map((w) => (
                  <button key={w} type="button" className="pt-chip" aria-pressed={provider === w} onClick={() => setProvider(w)}>
                    {w}
                  </button>
                ))}
                <input
                  className="pt-field !min-h-[44px] w-40 !py-2"
                  placeholder={t("portal.pay.otherWallet")}
                  aria-label={t("portal.pay.otherWallet")}
                  value={WALLETS.includes(provider) ? "" : provider}
                  onChange={(e) => setProvider(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {method === "BANK" && billing.how_to_pay ? (
            <details className="mt-4 rounded-[16px] bg-[var(--pt-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-primary-ink">{t("portal.bill.howToPay")}</summary>
              <div className="mt-2">
                <CopyRow label={t("portal.bill.account")} value={billing.how_to_pay.account_number} />
                <CopyRow label={t("portal.bill.iban")} value={billing.how_to_pay.iban} />
              </div>
            </details>
          ) : null}

          <p className="pt-label mt-5">{t("portal.pay.when")}</p>
          <div className="flex flex-wrap gap-2">
            {(["today", "yesterday", "other"] as const).map((w) => (
              <button key={w} type="button" className="pt-chip" aria-pressed={when === w} onClick={() => setWhen(w)}>
                {t(`portal.pay.day.${w}`)}
              </button>
            ))}
          </div>
          {when === "other" ? (
            <DateField
              className="mt-3"
              inputClassName="pt-field"
              value={otherDay}
              onChange={setOtherDay}
              max={isoDay(0)}
              placeholder={t("portal.common.datePlaceholder")}
              calendarLabel={t("portal.common.calendar")}
              aria-label={t("portal.pay.when")}
            />
          ) : null}

          <TextField
            className="mt-5"
            label={method === "MOBILE_MONEY" ? t("portal.pay.txId") : method === "CHEQUE" ? t("portal.pay.chequeNo") : t("portal.pay.reference")}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-5">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-[16px] bg-[var(--pt-soft)] p-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{method ? t(`portal.pay.method.${method}`) : ""}</p>
              <p className="pt-num truncate text-lg font-bold text-foreground">{money(paid, currency)}</p>
            </div>
            <Pill plain>{relDayTitle(paidOn, 2)}</Pill>
          </div>
          <FileChooser value={file} onChange={setFile} disabled={state !== "idle"} compact />
          {file ? (
            <TextArea
              className="mt-4"
              label={t("portal.pay.note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              disabled={state !== "idle"}
            />
          ) : null}
          {state !== "idle" ? (
            <div className="mt-4">
              <UploadProgress pct={pct} done={state === "done"} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
