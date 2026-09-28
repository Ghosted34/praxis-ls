/**
 * Quotes — asking for a price, seeing where each request stands, and
 * answering the proposals the team sends back.
 *
 * Asking is a three-step sheet, one decision per screen: HOW it moves, WHERE
 * from and to, WHAT it is. Everything that can be a tap is a chip, and the
 * typing is optional three ways over (owner decision: prefill + AI fill):
 *
 *   · "Describe it in your own words" — one line, the way they would say it on
 *     the phone, and the three steps come back filled (portal_quote_fill);
 *   · "Same as last time" — their previous request, every field of it;
 *   · "Like PRX-…" — one of their shipments on the move, as the starting point.
 *
 * Whatever filled it, the client walks the steps and sends it themselves.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  portalQuoteRequests,
  portalCreateQuote,
  portalQuoteFill,
  portalProposals,
  type PortalQuoteRequest,
  type ProposalSummary,
  type ShipmentCard,
  type Mode,
} from "@/lib/portal-api";
import { num } from "@/lib/format";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import { Sheet, Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, TextField, TextArea, StepDots, Seg, useLoad, useToast, errorText, Busy, type Tone, type Load } from "../ui/kit";
import { QuoteIcon, PlusIcon, ArrowRightIcon, ChevronRightIcon, CheckIcon, RefreshIcon, SparkIcon, ShipIcon } from "../ui/icons";
import { relDayTitle } from "../lib/when";
import { parseAmount } from "../lib/numbers";
import { ModeIcon } from "./shipment-parts";
import { ProposalRow, ProposalSheet } from "./proposals";

const MODES: Mode[] = ["SEA", "AIR", "ROAD", "CUSTOMS", "STORAGE", "OTHER"];
const DIRECTIONS = ["IMPORT", "EXPORT", "LOCAL"] as const;
type Direction = (typeof DIRECTIONS)[number];
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

/** And its direction — the category reads "Sea freight · Import". */
function directionOf(q: PortalQuoteRequest): Direction | null {
  const k = String(q.service_category || "").toUpperCase();
  if (/IMPORT/.test(k)) return "IMPORT";
  if (/EXPORT/.test(k)) return "EXPORT";
  if (/LOCAL/.test(k)) return "LOCAL";
  return null;
}

type Tab = "requests" | "proposals";

export function QuotesPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const summary = useSummary();
  const [params, setParams] = useSearchParams();
  const list = useLoad(portalQuoteRequests, "quotes");
  const offers = useLoad(portalProposals, "proposals");
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>(params.get("tab") === "proposals" ? "proposals" : "requests");
  const [proposal, setProposal] = React.useState<string | null>(null);

  // Deep links: "?new=1" from Home, "?tab=proposals" and "?proposal=<id>" from
  // Home's "waiting for your answer" and from the email that announced it.
  React.useEffect(() => {
    let changed = false;
    if (params.get("new") === "1") {
      setOpen(true);
      params.delete("new");
      changed = true;
    }
    const wanted = params.get("proposal");
    if (wanted) {
      setTab("proposals");
      setProposal(wanted);
      params.delete("proposal");
      changed = true;
    }
    if (params.get("tab")) {
      params.delete("tab");
      changed = true;
    }
    if (changed) setParams(params, { replace: true });
  }, [params, setParams]);

  const pending = (offers.data || []).filter((p) => p.status === "SENT").length;

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

      {(offers.data || []).length ? (
        <div className="mb-4">
          <Seg<Tab>
            label={t("portal.nav.quotes")}
            value={tab}
            onChange={setTab}
            items={[
              { value: "requests", label: t("portal.quote.tab.requests") },
              { value: "proposals", label: t("portal.quote.tab.proposals"), count: pending },
            ]}
          />
        </div>
      ) : null}

      {tab === "proposals" && (offers.data || []).length ? (
        <ProposalsList items={offers.data || []} onOpen={(p) => setProposal(p.proposal_id)} />
      ) : (
        <RequestsList list={list} onNew={() => setOpen(true)} />
      )}

      <QuoteSheet open={open} onClose={() => setOpen(false)} onDone={list.reload} last={list.data?.[0] || null} ships={summary?.data?.shipments?.items || []} />
      <ProposalSheet
        id={proposal}
        onClose={() => setProposal(null)}
        onChanged={() => {
          offers.reload();
          summary?.reload();
        }}
      />
    </div>
  );
}

function ProposalsList({ items, onOpen }: { items: ProposalSummary[]; onOpen: (p: ProposalSummary) => void }) {
  return (
    <div className="pt-card pt-rows overflow-hidden">
      {items.map((p) => (
        <ProposalRow key={p.proposal_id} p={p} onOpen={onOpen} />
      ))}
    </div>
  );
}

function RequestsList({ list, onNew }: { list: Load<PortalQuoteRequest[]>; onNew: () => void }) {
  const { t } = useTranslation();
  return (
    <>
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
                <button type="button" className="pt-btn pt-btn-soft" onClick={onNew}>
                  <PlusIcon size={20} />
                  {t("portal.quote.request")}
                </button>
              }
            />
          </div>
        )
      ) : null}
    </>
  );
}

