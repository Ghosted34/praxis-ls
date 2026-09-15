/**
 * Service type → Website tab (PR2).
 *
 * The ninth dossier tab for the tenant website package. One GET always answers
 * 200 (`profile: null` before creation); every create and every edit goes through
 * the one upsert with omitted-keys-unchanged semantics. The readiness checklist
 * renders the server's `readiness` object exactly — the FE never invents a
 * different publish rule. Slug + media lock while published; copy/FAQ/related
 * stay live. See `doc/SERVICE_TYPE_WEB_PROFILE_ENGINEERING_GUIDE.md` §3.1.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { FileDrop, fileDropProps } from "@/components/ui/file-drop";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { errMsg, useResource } from "@/lib/use-resource";
import { ApiError } from "@/lib/api-client";
import { slug as suggestSlug, isValidSlug } from "@/lib/slug";
import * as api from "@/lib/operations-api";
import { useToast } from "@/components/ui/toast";
import { useFormDraft } from "@/lib/form-draft";
import { DraftBanner } from "@/components/ui/draft-banner";
import { ServiceTypeWebPillars } from "./service-type-web-pillars";
import { ServiceTypeWebAiDialog } from "./service-type-web-ai-dialog";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const L = api.SERVICE_TYPE_WEB_LIMITS;

type Lang = "fr" | "en";
type MediaRole = "COVER" | "ICON" | "GALLERY";

function imageProblem(file: File): string | null {
  if (!file.size) return "That image is empty.";
  if (file.size > IMAGE_MAX_BYTES) return "Images must be no larger than 10 MB.";
  // A browser reports an EMPTY type for a file whose extension the operating
  // system has no registry entry for, and `.webp` is the one that still hits
  // that on Windows — so treating "" as "not an image" refused genuine WebP
  // files with a message telling the person to pick a WebP. The vault sniffs the
  // magic bytes and is the authority (`document_vault.service.sniffContentType`);
  // only an outright mismatch is worth refusing here. Same rule as
  // `vault-file.scanFileProblem`.
  if (file.type && !IMAGE_ACCEPT.split(",").includes(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG or WebP image.";
  }
  return null;
}

function relatedIds(related: api.ServiceTypeWebTab["related"]): string[] {
  if (!Array.isArray(related)) return [];
  return related.map((r) =>
    typeof r === "string" ? r : r.related_service_type_id,
  );
}

function relatedLabel(
  related: api.ServiceTypeWebTab["related"],
  id: string,
  fallbackName?: string | null,
): string {
  const hit = (related || []).find(
    (r) => typeof r !== "string" && r.related_service_type_id === id,
  );
  if (hit && typeof hit !== "string") {
    return hit.name_en || hit.name_fr || hit.key || id.slice(0, 8);
  }
  return fallbackName || id.slice(0, 8);
}

/* ── Character counter ───────────────────────────────────────────────────── */

