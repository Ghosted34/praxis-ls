/**
 * Proposals — the offers the team sent, and the client's answer to each.
 *
 * A proposal opens as the document itself — what is included, the pricing,
 * the total — rendered from the same model as its PDF, so the screen and the
 * download can never disagree. Three answers sit under the thumb:
 *
 *   · DECLINE, with a reason from a short list (sales reads one vocabulary
 *     wherever a client said no) and a line of their own if they want;
 *   · ACCEPT AND SIGN — a code to the email on file, then a stamp with their
 *     name or a signature drawn with a finger. That is an e-signature the
 *     tenant's verification portal can answer for (the signature programme,
 *     doc/SIGNATURE_ENGINEERING_GUIDE.md), not a click that "counts as" one;
 *   · ACCEPT, confirmed, only where the tenant has not switched e-signature on.
 *
 * Once answered, the proposal says so — and who signed, when, with the code
 * anyone can verify it by.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalProposal,
  portalProposalPdf,
  portalProposalDecline,
  portalProposalAccept,
  portalProposalSignStart,
  portalProposalSignResend,
  portalProposalSignComplete,
  type ProposalSummary,
  type ProposalDetail,
  type SigningStart,
  type SignCard,
} from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { Sheet, Pill, IconDisc, TextField, TextArea, useLoad, useToast, errorText, Busy, Shimmer, ConfirmSheet, InfoButton, StepDots, type Tone } from "../ui/kit";
import { QuoteIcon, DownloadIcon, CheckIcon, CheckCircleIcon, CloseIcon, RouteIcon, ShieldIcon, MailIcon, RefreshIcon } from "../ui/icons";
import { CodeInput } from "../ui/code-input";
import { SignaturePad } from "../ui/signature-pad";

const TONE: Record<ProposalSummary["status"], Tone> = { SENT: "brand", ACCEPTED: "ok", REJECTED: "mute" };

export function ProposalRow({ p, onOpen }: { p: ProposalSummary; onOpen: (p: ProposalSummary) => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="pt-row" onClick={() => onOpen(p)}>
      <IconDisc tone={TONE[p.status]}>{p.status === "ACCEPTED" ? <CheckCircleIcon /> : <QuoteIcon />}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[0.95rem] font-bold text-foreground">{p.title}</span>
          <span className="pt-num shrink-0 text-[0.95rem] font-bold text-foreground">{money(p.total, p.currency)}</span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Pill tone={TONE[p.status]}>{t(`portal.prop.status.${p.status}`)}</Pill>
          {p.doc_number ? (
            <Pill plain>
              <span className="pt-mono">{p.doc_number}</span>
            </Pill>
          ) : null}
          {p.status === "SENT" && p.valid_until ? <Pill plain>{t("portal.prop.validUntil", { date: dateFmt(p.valid_until) })}</Pill> : null}
        </span>
      </span>
    </button>
  );
}

/** Expired: past its validity, and so no longer something to answer. */
const expired = (d: ProposalDetail["proposal"]) => !!d.valid_until && d.valid_until < new Date().toISOString().slice(0, 10);

