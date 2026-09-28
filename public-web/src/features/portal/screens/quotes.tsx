/**
 * Quotes — asking for a price, and seeing where each request stands.
 *
 * Asking is a three-step sheet, one decision per screen: HOW it moves, WHERE
 * from and to, WHAT it is. Everything that can be a tap is a chip; the only
 * typing is the two places and a line about the cargo — and "Same as last
 * time" fills the route from their previous request.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { portalQuoteRequests, portalCreateQuote, type PortalQuoteRequest, type Mode } from "@/lib/portal-api";
import { num } from "@/lib/format";
import { usePageChrome, PageHeader } from "../shell/portal-shell";
import { Sheet, Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, TextField, TextArea, StepDots, useLoad, useToast, errorText, Busy, type Tone } from "../ui/kit";
import { QuoteIcon, PlusIcon, ArrowRightIcon, ChevronRightIcon, CheckIcon, RefreshIcon } from "../ui/icons";
import { relDayTitle } from "../lib/when";
import { parseAmount } from "../lib/numbers";
import { ModeIcon } from "./shipment-parts";

const MODES: Mode[] = ["SEA", "AIR", "ROAD", "CUSTOMS", "STORAGE", "OTHER"];
const DIRECTIONS = ["IMPORT", "EXPORT", "LOCAL"] as const;
const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"];

const STATUS_TONE: Record<string, Tone> = {
  RECEIVED: "info",
  UNDER_REVIEW: "brand",
  CLARIFICATION_REQUIRED: "warn",
  QUOTED: "ok",
  CONVERTED_TO_OPPORTUNITY: "ok",
  CLOSED_NO_ACTION: "mute",
};

/** The mode a request was filed under, read back from its category words. */
function modeOf(q: PortalQuoteRequest): Mode {
  const k = `${q.service_category || ""} ${q.service_type || ""}`.toUpperCase();
  if (/AIR|AÉRIEN|AERIEN/.test(k)) return "AIR";
  if (/SEA|MARITIME|OCEAN|MER/.test(k)) return "SEA";
  if (/ROAD|ROUTIER|TRUCK/.test(k)) return "ROAD";
  if (/CUSTOMS|DOUANE|DÉDOUANEMENT/.test(k)) return "CUSTOMS";
  if (/STORAGE|ENTREPOSAGE|WAREHOUSE/.test(k)) return "STORAGE";
  return "OTHER";
}

