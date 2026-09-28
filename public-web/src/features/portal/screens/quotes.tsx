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
  type PortalPlace,
  type ProposalSummary,
  type ShipmentCard,
  type Mode,
  type PlaceKind,
} from "@/lib/portal-api";
import { num } from "@/lib/format";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import { Sheet, Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, TextArea, StepDots, Seg, useLoad, useToast, errorText, Busy, type Tone, type Load } from "../ui/kit";
import { QuoteIcon, PlusIcon, ArrowRightIcon, ChevronRightIcon, CheckIcon, RefreshIcon, SparkIcon, ShipIcon, CloseIcon, PinIcon } from "../ui/icons";
import { PlaceField, EMPTY_PLACE, placeValue, typedValue, pinExact, type PlaceValue } from "../ui/place-picker";
import { relDayTitle } from "../lib/when";
import { parseAmount } from "../lib/numbers";
import { ModeIcon } from "./shipment-parts";
import { ProposalRow, ProposalSheet } from "./proposals";

const MODES: Mode[] = ["SEA", "AIR", "ROAD", "CUSTOMS", "STORAGE", "OTHER"];
const DIRECTIONS = ["IMPORT", "EXPORT", "LOCAL"] as const;
type Direction = (typeof DIRECTIONS)[number];
const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"];

/* ── the route step, per mode ────────────────────────────────────────────── */

/**
 * What the route step asks, and what each end may be.
 *
 * The same engine as the desk's operations file, which asks an air file for
 * an ORIGIN AIRPORT and a sea file for a PORT OF LOADING, and asks both for a
 * place of collection and a place of delivery. A quote asks the same four
 * questions, because a client who has not shipped yet usually wants the whole
 * journey priced — the factory to the warehouse — and the two text boxes this
 * replaced could only hold the middle of it.
 *
 * `legs` offers the two doors either side of the main leg. Only sea and air
 * have a "port" middle distinct from the doors; a road move IS door to door,
 * so its two ends take addresses directly.
 */
type EndSpec = { label: string; hint: string; kinds?: PlaceKind[]; doors: boolean };
type RouteSpec = { from: EndSpec; to: EndSpec; legs: boolean };

/** A port field offers ports — and terminals and dry ports, which are where a
 *  sea move genuinely starts or ends inland. */
const PORT_KINDS: PlaceKind[] = ["SEAPORT", "TERMINAL", "INLAND"];
const AIRPORT_KINDS: PlaceKind[] = ["AIRPORT"];
/** A door: any address, and the shared places a door is often described by. */
const DOOR_KINDS: PlaceKind[] = ["ADDRESS", "WAREHOUSE", "CITY", "INLAND", "TERMINAL", "BORDER_POST", "OTHER"];

function routeSpec(mode: Mode | null): RouteSpec {
  if (mode === "SEA") {
    return {
      from: { label: "portal.quote.route.pol", hint: "portal.quote.route.portHint", kinds: PORT_KINDS, doors: false },
      to: { label: "portal.quote.route.pod", hint: "portal.quote.route.portHint", kinds: PORT_KINDS, doors: false },
      legs: true,
    };
  }
  if (mode === "AIR") {
    return {
      from: { label: "portal.quote.route.aol", hint: "portal.quote.route.airportHint", kinds: AIRPORT_KINDS, doors: false },
      to: { label: "portal.quote.route.aod", hint: "portal.quote.route.airportHint", kinds: AIRPORT_KINDS, doors: false },
      legs: true,
    };
  }
  return {
    from: { label: "portal.quote.from", hint: "portal.quote.route.placeHint", doors: true },
    to: { label: "portal.quote.to", hint: "portal.quote.route.placeHint", doors: true },
    legs: false,
  };
}

/** A request's stored end, back as a value: the place it was pinned to, or
 *  the words — or nothing. */
const endOf = (text: string | null | undefined, place: PortalPlace | null | undefined): PlaceValue =>
  place ? placeValue(place, text) : text ? typedValue(text) : EMPTY_PLACE;

/** Does a picked place still fit the field after the mode changed? A Shanghai
 *  SEAPORT is no answer to "Origin airport". */