export function ProposalSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const lang = getLang();
  const detail = useLoad(() => (id ? portalProposal(id, lang) : Promise.resolve(null)), id ? `prop:${id}:${lang}` : "none");
  const [downloading, setDownloading] = React.useState(false);
  const [signing, setSigning] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [accepting, setAccepting] = React.useState(false);
  const d = detail.data;
  const p = d?.proposal;
  const open = !!p && p.status === "SENT" && !expired(p);

  async function pdf() {
    if (!id || !p) return;
    setDownloading(true);
    try {
      await portalProposalPdf(id, `${p.doc_number || "proposal"}.pdf`, lang);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setDownloading(false);
    }
  }

  async function acceptPlain() {
    if (!id) return;
    setAccepting(true);
    try {
      await portalProposalAccept(id);
      toast(t("portal.prop.accepted"));
      setConfirming(false);
      detail.reload();
      onChanged();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setAccepting(false);
    }
  }

  const answered = () => {
    detail.reload();
    onChanged();
  };

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      full
      wide
      title={<span className="block truncate">{d?.presentation.title || t("portal.prop.proposal")}</span>}
      footer={
        p ? (
          open ? (
            <div className="grid grid-cols-[auto_auto_1fr] gap-2">
              <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setDeclining(true)}>
                {t("portal.prop.decline")}
              </button>
              <button type="button" className="pt-btn pt-btn-outline !px-4" onClick={() => void pdf()} disabled={downloading} aria-label={t("portal.common.pdf")}>
                <Busy busy={downloading}>
                  <DownloadIcon size={20} />
                </Busy>
              </button>
              <button type="button" className="pt-btn pt-btn-primary" onClick={() => (d?.signing.available ? setSigning(true) : setConfirming(true))}>
                <CheckIcon size={20} />
                {d?.signing.available ? t("portal.prop.acceptSign") : t("portal.prop.accept")}
              </button>
            </div>
          ) : (
            <button type="button" className="pt-btn pt-btn-outline pt-btn-block" onClick={() => void pdf()} disabled={downloading}>
              <Busy busy={downloading}>
                <DownloadIcon size={20} />
              </Busy>
              {t("portal.common.pdf")}
            </button>
          )
        ) : null
      }
    >
      {detail.error && !d ? <p className="mt-2 text-sm text-[rgb(var(--bad))]">{detail.error}</p> : null}
      {!d && !detail.error ? (
        <div className="grid gap-3 pt-2" aria-hidden="true">
          <Shimmer className="h-6 w-2/5" />
          <Shimmer className="h-12 w-3/5" />
          <Shimmer className="h-32" />
        </div>
      ) : null}
      {d && p ? (
        <div className="pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={p.status === "SENT" && expired(p) ? "mute" : TONE[p.status]}>
              {p.status === "SENT" && expired(p) ? t("portal.prop.expired") : t(`portal.prop.status.${p.status}`)}
            </Pill>
            {p.doc_number ? (
              <Pill plain>
                <span className="pt-mono">{p.doc_number}</span>
              </Pill>
            ) : null}
            {p.status === "SENT" && p.valid_until && !expired(p) ? <Pill plain>{t("portal.prop.validUntil", { date: dateFmt(p.valid_until) })}</Pill> : null}
          </div>
          <p className="mt-4 text-sm font-semibold text-muted-foreground">{t("portal.prop.total")}</p>
          <p className="pt-display pt-num text-[2.2rem]">{money(p.total, p.currency)}</p>
          {d.presentation.route ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <RouteIcon size={16} className="text-muted-foreground" />
              {d.presentation.route}
            </p>
          ) : null}

          {d.signature ? <SignedCard sig={d.signature} /> : null}

          {d.presentation.sections.length ? (
            <div className="mt-6 grid gap-4">
              {d.presentation.sections.map((s) => (
                <section key={s.key} className="rounded-[18px] bg-[var(--pt-soft)] p-4">
                  <h3 className="text-[0.95rem] font-bold text-foreground">{s.title}</h3>
                  <p className="mt-1.5 whitespace-pre-line text-[0.95rem] leading-relaxed text-muted-foreground">{s.body}</p>
                </section>
              ))}
            </div>
          ) : null}

          {d.presentation.lines.length ? (
            <>
              <p className="pt-section-title mt-6">{t("portal.prop.pricing")}</p>
              <ul className="pt-rows mt-2">
                {d.presentation.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-2.5">
                    <span className="min-w-0 text-sm text-foreground">
                      {l.label}
                      {l.quantity !== 1 ? (
                        <span className="pt-num ml-1.5 text-xs text-muted-foreground">
                          {l.quantity} × {l.unit_price_display}
                        </span>
                      ) : null}
                    </span>
                    <span className="pt-num shrink-0 text-sm font-semibold text-foreground">{l.total_display}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between rounded-[16px] bg-[var(--pt-soft)] p-4 text-base font-bold text-foreground">
                <span>{d.presentation.labels.total}</span>
                <span className="pt-num">{money(p.total, p.currency)}</span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {d && id ? (
        <>
          <SignSheet
            open={signing}
            id={id}
            cards={d.signing.cards}
            title={d.presentation.title}
            onClose={() => setSigning(false)}
            onDone={() => {
              setSigning(false);
              toast(t("portal.prop.accepted"));
              answered();
            }}
          />
          <DeclineSheet
            open={declining}
            id={id}
            reasons={d.decline_reasons}
            onClose={() => setDeclining(false)}
            onDone={() => {
              setDeclining(false);
              toast(t("portal.prop.declined"));
              answered();
            }}
          />
          <ConfirmSheet
            open={confirming}
            title={t("portal.prop.acceptTitle")}
            body={t("portal.prop.acceptBody")}
            confirmLabel={t("portal.prop.accept")}
            busy={accepting}
            onConfirm={() => void acceptPlain()}
            onClose={() => setConfirming(false)}
          />
        </>
      ) : null}
    </Sheet>
  );
}

/** "Signed by Marie Nguema, Finance · 28/09/2026", and the code that verifies it. */
function SignedCard({ sig }: { sig: NonNullable<ProposalDetail["signature"]> }) {
  const { t } = useTranslation();
  const code = sig.verify_code ? sig.verify_code.replace(/^(.{4})(.{4})$/, "$1-$2") : null;
  return (
    <div className="mt-5 flex items-start gap-3 rounded-[18px] border border-[var(--pt-line)] p-4">
      <IconDisc tone="ok" size={40}>
        <ShieldIcon size={20} />
      </IconDisc>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-foreground">{t("portal.prop.sign.signedBy", { name: sig.signer_name })}</p>
        <p className="truncate text-sm text-muted-foreground">{[sig.signer_role, dateFmt(sig.signed_at)].filter(Boolean).join(" · ")}</p>
        {code ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span>{t("portal.prop.sign.verify")}</span>
            <span className="pt-mono font-semibold text-foreground">{code}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── accept and sign ─────────────────────────────────────────────────────── */

/**
 * Two steps. The code first — sent the moment the sheet opens, to the email
 * on file, and shown masked — then the mark: a stamp with the name and role
 * the signer types, or a signature drawn with a finger. One request signs and
 * accepts; a wrong code comes back to step one with the reason.
 */
function SignSheet({
  open,
  id,
  cards,
  title,
  onClose,
  onDone,
}: {
  open: boolean;
  id: string;
  cards: SignCard[];
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const portal = usePortal();
  const lang = getLang();
  const [step, setStep] = React.useState(0);
  const [start, setStart] = React.useState<SigningStart | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [card, setCard] = React.useState<SignCard["preset_code"]>("STAMP");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [mark, setMark] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const begin = React.useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const s = await portalProposalSignStart(id, lang);
      setStart(s);
      const first = (s.cards.length ? s.cards : cards)[0];
      if (first) setCard(first.preset_code);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }, [id, lang, cards]);

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setCode("");
    setMark(null);
    setError(null);
    setName(portal.me.portal_user.full_name || "");
    setRole("");
    void begin();
  }, [open, begin, portal.me.portal_user.full_name]);

  async function resend() {
    setError(null);
    try {
      const r = await portalProposalSignResend(id, lang);
      setStart((s) => (s ? { ...s, otp: r.otp } : s));
      toast(t("portal.prop.sign.resent"));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await portalProposalSignComplete(id, lang, {
        code,
        preset_code: card,
        full_name: name.trim() || undefined,
        party_role: role.trim() || undefined,
        ...(card === "DRAWN" && mark ? { mark_image_b64: mark } : {}),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
      // A code problem is fixed on the code step.
      const c = (e as { code?: string }).code || "";
      if (/^OTP_/.test(c)) {
        setCode("");
        setStep(0);
      }
    } finally {
      setBusy(false);
    }
  }

  const offer = start?.cards.length ? start.cards : cards;
  const ready = step === 0 ? code.length === 6 && !!start : !!name.trim() && (card !== "DRAWN" || !!mark);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      title={step === 0 ? t("portal.prop.sign.step1") : t("portal.prop.sign.step2")}
      footer={
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setStep(0)} disabled={busy}>
              {t("portal.common.back")}
            </button>
          ) : null}
          <button type="button" className="pt-btn pt-btn-primary flex-1" disabled={!ready || busy || starting} onClick={() => (step === 0 ? setStep(1) : void sign())}>
            <Busy busy={busy}>{step === 1 ? <CheckIcon size={20} /> : null}</Busy>
            {step === 0 ? t("portal.common.next") : t("portal.prop.sign.submit")}
          </button>
        </div>
      }
    >
      <StepDots count={2} at={step} label={t("portal.pay.progress", { step: step + 1, total: 2 })} />
      <p className="mt-4 truncate text-sm font-semibold text-muted-foreground">{title}</p>

      {step === 0 ? (
        <div className="mt-4">
          {starting && !start ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("portal.prop.sign.sending")}
            </p>
          ) : start ? (
            <div className="flex items-start gap-3">
              <IconDisc tone="brand" size={40}>
                <MailIcon size={20} />
              </IconDisc>
              <p className="min-w-0 text-[0.95rem] text-foreground">{t("portal.prop.sign.sentTo", { email: start.signer.email_masked })}</p>
            </div>
          ) : null}
          {start ? (
            <>
              <CodeInput value={code} onChange={setCode} disabled={busy} label={t("portal.prop.sign.codeLabel")} />
              <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm mt-3" onClick={() => void resend()}>
                <RefreshIcon size={16} />
                {t("portal.prop.sign.resend")}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {offer.length > 1 ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("portal.prop.sign.how")}>
              {offer.map((c) => (
                <button key={c.preset_code} type="button" className="pt-chip !h-auto flex-col !gap-1 !py-3" aria-pressed={card === c.preset_code} onClick={() => setCard(c.preset_code)}>
                  <span className="text-sm font-semibold">{t(`portal.prop.sign.card.${c.preset_code}`)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <TextField label={t("portal.prop.sign.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" />
          <TextField label={t("portal.prop.sign.role")} value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} placeholder={t("portal.prop.sign.rolePlaceholder")} autoComplete="organization-title" />
          {card === "DRAWN" ? (
            <div>
              <p className="pt-label">{t("portal.prop.sign.draw")}</p>
              <SignaturePad onChange={setMark} label={t("portal.prop.sign.draw")} />
            </div>
          ) : (
            <div className="pt-sign-stamp" aria-hidden="true">
              <span className="block text-[1.05rem] font-bold text-foreground">{name.trim() || "—"}</span>
              {role.trim() ? <span className="block text-sm text-muted-foreground">{role.trim()}</span> : null}
              <span className="pt-num mt-1 block text-xs text-muted-foreground">{dateFmt(new Date())}</span>
            </div>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{t("portal.prop.sign.agree")}</span>
            <InfoButton title={t("portal.prop.sign.aboutTitle")} label={t("portal.prop.sign.aboutTitle")}>
              <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{t("portal.prop.sign.about")}</p>
            </InfoButton>
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

/* ── decline ─────────────────────────────────────────────────────────────── */

function DeclineSheet({
  open,
  id,
  reasons,
  onClose,
  onDone,
}: {
  open: boolean;
  id: string;
  reasons: ProposalDetail["decline_reasons"];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    setError(null);
  }, [open]);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await portalProposalDecline(id, reason, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("portal.prop.declineTitle")}
      footer={
        <button type="button" className="pt-btn pt-btn-danger pt-btn-block" disabled={!reason || busy} onClick={() => void send()}>
          <Busy busy={busy}>
            <CloseIcon size={20} />
          </Busy>
          {t("portal.prop.declineSend")}
        </button>
      }
    >
      <div className="grid gap-2">
        {reasons.map((r) => (
          <button key={r.reason_code} type="button" className={cn("pt-chip justify-start")} aria-pressed={reason === r.reason_code} onClick={() => setReason(r.reason_code)}>
            {r.label}
          </button>
        ))}
      </div>
      <TextArea className="mt-4" label={t("portal.prop.declineNote")} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} />
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
