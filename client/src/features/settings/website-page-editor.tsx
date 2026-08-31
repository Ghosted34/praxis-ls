/**
 * One website page — its identity, and the blocks that make up its content.
 *
 * ── WHY ONLY TWO BLOCK TYPES HAVE A FORM ───────────────────────────────────
 *
 * The block library has fifteen. `public-web` renders two: the proof strip
 * under the hero reads the home page's `stat_counters` and `stat_chips`. An
 * editor offering the other thirteen would let a marketing person spend an
 * afternoon authoring a `leader_message` that no page displays — which is worse
 * than an editor that is visibly narrow, because the first reads as broken and
 * the second as unfinished. The list grows in the same commit that teaches
 * `public-web` to draw another one, or it is the same bug again.
 *
 * Blocks of the other thirteen types are NOT hidden. A page created through the
 * API can carry them, and a screen that pretended otherwise would silently drop
 * them out of the reorder — so they are listed, named, counted in the order, and
 * left alone.
 *
 * ── WHY A FIGURE HAS BOTH A VALUE AND A METRIC ────────────────────────────
 *
 * `value` is the literal; `metric_key` optionally binds it to the registry in
 * `site_content.metrics.js`, and the server replaces the literal with the live
 * number before the public page ever sees it. So the literal is not dead — it
 * is what shows when a metric is unknown, absent, or returns nothing, which is
 * the normal state of `operations.avg_clearance_hours` until a service type has
 * its clearance stages marked. That is why the form asks for both and says so:
 * a bound stat with a literal of 0 publishes "0" on the day the metric cannot
 * answer, and nobody would guess why.
 *
 * ── FRENCH AND ENGLISH SIDE BY SIDE ───────────────────────────────────────
 *
 * Not a language toggle. French is required and English is optional, and the
 * public page falls back FR↔EN rather than blanking — so a missing translation
 * is a real, silent outcome, and the form that hides it behind a switch is the
 * form you can save having never looked.
 */
