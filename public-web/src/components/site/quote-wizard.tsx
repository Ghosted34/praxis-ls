import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Select, Textarea } from "@/components/ui/field";
import { PlaceInput } from "@/components/ui/place-input";
import { FileInput, type Attachment } from "@/components/ui/file-input";
import { Stepper, type Step } from "@/components/ui/stepper";
import { ErrorState, SuccessState } from "@/components/state";
import { ArrowRightIcon } from "@/components/ui/icons";
import { SelectCard } from "@/components/ui/select-card";
import { quoteRequests, type QuoteRequest } from "@/lib/intake-api";
import type { PlacePick } from "@/lib/places-api";
import { useIntake } from "@/lib/use-intake";
import { useWizardDraft } from "@/lib/use-wizard-draft";
import { getLang } from "@/lib/i18n";
import type { ServiceCard, ServiceMode } from "@/lib/services-api";
import { pickText, pickSlug } from "@/lib/services-api";
import {
  MODE_ICONS,
  isStorageOnly,
  modesOf,
  routeLabelKeys,
  servicesIn,
} from "@/lib/service-modes";

/**
 * The quote desk, as four questions instead of one wall of fields.
 *
 * ── WHY A WIZARD AT ALL ────────────────────────────────────────────────────
 *
 * The single-screen version of this form asks a stranger for eleven things
 * before it asks for anything they came to give. Their site got this right and
 * it is the one structural idea worth taking wholesale: Need → Route → Details
 * → Contact, so the first screen is one question and the commitment grows only
 * after they have already invested two answers.
 *
 * What is NOT taken from theirs:
 *
 *   · **the mandatory attachment.** Resolved decision 5. Requiring a commercial
 *     invoice before somebody can ask a price loses every prospect who is still
 *     shopping — which is most of them, and exactly the ones a marketing site
 *     exists to catch.
 *   · **`onsubmit="return false;"` with the real submit on a button's onclick.**
 *     That is how every `required` attribute on their page became decorative:
 *     native validation never runs. Each step here validates before it will
 *     advance, and the same rules gate the final submit.
 *   · **the third-party geocoder.** Theirs sends every keystroke of a route to
 *     an unkeyed public Photon instance and then never submits the coordinates
 *     it captured. Ours go through our own endpoint and are actually stored.
 *   · **`alert()`.** Errors are inline and designed, per §3.3.
 *
 * ── THE BRANCH ─────────────────────────────────────────────────────────────
 *
 * A warehousing enquiry has no route and no Incoterm; a freight enquiry has
 * both, and what "origin" is called depends on the mode — Airport of departure,
 * Port of loading, Place of collection. Their site branches on this and it is
 * right: asking a warehousing prospect for an Incoterm is asking a question
 * with no answer, and a form that does that reads as a form nobody thought
 * about.
 *
 * The incoterm stays REQUIRED on the freight branch (resolved decision 3 — it
 * is the one field the intake schema insists on) and is sent as `N/A` on the
 * warehousing branch, which is a real answer rather than a blank.
 */

/** Incoterms 2020. Not a guess at the tenant's business — the published list. */
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

const WAREHOUSE_DURATIONS = [
  "LESS_THAN_7_DAYS",
  "DAYS_7_TO_14",
  "DAYS_15_TO_30",
  "OVER_30_DAYS",
  "UNKNOWN",
] as const;

/**
 * The modes offered when the tenant has published NO services.
 *
 * ── WHY THERE IS STILL A LITERAL HERE ──────────────────────────────────────
 *
 * These four were once the whole of the first question, hardcoded, on every
 * tenant — which asked a stranger to classify their shipment with a taxonomy
 * the tenant does not own, and then asked them to TYPE the service name that
 * the tenant does. Both are gone: where services are published, `modesOf` reads
 * the modes off them and the service is picked, never typed.
 *
 * What survives is the pre-launch state, and it survives deliberately. A tenant
 * whose service profiles are still drafts has a live quote page and no way to
 * describe anything on it, and a form that answers "we cannot ask you yet" is
 * worse for them than four ordinary freight options and a free-text line. It is
 * the fallback, not the design — all four disappear the moment a profile is
 * published.
 */
