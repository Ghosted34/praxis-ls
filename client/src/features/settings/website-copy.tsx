/**
 * Settings › Website › Copy — the words the APP puts on the tenant's site.
 *
 * ── THE GAP THIS SCREEN CLOSES ─────────────────────────────────────────────
 *
 * Every other screen in this area edits content a tenant ADDS: their hero,
 * their figures, their case notes, their articles. This one edits the ~465
 * sentences the product itself prints around that content — the section
 * headings, the empty states, the form labels, the buttons, the legal line in
 * the footer.
 *
 * They were never neutral furniture. "Success stories / Operations we have run,
 * in our own words" is the headline of the Our-work page and a claim about the
 * tenant's business in words we chose for them; so is "We publish case notes as
 * work finishes", and the three promises on the contact page. On a white-label
 * product a tenant who runs project cargo and would call that page "Reference
 * projects" had exactly two options — our sentence, or an empty page — and no
 * way to discover that the first one was not theirs.
 *
 * ── WHY THE DEFAULT IS THE PLACEHOLDER AND NOT THE VALUE ──────────────────
 *
 * A field pre-filled with the shipped sentence cannot tell "the tenant is happy
 * with ours" apart from "the tenant typed ours out by hand", and the difference
 * matters on every later deploy: an override is frozen at the day it was
 * written, so a pre-filled field would silently opt every tenant out of every
 * future improvement to copy they never actually chose. An empty field with the
 * sentence behind it in grey says the true thing — this is what your visitors
 * read; write something else here if you want something else.
 *
 * Clearing a field therefore means "go back to what Praxis ships", which is the
 * only reset gesture this screen needs and the reason there is no per-row
 * delete button.
 *
 * ── WHY FRENCH IS THE REQUIRED HALF ───────────────────────────────────────
 *
 * `bi()` in `site_content.schema.js` makes FR required and EN optional across
 * the whole block library, because FR is what every renderer falls back to. So
 * an override with English only is refused by the API, and this screen says so
 * in the field rather than letting a tenant discover it from a 422 after
 * writing forty of them.
 *
 * ── WHY THE SEARCH BOX IS NOT OPTIONAL ────────────────────────────────────
 *
 * 465 rows in 24 sections. A tenant arrives here having SEEN a sentence on
 * their site and wanting to change that sentence — they do not know it is
 * called `site.portfolioPage.titleMain`, and they should not have to. So the
 * filter matches the shipped text in both languages as well as the label and
 * the key: paste "Operations we have run" and the row you meant is the only one
 * left.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { SettingsCard } from "@/components/settings/controls";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useConfirm } from "@/components/ui/use-confirm";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-content-api";
import { WebsiteNav } from "./website-nav";

/** One row's edit state. Both halves are plain strings; empty means "not
 *  overridden", which is what makes clearing a field the reset gesture. */
type Draft = { fr: string; en: string };

/** Above this many characters the shipped default is prose rather than a label,
 *  and a single-line input makes editing it a horizontal scroll. Measured
 *  against the defaults rather than the tenant's text so a row does not change
 *  shape as they type. */
const PROSE_AT = 90;

const emptyDraft = (): Draft => ({ fr: "", en: "" });
const isSet = (d: Draft | undefined) => Boolean(d && d.fr.trim());

