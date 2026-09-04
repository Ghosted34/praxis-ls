/**
 * One article: what it is called, where it lives, and what it says.
 *
 * ── ONE SAVE, NOT A SAVE PER FIELD ────────────────────────────────────────
 *
 * The pages editor autosaves each block as it is touched, because a block is a
 * small independent object and a writer rearranges ten of them in a minute. An
 * article is one long text somebody is in the middle of writing, and a save on
 * every keystroke-settled field would push half-written prose to the server and
 * make the undo story "whatever was last flushed". So: a dirty flag, one Save,
 * and a warning before leaving with unsaved work.
 *
 * ── WHY THE SLUG IS SUGGESTED AND NOT IMPOSED ─────────────────────────────
 *
 * It is the article's public address, so once it is published somewhere it is a
 * link somebody may have sent. The field is prefilled from the headline while it
 * is empty and left alone the moment a person types in it — the same behaviour
 * the service Website tab has, so the two do not teach different habits.
 *
 * ── THE COVER SAVES IMMEDIATELY, THE TEXT DOES NOT ────────────────────────
 *
 * Everything else on this screen waits for Save. The cover does not, and the
 * inconsistency is deliberate: an upload is a round trip that returns a
 * document id, and holding that id in local state until somebody presses Save
 * would mean a file already in the vault, already scoped for public serving,
 * that the article does not yet point at — an orphan if the tab is closed. So
 * the upload IS the save for that one field, and the response replaces the row.
 */
import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { SettingsCard } from "@/components/settings/controls";
import { Field } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { FileDrop } from "@/components/ui/file-drop";
import { Callout } from "@/components/ui/callout";
import { useResource, errMsg } from "@/lib/use-resource";
import { slug as suggestSlug, isValidSlug } from "@/lib/slug";
import { readFileAsDataUrl } from "@/lib/vault-file";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/insights-api";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Mirrors `GALLERY_MAX` in the insight service, which enforces it. Stated here
 *  so the button disables instead of the upload 422-ing. */
const GALLERY_MAX = 12;

/** The editable half of the row, as strings — every field the form writes.
 *  `null` upstream becomes "" here and "" becomes `null` on the way back, so a
 *  cleared field is a cleared field rather than a translated-to-nothing empty
 *  string on a public page. */
type Draft = {
  title_fr: string; title_en: string;
  slug_fr: string; slug_en: string;
  excerpt_fr: string; excerpt_en: string;
  body_fr: string; body_en: string;
  meta_title_fr: string; meta_title_en: string;
  meta_description_fr: string; meta_description_en: string;
  tags: string;
};

const EMPTY: Draft = {
  title_fr: "", title_en: "",
  slug_fr: "", slug_en: "",
  excerpt_fr: "", excerpt_en: "",
  body_fr: "", body_en: "",
  meta_title_fr: "", meta_title_en: "",
  meta_description_fr: "", meta_description_en: "",
  tags: "",
};

const s = (v: string | null | undefined) => v ?? "";
const orNull = (v: string) => (v.trim() ? v.trim() : null);

function toDraft(row: api.InsightArticle): Draft {
  return {
    title_fr: s(row.title_fr), title_en: s(row.title_en),
    slug_fr: s(row.slug_fr), slug_en: s(row.slug_en),
    excerpt_fr: s(row.excerpt_fr), excerpt_en: s(row.excerpt_en),
    body_fr: s(row.body_fr), body_en: s(row.body_en),
    meta_title_fr: s(row.meta_title_fr), meta_title_en: s(row.meta_title_en),
    meta_description_fr: s(row.meta_description_fr),
    meta_description_en: s(row.meta_description_en),
    tags: (row.tags || []).join(", "),
  };
}