const FALLBACK_MODES: ServiceMode[] = ["SEA", "AIR", "ROAD", "WAREHOUSE"];

/** How many service names a mode card lists before it stops. Three is where the
 *  card is naming what the mode covers rather than reprinting the services page
 *  into a radio button. */
const NAMES_ON_CARD = 3;

const EMAIL_RE = /.+@.+\..+/;
const DRAFT_KEY = "praxis.quote.draft";

type Draft = {
  mode: ServiceMode | "";
  /** The published service the visitor picked, so a restored draft re-selects
   *  the same row rather than matching on a name that may since have been
   *  reworded. Empty on the no-services fallback, where there is no row. */
  service_type_id: string;
  service_category: string;
  origin_location: string;
  destination_location: string;
  warehouse_location: string;
  warehouse_duration: string;
  incoterm: string;
  estimated_weight: string;
  project_cargo_flag: boolean;
  cargo_description: string;
  additional_notes: string;
  requester_name: string;
  requester_company: string;
  requester_email: string;
  requester_phone: string;
};

const EMPTY: Draft = {
  mode: "",
  service_type_id: "",
  service_category: "",
  origin_location: "",
  destination_location: "",
  warehouse_location: "",
  warehouse_duration: "",
  incoterm: "",
  estimated_weight: "",
  project_cargo_flag: false,
  cargo_description: "",
  additional_notes: "",
  requester_name: "",
  requester_company: "",
  requester_email: "",
  requester_phone: "",
};