const fits = (v: PlaceValue, kinds?: PlaceKind[]) => !v.pick || !kinds || !v.kind || kinds.includes(v.kind as PlaceKind);

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
                    {q.collection_location || q.delivery_location ? (
                      <Pill plain>
                        <PinIcon size={13} />
                        {q.collection_location && q.delivery_location
                          ? t("portal.quote.route.doorToDoor")
                          : q.collection_location
                            ? t("portal.quote.route.withCollection")
                            : t("portal.quote.route.withDelivery")}
                      </Pill>
                    ) : null}
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
  const [origin, setOrigin] = React.useState<PlaceValue>(EMPTY_PLACE);
  const [destination, setDestination] = React.useState<PlaceValue>(EMPTY_PLACE);
  // The doors either side of the main leg: null = not asked for.
  const [collection, setCollection] = React.useState<PlaceValue | null>(null);
  const [delivery, setDelivery] = React.useState<PlaceValue | null>(null);
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
    setOrigin(EMPTY_PLACE);
    setDestination(EMPTY_PLACE);
    setCollection(null);
    setDelivery(null);
    setIncoterm(null);
    setCargo("");
    setWeight("");
    setError(null);
    setDescribing(false);
    setDescription("");
    setFilled(false);
  }, [open]);

  const kg = parseAmount(weight);
  const spec = routeSpec(mode);
  const canNext = [!!mode && !!direction, origin.text.trim().length > 1 && destination.text.trim().length > 1, cargo.trim().length > 2 && (!weight || kg >= 0)][step];

  // A picked place that no longer answers the field's question once the mode
  // changes goes back to being words, rather than telling the desk "Shanghai,
  // seaport" under "Origin airport".
  React.useEffect(() => {
    const s = routeSpec(mode);
    setOrigin((cur) => (fits(cur, s.from.kinds) ? cur : typedValue(cur.text)));
    setDestination((cur) => (fits(cur, s.to.kinds) ? cur : typedValue(cur.text)));
  }, [mode]);

  /**
   * Words that arrived without a pick — the AI fill, "Like PRX-…" — pinned when
   * the places the client can see hold exactly that place. Applied only if the
   * field still holds those words, so a pick they made meanwhile is never
   * overwritten by a late answer.
   */
  function pin(which: "origin" | "destination", text: string | null | undefined, m: Mode | null) {
    const words = typedValue(String(text || "")).text;
    if (words.length < 2) return;
    const s = routeSpec(m);
    const set = which === "origin" ? setOrigin : setDestination;
    void pinExact(words, which === "origin" ? s.from.kinds : s.to.kinds).then((v) => {
      if (v) set((cur) => (cur.text === words && !cur.pick ? v : cur));
    });
  }

  /** The last request, every field of it — the places it was pinned to included. */
  function sameAsLast() {
    if (!last) return;
    setMode(modeOf(last));
    const dir = directionOf(last);
    if (dir) setDirection(dir);
    setOrigin(endOf(last.origin_location, last.origin_place));
    setDestination(endOf(last.destination_location, last.destination_place));
    setCollection(last.collection_location ? endOf(last.collection_location, last.collection_place) : null);
    setDelivery(last.delivery_location ? endOf(last.delivery_location, last.delivery_place) : null);
    // "TBD" is what the server files for "Not sure" (portal.service) — not a term to offer back.
    if (last.incoterm && last.incoterm !== "TBD") setIncoterm(last.incoterm);
    if (last.cargo_description) setCargo(last.cargo_description);
    if (last.estimated_weight) setWeight(String(last.estimated_weight));
    setFilled(true);
  }

  /** One of their shipments as the starting point. */
  function like(s: ShipmentCard) {
    const m = MODES.includes(s.mode as Mode) ? (s.mode as Mode) : mode;
    if (m !== mode) setMode(m);
    setOrigin(typedValue(s.origin || ""));
    setDestination(typedValue(s.destination || ""));
    pin("origin", s.origin, m);
    pin("destination", s.destination, m);
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
      const m = fields.mode || mode;
      if (fields.origin) {
        setOrigin(typedValue(fields.origin));
        pin("origin", fields.origin, m);
      }
      if (fields.destination) {
        setDestination(typedValue(fields.destination));
        pin("destination", fields.destination, m);
      }
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
      // A door counts only where the mode offers one, and only once it names a place.
      const door = (v: PlaceValue | null) => (spec.legs && v && v.text.trim() ? v : null);
      const from = door(collection);
      const to = door(delivery);
      await portalCreateQuote({
        service_category: `${t(`portal.mode.${mode}`)} · ${t(`portal.quote.dir.${direction}`)}`,
        origin_location: origin.text.trim(),
        destination_location: destination.text.trim(),
        ...(origin.pick ? { origin_place: origin.pick } : {}),
        ...(destination.pick ? { destination_place: destination.pick } : {}),
        ...(from ? { collection_location: from.text.trim(), ...(from.pick ? { collection_place: from.pick } : {}) } : {}),
        ...(to ? { delivery_location: to.text.trim(), ...(to.pick ? { delivery_place: to.pick } : {}) } : {}),
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
        <div className="mt-5 grid gap-6">
          <RouteLegs
            spec={spec}
            origin={origin}
            destination={destination}
            collection={collection}
            delivery={delivery}
            onOrigin={setOrigin}
            onDestination={setDestination}
            onCollection={setCollection}
            onDelivery={setDelivery}
          />
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

/**
 * The route, drawn the way the cargo travels it: the door we collect from,
 * the two ends of the main leg, the door we deliver to — joined by a rail.
 *
 * The two doors start as dashed "add" rows rather than as two more empty
 * fields: most requests are port to port, and four boxes where two are
 * optional reads as four questions. Adding one opens its search straight away;
 * closing that search with nothing chosen takes the door back off, so an
 * empty door never sits on the screen looking like a question left unanswered.
 */
function RouteLegs({
  spec,
  origin,
  destination,
  collection,
  delivery,
  onOrigin,
  onDestination,
  onCollection,
  onDelivery,
}: {
  spec: RouteSpec;
  origin: PlaceValue;
  destination: PlaceValue;
  collection: PlaceValue | null;
  delivery: PlaceValue | null;
  onOrigin: (v: PlaceValue) => void;
  onDestination: (v: PlaceValue) => void;
  onCollection: (v: PlaceValue | null) => void;
  onDelivery: (v: PlaceValue | null) => void;
}) {
  const { t } = useTranslation();
  // Which door was JUST added — its search opens on arrival. Only a door added
  // by a tap does; one restored by "Same as last time" arrives filled and shut.
  const [added, setAdded] = React.useState<"collection" | "delivery" | null>(null);

  function door(which: "collection" | "delivery", value: PlaceValue | null, set: (v: PlaceValue | null) => void, dash: { above?: boolean; below?: boolean }) {
    const label = t(`portal.quote.route.${which}`);
    const rail = { "data-dash-above": dash.above || undefined, "data-dash-below": dash.below || undefined };
    if (!value) {
      return (
        <li className="pt-leg" data-add {...rail}>
          <span className="pt-leg-dot" data-door aria-hidden="true" />
          <button
            type="button"
            className="pt-leg-add"
            onClick={() => {
              setAdded(which);
              set(EMPTY_PLACE);
            }}
          >
            <span className="pt-place-glyph">
              <PlusIcon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">{t(`portal.quote.route.${which}Add`)}</span>
              <span className="block truncate text-xs text-muted-foreground">{t(`portal.quote.route.${which}AddHint`)}</span>
            </span>
          </button>
        </li>
      );
    }
    return (
      <li className="pt-leg" {...rail}>
        <span className="pt-leg-dot" data-door aria-hidden="true" />
        <PlaceField
          label={label}
          value={value}
          onChange={set}
          kinds={DOOR_KINDS}
          doors
          placeholder={t("portal.quote.route.doorHint")}
          autoOpen={added === which && !value.text}
          onDismissEmpty={() => set(null)}
          action={
            <button type="button" className="pt-icon-btn -my-2.5 -mr-2 text-muted-foreground" aria-label={t("portal.quote.route.remove", { place: label })} onClick={() => set(null)}>
              <CloseIcon size={18} />
            </button>
          }
        />
      </li>
    );
  }

  return (
    <ol className="pt-legs">
      {spec.legs ? door("collection", collection, onCollection, { below: true }) : null}
      <li className="pt-leg" data-dash-above={spec.legs || undefined}>
        <span className="pt-leg-dot" aria-hidden="true" />
        <PlaceField label={t(spec.from.label)} value={origin} onChange={onOrigin} kinds={spec.from.kinds} doors={spec.from.doors} placeholder={t(spec.from.hint)} />
      </li>
      <li className="pt-leg" data-dash-below={spec.legs || undefined}>
        <span className="pt-leg-dot" aria-hidden="true" />
        <PlaceField label={t(spec.to.label)} value={destination} onChange={onDestination} kinds={spec.to.kinds} doors={spec.to.doors} placeholder={t(spec.to.hint)} />
      </li>
      {spec.legs ? door("delivery", delivery, onDelivery, { above: true }) : null}
    </ol>
  );
}