export function WebsiteInsightEditorPage() {
  const { articleId = "" } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useResource(
    () => api.fetchInsight(articleId),
    [articleId],
  );

  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  // Once somebody has typed in a slug box it is theirs, even if they clear it.
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [coverBusy, setCoverBusy] = React.useState(false);
  const [coverError, setCoverError] = React.useState<string | null>(null);
  const [removingCover, setRemovingCover] = React.useState(false);

  React.useEffect(() => {
    if (data) {
      setDraft(toDraft(data));
      setDirty(false);
      setSlugTouched(Boolean(data.slug_fr || data.slug_en));
    }
  }, [data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  /* Suggested from the headline while the writer has not touched either box.
     Not applied on save — shown in the field, so what they see is what will be
     stored and there is no surprise address on a published article. */
  const suggestedFr = suggestSlug(draft.title_fr, articleId);
  const suggestedEn = suggestSlug(draft.title_en || draft.title_fr, articleId);
  const slugFr = slugTouched ? draft.slug_fr : draft.slug_fr || suggestedFr;
  const slugEn = slugTouched ? draft.slug_en : draft.slug_en || suggestedEn;

  const slugFrBad = Boolean(slugFr) && !isValidSlug(slugFr);
  const slugEnBad = Boolean(slugEn) && !isValidSlug(slugEn);
  const canSave =
    dirty && !busy && Boolean(draft.title_fr.trim()) && !slugFrBad && !slugEnBad;

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await api.updateInsight(articleId, {
        title_fr: draft.title_fr.trim(),
        title_en: orNull(draft.title_en),
        slug_fr: orNull(slugFr),
        slug_en: orNull(slugEn),
        excerpt_fr: orNull(draft.excerpt_fr),
        excerpt_en: orNull(draft.excerpt_en),
        body_fr: orNull(draft.body_fr),
        body_en: orNull(draft.body_en),
        meta_title_fr: orNull(draft.meta_title_fr),
        meta_title_en: orNull(draft.meta_title_en),
        meta_description_fr: orNull(draft.meta_description_fr),
        meta_description_en: orNull(draft.meta_description_en),
        // Split, trimmed, blanks dropped — "logistique, douane," is two tags.
        tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setDirty(false);
      reload();
    } catch (err) {
      setSaveError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  /** Refused here as well as in the vault, so the common mistakes cost a
   *  sentence rather than a round trip and a 422. */
  function imageProblem(file: File): string | null {
    if (!file.size) return tr("That image is empty.");
    if (file.size > IMAGE_MAX_BYTES) return tr("Images must be no larger than 10 MB.");
    if (!IMAGE_ACCEPT.split(",").includes(file.type.toLowerCase())) {
      return tr("Choose a PNG, JPEG or WebP image.");
    }
    return null;
  }

  async function onPickCover(file: File | null) {
    setCoverError(null);
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      setCoverError(problem);
      return;
    }
    setCoverBusy(true);
    try {
      await api.setInsightCover(articleId, {
        data_url: await readFileAsDataUrl(file),
        original_name: file.name,
      });
      reload();
    } catch (err) {
      setCoverError(errMsg(err));
    } finally {
      setCoverBusy(false);
    }
  }

  async function onPickGalleryImage(file: File | null) {
    setCoverError(null);
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      setCoverError(problem);
      return;
    }
    setCoverBusy(true);
    try {
      await api.addInsightGalleryImage(articleId, {
        data_url: await readFileAsDataUrl(file),
        original_name: file.name,
      });
      reload();
    } catch (err) {
      setCoverError(errMsg(err));
    } finally {
      setCoverBusy(false);
    }
  }

  /** Reorder and remove are one call: the array is the display order, so both
   *  are "store this list". */
  async function saveGallery(ids: string[]) {
    setCoverError(null);
    setCoverBusy(true);
    try {
      await api.setInsightGallery(articleId, ids);
      reload();
    } catch (err) {
      setCoverError(errMsg(err));
    } finally {
      setCoverBusy(false);
    }
  }

  async function onRemoveCover() {
    setCoverError(null);
    setCoverBusy(true);
    try {
      await api.removeInsightCover(articleId);
      setRemovingCover(false);
      reload();
    } catch (err) {
      setCoverError(errMsg(err));
    } finally {
      setCoverBusy(false);
    }
  }

  function leave() {
    if (dirty) {
      setLeaving(true);
      return;
    }
    nav("/settings/website/articles");
  }

  if (loading) return <LoadingRow />;
  if (error) return <ErrorState message={error} />;

  const published = Boolean(data?.is_published);
  const coverId = data?.cover_vault_id ?? null;
  const gallery = data?.gallery_vault_ids ?? [];

  return (
    <section className={cn(pageShell.standard, "pb-24")}>
      <PageHeader
        eyebrow={<HubCrumb area="Insights" to="/settings/website/articles" />}
        title={data ? data.title_fr : tr("Article")}
        description="What it is called, where it lives on your site, and what it says."
        action={
          <div className="flex items-center gap-3">
            <Pill tone={published ? "ok" : "mute"}>
              {published ? tr("Published") : tr("Draft")}
            </Pill>
            <Button variant="outline" onClick={leave}>
              {tr("All articles")}
            </Button>
            <Button disabled={!canSave} loading={busy} onClick={save}>
              {tr("Save")}
            </Button>
          </div>
        }
      />

      {published && (
        /* A published article is live while it is being edited, and a save goes
           straight to the public page. Saying so is the difference between a
           writer drafting a rewrite in the box and a writer publishing three
           half-finished paragraphs to their own site. */
        <Callout tone="warn" title={tr("This article is live")}>
          Every save goes straight to your public site. To rework it out of
          sight, unpublish it from the list first.
        </Callout>
      )}

      <SettingsCard
        title={tr("Headline and address")}
        desc="French is required; English is optional and the public page falls back to French when it is missing."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Headline (French)")} required
            error={!draft.title_fr.trim() ? tr("French is required.") : undefined}>
            <Input value={draft.title_fr} onChange={(e) => set("title_fr", e.target.value)} />
          </Field>
          <Field label={tr("Headline (English)")}>
            <Input value={draft.title_en} onChange={(e) => set("title_en", e.target.value)} />
          </Field>
          <Field
            label={tr("Address (French)")}
            hint="The last part of the article's URL. Suggested from the headline until you type here."
            error={slugFrBad ? tr("Lowercase letters, digits and hyphens.") : undefined}
          >
            <Input className="font-mono" value={slugFr}
              onChange={(e) => { setSlugTouched(true); set("slug_fr", e.target.value); }} />
          </Field>
          <Field
            label={tr("Address (English)")}
            error={slugEnBad ? tr("Lowercase letters, digits and hyphens.") : undefined}
          >
            <Input className="font-mono" value={slugEn}
              onChange={(e) => { setSlugTouched(true); set("slug_en", e.target.value); }} />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard
        title={tr("Cover image")}
        desc="Shown on the Insights index and across the top of the article. Optional — an article without one reads as text, not as broken."
      >
        <FileDrop
          file={null}
          onPick={(f) => void onPickCover(f)}
          accept={IMAGE_ACCEPT}
          disabled={coverBusy}
          label={coverId ? tr("Replace the cover") : tr("Add a cover")}
          hint={tr("PNG, JPEG or WebP, up to 10 MB.")}
          error={coverError || undefined}
        />
        {coverId && (
          <div className="mt-4 flex flex-wrap items-start gap-4">
            {/* A preview only where one can exist.

                The public media route refuses a document whose article is not
                published, so a draft's cover would render as a broken frame —
                which reads as a failed upload rather than as the correct
                answer. Published: the image, from the same URL the site uses.
                Draft: the document id and a sentence saying it is stored and
                not yet public. */}
            {published ? (
              <img
                src={api.insightCoverUrl(coverId) || undefined}
                alt=""
                className="h-24 w-40 rounded-[calc(var(--radius)-2px)] border object-cover"
              />
            ) : (
              <div className="flex h-24 w-40 items-center justify-center rounded-[calc(var(--radius)-2px)] border border-dashed text-center text-xs text-muted-foreground">
                {tr("Stored — visible once the article is published")}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">
                {coverId.slice(0, 8)}…
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={coverBusy}
                onClick={() => setRemovingCover(true)}
              >
                {tr("Remove cover")}
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={tr("Images in the article")}
        desc="Drawn as a grid below the text, in the order here. They cannot be placed between paragraphs — the article body is plain text on purpose, so images live in one strip underneath."
      >
        <FileDrop
          file={null}
          onPick={(f) => void onPickGalleryImage(f)}
          accept={IMAGE_ACCEPT}
          disabled={coverBusy || gallery.length >= GALLERY_MAX}
          label={tr("Add an image")}
          hint={
            gallery.length >= GALLERY_MAX
              ? tr("That is the most an article can carry.")
              : tr("PNG, JPEG or WebP, up to 10 MB.")
          }
        />
        {gallery.length > 0 && (
          <ul className="mt-4 space-y-2">
            {gallery.map((id, i) => (
              <li
                key={id}
                className="flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-2px)] border p-2"
              >
                {published ? (
                  <img
                    src={api.insightCoverUrl(id) || undefined}
                    alt=""
                    className="h-14 w-20 rounded-[calc(var(--radius)-4px)] border object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-20 items-center justify-center rounded-[calc(var(--radius)-4px)] border border-dashed text-[10px] text-muted-foreground">
                    {tr("Draft")}
                  </div>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {i + 1}. {id.slice(0, 8)}…
                </span>
                <div className="ms-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={coverBusy || i === 0}
                    onClick={() => {
                      const next = [...gallery];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      void saveGallery(next);
                    }}
                  >
                    {tr("Up")}
                  </Button>
                  <Button size="sm" variant="ghost"
                    disabled={coverBusy || i === gallery.length - 1}
                    onClick={() => {
                      const next = [...gallery];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      void saveGallery(next);
                    }}
                  >
                    {tr("Down")}
                  </Button>
                  {/* No confirmation on a single image, unlike the cover.
                      Removing one of twelve is cheap to undo — upload it again —
                      and a dialog on every thumbnail turns arranging a gallery
                      into twelve dialogs. The file is archived, not deleted. */}
                  <Button size="sm" variant="ghost" disabled={coverBusy}
                    onClick={() => void saveGallery(gallery.filter((g) => g !== id))}
                  >
                    {tr("Remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title={tr("The article")}
        desc="The excerpt is the line under the headline on the Insights index. The body is the article itself."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Excerpt (French)")}>
            <Textarea rows={3} value={draft.excerpt_fr}
              onChange={(e) => set("excerpt_fr", e.target.value)} />
          </Field>
          <Field label={tr("Excerpt (English)")}>
            <Textarea rows={3} value={draft.excerpt_en}
              onChange={(e) => set("excerpt_en", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={tr("Body (French)")}
            hint="Plain text and simple markdown. Blank lines separate paragraphs.">
            <Textarea rows={16} value={draft.body_fr}
              onChange={(e) => set("body_fr", e.target.value)} />
          </Field>
          <Field label={tr("Body (English)")}>
            <Textarea rows={16} value={draft.body_en}
              onChange={(e) => set("body_en", e.target.value)} />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard
        title={tr("Tags and search")}
        desc="Tags filter the Insights index. The search fields are what a search engine and a shared link show; left blank, the headline and excerpt are used."
      >
        <Field label={tr("Tags")} hint="Separated by commas.">
          <Input value={draft.tags} onChange={(e) => set("tags", e.target.value)}
            placeholder="douane, transit, conteneur" />
        </Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={tr("Search title (French)")}>
            <Input value={draft.meta_title_fr}
              onChange={(e) => set("meta_title_fr", e.target.value)} />
          </Field>
          <Field label={tr("Search title (English)")}>
            <Input value={draft.meta_title_en}
              onChange={(e) => set("meta_title_en", e.target.value)} />
          </Field>
          <Field label={tr("Search description (French)")}>
            <Textarea rows={2} value={draft.meta_description_fr}
              onChange={(e) => set("meta_description_fr", e.target.value)} />
          </Field>
          <Field label={tr("Search description (English)")}>
            <Textarea rows={2} value={draft.meta_description_en}
              onChange={(e) => set("meta_description_en", e.target.value)} />
          </Field>
        </div>
      </SettingsCard>

      {saveError && <ErrorState message={saveError} />}

      <ConfirmDialog
        open={removingCover}
        onClose={() => setRemovingCover(false)}
        busy={coverBusy}
        destructive
        title={tr("Remove the cover?")}
        confirmLabel={tr("Remove")}
        onConfirm={() => void onRemoveCover()}
        body={
          published
            ? "It comes off the live article straight away. The file is archived, not deleted, but you would upload it again to put it back."
            : "The file is archived, not deleted, but you would upload it again to put it back."
        }
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        destructive
        title={tr("Leave without saving?")}
        confirmLabel={tr("Discard changes")}
        onConfirm={() => {
          setLeaving(false);
          nav("/settings/website/articles");
        }}
        body="The edits you have made to this article have not been saved and will be lost."
      />
    </section>
  );
}

export default WebsiteInsightEditorPage;