export function QuoteWizard({
  services = [],
  /**
   * The service this form was opened FROM — the profile page's own quote band.
   *
   * That page rendered the wizard with no services and no context at all, so a
   * visitor who had just read a page about sea freight import was asked, on the
   * same screen, how their cargo was moving and which service they wanted. The
   * answer was two scrolls above them. Passing the row makes the first step
   * arrive already answered, and it stays editable: somebody may open the sea
   * page and decide they want the air service.
   */
  preselect = null,
}: {
  services?: ServiceCard[];
  preselect?: ServiceCard | null;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const hasServices = services.length > 0;
  /* The first question, built from the tenant's own published services — or the
     pre-launch literal when there are none. */
  const modes = hasServices ? modesOf(services) : FALLBACK_MODES;
  const [f, setF, clearDraft] = useWizardDraft<Draft>(DRAFT_KEY, EMPTY);
  const [step, setStep] = React.useState(0);
  const [furthest, setFurthest] = React.useState(0);
  // Shown only after an attempt to advance: pointing at a field somebody has
  // not reached yet is nagging, not validating.
  const [showErrors, setShowErrors] = React.useState(false);
  const [originPick, setOriginPick] = React.useState<PlacePick | null>(null);
  const [destinationPick, setDestinationPick] = React.useState<PlacePick | null>(null);
  const [attachment, setAttachment] = React.useState<Attachment | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) => quoteRequests.send(body as QuoteRequest, startedAt),
    onRateLimited: t("site.quote.limited"),
    onFailed: t("site.quote.err"),
  });

  const warehousing = isStorageOnly(f.mode);
  /* What is on offer under the mode currently picked. One service is not a
     question — it is the answer, and the effect below fills it in rather than
     opening a select with a single option in it. */
  const choices = servicesIn(services, f.mode);

  const applyService = React.useCallback(
    (row: ServiceCard) =>
      setF((prev) => ({
        ...prev,
        mode: row.mode,
        service_type_id: row.service_type_id,
        // The NAME, in the visitor's language, because that is what lands on the
        // desk: `quote_request.service_category` is free text, and the person
        // reading the lead wants the service as their own site words it.
        service_category: pickText(row, "name", lang) || pickSlug(row, lang),
      })),
    [setF, lang],
  );

  /* A mode with exactly one service under it answers its own second question.
     An effect rather than a line in the click handler, so it also covers a draft
     restored from a previous visit and a mode arriving via `preselect` — three
     routes into the same state, one place that settles it. */
  React.useEffect(() => {
    if (!f.mode || f.service_category.trim()) return;
    const only = servicesIn(services, f.mode);
    if (only.length === 1) applyService(only[0]);
  }, [f.mode, f.service_category, services, applyService]);

  const preselectId = preselect?.service_type_id || "";
  React.useEffect(() => {
    if (!preselect || !preselectId) return;
    // Never over a draft in progress: somebody who half-filled this form and
    // came back through a different service page keeps what they typed.
    setF((prev) =>
      prev.service_category.trim()
        ? prev
        : {
            ...prev,
            mode: preselect.mode,
            service_type_id: preselect.service_type_id,
            service_category:
              pickText(preselect, "name", lang) || pickSlug(preselect, lang),
          },
    );
    // `preselectId` only — the row object is rebuilt on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectId]);

  /**
   * Changing the mode drops a service that does not belong to the new one.
   *
   * Without this the form can be submitted saying "By air" and "Sea freight
   * import", which is a lead the desk has to telephone about before it can
   * price anything. On the fallback path there is no row to validate against,
   * so the free text the visitor typed is left alone.
   */
  /**
   * The services under a mode, as the card's description.
   *
   * ONE PER LINE, not joined by "·". The joined version wrapped mid-list on
   * every card wide enough to hold two names, which left a separator dangling
   * at the end of a line looking like a typo — and made three services read as
   * one long run-on the eye has to parse before it can count them. A short
   * stacked list is countable at a glance, which is the only thing this text
   * has to do.
   *
   * Cut at three with a remainder line rather than an ellipsis: "+2 more" says
   * how much is behind the card, and "…" says only that something is.
   */
  function namesUnder(m: ServiceMode): React.ReactNode {
    const rows = servicesIn(services, m);
    const rest = rows.length - NAMES_ON_CARD;
    return (
      <span className="block space-y-0.5">
        {rows.slice(0, NAMES_ON_CARD).map((sv) => (
          <span key={sv.service_type_id} className="block truncate">
            {pickText(sv, "name", lang) || pickSlug(sv, lang)}
          </span>
        ))}
        {rest > 0 && (
          <span className="block opacity-70">
            {t("site.quote.modeMore", { count: rest })}
          </span>
        )}
      </span>
    );
  }

  function pickMode(m: ServiceMode) {
    if (!hasServices) {
      set("mode", m);
      return;
    }
    setF((prev) => {
      const keep = services.some(
        (x) => x.service_type_id === prev.service_type_id && x.mode === m,
      );
      return keep
        ? { ...prev, mode: m }
        : { ...prev, mode: m, service_type_id: "", service_category: "" };
    });
  }

  const STEPS: Step[] = [
    { key: "need", label: t("site.quote.stepNeed") },
    { key: "route", label: warehousing ? t("site.quote.stepStorage") : t("site.quote.stepRoute") },
    { key: "details", label: t("site.quote.stepDetails") },
    { key: "contact", label: t("site.quote.stepContact") },
  ];

  /**
   * What each step will not let through.
   *
   * One place, so the "next" button, the step dots and the final submit all
   * agree — three copies of this is how a wizard ends up letting somebody reach
   * the last screen and then refusing on a field two steps back.
   */
  function problems(index: number): Record<string, string> {
    const out: Record<string, string> = {};
    if (index === 0) {
      if (!f.mode) out.mode = t("site.quote.errMode");
      if (!f.service_category.trim()) out.service_category = t("site.quote.errService");
    }
    if (index === 1) {
      if (warehousing) {
        if (f.warehouse_location.trim().length < 2) out.warehouse_location = t("site.quote.errWarehouse");
      } else {
        if (f.origin_location.trim().length < 2) out.origin_location = t("site.quote.errOrigin");
        if (f.destination_location.trim().length < 2) out.destination_location = t("site.quote.errDestination");
        if (!f.incoterm) out.incoterm = t("site.quote.errIncoterm");
      }
    }
    if (index === 3) {
      if (f.requester_name.trim().length < 2) out.requester_name = t("site.quote.errName");
      if (!EMAIL_RE.test(f.requester_email.trim())) out.requester_email = t("site.quote.errEmail");
    }
    return out;
  }

  // Step 2 (details) asks nothing required — every field on it is a nicety that
  // makes a better quote, and gating on one would be inventing a requirement.
  const localErrors = showErrors ? problems(step) : {};
  const err = (k: string) => localErrors[k] || intake.fields[k] || undefined;

  function goTo(index: number) {
    setStep(index);
    setShowErrors(false);
    // Focus the new step's heading rather than its first input: a screen reader
    // should hear which question it is now on before being dropped into a field.
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function next() {
    if (Object.keys(problems(step)).length > 0) {
      setShowErrors(true);
      return;
    }
    const to = Math.min(step + 1, STEPS.length - 1);
    setFurthest((v) => Math.max(v, to));
    goTo(to);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Every step, not just this one — the dots let somebody jump back and leave
    // an earlier one incomplete.
    for (let i = 0; i < STEPS.length; i += 1) {
      if (Object.keys(problems(i)).length > 0) {
        setShowErrors(true);
        goTo(i);
        setShowErrors(true);
        return;
      }
    }
    const weight = Number(f.estimated_weight);
    const body: QuoteRequest = {
      requester_name: f.requester_name.trim(),
      requester_company: f.requester_company.trim() || undefined,
      requester_email: f.requester_email.trim(),
      requester_phone: f.requester_phone.trim() || undefined,
      service_category: f.service_category.trim(),
      cargo_description: f.cargo_description.trim() || undefined,
      additional_notes: f.additional_notes.trim() || undefined,
      project_cargo_flag: f.project_cargo_flag,
      estimated_weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
      // `N/A` rather than a blank: the schema requires an incoterm, and a
      // warehousing enquiry genuinely has none. Saying so is an answer.
      incoterm: warehousing ? "N/A" : f.incoterm,
      ...(warehousing
        ? {
            warehouse_location: f.warehouse_location.trim(),
            warehouse_duration:
              (f.warehouse_duration as QuoteRequest["warehouse_duration"]) || undefined,
          }
        : {
            origin_location: f.origin_location.trim(),
            destination_location: f.destination_location.trim(),
            // Sent only while the text still matches what was picked — the
            // picker clears these the moment the input is edited.
            origin_place: originPick || undefined,
            destination_place: destinationPick || undefined,
          }),
      ...(attachment
        ? { attachment_data_url: attachment.dataUrl, attachment_filename: attachment.filename }
        : {}),
    };
    const r = await intake.submit(body);
    if (r) {
      // A submitted draft that survives is a form that reappears pre-filled and
      // invites a duplicate.
      clearDraft();
      setAttachment(null);
      setOriginPick(null);
      setDestinationPick(null);
    }
  }

  if (intake.result) {
    return (
      <SuccessState
        title={t("site.quote.sent")}
        hint={
          intake.result.reference ? (
            <>
              {t("site.quote.reference")}{" "}
              <span className="num font-semibold text-foreground">
                {intake.result.reference}
              </span>
            </>
          ) : undefined
        }
      />
    );
  }

  const labels = routeLabelKeys(f.mode);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Stepper
        steps={STEPS}
        current={step}
        furthest={furthest}
        onGoTo={goTo}
        label={t("site.quote.stepsLabel")}
        counter={t("site.quote.stepCounter", { step: step + 1, total: STEPS.length })}
      />

      {intake.error && (
        <ErrorState message={intake.error} className="mt-2" />
      )}

      {/* Centred, like every step on their portal. On a form this wide a
          left-aligned question sits under the step dots and reads as a caption
          for them; centred, it reads as the thing being asked. */}
      <div className="text-center">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-h3 font-semibold tracking-tight outline-none"
        >
          {STEPS[step].label}
        </h3>
        <p className="mx-auto mt-2 max-w-measure text-muted-foreground">
          {t(`site.quote.stepHint${step}`)}
        </p>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <fieldset>
            <legend className="field-label">{t("site.quote.mode")}</legend>
            {/*
              A RADIO GROUP, not four toggle buttons.

              This is a single choice among four, which is what a radio group
              IS — and the semantics are not a formality: a group gives arrow-key
              navigation, one tab stop instead of four, and a screen reader that
              announces "2 of 4" rather than four unrelated pressed/unpressed
              buttons. Their own markup gets this right (`<label>` wrapping an
              `<input type="radio">`), and it was the thing worth copying from it.

              The visible card is a sibling of a visually-hidden input, so the
              focus ring is drawn on the card via `peer-focus-visible` and the
              real control keeps the keyboard behaviour.
            */}
            {/* The shared component, not a hand-rolled copy of it. This block
                WAS the hand-roll the plan's acceptance list tells a reviewer to
                catch: the card, the ring and the three-signal selected state
                were written here, and `--pick-ring` — the token §5 added for
                exactly this — sat unused while the same two shadow values were
                spelled out inline. One implementation, one token. */}
            {/* Three across, not four. The mode list is read off the tenant's
                published services now, so its length is theirs — seven on a
                full freight taxonomy — and a four-column grid turns that into a
                filled row and a ragged one. At three the last row is short by
                the same amount but the cards are wider, which is what the
                service names underneath them needed anyway. */}
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modes.map((m) => (
                <SelectCard
                  key={m}
                  name="quote-mode"
                  value={m}
                  checked={f.mode === m}
                  onChange={(v) => pickMode(v as ServiceMode)}
                  icon={MODE_ICONS[m]}
                  title={t(`site.quote.mode${m}`)}
                  /* The tenant's OWN service names, where there are any.
 
                     "By sea — Sea freight import · Sea freight export ·
                     End-to-end sea freight" answers the question the generic
                     hint could only gesture at, and it answers it in the words
                     the rest of the site uses. The dictionary hint is what is
                     left when nothing is published: a prospect who does not know
                     whether "By road or rail" covers a Douala → N'Djamena run
                     picks nothing, and picking nothing is where this form loses
                     them. */
                  description={
                    hasServices
                      ? namesUnder(m)
                      : t(`site.quote.mode${m}Hint`)
                  }
                />
              ))}
            </div>
            {err("mode") && (
              <p role="alert" className="mt-2 text-sm text-[rgb(var(--bad))]">
                {err("mode")}
              </p>
            )}
          </fieldset>

          {/*
            THE SECOND HALF OF THE STEP, IN THREE STATES.

            · Several services under the mode → a select of those services, and
              only those. The old version listed every published service under
              every mode, so "By air" could be submitted with "Sea freight
              import" next to it.
            · Exactly one → nothing to ask. It is set for them and shown as a
              line of text, because a select with one option is a question with
              one answer and reads as a form that has not finished loading.
            · No published services at all → the free-text box, which is the
              pre-launch fallback and the only path that still asks anybody to
              type the name of a service the tenant sells.
          */}
          {!hasServices ? (
            <Input
              label={t("site.quote.service")}
              required
              placeholder={t("site.quote.servicePlaceholder")}
              value={f.service_category}
              error={err("service_category")}
              onChange={(e) => set("service_category", e.target.value)}
            />
          ) : choices.length > 1 ? (
            <Select
              label={t("site.quote.service")}
              required
              value={f.service_type_id}
              error={err("service_category")}
              onChange={(e) => {
                const row = services.find(
                  (x) => x.service_type_id === e.target.value,
                );
                if (row) applyService(row);
              }}
              options={[
                { value: "", label: t("site.quote.servicePick") },
                ...choices.map((sv) => ({
                  value: sv.service_type_id,
                  label: pickText(sv, "name", lang) || pickSlug(sv, lang),
                })),
              ]}
            />
          ) : f.service_category ? (
            <p className="rounded-[calc(var(--radius)-2px)] border bg-[var(--secondary)] px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {t("site.quote.service")}:{" "}
              </span>
              <span className="font-medium">{f.service_category}</span>
            </p>
          ) : null}
        </div>
      )}

      {step === 1 && !warehousing && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PlaceInput
              id="q-origin"
              label={t(`site.quote.${labels.origin}`)}
              required
              value={f.origin_location}
              onChange={(v) => set("origin_location", v)}
              onPick={setOriginPick}
              error={err("origin_location")}
              hint={t("site.quote.placeHint")}
              placeholder={t("site.quote.originPlaceholder")}
            />
            <PlaceInput
              id="q-destination"
              label={t(`site.quote.${labels.destination}`)}
              required
              value={f.destination_location}
              onChange={(v) => set("destination_location", v)}
              onPick={setDestinationPick}
              error={err("destination_location")}
              placeholder={t("site.quote.destinationPlaceholder")}
            />
          </div>
          <Select
            label={t("site.quote.incoterm")}
            required
            hint={t("site.quote.incotermHint")}
            value={f.incoterm}
            error={err("incoterm")}
            onChange={(e) => set("incoterm", e.target.value)}
            options={[
              { value: "", label: t("site.quote.incotermPick") },
              ...INCOTERMS.map((i) => ({ value: i, label: i })),
            ]}
          />
        </div>
      )}

      {step === 1 && warehousing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <PlaceInput
            id="q-warehouse"
            label={t("site.quote.warehouseLocation")}
            required
            value={f.warehouse_location}
            onChange={(v) => set("warehouse_location", v)}
            // Storage has no route, so nothing is geocoded here: the desk needs
            // the town, and a pin on a warehouse the tenant has not chosen yet
            // would be a coordinate for a place that does not exist.
            onPick={() => undefined}
            error={err("warehouse_location")}
            placeholder={t("site.quote.warehousePlaceholder")}
          />
          <Select
            label={t("site.quote.warehouseDuration")}
            value={f.warehouse_duration}
            error={err("warehouse_duration")}
            onChange={(e) => set("warehouse_duration", e.target.value)}
            options={[
              { value: "", label: t("site.quote.durationPick") },
              ...WAREHOUSE_DURATIONS.map((d) => ({
                value: d,
                label: t(`site.quote.duration${d}`),
              })),
            ]}
          />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t("site.quote.weight")}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              hint={t("site.quote.weightHint")}
              value={f.estimated_weight}
              error={err("estimated_weight")}
              onChange={(e) => set("estimated_weight", e.target.value)}
            />
            <div className="flex items-end">
              <label className="flex cursor-pointer items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={f.project_cargo_flag}
                  onChange={(e) => set("project_cargo_flag", e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand-orange))]"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{t("site.quote.projectCargo")}</span>
                  <span className="block text-muted-foreground">
                    {t("site.quote.projectCargoHint")}
                  </span>
                </span>
              </label>
            </div>
          </div>
          <Textarea
            label={t("site.quote.cargo")}
            hint={t("site.quote.cargoHint")}
            rows={4}
            maxLength={5000}
            value={f.cargo_description}
            error={err("cargo_description")}
            onChange={(e) => set("cargo_description", e.target.value)}
          />
          <FileInput
            id="q-attachment"
            label={t("site.quote.attachment")}
            hint={t("site.quote.attachmentHint")}
            value={attachment}
            onChange={setAttachment}
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t("site.quote.name")}
              required
              autoComplete="name"
              value={f.requester_name}
              error={err("requester_name")}
              onChange={(e) => set("requester_name", e.target.value)}
            />
            <Input
              label={t("site.quote.company")}
              autoComplete="organization"
              value={f.requester_company}
              error={err("requester_company")}
              onChange={(e) => set("requester_company", e.target.value)}
            />
            <Input
              label={t("site.quote.email")}
              type="email"
              required
              autoComplete="email"
              value={f.requester_email}
              error={err("requester_email")}
              onChange={(e) => set("requester_email", e.target.value)}
            />
            <Input
              label={t("site.quote.phone")}
              type="tel"
              autoComplete="tel"
              value={f.requester_phone}
              error={err("requester_phone")}
              onChange={(e) => set("requester_phone", e.target.value)}
            />
          </div>
          <Textarea
            label={t("site.quote.notes")}
            hint={t("site.quote.notesHint")}
            rows={3}
            maxLength={5000}
            value={f.additional_notes}
            error={err("additional_notes")}
            onChange={(e) => set("additional_notes", e.target.value)}
          />
        </div>
      )}

      {/* The honeypot: present for a scraper, invisible for a person. */}
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">{t("site.quote.privacy")}</p>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => goTo(step - 1)}>
              {t("common.back")}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="button" size="lg" onClick={next}>
              {t("site.quote.next")}
              <ArrowRightIcon size={16} className="ml-2" />
            </Button>
          ) : (
            <Button type="submit" size="lg" loading={intake.busy} disabled={intake.busy}>
              {intake.busy ? t("site.quote.sending") : t("site.quote.submit")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