function QuoteSheet({
  open,
  onClose,
  onDone,
  last,
  ships,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  last: PortalQuoteRequest | null;
  ships: ShipmentCard[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const portal = usePortal();
  const [step, setStep] = React.useState(0);
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [direction, setDirection] = React.useState<Direction | null>(null);
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [incoterm, setIncoterm] = React.useState<string | null>(null);
  const [cargo, setCargo] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [describing, setDescribing] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [filling, setFilling] = React.useState(false);
  const [filled, setFilled] = React.useState(false);

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
    setDescribing(false);
    setDescription("");
    setFilled(false);
  }, [open]);

  const kg = parseAmount(weight);
  const canNext = [!!mode && !!direction, origin.trim().length > 1 && destination.trim().length > 1, cargo.trim().length > 2 && (!weight || kg >= 0)][step];

  /** The last request, every field of it. */
  function sameAsLast() {
    if (!last) return;
    setMode(modeOf(last));
    const dir = directionOf(last);
    if (dir) setDirection(dir);
    setOrigin(last.origin_location || "");
    setDestination(last.destination_location || "");
    if (last.cargo_description) setCargo(last.cargo_description);
    if (last.estimated_weight) setWeight(String(last.estimated_weight));
    setFilled(true);
  }

  /** One of their shipments as the starting point. */
  function like(s: ShipmentCard) {
    if (MODES.includes(s.mode as Mode)) setMode(s.mode as Mode);
    setOrigin(s.origin || "");
    setDestination(s.destination || "");
    if (s.title) setCargo(s.title);
    setFilled(true);
  }

  async function fill() {
    const text = description.trim();
    if (text.length < 3) return;
    setFilling(true);
    setError(null);
    try {
      const { fields } = await portalQuoteFill(text);
      if (fields.mode) setMode(fields.mode);
      if (fields.direction) setDirection(fields.direction);
      if (fields.origin) setOrigin(fields.origin);
      if (fields.destination) setDestination(fields.destination);
      if (fields.incoterm) setIncoterm(fields.incoterm);
      const what = [fields.containers, fields.cargo].filter(Boolean).join(" — ");
      if (what) setCargo(what.slice(0, 2000));
      if (fields.weight_kg) setWeight(String(fields.weight_kg));
      setFilled(true);
      setDescribing(false);
      toast(t("portal.quote.filled"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFilling(false);
    }
  }

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
  // A term the fill read that the chips do not carry is still offered, selected.
  const terms = incoterm && !INCOTERMS.includes(incoterm) ? [...INCOTERMS, incoterm] : INCOTERMS;
  const starters = portal.canOps ? ships.slice(0, 3) : [];

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
      <div className="flex items-center justify-between gap-3">
        <StepDots count={3} at={step} label={t("portal.pay.progress", { step: step + 1, total: 3 })} />
        {filled ? (
          <Pill tone="brand">
            <SparkIcon size={13} />
            {t("portal.quote.filledPill")}
          </Pill>
        ) : null}
      </div>

      {step === 0 ? (
        <div className="mt-5">
          {/* ── the three ways not to type ── */}
          {describing ? (
            <div className="pt-card grid gap-3 p-4">
              <TextArea
                label={t("portal.quote.describe")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t("portal.quote.describeHint")}
                autoFocus
              />
              <button type="button" className="pt-btn pt-btn-primary" onClick={() => void fill()} disabled={filling || description.trim().length < 3}>
                <Busy busy={filling}>
                  <SparkIcon size={20} />
                </Busy>
                {filling ? t("portal.quote.filling") : t("portal.quote.fill")}
              </button>
            </div>
          ) : (
            <button type="button" className="pt-card pt-card-press flex w-full items-center gap-3 p-4 text-left" onClick={() => setDescribing(true)}>
              <IconDisc tone="brand" size={44}>
                <SparkIcon size={22} />
              </IconDisc>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-bold text-foreground">{t("portal.quote.describe")}</span>
                <span className="block truncate text-sm text-muted-foreground">{t("portal.quote.describeHint")}</span>
              </span>
              <ChevronRightIcon size={18} className="text-muted-foreground" />
            </button>
          )}

          {last || starters.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {last ? (
                <button type="button" className="pt-chip" onClick={sameAsLast}>
                  <RefreshIcon size={16} />
                  {t("portal.quote.sameAsLast")}
                </button>
              ) : null}
              {starters.map((s) => (
                <button key={s.dossier_id} type="button" className="pt-chip" onClick={() => like(s)}>
                  <ShipIcon size={16} />
                  {t("portal.quote.likeShipment", { ref: s.ref })}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-3 gap-2">
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
          <TextField label={t("portal.quote.from")} value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={120} placeholder={t("portal.quote.fromHint")} autoComplete="off" />
          <TextField label={t("portal.quote.to")} value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={120} placeholder={t("portal.quote.toHint")} autoComplete="off" />
          {mode === "SEA" || mode === "AIR" || mode === "ROAD" ? (
            <div>
              <p className="pt-label">{t("portal.quote.incoterm")}</p>
              <div className="flex flex-wrap gap-2">
                {terms.map((i) => (
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
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
