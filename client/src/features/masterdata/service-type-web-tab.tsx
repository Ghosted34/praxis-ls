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
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { FileDrop } from "@/components/ui/file-drop";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { errMsg, useResource } from "@/lib/use-resource";
import { ApiError } from "@/lib/api-client";
import { readFileAsDataUrl } from "@/lib/vault-file";
import { slug as suggestSlug, isValidSlug } from "@/lib/slug";
import * as api from "@/lib/operations-api";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const L = api.SERVICE_TYPE_WEB_LIMITS;

type Lang = "fr" | "en";

function imageProblem(file: File): string | null {
  if (!file.size) return "That image is empty.";
  if (file.size > IMAGE_MAX_BYTES) return "Images must be no larger than 10 MB.";
  if (!IMAGE_ACCEPT.split(",").includes(file.type.toLowerCase())) {
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

/* ── Root tab ────────────────────────────────────────────────────────────── */

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
  const nameEnPollRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (nameEnPollRef.current != null) {
        window.clearInterval(nameEnPollRef.current);
      }
    },
    [],
  );

  const applyTab = React.useCallback((payload: api.ServiceTypeWebTab) => {
    setLocalTab(payload);
    const p = payload.profile;
    const next: api.ServiceTypeWebProfilePatch = {
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
    };
    setDraft(next);
    setBaseline(next);
    setFaqRows(
      (payload.faq || []).map((r) => ({
        question_fr: r.question_fr,
        question_en: r.question_en,
        answer_fr: r.answer_fr,
        answer_en: r.answer_en,
        sort_order: r.sort_order,
      })),
    );
    setPickedRelated(relatedIds(payload.related));
    setSlugHint({});
    setError(null);
  }, []);

  // Seed from GET; clear the local override when the service type (or its
  // name_en) changes so a jump-modal save re-applies the fresh readiness.
  React.useEffect(() => {
    setLocalTab(null);
  }, [serviceTypeId, serviceTypeNameEn]);

  React.useEffect(() => {
    if (tab.data && !localTab) applyTab(tab.data);
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

  function setField<K extends keyof api.ServiceTypeWebProfilePatch>(
    key: K,
    value: api.ServiceTypeWebProfilePatch[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  /** Build the omitted-keys-unchanged patch — only dirty keys. */
  function dirtyPatch(): api.ServiceTypeWebProfilePatch {
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
        } else {
          (out as Record<string, unknown>)[k] = a;
        }
      }
    }
    // Never send empty slug strings — the regex rejects ""; leave omitted.
    if (out.slug_fr === "") delete out.slug_fr;
    if (out.slug_en === "") delete out.slug_en;
    return out;
  }

  async function run(fn: () => Promise<api.ServiceTypeWebTab | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result) {
        // Re-render from the response body only (guide: do not branch on 201 vs 200).
        applyTab(result);
      } else {
        setLocalTab(null);
        tab.reload();
      }
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
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(extra?: api.ServiceTypeWebProfilePatch) {
    const patch = { ...dirtyPatch(), ...extra };
    if (Object.keys(patch).length === 0 && !extra) {
      setError(null);
      return;
    }
    // What the user accepted in the box is what gets sent — never rewrite.
    await run(() => api.upsertServiceTypeWeb(serviceTypeId, patch));
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

  async function onUpload(role: "COVER" | "ICON" | "GALLERY", file: File | null) {
    setMediaError(null);
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      setMediaError(problem);
      return;
    }
    await run(async () => {
      const data_url = await readFileAsDataUrl(file);
      return api.uploadServiceTypeWebMedia(serviceTypeId, {
        role,
        data_url,
        original_name: file.name,
      });
    });
  }

  async function onRemoveMedia(docId: string) {
    await run(() => api.removeServiceTypeWebMedia(serviceTypeId, docId));
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
    });
  }

  async function saveRelated() {
    await run(async () => {
      const out = await api.replaceServiceTypeWebRelated(
        serviceTypeId,
        pickedRelated,
      );
      return out.tab;
    });
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

  const slugSuggestion = suggestSlug(
    lang === "fr" ? nameFr || serviceTypeKey : nameEn || nameFr || serviceTypeKey,
    serviceTypeKey,
  );
  const currentSlug = String(draft[slugKey] ?? "");

  return (
    <div className="space-y-6" data-testid="web-profile-editor">
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
              {isPublished ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy}
                  onClick={() =>
                    void run(() => api.unpublishServiceTypeWeb(serviceTypeId))
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
                    void run(() => api.publishServiceTypeWeb(serviceTypeId))
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
              file={null}
              disabled={mediaLocked || busy}
              accept={IMAGE_ACCEPT}
              label={`${tr("Cover image")} · ${tr("required to publish")}`}
              hint="PNG, JPEG or WebP · 10 MB maximum"
              error={mediaError}
              onPick={(file) => void onUpload("COVER", file)}
            />
            {profile.cover_vault_id && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="font-mono text-muted-foreground">
                  {profile.cover_vault_id.slice(0, 8)}…
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
              file={null}
              disabled={mediaLocked || busy}
              accept={IMAGE_ACCEPT}
              label={tr("Icon (optional)")}
              hint="PNG, JPEG or WebP · 10 MB maximum"
              onPick={(file) => void onUpload("ICON", file)}
            />
            {profile.icon_vault_id && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="font-mono text-muted-foreground">
                  {profile.icon_vault_id.slice(0, 8)}…
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
            file={null}
            disabled={
              mediaLocked ||
              busy ||
              (profile.gallery_vault_ids || []).length >= L.GALLERY_MAX
            }
            accept={IMAGE_ACCEPT}
            label={tr("Add gallery image")}
            hint={`${tr("Up to")} ${L.GALLERY_MAX}`}
            onPick={(file) => void onUpload("GALLERY", file)}
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
                          void run(() =>
                            api.upsertServiceTypeWeb(serviceTypeId, {
                              gallery_vault_ids: g,
                            }),
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