export function QuotesPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const [params, setParams] = useSearchParams();
  const list = useLoad(portalQuoteRequests, "quotes");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (params.get("new") !== "1") return;
    setOpen(true);
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);

  return (
    <div>
      <PageHeader
        title={t("portal.nav.quotes")}
        action={
          <button type="button" className="pt-btn pt-btn-primary pt-btn-sm sm:!min-h-[44px] sm:!px-5 sm:!text-[0.9375rem]" onClick={() => setOpen(true)}>
            <PlusIcon size={18} />
            {t("portal.quote.new")}
          </button>
        }
      />
      {list.error && !list.data ? <ErrorCard message={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <SkeletonCards count={3} /> : null}
      {list.data ? (
        list.data.length ? (
          <div className="pt-card pt-rows overflow-hidden">
            {list.data.map((q) => (
              <div key={q.quote_request_id} className="pt-row">
                <IconDisc tone={STATUS_TONE[q.status] || "brand"}>
                  <ModeIcon mode={modeOf(q)} />
                </IconDisc>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-[0.95rem] font-semibold text-foreground">
                    <span className="truncate">{q.origin_location || "—"}</span>
                    <ArrowRightIcon size={16} className="text-muted-foreground" />
                    <span className="truncate">{q.destination_location || "—"}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={STATUS_TONE[q.status] || "mute"}>{t(`portal.quote.status.${q.status}`, { defaultValue: q.status })}</Pill>
                    {q.public_ref ? (
                      <Pill plain>
                        <span className="pt-mono">{q.public_ref}</span>
                      </Pill>
                    ) : null}
                    <Pill plain>{relDayTitle(q.created_at, 6)}</Pill>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pt-card">
            <EmptyState
              icon={<QuoteIcon size={28} />}
              title={t("portal.quote.none")}
              action={
                <button type="button" className="pt-btn pt-btn-soft" onClick={() => setOpen(true)}>
                  <PlusIcon size={20} />
                  {t("portal.quote.request")}
                </button>
              }
            />
          </div>
        )
      ) : null}
      <QuoteSheet open={open} onClose={() => setOpen(false)} onDone={list.reload} last={list.data?.[0] || null} />
    </div>
  );
}

function QuoteSheet({ open, onClose, onDone, last }: { open: boolean; onClose: () => void; onDone: () => void; last: PortalQuoteRequest | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [direction, setDirection] = React.useState<(typeof DIRECTIONS)[number] | null>(null);
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [incoterm, setIncoterm] = React.useState<string | null>(null);
  const [cargo, setCargo] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setMode(null);
    setDirection(null);
    setOrigin("");
    setDestination("");
    setIncoterm(null);
    setCargo("");
    setWeight("");
    setError(null);
  }, [open]);

  const kg = parseAmount(weight);
  const canNext = [!!mode && !!direction, origin.trim().length > 1 && destination.trim().length > 1, cargo.trim().length > 2 && (!weight || kg >= 0)][step];

  async function submit() {
    if (!mode || !direction) return;
    setBusy(true);
    setError(null);
    try {
      await portalCreateQuote({
        service_category: `${t(`portal.mode.${mode}`)} · ${t(`portal.quote.dir.${direction}`)}`,
        origin_location: origin.trim(),
        destination_location: destination.trim(),
        cargo_description: cargo.trim(),
        ...(weight && Number.isFinite(kg) ? { estimated_weight: kg } : {}),
        ...(incoterm ? { incoterm } : {}),
      });
      toast(t("portal.quote.sent"));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const titles = [t("portal.quote.step1"), t("portal.quote.step2"), t("portal.quote.step3")];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={titles[step]}
      footer={
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              {t("portal.common.back")}
            </button>
          ) : null}
          <button type="button" className="pt-btn pt-btn-primary flex-1" disabled={!canNext || busy} onClick={() => (step < 2 ? setStep((s) => s + 1) : void submit())}>
            <Busy busy={busy}>{step === 2 ? <CheckIcon size={20} /> : null}</Busy>
            {step < 2 ? t("portal.common.next") : t("portal.quote.send")}
            {step < 2 ? <ChevronRightIcon size={20} /> : null}
          </button>
        </div>
      }
    >
      <StepDots count={3} at={step} label={t("portal.pay.progress", { step: step + 1, total: 3 })} />

      {step === 0 ? (
        <div className="mt-5">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button key={m} type="button" className="pt-chip !h-auto flex-col !gap-2 !px-2 !py-4" aria-pressed={mode === m} onClick={() => setMode(m)}>
                <span className="text-primary-ink">
                  <ModeIcon mode={m} size={26} />
                </span>
                <span className="text-center text-[0.8rem] leading-tight">{t(`portal.mode.${m}`)}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {DIRECTIONS.map((d) => (
              <button key={d} type="button" className="pt-chip" aria-pressed={direction === d} onClick={() => setDirection(d)}>
                {t(`portal.quote.dir.${d}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-5 grid gap-4">
          {last && (last.origin_location || last.destination_location) ? (
            <button
              type="button"
              className="pt-chip justify-start self-start"
              onClick={() => {
                setOrigin(last.origin_location || "");
                setDestination(last.destination_location || "");
              }}
            >
              <RefreshIcon size={16} />
              {t("portal.quote.sameAsLast")}
            </button>
          ) : null}
          <TextField label={t("portal.quote.from")} value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={120} placeholder={t("portal.quote.fromHint")} autoComplete="off" />
          <TextField label={t("portal.quote.to")} value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={120} placeholder={t("portal.quote.toHint")} autoComplete="off" />
          {mode === "SEA" || mode === "AIR" || mode === "ROAD" ? (
            <div>
              <p className="pt-label">{t("portal.quote.incoterm")}</p>
              <div className="flex flex-wrap gap-2">
                {INCOTERMS.map((i) => (
                  <button key={i} type="button" className="pt-chip pt-mono !min-h-[40px] !px-3.5" aria-pressed={incoterm === i} onClick={() => setIncoterm(incoterm === i ? null : i)}>
                    {i}
                  </button>
                ))}
                <button type="button" className="pt-chip !min-h-[40px] !px-3.5" aria-pressed={incoterm === null} onClick={() => setIncoterm(null)}>
                  {t("portal.quote.notSure")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-5 grid gap-4">
          <TextArea label={t("portal.quote.what")} value={cargo} onChange={(e) => setCargo(e.target.value)} rows={3} maxLength={2000} placeholder={t("portal.quote.whatHint")} />
          <div>
            <label htmlFor="pt-q-kg" className="pt-label">
              {t("portal.quote.weight")}
            </label>
            <div className="relative">
              <input id="pt-q-kg" className="pt-field pt-num pr-14" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.,\s]/g, ""))} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">kg</span>
            </div>
            {weight && Number.isFinite(kg) && kg >= 1000 ? <p className="pt-num mt-1.5 text-xs text-muted-foreground">≈ {num(Math.round(kg / 100) / 10)} t</p> : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-[rgb(var(--bad))]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