import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { SettingsCard, Toggle } from "@/components/settings/controls";
import { Field, Select } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { useResource, errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/site-content-api";

/* ── small shared shapes ──────────────────────────────────────────────────── */

const BLOCK_LABEL: Record<string, string> = {
  stat_counters: "Figures",
  stat_chips: "Credentials",
};

/** A block type this screen can draw a form for. */
const isEditable = (t: string): t is api.EditableBlockType =>
  (api.EDITABLE_BLOCK_TYPES as string[]).includes(t);

const blank = (): api.Bilingual => ({ fr: "", en: "" });

/** Blank means "not set", which is `null` upstream — never `""`, which for a
 *  slug fails the pattern and for a translation renders as translated-to-nothing. */
const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

const bi = (v: api.Bilingual): api.Bilingual => ({
  fr: v.fr.trim(),
  en: orNull(v.en ?? ""),
});

/** Move `from` to `to` in a copy. Used for both blocks and the items inside
 *  one, because they are the same gesture and two implementations of it drift. */
function moved<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/**
 * Both languages of one field, in one row.
 *
 * The FR side carries `required` because the schema does. The EN side says
 * "optional" rather than being silently blank, so the person filling it in
 * knows that leaving it produces a French heading on an English page rather
 * than an empty one.
 */
function BiRow({
  label,
  value,
  onChange,
  required,
  placeholderFr,
  placeholderEn,
}: {
  label: string;
  value: api.Bilingual;
  onChange: (v: api.Bilingual) => void;
  required?: boolean;
  placeholderFr?: string;
  placeholderEn?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label={`${label} ${tr("(French)")}`}
        required={required}
        error={
          required && !value.fr.trim() ? tr("French is required.") : undefined
        }
      >
        <Input
          value={value.fr}
          onChange={(e) => onChange({ ...value, fr: e.target.value })}
          placeholder={placeholderFr}
        />
      </Field>
      <Field label={`${label} ${tr("(English)")}`} hint={tr("Optional — falls back to French.")}>
        <Input
          value={value.en ?? ""}
          onChange={(e) => onChange({ ...value, en: e.target.value })}
          placeholder={placeholderEn}
        />
      </Field>
    </div>
  );
}

/* ── the screen ───────────────────────────────────────────────────────────── */

export function WebsitePageEditorPage() {
  const { pageId = "" } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useResource(
    () => api.fetchSitePage(pageId),
    [pageId],
  );
  const [meta, setMeta] = React.useState<api.SiteMeta | null>(null);

  React.useEffect(() => {
    let alive = true;
    // Uncached — see the note in website-pages.tsx.
    api
      .fetchSiteMeta()
      .then((m) => {
        if (alive) setMeta(m);
      })
      .catch(() => {
        // Not silent, and not an error to report either: the only thing this
        // read decides is whether to draw a notice ABOUT the package, so the
        // handled outcome is "say nothing". A 403 here is the ordinary answer
        // for a user with MOD-29 edit but not view, and a red banner about a
        // failed lookup would be louder than the notice it replaced.
        if (alive) setMeta(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const page = data?.page ?? null;
  const blocks = React.useMemo(() => data?.blocks ?? [], [data]);

  return (
    <section className={cn(pageShell.standard, "pb-24")}>
      <PageHeader
        eyebrow={<HubCrumb area="Website pages" to="/settings/website" />}
        title={page ? page.title_fr : tr("Website page")}
        description="What this page is called, and what is on it."
        action={
          page ? (
            <div className="flex items-center gap-3">
              <Pill tone={page.is_published ? "ok" : "mute"}>
                {page.is_published ? tr("Published") : tr("Draft")}
              </Pill>
              <Button variant="outline" onClick={() => nav("/settings/website")}>
                {tr("All pages")}
              </Button>
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingRow label={tr("Loading the page…")} />
      ) : error ? (
        <ErrorState message={error} />
      ) : !page ? (
        <EmptyState
          title={tr("This page no longer exists")}
          hint="It may have been deleted. The list shows what is left."
          action={
            <Button onClick={() => nav("/settings/website")}>
              {tr("All pages")}
            </Button>
          }
        />
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {meta && !meta.website_enabled && (
            <Callout tone="warn" title={tr("The public site is off")}>
              Everything here saves, and publishing works, but nothing serves
              these pages until the website package is switched on for this
              workspace.
            </Callout>
          )}

          <IdentityCard page={page} onSaved={reload} />

          <BlocksCard
            pageId={pageId}
            blocks={blocks}
            metrics={meta?.metrics ?? []}
            onChanged={reload}
          />
        </div>
      )}
    </section>
  );
}

/* ── identity ─────────────────────────────────────────────────────────────── */

/**
 * Key, titles, slugs and the two SEO fields.
 *
 * The whole record is PATCHed rather than only the changed fields. The endpoint
 * takes every one of them as optional and refuses an empty body, so a diff would
 * buy nothing but a way to send a body that is empty because the diff was wrong.
 */
function IdentityCard({
  page,
  onSaved,
}: {
  page: api.SitePage;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    key: page.key,
    title_fr: page.title_fr,
    title_en: page.title_en ?? "",
    slug_fr: page.slug_fr ?? "",
    slug_en: page.slug_en ?? "",
    meta_title_fr: page.meta_title_fr ?? "",
    meta_title_en: page.meta_title_en ?? "",
    meta_description_fr: page.meta_description_fr ?? "",
    meta_description_en: page.meta_description_en ?? "",
  });
  const set = (k: keyof typeof form, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const keyOk = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(form.key);
  const canSave = keyOk && !!form.title_fr.trim() && !busy;

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.updateSitePage(page.page_id, {
        key: form.key,
        title_fr: form.title_fr.trim(),
        title_en: orNull(form.title_en),
        slug_fr: orNull(form.slug_fr),
        slug_en: orNull(form.slug_en),
        meta_title_fr: orNull(form.meta_title_fr),
        meta_title_en: orNull(form.meta_title_en),
        meta_description_fr: orNull(form.meta_description_fr),
        meta_description_en: orNull(form.meta_description_en),
      });
      setMsg(tr("Saved."));
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title={tr("Page")}
      desc="The key is what the site matches on; the slug is what appears in the address."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={tr("Key")}
            required
            hint="The marketing site reads its figures from the page keyed “home”."
            error={
              form.key && !keyOk
                ? tr("Use lowercase letters, digits and hyphens.")
                : undefined
            }
          >
            <Input
              value={form.key}
              onChange={(e) => set("key", e.target.value.toLowerCase())}
              className="font-mono"
            />
          </Field>
          <Field
            label={tr("Address")}
            hint="Leave both blank for the page that lives at the site root."
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={form.slug_fr}
                onChange={(e) => set("slug_fr", e.target.value.toLowerCase())}
                placeholder="fr"
                aria-label={tr("Slug (French)")}
                className="font-mono"
              />
              <Input
                value={form.slug_en}
                onChange={(e) => set("slug_en", e.target.value.toLowerCase())}
                placeholder="en"
                aria-label={tr("Slug (English)")}
                className="font-mono"
              />
            </div>
          </Field>
        </div>

        <BiRow
          label={tr("Title")}
          required
          value={{ fr: form.title_fr, en: form.title_en }}
          onChange={(v) =>
            setForm((s) => ({ ...s, title_fr: v.fr, title_en: v.en ?? "" }))
          }
          placeholderFr="Accueil"
          placeholderEn="Home"
        />

        <BiRow
          label={tr("Search title")}
          value={{ fr: form.meta_title_fr, en: form.meta_title_en }}
          onChange={(v) =>
            setForm((s) => ({
              ...s,
              meta_title_fr: v.fr,
              meta_title_en: v.en ?? "",
            }))
          }
        />

        <BiRow
          label={tr("Search description")}
          value={{
            fr: form.meta_description_fr,
            en: form.meta_description_en,
          }}
          onChange={(v) =>
            setForm((s) => ({
              ...s,
              meta_description_fr: v.fr,
              meta_description_en: v.en ?? "",
            }))
          }
        />

        {err && <ErrorState message={err} />}
        <div className="flex items-center justify-end gap-3">
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          <Button onClick={save} disabled={!canSave}>
            {busy ? tr("Saving…") : tr("Save page")}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

/* ── blocks ───────────────────────────────────────────────────────────────── */

function BlocksCard({
  pageId,
  blocks,
  metrics,
  onChanged,
}: {
  pageId: string;
  blocks: api.SiteBlock[];
  metrics: { key: string; unit: string | null }[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<api.SiteBlock | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  /** A new block is created with `{ items: [] }`, never an absent content: the
   *  type's schema requires `items`, so an empty body is a 422 at the moment of
   *  clicking Add — which reads as the button being broken. */
  const add = (type: api.EditableBlockType) =>
    run(() => api.createSiteBlock(pageId, { type, content: { items: [] } }));

  /** The WHOLE order goes up, including blocks this screen cannot edit. Sending
   *  only the ones with a form would renumber around them and quietly move
   *  somebody's hero to the bottom. */
  const move = (index: number, delta: number) => {
    const next = moved(blocks, index, index + delta);
    if (next === blocks) return;
    void run(() =>
      api.reorderSiteBlocks(
        pageId,
        next.map((b) => b.block_id),
      ),
    );
  };

  return (
    <SettingsCard
      title={tr("Content")}
      desc="Blocks are drawn top to bottom. The marketing site currently reads the figures and the credentials."
    >
      <div className="flex flex-col gap-4">
        {err && <ErrorState message={err} />}

        {!blocks.length ? (
          <EmptyState
            title={tr("Nothing on this page yet")}
            hint="Add the figures band to put a number, a certification and a network name on the first screen a visitor sees."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {blocks.map((block, i) => (
              <li key={block.block_id}>
                <BlockCard
                  block={block}
                  metrics={metrics}
                  busy={busy}
                  first={i === 0}
                  last={i === blocks.length - 1}
                  onMove={(d) => move(i, d)}
                  onDelete={() => setDeleting(block)}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {api.EDITABLE_BLOCK_TYPES.map((type) => (
            <Button
              key={type}
              variant="outline"
              disabled={busy}
              onClick={() => void add(type)}
            >
              {tr("Add")} {BLOCK_LABEL[type]}
            </Button>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={busy}
        destructive
        title={tr("Delete this block?")}
        body="Its content goes with it. Hiding a block takes it off the page without losing what is in it."
        confirmLabel={tr("Delete block")}
        onConfirm={() => {
          const b = deleting;
          if (!b) return;
          void run(() => api.deleteSiteBlock(b.block_id)).then(() =>
            setDeleting(null),
          );
        }}
      />
    </SettingsCard>
  );
}

function BlockCard({
  block,
  metrics,
  busy,
  first,
  last,
  onMove,
  onDelete,
  onChanged,
}: {
  block: api.SiteBlock;
  metrics: { key: string; unit: string | null }[];
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const editable = isEditable(block.type);
  const [visible, setVisible] = React.useState(block.is_visible);
  const [err, setErr] = React.useState<string | null>(null);

  async function setHidden(next: boolean) {
    // Optimistic, and reverted on failure: a switch that waits for a round trip
    // before moving reads as a switch that did not register the press.
    setVisible(next);
    setErr(null);
    try {
      await api.updateSiteBlock(block.block_id, { is_visible: next });
      onChanged();
    } catch (e) {
      setVisible(!next);
      setErr(errMsg(e));
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {BLOCK_LABEL[block.type] ?? block.type}
          </h3>
          {!editable && (
            <Pill tone="mute">
              <span className="font-mono text-[11px]">{block.type}</span>
            </Pill>
          )}
          {!visible && <Pill tone="warn">{tr("Hidden")}</Pill>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || first}
            onClick={() => onMove(-1)}
            aria-label={tr("Move up")}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || last}
            onClick={() => onMove(1)}
            aria-label={tr("Move down")}
          >
            ↓
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
            {tr("Delete")}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Toggle
          checked={visible}
          onChange={(v) => void setHidden(v)}
          label={tr("Shown on the page")}
          hint={tr("Hidden keeps the content and takes it off the site.")}
        />
      </div>

      {err && <ErrorState message={err} />}

      {block.type === "stat_counters" ? (
        <CounterItems block={block} metrics={metrics} onSaved={onChanged} />
      ) : block.type === "stat_chips" ? (
        <ChipItems block={block} onSaved={onChanged} />
      ) : (
        /* Listed, named, counted in the order — and not touched. A block type
           with no form here is one `public-web` does not draw yet, and a screen
           that hid it would drop it out of the reorder. */
        <p className="text-sm text-muted-foreground">
          {tr(
            "This block type has no editor here yet. It is left exactly as it is, and it keeps its place in the order.",
          )}
        </p>
      )}
    </div>
  );
}

/* ── the two item editors ─────────────────────────────────────────────────── */

/** Everything an item editor needs, so the two below stay the same shape. */
function ItemFrame({
  index,
  total,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={tr("Move up")}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label={tr("Move down")}
          >
            ↓
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {tr("Remove")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** Save + status, shared by both item editors. */
function SaveRow({
  busy,
  disabled,
  saved,
  error,
  onSave,
}: {
  busy: boolean;
  disabled: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <>
      {error && <ErrorState message={error} />}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-muted-foreground">{tr("Saved.")}</span>
        )}
        <Button onClick={onSave} disabled={disabled || busy}>
          {busy ? tr("Saving…") : tr("Save block")}
        </Button>
      </div>
    </>
  );
}

function useItems<T>(block: api.SiteBlock, make: (raw: unknown) => T) {
  return React.useState<T[]>(() => {
    const raw = block.content?.items;
    return Array.isArray(raw) ? raw.map(make) : [];
  });
}

function CounterItems({
  block,
  metrics,
  onSaved,
}: {
  block: api.SiteBlock;
  metrics: { key: string; unit: string | null }[];
  onSaved: () => void;
}) {
  type Item = {
    label: api.Bilingual;
    sublabel: api.Bilingual;
    unit: string;
    value: string;
    metric_key: string;
  };

  const [items, setItems] = useItems<Item>(block, (raw) => {
    const r = (raw ?? {}) as Partial<api.StatCounterItem>;
    return {
      label: { fr: r.label?.fr ?? "", en: r.label?.en ?? "" },
      sublabel: { fr: r.sublabel?.fr ?? "", en: r.sublabel?.en ?? "" },
      unit: r.unit ?? "",
      // Held as a string so the field can be empty while being typed. A number
      // state would turn a cleared field into 0 and publish it.
      value: String(r.value ?? 0),
      metric_key: r.metric_key ?? "",
    };
  });
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const patch = (i: number, next: Partial<Item>) => {
    setSaved(false);
    setItems((s) => s.map((it, n) => (n === i ? { ...it, ...next } : it)));
  };

  const invalid = items.some(
    (i) => !i.label.fr.trim() || !Number.isFinite(Number(i.value)),
  );

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateSiteBlock(block.block_id, {
        content: {
          items: items.map((i) => ({
            label: bi(i.label),
            // Absent rather than an empty pair: the schema takes null, and a
            // `{fr: ""}` would fail its own min(1).
            sublabel: i.sublabel.fr.trim() ? bi(i.sublabel) : null,
            unit: orNull(i.unit),
            value: Number(i.value),
            metric_key: i.metric_key || null,
          })),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <ItemFrame
          key={i}
          index={i}
          total={items.length}
          onMove={(d) => {
            setSaved(false);
            setItems((s) => moved(s, i, i + d));
          }}
          onRemove={() => {
            setSaved(false);
            setItems((s) => s.filter((_, n) => n !== i));
          }}
        >
          <BiRow
            label={tr("Label")}
            required
            value={item.label}
            onChange={(v) => patch(i, { label: v })}
            placeholderFr="Volume géré"
            placeholderEn="CBM managed"
          />
          <BiRow
            label={tr("Note")}
            value={item.sublabel}
            onChange={(v) => patch(i, { sublabel: v })}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={tr("Live figure")}
              hint="Bound to the ledger, recomputed on every page view."
            >
              <Select
                value={item.metric_key}
                onChange={(e) => {
                  const key = e.target.value;
                  const unit = metrics.find((m) => m.key === key)?.unit;
                  // Prefill the unit from the registry's own answer, but never
                  // overwrite one somebody typed.
                  patch(i, {
                    metric_key: key,
                    unit: item.unit || unit || "",
                  });
                }}
              >
                <option value="">{tr("Not bound — use the number below")}</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.key}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={tr("Number")}
              required
              hint={
                item.metric_key
                  ? tr("Shown only when the live figure cannot be computed.")
                  : tr("What the page shows.")
              }
              error={
                Number.isFinite(Number(item.value))
                  ? undefined
                  : tr("Must be a number.")
              }
            >
              <Input
                inputMode="numeric"
                value={item.value}
                onChange={(e) => patch(i, { value: e.target.value })}
                className="font-mono"
              />
            </Field>
            <Field label={tr("Unit")} hint="Shown after the number.">
              <Input
                value={item.unit}
                onChange={(e) => patch(i, { unit: e.target.value })}
                placeholder="CBM"
              />
            </Field>
          </div>
        </ItemFrame>
      ))}

      <div>
        <Button
          variant="outline"
          onClick={() => {
            setSaved(false);
            setItems((s) => [
              ...s,
              {
                label: blank(),
                sublabel: blank(),
                unit: "",
                value: "0",
                metric_key: "",
              },
            ]);
          }}
        >
          {tr("Add a figure")}
        </Button>
      </div>

      <SaveRow
        busy={busy}
        disabled={invalid}
        saved={saved}
        error={err}
        onSave={() => void save()}
      />
    </div>
  );
}

function ChipItems({
  block,
  onSaved,
}: {
  block: api.SiteBlock;
  onSaved: () => void;
}) {
  type Item = { label: api.Bilingual; value: api.Bilingual };

  const [items, setItems] = useItems<Item>(block, (raw) => {
    const r = (raw ?? {}) as Partial<api.StatChipItem>;
    return {
      label: { fr: r.label?.fr ?? "", en: r.label?.en ?? "" },
      value: { fr: r.value?.fr ?? "", en: r.value?.en ?? "" },
    };
  });
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const invalid = items.some((i) => !i.label.fr.trim() || !i.value.fr.trim());

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateSiteBlock(block.block_id, {
        content: {
          items: items.map((i) => ({ label: bi(i.label), value: bi(i.value) })),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <ItemFrame
          key={i}
          index={i}
          total={items.length}
          onMove={(d) => {
            setSaved(false);
            setItems((s) => moved(s, i, i + d));
          }}
          onRemove={() => {
            setSaved(false);
            setItems((s) => s.filter((_, n) => n !== i));
          }}
        >
          <BiRow
            label={tr("What it is")}
            required
            value={item.label}
            onChange={(v) => {
              setSaved(false);
              setItems((s) =>
                s.map((it, n) => (n === i ? { ...it, label: v } : it)),
              );
            }}
            placeholderFr="Certification"
            placeholderEn="Certification"
          />
          <BiRow
            label={tr("What it says")}
            required
            value={item.value}
            onChange={(v) => {
              setSaved(false);
              setItems((s) =>
                s.map((it, n) => (n === i ? { ...it, value: v } : it)),
              );
            }}
            placeholderFr="ISO 9001:2015"
            placeholderEn="ISO 9001:2015"
          />
        </ItemFrame>
      ))}

      <div>
        <Button
          variant="outline"
          onClick={() => {
            setSaved(false);
            setItems((s) => [...s, { label: blank(), value: blank() }]);
          }}
        >
          {tr("Add a credential")}
        </Button>
      </div>

      <SaveRow
        busy={busy}
        disabled={invalid}
        saved={saved}
        error={err}
        onSave={() => void save()}
      />
    </div>
  );
}

export default WebsitePageEditorPage;