export function WebsiteCopyPage() {
  const [catalogue, setCatalogue] = React.useState<api.CopyCatalogue | null>(null);
  const [page, setPage] = React.useState<api.SitePage | null>(null);
  const [block, setBlock] = React.useState<api.SiteBlock | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = React.useCallback(() => {
    setLoadError(null);
    Promise.all([api.fetchCopyCatalogue(), api.listSitePages()])
      .then(async ([cat, pages]) => {
        setCatalogue(cat);
        const row = pages.find((p) => p.key === api.COPY_PAGE_KEY) || null;
        setPage(row);
        if (!row) {
          // The ordinary first visit. The page and its block are created on the
          // first save, not on arrival: a tenant who opens this screen to look
          // around should not leave a row behind them.
          setBlock(null);
          setDrafts({});
          return;
        }
        const tab = await api.fetchSitePage(row.page_id);
        const existing =
          tab.blocks.find((b) => b.type === api.COPY_BLOCK_TYPE) || null;
        setBlock(existing);
        const next: Record<string, Draft> = {};
        const items = Array.isArray(existing?.content?.items)
          ? (existing.content.items as api.CopyOverrideItem[])
          : [];
        for (const item of items) {
          if (!item?.key) continue;
          next[item.key] = {
            fr: item.value?.fr ?? "",
            en: item.value?.en ?? "",
          };
        }
        setDrafts(next);
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  const sections = catalogue?.sections ?? [];
  const entries = React.useMemo(() => catalogue?.entries ?? [], [catalogue]);

  /** Rows per section, after the filter. Built once per keystroke rather than
   *  per section render — 465 rows filtered 24 times is the difference between
   *  a search box that types smoothly and one that does not. */
  const bySection = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, api.CopyCatalogueEntry[]>();
    for (const e of entries) {
      if (
        q &&
        !e.label.toLowerCase().includes(q) &&
        !e.key.toLowerCase().includes(q) &&
        !e.default_en.toLowerCase().includes(q) &&
        !e.default_fr.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = out.get(e.section);
      if (list) list.push(e);
      else out.set(e.section, [e]);
    }
    return out;
  }, [entries, query]);

  const overriddenIn = React.useCallback(
    (section: string) =>
      entries.filter((e) => e.section === section && isSet(drafts[e.key])).length,
    [entries, drafts],
  );

  const overriddenTotal = entries.filter((e) => isSet(drafts[e.key])).length;

  /** A row with English but no French. The API refuses it, so the button is
   *  disabled and the offending fields are marked — the same shape
   *  `website-social.tsx` uses for a URL on the wrong domain. */
  const incomplete = React.useMemo(
    () =>
      Object.entries(drafts)
        .filter(([, d]) => !d.fr.trim() && d.en.trim())
        .map(([key]) => key),
    [drafts],
  );

  function edit(key: string, half: keyof Draft, value: string) {
    setSaved(false);
    setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? emptyDraft()), [half]: value } }));
  }

  /** What gets stored: every row with French in it, in catalogue order so the
   *  saved block reads the same way the screen does. A row the tenant cleared
   *  is simply absent, which is how an override stops existing. */
  function items(): api.CopyOverrideItem[] {
    return entries
      .filter((e) => isSet(drafts[e.key]))
      .map((e) => {
        const d = drafts[e.key];
        return {
          key: e.key,
          value: { fr: d.fr.trim(), en: d.en.trim() || null },
        };
      });
  }

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      let target = page;
      if (!target) {
        target = await api.createSitePage({
          key: api.COPY_PAGE_KEY,
          // Titles are required by the schema and never rendered for this row —
          // it has no URL and no nav position. They are what an administrator
          // sees if they ever meet it in an audit log, so they say what it is.
          title_fr: tr("Textes du site"),
          title_en: tr("Site copy"),
          // Last in nav order. It is not in the nav, but `sort_order` also
          // decides which page wins when two override the same key, and the
          // one screen that writes overrides should be the one that wins.
          sort_order: 999,
        });
        setPage(target);
      }
      const content = { items: items() };
      const next = block
        ? await api.updateSiteBlock(block.block_id, { content })
        : await api.createSiteBlock(target.page_id, {
            type: api.COPY_BLOCK_TYPE,
            content,
          });
      setBlock(next);
      setSaved(true);
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function publish(next: boolean) {
    if (!page) return;
    const ok = await confirm(
      next
        ? {
            title: tr("Put your wording live?"),
            body: tr(
              "Visitors will read your text instead of the wording Praxis ships. You can take it down again at any time.",
            ),
            confirmLabel: tr("Publish wording"),
          }
        : {
            title: tr("Go back to the Praxis wording?"),
            body: tr(
              "Your text is kept and stops being shown. Visitors read the wording Praxis ships until you publish again.",
            ),
            confirmLabel: tr("Unpublish wording"),
            destructive: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    setSaveError(null);
    try {
      setPage(await api.publishSitePage(page.page_id, next));
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        action={<Button onClick={load}>{tr("Try again")}</Button>}
      />
    );
  }

  const live = Boolean(page?.is_published);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Website wording")}
        description={tr(
          "Every heading, label and sentence the site shows around your content. Leave a field blank to keep the wording Praxis ships.",
        )}
      />
      <WebsiteNav />

      {!catalogue ? (
        <LoadingRow />
      ) : (
        <>
          <SettingsCard
            title={tr("What your visitors read")}
            desc={tr(
              "French is the version the site falls back to, so it is the one an override needs. English is optional.",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Pill tone={live ? "ok" : "mute"}>
                  {live ? tr("Live") : tr("Draft")}
                </Pill>
                <span className="text-sm text-muted-foreground">
                  {overriddenTotal === 1
                    ? tr("1 sentence in your words")
                    : `${overriddenTotal} ${tr("sentences in your words")}`}
                  {" · "}
                  {`${entries.length} ${tr("available")}`}
                </span>
              </div>
              {page ? (
                <Button variant="outline" onClick={() => publish(!live)} disabled={busy}>
                  {live ? tr("Unpublish wording") : tr("Publish wording")}
                </Button>
              ) : null}
            </div>
            {!live && overriddenTotal > 0 ? (
              /* The trap this screen would otherwise set: a tenant edits forty
                 sentences, saves, visits their site and sees no change, with
                 nothing anywhere explaining that saved and live are two
                 different things. */
              <Callout tone="warn" title={tr("Not live yet")}>
                {tr(
                  "Your wording is saved but visitors still read the Praxis version. Publish it to put it on the site.",
                )}
              </Callout>
            ) : null}
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Search the wording, e.g. Success stories")}
              aria-label={tr("Search the wording")}
            />
          </SettingsCard>

          {sections.every((s) => !(bySection.get(s.key)?.length ?? 0)) ? (
            <EmptyState
              title={tr("Nothing matches that")}
              hint={tr("Try a few words exactly as they appear on your site.")}
            />
          ) : (
            sections.map((section) => {
              const rows = bySection.get(section.key) ?? [];
              if (!rows.length) return null;
              // A search narrows to what was asked for, so the sections it
              // leaves standing open themselves — closing them would hide the
              // answer behind one more click.
              const expanded = Boolean(query.trim()) || open === section.key;
              const count = overriddenIn(section.key);
              return (
                <section
                  key={section.key}
                  className="rounded-[var(--radius)] border border-[var(--border)]"
                >
                  <h2>
                    <button
                      type="button"
                      onClick={() => setOpen(open === section.key ? null : section.key)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">
                          {section.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {section.pages.length
                            ? section.pages.join(" · ")
                            : tr("Not shown on any page")}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {count > 0 ? <Pill tone="ok">{String(count)}</Pill> : null}
                        <span className="text-xs text-muted-foreground">
                          {`${rows.length}`}
                        </span>
                      </span>
                    </button>
                  </h2>
                  {expanded ? (
                    <div className="space-y-5 border-t border-[var(--border)] p-4">
                      {rows.map((row) => {
                        const draft = drafts[row.key] ?? emptyDraft();
                        const prose =
                          row.default_en.length > PROSE_AT ||
                          row.default_fr.length > PROSE_AT;
                        const Control = prose ? Textarea : Input;
                        const bad = incomplete.includes(row.key);
                        return (
                          <div key={row.key} className="grid gap-2">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {row.label}
                              </span>
                              <code className="font-mono text-[11px] text-muted-foreground">
                                {row.key}
                              </code>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="grid gap-1">
                                <span className="text-xs text-muted-foreground">
                                  {tr("French")}
                                </span>
                                <Control
                                  value={draft.fr}
                                  placeholder={row.default_fr}
                                  aria-invalid={bad || undefined}
                                  onChange={(
                                    e: React.ChangeEvent<
                                      HTMLInputElement | HTMLTextAreaElement
                                    >,
                                  ) => edit(row.key, "fr", e.target.value)}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-xs text-muted-foreground">
                                  {tr("English")}
                                </span>
                                <Control
                                  value={draft.en}
                                  placeholder={row.default_en}
                                  onChange={(
                                    e: React.ChangeEvent<
                                      HTMLInputElement | HTMLTextAreaElement
                                    >,
                                  ) => edit(row.key, "en", e.target.value)}
                                />
                              </label>
                            </div>
                            {bad ? (
                              <p className="text-xs text-bad">
                                {tr(
                                  "Add the French too — it is the version the site falls back to.",
                                )}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}

          {saveError ? (
            <Callout tone="bad" title={tr("Not saved")}>
              {saveError}
            </Callout>
          ) : null}
          {saved && !saveError ? (
            <Callout tone="ok" title={tr("Saved")}>
              {live
                ? tr("Your site picks this up within a few minutes.")
                : tr("Publish your wording to put it in front of visitors.")}
            </Callout>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              {tr("Discard changes")}
            </Button>
            <Button onClick={save} disabled={busy || incomplete.length > 0}>
              {busy ? tr("Saving…") : tr("Save wording")}
            </Button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