function CharCount({
  value,
  max,
  fallback,
}: {
  value: string;
  max: number;
  fallback?: string | null;
}) {
  const n = value.length;
  return (
    <span
      className={cn(
        "micro",
        n > max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {n}/{max}
      {fallback != null && !value.trim() ? (
        <span className="ml-2 opacity-80">
          · {tr("Falls back to")}: {fallback || "—"}
        </span>
      ) : null}
    </span>
  );
}

/* ── Publish readiness checklist ─────────────────────────────────────────── */

function ReadinessChecklist({
  readiness,
  onJumpNameEn,
  canWrite,
}: {
  readiness: api.ServiceTypeWebReadiness;
  onJumpNameEn: () => void;
  canWrite: boolean;
}) {
  const rows: {
    key: string;
    ok: boolean;
    label: string;
    action?: { label: string; onClick: () => void };
  }[] = [
    {
      key: "name_en",
      ok: readiness.name_en_present,
      label: tr("English name — set on the service type"),
      action: canWrite
        ? { label: tr("Edit service type"), onClick: onJumpNameEn }
        : undefined,
    },
    {
      key: "short_fr",
      ok: readiness.short_fr,
      label: tr("Short description (FR)"),
    },
    {
      key: "short_en",
      ok: readiness.short_en,
      label: tr("Short description (EN)"),
    },
    {
      key: "long_fr",
      ok: readiness.long_fr,
      label: tr("Long description (FR)"),
    },
    {
      key: "long_en",
      ok: readiness.long_en,
      label: tr("Long description (EN)"),
    },
    { key: "slug_fr", ok: readiness.slug_fr, label: tr("Slug (FR)") },
    { key: "slug_en", ok: readiness.slug_en, label: tr("Slug (EN)") },
    {
      key: "cover",
      ok: readiness.cover.allowed,
      label: tr("Cover image (required to publish)"),
    },
  ];

  return (
    <ul className="space-y-1.5" data-testid="web-readiness-checklist">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
          <span
            aria-hidden
            className={
              r.ok ? "text-[rgb(var(--ok))]" : "text-muted-foreground"
            }
          >
            {r.ok ? "✓" : "○"}
          </span>
          <span
            className={r.ok ? "text-foreground" : "text-muted-foreground"}
          >
            {r.label}
          </span>
          {r.action && !r.ok && (
            <Button size="sm" variant="outline" onClick={r.action.onClick}>
              {r.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Highlights editor ───────────────────────────────────────────────────── */

function HighlightsEditor({
  value,
  onChange,
  disabled,
  lang,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  lang: Lang;
}) {
  const items = value.length ? value : [""];
  function setAt(i: number, text: string) {
    const next = items.map((v, idx) => (idx === i ? text : v));
    onChange(next);
  }
  function add() {
    if (items.length >= L.HIGHLIGHTS_MAX) return;
    onChange([...items, ""]);
  }
  function remove(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    onChange(next.length ? next : []);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro text-muted-foreground">
          {tr("Guided 4–8 highlights · hard cap 8")} · {lang.toUpperCase()}
        </p>
        <span className="micro text-muted-foreground">
          {items.filter((s) => s.trim()).length}/{L.HIGHLIGHTS_MAX}
        </span>
      </div>
      {items.map((h, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${tr("Highlight")} ${i + 1} (${lang})`}
            value={h}
            disabled={disabled}
            maxLength={280}
            onChange={(e) => setAt(i, e.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || items.length <= 1}
            onClick={() => remove(i)}
          >
            {tr("Remove")}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || items.length >= L.HIGHLIGHTS_MAX}
        onClick={add}
      >
        {tr("Add highlight")}
      </Button>
    </div>
  );
}

/* ── Accent picker ───────────────────────────────────────────────────────── */

/**
 * Which brand token tints this service's card.
 *
 * The swatches paint with `rgb(var(--brand-orange))` and friends rather than a
 * palette class, because that is the whole point of storing a token NAME: the
 * three chips restyle themselves to the tenant's own brand, so what the person
 * picks here is what they will see on their site. A `bg-orange-500` swatch would
 * show them a colour their site never renders.
 *
 * The mapping mirrors `public-web/src/lib/service-identity.ts` — PRIMARY is the
 * brand fill, ACCENT the secondary brand colour, SUCCESS the semantic green.
 * They are deliberately the same three tokens, resolved on this side too, so the
 * preview cannot drift from the page.
 */
const ACCENT_SWATCH: Record<api.ServiceTypeWebAccent, string> = {
  PRIMARY: "rgb(var(--brand-orange))",
  ACCENT: "rgb(var(--brand-blue))",
  SUCCESS: "rgb(var(--ok))",
};

const ACCENT_LABEL: Record<api.ServiceTypeWebAccent, string> = {
  PRIMARY: "Brand",
  ACCENT: "Secondary",
  SUCCESS: "Success",
};

function AccentPicker({
  value,
  onChange,
  disabled,
}: {
  value: api.ServiceTypeWebAccent;
  onChange: (next: api.ServiceTypeWebAccent) => void;
  disabled?: boolean;
}) {
  const options = Object.keys(ACCENT_SWATCH) as api.ServiceTypeWebAccent[];
  return (
    <div
      role="radiogroup"
      aria-label={tr("Card accent")}
      className="flex flex-wrap gap-2"
      data-testid="web-accent-picker"
    >
      {options.map((key) => {
        const on = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              on
                ? "border-primary bg-primary/10 text-foreground"
                : "border-input text-muted-foreground hover:bg-muted",
            )}
          >
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
              style={{ background: ACCENT_SWATCH[key] }}
            />
            {tr(ACCENT_LABEL[key])}
            {/* Never colour alone (WCAG §1.4.1) — the selected chip is also the
                only one carrying the tick and the ring. */}
            {on && <span aria-hidden>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Root tab ────────────────────────────────────────────────────────────── */

/**
 * The editor's field set, derived from a profile row.
 *
 * Lifted out of `applyTab` because "a new server payload arrived" and "re-seed
 * the boxes the user is typing into" are two different events, and treating
 * them as one is what destroyed authored copy. EVERY mutation on this tab
 * answers with the whole tab, and `applyTab` pushed all of it straight back
 * into `draft` — so Publish, Save FAQ, Save related, Remove media and a
 * gallery reorder each replaced a screenful of unsaved text with whatever the
 * server still held. No error, no prompt, nothing in the console. The reported
 * case: eleven thousand characters of page copy pasted in, Publish pressed,
 * and the seeded placeholder back in the boxes. None of those writes touch a
 * text column, so re-seeding from them was pure loss with no upside.
 *
 * `reseedFor` below is the policy that replaced it.
 */
function draftFromProfile(
  p: api.ServiceTypeWebTab["profile"],
): api.ServiceTypeWebProfilePatch {
  return {
      short_description_fr: p?.short_description_fr ?? "",
      short_description_en: p?.short_description_en ?? "",
      long_description_fr: p?.long_description_fr ?? "",
      long_description_en: p?.long_description_en ?? "",
      highlights_fr: [...(p?.highlights_fr || [])],
      highlights_en: [...(p?.highlights_en || [])],
      coverage_fr: p?.coverage_fr ?? "",
      coverage_en: p?.coverage_en ?? "",
      slug_fr: p?.slug_fr ?? "",
      slug_en: p?.slug_en ?? "",
      meta_title_fr: p?.meta_title_fr ?? "",
      meta_title_en: p?.meta_title_en ?? "",
      meta_description_fr: p?.meta_description_fr ?? "",
      meta_description_en: p?.meta_description_en ?? "",
      video_url: p?.video_url ?? "",
      sort_order: p?.sort_order ?? 100,
      // The card (12755). Seeded into BOTH draft and baseline like every other
      // field: `dirtyPatch` compares the two, so a key absent from here can
      // never be sent — which is exactly how these four stayed unreachable
      // while the API accepted them all along.
      //
      // `group_id` keeps null rather than collapsing to "": null IS the value
      // that puts the service in the trailing unnamed group, and the server
      // reads an explicit null as that instruction.
      group_id: p?.group_id ?? null,
      claim_fr: p?.claim_fr ?? "",
      claim_en: p?.claim_en ?? "",
      accent: p?.accent ?? "PRIMARY",
  };
}

/**
 * Which parts of the editor a given response is allowed to overwrite.
 *
 * The rule is "only a write that actually touched a section may re-seed it".
 * Anything omitted keeps what the user has on screen, unsaved and still dirty.
 */
type Reseed = { draft?: boolean; faq?: boolean; related?: boolean };

/** The first GET, and a restore — the editor is empty, so everything seeds. */
const RESEED_ALL: Reseed = { draft: true, faq: true, related: true };
/** Publish, unpublish, media, gallery order: no text column moved. Touch nothing. */
const RESEED_NONE: Reseed = {};

/**
 * Build the omitted-keys-unchanged patch — only dirty keys.
 *
 * Pure and module-level so the component can memoise it, which gives the tab a
 * reliable `isDirty` for the unsaved-changes guard and the Save button. It was
 * a closure over `draft`/`baseline` called only at save time, so nothing else
 * could ask "is there unsaved work here?" — and nothing did.
 */
function buildDirtyPatch(
  draft: api.ServiceTypeWebProfilePatch,
  baseline: api.ServiceTypeWebProfilePatch,
): api.ServiceTypeWebProfilePatch {
  const out: api.ServiceTypeWebProfilePatch = {};
  const keys = Object.keys(draft) as (keyof api.ServiceTypeWebProfilePatch)[];
  for (const k of keys) {
    let a = draft[k];
    const b = baseline[k];
    // Highlights: drop blank rows on the wire so the validator's min(1) passes.
    if (k === "highlights_fr" || k === "highlights_en") {
      a = (Array.isArray(a) ? a : [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, L.HIGHLIGHTS_MAX);
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const bNorm =
        k === "highlights_fr" || k === "highlights_en"
          ? (b as string[]).map((s) => String(s).trim()).filter(Boolean)
          : b;
      if (JSON.stringify(a) !== JSON.stringify(bNorm)) {
        (out as Record<string, unknown>)[k] = a;
      }
    } else if (a !== b) {
      // Empty string for text clears as "" (readiness treats "" as missing);
      // video_url empty → null so the server clears the column.
      if (k === "video_url" && a === "") {
        out.video_url = null;
      } else if ((k === "claim_fr" || k === "claim_en") && a === "") {
        // A cleared claim is an absent claim. Sending "" would store a blank
        // string that every "is this set?" test in the tree has to special-case
        // — including the backfill seed's, which reads blank as empty and would
        // re-fill a claim the tenant had deliberately removed.
        (out as Record<string, unknown>)[k] = null;
      } else {
        (out as Record<string, unknown>)[k] = a;
      }
    }
  }
  // Empty slug box while draft → explicit null (server `col = EXCLUDED.col`
  // clears). The regex rejects "", so we never send "". Slug inputs are locked
  // while published, so this path only runs on a draft clear.
  if (out.slug_fr === "") out.slug_fr = null;
  if (out.slug_en === "") out.slug_en = null;
  return out;
}

/**
 * Merge a save response back into the boxes WITHOUT discarding keystrokes that
 * landed while the request was in flight.
 *
 * A field the user has not touched since `sent` takes the server's value; one
 * they have kept typing into keeps theirs and stays dirty for the next save.
 * On a page this size a save is not instant, and "it threw away the sentence I
 * typed while it was saving" is the same defect in miniature.
 */
function mergeAfterSave(
  current: api.ServiceTypeWebProfilePatch,
  sent: api.ServiceTypeWebProfilePatch,
  fromServer: api.ServiceTypeWebProfilePatch,
): api.ServiceTypeWebProfilePatch {
  const out = { ...fromServer };
  for (const k of Object.keys(fromServer) as (keyof api.ServiceTypeWebProfilePatch)[]) {
    const same = JSON.stringify(current[k]) === JSON.stringify(sent[k]);
    if (!same) (out as Record<string, unknown>)[k] = current[k];
  }
  return out;
}

export function ServiceTypeWebTab({
  serviceTypeId,
  serviceTypeKey,
  serviceTypeNameEn,
  onEditServiceType,
  canWrite = true,
}: {
  serviceTypeId: string;
  /** Stable key used as the never-empty slug fallback. */
  serviceTypeKey: string;
  /**
   * Current `name_en` from the service-type row. Included in the GET deps so a
   * jump-modal save (which reloads the dossier) re-fetches readiness and the
   * checklist ticks without the tab writing name_en itself.
   */
  serviceTypeNameEn?: string | null;
  /** Opens the existing service-type edit modal (name_en jump target). */
  onEditServiceType: () => void;
  /** False when the caller knows the user has no edit right (optional). */
  canWrite?: boolean;
}) {
  const tab = useResource(
    () => api.getServiceTypeWeb(serviceTypeId),
    [serviceTypeId, serviceTypeNameEn],
  );
  const toast = useToast();
  const [lang, setLang] = React.useState<Lang>("fr");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mediaError, setMediaError] = React.useState<string | null>(null);

  // Mutation responses return the full tab payload (guide: re-render from the
  // body only). Hold that here so a subsequent GET reload cannot clobber a
  // just-created or just-unpublished row with a stale cache entry.
  const [localTab, setLocalTab] = React.useState<api.ServiceTypeWebTab | null>(
    null,
  );

  // Local draft of profile fields — seeded from the last successful GET/upsert.
  // Dirty tracking: only keys that differ from `baseline` are sent on save.
  const [draft, setDraft] = React.useState<api.ServiceTypeWebProfilePatch>({});
  const [baseline, setBaseline] = React.useState<api.ServiceTypeWebProfilePatch>(
    {},
  );
  const [faqRows, setFaqRows] = React.useState<api.ServiceTypeWebFaqRow[]>([]);
  const [pickedRelated, setPickedRelated] = React.useState<string[]>([]);
  const [relatedQ, setRelatedQ] = React.useState("");
  const [slugHint, setSlugHint] = React.useState<{
    fr?: string;
    en?: string;
  }>({});
  // Pillars are tenant-wide, so they are their own read rather than part of the
  // tab payload. Only the ACTIVE ones are offered: assigning a service to a
  // hidden pillar would drop its card into the unnamed group with nothing on
  // this screen explaining why.
  const pillars = useResource(() => api.listServiceTypeWebGroups(), []);
  const [pillarsOpen, setPillarsOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const nameEnPollRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (nameEnPollRef.current != null) {
        window.clearInterval(nameEnPollRef.current);
      }
    },
    [],
  );

  const applyTab = React.useCallback(
    (payload: api.ServiceTypeWebTab, reseed: Reseed = RESEED_ALL) => {
      // The row itself is always current — readiness, published state, media
      // ids and slugs all come from here, and holding a stale one is what made
      // an uploaded cover fail to tick its checklist row.
      setLocalTab(payload);
      if (reseed.draft) {
        const next = draftFromProfile(payload.profile);
        setDraft(next);
        setBaseline(next);
      }
      if (reseed.faq) {
        setFaqRows(
          (payload.faq || []).map((r) => ({
            question_fr: r.question_fr,
            question_en: r.question_en,
            answer_fr: r.answer_fr,
            answer_en: r.answer_en,
            sort_order: r.sort_order,
          })),
        );
      }
      if (reseed.related) setPickedRelated(relatedIds(payload.related));
      setSlugHint({});
      setError(null);
    },
    [],
  );

  // Seed from GET; clear the local override when the service type (or its
  // name_en) changes so a jump-modal save re-applies the fresh readiness.
  React.useEffect(() => {
    setLocalTab(null);
  }, [serviceTypeId, serviceTypeNameEn]);

  React.useEffect(() => {
    if (!tab.data || localTab) return;
    // `localTab` is cleared by the name_en poll and by void mutations, which
    // re-opens this path while the user may be mid-sentence. Seed the boxes
    // only when there is nothing in them to lose.
    applyTab(
      tab.data,
      isDirtyRef.current ? { faq: true, related: true } : RESEED_ALL,
    );
  }, [tab.data, localTab, applyTab]);

  // Prefer the mutation response; fall back to the GET.
  const data = localTab ?? tab.data;
  const profile = data?.profile ?? null;
  const readiness = data?.readiness;
  const isPublished = Boolean(profile?.is_published);
  const isArchived = data?.service_type?.is_active === false;
  const readOnly = isArchived || !canWrite;
  const mediaLocked = isPublished || readOnly;
  const slugLocked = isPublished || readOnly;

  const nameFr = data?.service_type?.name_fr || "";
  const nameEn = data?.service_type?.name_en || "";

  /** Only the keys that differ from the last server payload. */
  const dirty = React.useMemo(
    () => buildDirtyPatch(draft, baseline),
    [draft, baseline],
  );
  const isDirty = Object.keys(dirty).length > 0;
  // Read by the reload effect, which must not re-seed over unsaved work but
  // must not re-run every keystroke either.
  const isDirtyRef = React.useRef(false);
  isDirtyRef.current = isDirty;

  /**
   * The local rescue copy.
   *
   * A service page is the longest thing anyone writes in this product — the
   * case that prompted this was eleven thousand characters per language,
   * composed elsewhere and pasted in. Losing that to a stray click, a reload
   * or a closed laptop is not a small annoyance, so what is in the boxes is
   * mirrored to this browser and offered back on return.
   *
   * `maxBytes` is raised well above the shared 64 KB default: that ceiling is
   * sized for ordinary forms, and the comment on it names a document editor as
   * the exception. This is that exception, and a silently dropped rescue copy
   * is worse than none — the banner would simply never appear on the one
   * screen most able to lose an hour of work.
   */
  const formDraft = useFormDraft<api.ServiceTypeWebProfilePatch>({
    key: `service-type-web:${serviceTypeId}`,
    values: draft,
    label: "Website copy",
    maxBytes: 512 * 1024,
    enabled: !readOnly,
  });

  // Last line of defence for a full-page navigation or a closed tab. The draft
  // hook already flushes on `visibilitychange`; this is the prompt, not the
  // save, and browsers show their own wording for it.
  React.useEffect(() => {
    if (!isDirty || readOnly) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, readOnly]);

  function setField<K extends keyof api.ServiceTypeWebProfilePatch>(
    key: K,
    value: api.ServiceTypeWebProfilePatch[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }


  async function run(
    fn: () => Promise<api.ServiceTypeWebTab | void>,
    reseed: Reseed = RESEED_ALL,
    /** Re-seed this response by hand, when `reseed` is too blunt. */
    after?: (payload: api.ServiceTypeWebTab) => void,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result) {
        // Re-render from the response body only (guide: do not branch on 201 vs 200).
        applyTab(result, reseed);
        after?.(result);
      } else {
        setLocalTab(null);
        tab.reload();
      }
      return true;
    } catch (e) {
      // Surface server messages verbatim (LOCKED, BAD_FILE_TYPE, SLUG_TAKEN,
      // CONFLICT, validation). Never re-phrase.
      if (e instanceof ApiError) {
        setError(e.message || errMsg(e));
        // Slug regex 422 carries no suggestion — offer one computed locally.
        if (
          e.status === 422 &&
          (e.code === "VALIDATION_ERROR" || e.fields)
        ) {
          const fields = e.fields || {};
          if ("slug_fr" in fields || "slug_en" in fields) {
            setSlugHint({
              fr: suggestSlug(nameFr || serviceTypeKey, serviceTypeKey),
              en: suggestSlug(nameEn || nameFr || serviceTypeKey, serviceTypeKey),
            });
          }
        }
      } else {
        setError(errMsg(e));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(extra?: api.ServiceTypeWebProfilePatch) {
    const patch = { ...dirty, ...extra };
    if (Object.keys(patch).length === 0) {
      // Say so out loud. This returned silently, so "Save with nothing to do"
      // and "Save succeeded" looked identical from the outside — and after the
      // boxes had been reset by some other write, the silent one was what the
      // user got while believing their copy was safely stored.
      toast.info(tr("No changes to save."));
      return;
    }
    // What the user accepted in the box is what gets sent — never rewrite.
    //
    // `sent` is the draft as it stood at the moment of sending. A page this
    // size takes a visible moment to save, and the response must not roll back
    // a sentence typed while it was in flight — so we re-seed by hand here
    // rather than letting `applyTab` overwrite the boxes wholesale.
    const sent = draft;
    const ok = await run(
      () => api.upsertServiceTypeWeb(serviceTypeId, patch),
      RESEED_NONE,
      (payload) => {
        const fromServer = draftFromProfile(payload.profile);
        setDraft((current) => mergeAfterSave(current, sent, fromServer));
        setBaseline(fromServer);
      },
    );
    if (ok) {
      // The local rescue copy has done its job; keeping it would offer to
      // restore what is now simply the saved state.
      formDraft.clear();
      toast.success(tr("Website copy saved."));
    }
  }

  async function createPage() {
    // First save on empty state: same upsert verb. Seed slugs from names so the
    // row is useful immediately; the user can edit before publish.
    const seed: api.ServiceTypeWebProfilePatch = {
      slug_fr: suggestSlug(nameFr || serviceTypeKey, serviceTypeKey) || undefined,
      slug_en:
        suggestSlug(nameEn || nameFr || serviceTypeKey, serviceTypeKey) ||
        undefined,
    };
    await run(() => api.upsertServiceTypeWeb(serviceTypeId, seed));
  }

  /**
   * THE PICKED FILE IS THE PREVIEW, and it is why this state exists.
   *
   * Every dropzone on this screen used to be handed `file={null}`, hard-coded.
   * `<FileDrop>` already renders a thumbnail, the filename, the size and an
   * upload state from the file it is given — all of it was dead code here, so
   * choosing a cover produced no thumbnail, no filename, and no sign that
   * anything had happened. What replaced it, once the round trip finished, was
   * the first eight characters of a document UUID: `91ff95bb…`. Nobody can
   * confirm they uploaded the right photograph from that, which is exactly the
   * report this fixes — "I don't know if it uploaded, there is no preview".
   *
   * Held per slot rather than as one value because COVER and ICON are distinct
   * pictures that can each be mid-upload, and a single field would show one
   * slot's thumbnail under the other's dropzone.
   *
   * It is the LOCAL file, never a fetched one: the bytes are already in the
   * browser, so the preview costs nothing and — unlike reading the stored
   * document back — needs no permission the person editing a service type may
   * not have. A cover uploaded in an EARLIER session therefore still has no
   * thumbnail; see the note on the vault download in the media block below.
   */
  /**
   * One upload engine per media slot.
   *
   * Three explicit calls rather than a loop, because hooks must run in a fixed
   * order — and one shared uploader would mean a gallery upload driving the
   * cover slot's progress bar.
   *
   * `profile: "photo"` for all three: these are the pictures on the public
   * services page, so the enhancement chain is wanted. They are also the exact
   * screen this whole feature was reported against — it showed a filename and
   * then a tick, with nothing in between.
   */
  // Set below, once the gallery uploader exists — onAllComplete closes over
  // the uploader it belongs to, which cannot reference itself at creation.
  const galleryReset = React.useRef<(() => void) | null>(null);

  function useMediaUpload(role: MediaRole) {
    return useUpload<api.ServiceTypeWebTab>({
      profile: "photo",
      send: async (file, ctx) =>
        api.uploadServiceTypeWebMedia(
          serviceTypeId,
          {
            role,
            data_url: await fileToDataUrl(file),
            original_name: file.name,
          },
          ctx.onProgress,
        ),
      onAllComplete: () => {
        tab.reload();
        // A gallery frame clears its box — the list below is where the image
        // lives now, and the box has to be free for the next one.
        if (role === "GALLERY") galleryReset.current?.();
      },
    });
  }

  const coverUpload = useMediaUpload("COVER");
  const iconUpload = useMediaUpload("ICON");
  const galleryUpload = useMediaUpload("GALLERY");

  galleryReset.current = galleryUpload.reset;

  const uploaders: Record<MediaRole, ReturnType<typeof useMediaUpload>> = {
    COVER: coverUpload,
    ICON: iconUpload,
    GALLERY: galleryUpload,
  };

  function onUpload(role: MediaRole, file: File | null) {
    setMediaError(null);
    const uploader = uploaders[role];
    // Clearing the box — FileDrop's own "Remove file" — drops the preview
    // without touching what is stored. Removing the stored document is the
    // separate Remove button, which is destructive and says so.
    if (!file) {
      uploader.reset();
      return;
    }
    const problem = imageProblem(file);
    if (problem) {
      setMediaError(problem);
      return;
    }
    void uploader.pick([file]);
  }

  async function onRemoveMedia(docId: string) {
    await run(
      () => api.removeServiceTypeWebMedia(serviceTypeId, docId),
      RESEED_NONE,
    );
  }

  async function saveFaq() {
    const cleaned = faqRows
      .map((r, i) => ({
        question_fr: r.question_fr.trim(),
        question_en: r.question_en.trim(),
        answer_fr: r.answer_fr.trim(),
        answer_en: r.answer_en.trim(),
        sort_order: i * 10,
      }))
      .filter(
        (r) =>
          r.question_fr || r.question_en || r.answer_fr || r.answer_en,
      );
    // Server requires both languages on every row.
    for (const r of cleaned) {
      if (!r.question_fr || !r.question_en || !r.answer_fr || !r.answer_en) {
        setError(
          tr("Every FAQ row needs a question and answer in both French and English."),
        );
        return;
      }
    }
    await run(async () => {
      const out = await api.replaceServiceTypeWebFaq(serviceTypeId, cleaned);
      return out.tab;
    }, { faq: true });
  }

  async function saveRelated() {
    await run(async () => {
      const out = await api.replaceServiceTypeWebRelated(
        serviceTypeId,
        pickedRelated,
      );
      return out.tab;
    }, { related: true });
  }

  // Related-service search over the service-type list.
  const types = useResource(
    () => api.listServiceTypes({ includeInactive: false }),
    [],
  );
  const relatedCandidates = React.useMemo(() => {
    const rows = types.data || [];
    const needle = relatedQ.trim().toLowerCase();
    return rows
      .filter((r) => r.service_type_id !== serviceTypeId)
      .filter((r) => !pickedRelated.includes(r.service_type_id))
      .filter((r) => {
        if (!needle) return true;
        return (
          (r.name_en || "").toLowerCase().includes(needle) ||
          (r.name_fr || "").toLowerCase().includes(needle) ||
          (r.key || "").toLowerCase().includes(needle)
        );
      })
      .slice(0, 8);
  }, [types.data, relatedQ, pickedRelated, serviceTypeId]);

  /**
   * Active pillars — plus the one this service is ALREADY under, even if it has
   * since been hidden.
   *
   * Without that second half the select would find no option matching
   * `group_id` and fall back to rendering its first one, which is the unnamed
   * group: the box would state, wrongly and silently, that a service under a
   * hidden pillar belongs to no pillar at all. Nothing is lost on save (the
   * value is unchanged, so it is never in the patch) but the screen would be
   * lying about where the card sits, and the fix for a hidden pillar is to
   * un-hide it — which nobody does if they cannot see it is the one in use.
   */
  const pillarOptions = React.useMemo(() => {
    const all = pillars.data || [];
    const active = all.filter((g) => g.is_active !== false);
    const current = draft.group_id
      ? all.find((g) => g.group_id === draft.group_id)
      : undefined;
    return current && current.is_active === false ? [...active, current] : active;
  }, [pillars.data, draft.group_id]);

  if (tab.loading) return <LoadingRow label={tr("Loading website profile…")} />;
  if (tab.error) return <ErrorState message={tab.error} />;
  if (!data || !readiness) {
    return (
      <EmptyState
        title={tr("Not found")}
        hint={tr("This service type could not be loaded.")}
      />
    );
  }

  /* ── Empty state: no profile row yet ──────────────────────────────────── */
  if (!profile) {
    return (
      <div className="space-y-4" data-testid="web-empty-state">
        {isArchived && (
          <Callout tone="warn" title={tr("Archived service")}>
            {tr("Archived services are never public.")}
          </Callout>
        )}
        <EmptyState
          title={tr("No web page yet")}
          hint={tr(
            "Describe this service for your public website — bilingual copy, cover image, SEO slugs and FAQ. Creating a page never changes the operational form, milestones or dictionary.",
          )}
        />
        <p className="micro text-muted-foreground">
          {tr(
            "Customer-facing copy follows the brand register (BRAND_GLOSSARY_FR_EN.md) — clear, professional, never marketing-speak.",
          )}
        </p>
        {error && <ErrorState message={error} />}
        {canWrite && !isArchived && (
          <Button
            onClick={() => void createPage()}
            loading={busy}
            data-testid="web-create-page"
          >
            {tr("Create web page")}
          </Button>
        )}
      </div>
    );
  }

  const shortKey = `short_description_${lang}` as const;
  const longKey = `long_description_${lang}` as const;
  const coverKey = `coverage_${lang}` as const;
  const metaTitleKey = `meta_title_${lang}` as const;
  const metaDescKey = `meta_description_${lang}` as const;
  const slugKey = `slug_${lang}` as const;
  const highlightsKey = `highlights_${lang}` as const;
  const claimKey = `claim_${lang}` as const;

  const slugSuggestion = suggestSlug(
    lang === "fr" ? nameFr || serviceTypeKey : nameEn || nameFr || serviceTypeKey,
    serviceTypeKey,
  );
  const currentSlug = String(draft[slugKey] ?? "");

  return (
    <div className="space-y-6" data-testid="web-profile-editor">
      <ServiceTypeWebAiDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        serviceTypeId={serviceTypeId}
        hasExistingCopy={Boolean(
          String(draft.long_description_en ?? "").trim() ||
            String(draft.long_description_fr ?? "").trim(),
        )}
        current={draft}
        onApply={(patch, faq) => {
          // Into the DRAFT, never to the server. The author still presses Save,
          // which is also what makes this undoable — the rescue copy and the
          // baseline both still hold what was there before.
          setDraft((d) => ({ ...d, ...patch }));
          // The FAQ is a separate table behind its own Save, so it lands in the
          // FAQ editor's rows rather than in the profile draft.
          if (faq && faq.length) setFaqRows(faq);
          toast.success(
            faq && faq.length
              ? tr("Draft applied — review it, then Save and Save FAQ.")
              : tr("Draft applied — review it, then Save."),
          );
        }}
      />
      {formDraft.pending && (
        <DraftBanner
          savedAt={formDraft.pending.savedAt}
          what="website copy"
          onRestore={() => {
            const restored = formDraft.restore();
            // Merged over the current field set rather than replacing it, so a
            // draft written by an older build — one field short — cannot blank
            // a box it has never heard of.
            if (restored) setDraft((current) => ({ ...current, ...restored }));
          }}
          onDiscard={formDraft.discard}
        />
      )}
      {/* Status + publish strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {tr("Website page")}
            </h3>
            <Pill tone={isPublished ? "ok" : "mute"}>
              {isPublished ? tr("Published") : tr("Draft")}
            </Pill>
            {isArchived && <Pill tone="warn">{tr("Archived")}</Pill>}
          </div>
          {isArchived && (
            <Callout tone="warn" title={tr("Archived service")}>
              {tr("Archived services are never public.")}
            </Callout>
          )}
          <ReadinessChecklist
            readiness={readiness}
            onJumpNameEn={() => {
              // Open the existing service-type edit modal (parent's three-state
              // `editing`). The form lives on the parent and only reloads the
              // list on save — poll the tab GET briefly so readiness.name_en
              // ticks once the modal write lands (guide §3.1).
              onEditServiceType();
              setLocalTab(null);
              if (nameEnPollRef.current != null) {
                window.clearInterval(nameEnPollRef.current);
              }
              let n = 0;
              nameEnPollRef.current = window.setInterval(() => {
                n += 1;
                tab.reload();
                if (n >= 8 && nameEnPollRef.current != null) {
                  window.clearInterval(nameEnPollRef.current);
                  nameEnPollRef.current = null;
                }
              }, 1500);
            }}
            canWrite={canWrite && !isArchived}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && !isArchived && (
            <>
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => void saveProfile()}
              >
                {tr("Save")}
              </Button>
              {/* Beside Save rather than inside the Content block: it drafts the
                  whole page — both languages, the highlights, the meta fields —
                  not the one box it would otherwise sit under. */}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setAiOpen(true)}
                data-testid="web-ai-open"
              >
                {tr("Draft with AI")}
              </Button>
              {isPublished ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy}
                  onClick={() =>
                    void run(
                      () => api.unpublishServiceTypeWeb(serviceTypeId),
                      RESEED_NONE,
                    )
                  }
                  data-testid="web-unpublish"
                >
                  {tr("Unpublish")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={busy}
                  disabled={!readiness.publishable}
                  onClick={() =>
                    void run(
                      () => api.publishServiceTypeWeb(serviceTypeId),
                      RESEED_NONE,
                    )
                  }
                  data-testid="web-publish"
                >
                  {tr("Publish")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {/* Language toggle — side-by-side on wide screens for content */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={tr("Content language")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "fr", label: "FR" },
            { value: "en", label: "EN" },
          ]}
        />
        <p className="micro text-muted-foreground max-w-md">
          {tr(
            "Copy is customer-facing — follow BRAND_GLOSSARY_FR_EN.md register rules in both languages.",
          )}
        </p>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">{tr("Content")}</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label={`${tr("Short description")} (${lang.toUpperCase()})`}
            hint={tr("Card teaser and meta-description fallback.")}
          >
            <Textarea
              value={String(draft[shortKey] ?? "")}
              disabled={readOnly}
              maxLength={L.SHORT_DESCRIPTION_MAX}
              rows={3}
              onChange={(e) => setField(shortKey, e.target.value)}
            />
            <CharCount
              value={String(draft[shortKey] ?? "")}
              max={L.SHORT_DESCRIPTION_MAX}
            />
          </Field>
          <Field
            label={`${tr("Long description")} (${lang.toUpperCase()})`}
            hint={tr("Page body.")}
          >
            <Textarea
              value={String(draft[longKey] ?? "")}
              disabled={readOnly}
              maxLength={L.LONG_DESCRIPTION_MAX}
              rows={8}
              onChange={(e) => setField(longKey, e.target.value)}
            />
            <CharCount
              value={String(draft[longKey] ?? "")}
              max={L.LONG_DESCRIPTION_MAX}
            />
          </Field>
        </div>
        <HighlightsEditor
          lang={lang}
          value={(draft[highlightsKey] as string[]) || []}
          disabled={readOnly}
          onChange={(next) =>
            setField(highlightsKey, next.slice(0, L.HIGHLIGHTS_MAX))
          }
        />      </section>

      {/* ── Card ────────────────────────────────────────────────────────── */}
      {/* What the service looks like on the public services page: which pillar
          it sits under, the line its card closes on, and the brand token that
          tints it. All three are copy-level rather than slug/media, so they stay
          editable while published — the server locks only slugs and media. */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {tr("Card on the services page")}
        </h3>
        <Field
          label={`${tr("Closing line")} (${lang.toUpperCase()})`}
          hint={tr("One sentence the card ends on. Not a slogan — say what the service does for them.")}
        >
          <Input
            value={String(draft[claimKey] ?? "")}
            disabled={readOnly}
            maxLength={L.CLAIM_MAX}
            onChange={(e) => setField(claimKey, e.target.value)}
            data-testid={`web-claim-${lang}`}
          />
          <CharCount
            value={String(draft[claimKey] ?? "")}
            max={L.CLAIM_MAX}
          />
        </Field>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label={tr("Pillar")}
            hint={tr("The section of the services page this card sits under.")}
          >
            <div className="flex gap-2">
              <Select
                value={String(draft.group_id ?? "")}
                disabled={readOnly}
                aria-label={tr("Pillar")}
                data-testid="web-pillar"
                onChange={(e) => setField("group_id", e.target.value || null)}
              >
                {/* Empty is a real choice, not a placeholder: it puts the card in
                    the unnamed group at the foot of the page, which still renders. */}
                <option value="">{tr("Unnamed group (foot of the page)")}</option>
                {pillarOptions.map((g) => (
                  <option key={g.group_id} value={g.group_id}>
                    {g.name_fr}
                    {g.name_en ? ` · ${g.name_en}` : ""}
                    {g.is_active === false ? ` — ${tr("hidden")}` : ""}
                  </option>
                ))}
              </Select>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setPillarsOpen(true)}
                  data-testid="web-manage-pillars"
                >
                  {tr("Manage")}
                </Button>
              )}
            </div>
            {pillars.error && (
              <p className="micro text-destructive mt-1">{pillars.error}</p>
            )}
            {!pillars.loading && !pillars.error && (pillars.data || []).length === 0 && (
              <p className="micro text-muted-foreground mt-1">
                {tr("No pillars yet — every published service collects into one unnamed group.")}
              </p>
            )}
          </Field>
          <Field
            label={tr("Accent")}
            hint={tr("Which of your brand colours tints this card. Shown in your own palette.")}
          >
            <AccentPicker
              value={(draft.accent as api.ServiceTypeWebAccent) || "PRIMARY"}
              disabled={readOnly}
              onChange={(next) => setField("accent", next)}
            />
          </Field>
        </div>
        <p className="micro text-muted-foreground">
          {tr("The pillar and the accent are the same in both languages — only the closing line is per-language.")}
        </p>
      </section>

      <ServiceTypeWebPillars
        open={pillarsOpen}
        onClose={() => setPillarsOpen(false)}
        canWrite={canWrite && !isArchived}
        onChanged={() => {
          pillars.reload();
          // A deleted pillar is SET NULL on every profile under it, so this
          // service's own group_id may have just changed underneath the draft.
          // Re-read rather than leaving a stale id selected in the box.
          setLocalTab(null);
          tab.reload();
        }}
      />

      {/* ── Media ───────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{tr("Media")}</h3>
          {isPublished && (
            <p className="micro text-muted-foreground">
              {tr("Unpublish before changing slugs or media")}
            </p>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FileDrop
              {...fileDropProps(coverUpload.items[0])}
              disabled={mediaLocked || busy}
              accept={IMAGE_ACCEPT}
              label={`${tr("Cover image")} · ${tr("required to publish")}`}
              hint="PNG, JPEG or WebP · 10 MB maximum"
              error={mediaError ?? fileDropProps(coverUpload.items[0]).error}
              onPick={(file) => onUpload("COVER", file)}
            />
            {profile.cover_vault_id && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {/* The document id used to be the whole label, in monospace,
                      truncated to eight characters. It answers no question a
                      person editing a web page has — least of all "is my
                      photograph on there?" — so it is now the title attribute
                      (still there for a support conversation) behind a sentence
                      that says what the state actually is. */}
                  <span title={profile.cover_vault_id}>
                    {tr("Cover image stored")}
                  </span>
                  {readiness.cover.allowed ? (
                    <Pill tone="ok" className="ml-2">
                      {tr("Ready")}
                    </Pill>
                  ) : (
                    <Pill tone="warn" className="ml-2">
                      {tr("Not allowed")}
                    </Pill>
                  )}
                </span>
                {!mediaLocked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onRemoveMedia(profile.cover_vault_id!)}
                  >
                    {tr("Remove")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div>
            <FileDrop
              {...fileDropProps(iconUpload.items[0])}
              disabled={mediaLocked || busy}
              accept={IMAGE_ACCEPT}
              label={tr("Icon (optional)")}
              hint="PNG, JPEG or WebP · 10 MB maximum"
              onPick={(file) => onUpload("ICON", file)}
            />
            {profile.icon_vault_id && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span
                  className="text-muted-foreground"
                  title={profile.icon_vault_id}
                >
                  {tr("Icon stored")}
                </span>
                {!mediaLocked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onRemoveMedia(profile.icon_vault_id!)}
                  >
                    {tr("Remove")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        <div>
          <FileDrop
            {...fileDropProps(galleryUpload.items[0])}
            disabled={
              mediaLocked ||
              busy ||
              (profile.gallery_vault_ids || []).length >= L.GALLERY_MAX
            }
            accept={IMAGE_ACCEPT}
            label={tr("Add gallery image")}
            hint={`${tr("Up to")} ${L.GALLERY_MAX}`}
            onPick={(file) => onUpload("GALLERY", file)}
          />
          {(profile.gallery_vault_ids || []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {(profile.gallery_vault_ids || []).map((id, idx) => (
                <li
                  key={id}
                  className="flex items-center justify-between rounded border px-3 py-1.5 text-xs"
                >
                  <span className="font-mono text-muted-foreground">
                    {idx + 1}. {id.slice(0, 8)}…
                  </span>
                  <div className="flex gap-1">
                    {!mediaLocked && idx > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          const g = [...(profile.gallery_vault_ids || [])];
                          [g[idx - 1], g[idx]] = [g[idx], g[idx - 1]];
                          void run(
                            () =>
                              api.upsertServiceTypeWeb(serviceTypeId, {
                                gallery_vault_ids: g,
                              }),
                            RESEED_NONE,
                          );
                        }}
                      >
                        ↑
                      </Button>
                    )}
                    {!mediaLocked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void onRemoveMedia(id)}
                      >
                        {tr("Remove")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field
          label={tr("Video URL")}
          hint={tr("YouTube, Vimeo or Dailymotion embed only.")}
        >
          <Input
            value={String(draft.video_url ?? "")}
            disabled={readOnly}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(e) => setField("video_url", e.target.value)}
          />
        </Field>
      </section>

      {/* ── SEO ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{tr("SEO")}</h3>
          {isPublished && (
            <p className="micro text-muted-foreground">
              {tr("Unpublish before changing slugs or media")}
            </p>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label={`slug_${lang}`}
            hint={
              slugLocked
                ? tr("Unpublish before changing slugs or media")
                : `${tr("Suggestion")}: ${slugSuggestion}`
            }
          >
            <div className="flex gap-2">
              <Input
                value={currentSlug}
                disabled={slugLocked}
                aria-label={`slug_${lang}`}
                data-testid={`web-slug-${lang}`}
                onChange={(e) => {
                  // Typed value is stored as-is — never silently rewrite on save.
                  setField(slugKey, e.target.value);
                }}
              />
              {!slugLocked && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setField(slugKey, slugSuggestion)}
                >
                  {tr("Use suggestion")}
                </Button>
              )}
            </div>
            {currentSlug && !isValidSlug(currentSlug) && (
              <p className="micro text-destructive mt-1">
                {tr("Slug must be lowercase ASCII with single dashes.")}{" "}
                {tr("Suggestion")}: {slugSuggestion}
              </p>
            )}
            {slugHint[lang] && (
              <p className="micro mt-1">
                {tr("Suggestion")}:{" "}
                <button
                  type="button"
                  className="text-primary-ink underline"
                  onClick={() => setField(slugKey, slugHint[lang]!)}
                >
                  {slugHint[lang]}
                </button>
              </p>
            )}
            <p className="micro text-muted-foreground mt-1" data-testid="web-slug-preview">
              {tr("Preview")}: /{lang}/
              {currentSlug || slugSuggestion || "…"}
            </p>
          </Field>
          <div className="space-y-3">
            <Field label={`${tr("Meta title")} (${lang.toUpperCase()})`}>
              <Input
                value={String(draft[metaTitleKey] ?? "")}
                disabled={readOnly}
                maxLength={L.META_TITLE_MAX}
                onChange={(e) => setField(metaTitleKey, e.target.value)}
              />
              <CharCount
                value={String(draft[metaTitleKey] ?? "")}
                max={L.META_TITLE_MAX}
                fallback={lang === "fr" ? nameFr : nameEn || nameFr}
              />
            </Field>
            <Field label={`${tr("Meta description")} (${lang.toUpperCase()})`}>
              <Textarea
                value={String(draft[metaDescKey] ?? "")}
                disabled={readOnly}
                maxLength={L.META_DESCRIPTION_MAX}
                rows={3}
                onChange={(e) => setField(metaDescKey, e.target.value)}
              />
              <CharCount
                value={String(draft[metaDescKey] ?? "")}
                max={L.META_DESCRIPTION_MAX}
                fallback={String(draft[shortKey] ?? "") || undefined}
              />
            </Field>
          </div>
        </div>
        <p className="micro text-muted-foreground">
          {tr("Share image falls back to the cover.")}
        </p>
      </section>

      {/* ── Page sections ───────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {tr("Page sections")}
        </h3>

        <Field
          label={`${tr("Coverage note")} (${lang.toUpperCase()})`}
          hint={tr("Optional geography or scope note on the public page.")}
        >
          <Textarea
            value={String(draft[coverKey] ?? "")}
            disabled={readOnly}
            maxLength={L.COVERAGE_MAX}
            rows={3}
            onChange={(e) => setField(coverKey, e.target.value)}
          />
          <CharCount
            value={String(draft[coverKey] ?? "")}
            max={L.COVERAGE_MAX}
          />
        </Field>

        {/* FAQ — live while published (server lock removed in PR1 audit fix). */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-foreground">{tr("FAQ")}</h4>
            <div className="flex gap-2">
              {!readOnly && faqRows.length < L.FAQ_MAX && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFaqRows((rows) => [
                      ...rows,
                      {
                        question_fr: "",
                        question_en: "",
                        answer_fr: "",
                        answer_en: "",
                      },
                    ])
                  }
                >
                  {tr("Add FAQ")}
                </Button>
              )}
              {!readOnly && (
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() => void saveFaq()}
                >
                  {tr("Save FAQ")}
                </Button>
              )}
            </div>
          </div>
          {faqRows.length === 0 && (
            <p className="micro text-muted-foreground">
              {tr("No FAQ rows yet. Add bilingual Q&A pairs for the public page.")}
            </p>
          )}
          {faqRows.map((row, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border p-3"
              data-testid={`web-faq-row-${i}`}
            >
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={`${tr("Question")} FR`}>
                  <Input
                    value={row.question_fr}
                    disabled={readOnly}
                    maxLength={L.QUESTION_MAX}
                    onChange={(e) =>
                      setFaqRows((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, question_fr: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`${tr("Question")} EN`}>
                  <Input
                    value={row.question_en}
                    disabled={readOnly}
                    maxLength={L.QUESTION_MAX}
                    onChange={(e) =>
                      setFaqRows((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, question_en: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`${tr("Answer")} FR`}>
                  <Textarea
                    value={row.answer_fr}
                    disabled={readOnly}
                    maxLength={L.ANSWER_MAX}
                    rows={3}
                    onChange={(e) =>
                      setFaqRows((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, answer_fr: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`${tr("Answer")} EN`}>
                  <Textarea
                    value={row.answer_en}
                    disabled={readOnly}
                    maxLength={L.ANSWER_MAX}
                    rows={3}
                    onChange={(e) =>
                      setFaqRows((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, answer_en: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setFaqRows((rows) => rows.filter((_, idx) => idx !== i))
                  }
                >
                  {tr("Remove")}
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Related services — live while published. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-foreground">
              {tr("Related services")}
            </h4>
            {!readOnly && (
              <Button
                size="sm"
                loading={busy}
                onClick={() => void saveRelated()}
              >
                {tr("Save related")}
              </Button>
            )}
          </div>
          {pickedRelated.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pickedRelated.map((id) => (
                <li key={id}>
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                    {relatedLabel(
                      data.related,
                      id,
                      (types.data || []).find((t) => t.service_type_id === id)
                        ?.name_en ||
                        (types.data || []).find((t) => t.service_type_id === id)
                          ?.name_fr,
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={tr("Remove")}
                        onClick={() =>
                          setPickedRelated((ids) => ids.filter((x) => x !== id))
                        }
                      >
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="space-y-2">
              <Input
                value={relatedQ}
                onChange={(e) => setRelatedQ(e.target.value)}
                placeholder={tr("Search service types…")}
                aria-label={tr("Search service types…")}
              />
              <ul className="max-h-40 space-y-1 overflow-auto">
                {relatedCandidates.map((t) => (
                  <li key={t.service_type_id}>
                    <button
                      type="button"
                      className="w-full rounded-md border px-3 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() =>
                        setPickedRelated((ids) =>
                          ids.includes(t.service_type_id)
                            ? ids
                            : [...ids, t.service_type_id],
                        )
                      }
                    >
                      {t.name_en || t.name_fr}{" "}
                      <span className="micro font-mono">{t.key}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default ServiceTypeWebTab;
