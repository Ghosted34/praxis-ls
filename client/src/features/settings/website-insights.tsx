/**
 * Insights — the tenant's articles, beside the pages they sit next to.
 *
 * ── WHY THIS SCREEN IS NEW AND THE FEATURE IS NOT ─────────────────────────
 *
 * `insight_article` (migration 12757), full CRUD at `/insights`, a publish verb
 * of its own, a public read at `/public/insights`, and two routes on the
 * marketing site — `/insights` and `/insights/:slug` — both of them in that
 * site's header navigation. Everything except a way to write one. The product
 * shipped a nav link to a page only curl could fill, and every tenant's
 * Insights page has been empty since.
 *
 * ── WHY IT LIVES UNDER /settings/website ──────────────────────────────────
 *
 * An article is website content. Putting it under a separate Content area would
 * mean a tenant learning that their site is edited in two unrelated places, and
 * the settings ribbon holds only the handful of editors an administrator opens
 * daily — a third card in the grid would have been as findable as the second
 * one was, which is to say not very. `WebsiteNav` makes pages and articles two
 * halves of one screen.
 *
 * ── PUBLISHING IS A ROW ACTION ────────────────────────────────────────────
 *
 * Same rule as the pages screen, for the same reason: the API gives publishing
 * its own endpoint precisely so an ordinary field edit cannot flip it, and it
 * stamps who and when. A deliberate action with a sentence naming the outcome,
 * never a toggle somebody brushes past on the way to fixing a typo.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ListPage } from "@/components/list-page";
import { type Column } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { FormButtons } from "@/components/ui/form-buttons";
import { Modal, ConfirmDialog, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { HubCrumb } from "@/components/tabbed-hub";
import { useList, useRefresh, errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/insights-api";
import * as site from "@/lib/site-content-api";
import { WebsiteNav } from "./website-nav";

/** Publishing needs a slug and a body, and the server refuses without them.
 *  Saying so in the list is cheaper than a 422 the writer reads after pressing
 *  a button they expected to work. */
const readyToPublish = (r: api.InsightArticle) =>
  Boolean((r.slug_fr || r.slug_en) && (r.body_fr || r.body_en));

export function WebsiteInsightsPage() {
  const { rows, error, loading } = useList<api.InsightArticle>("/insights");
  const refresh = useRefresh();
  const nav = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [publishing, setPublishing] = React.useState<api.InsightArticle | null>(null);
  const [deleting, setDeleting] = React.useState<api.InsightArticle | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<site.SiteMeta | null>(null);

  React.useEffect(() => {
    let alive = true;
    // Uncached, like the pages screen: a screen ABOUT the website should notice
    // the package being switched on without a reload. A 403 (MOD-29 edit but
    // not view) simply leaves the notice undrawn.
    site
      .fetchSiteMeta()
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, []);

  async function run(fn: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      refresh();
      done();
    } catch (err) {
      // errMsg, never String(err): it turns the 403 into the permission
      // sentence and the 422 into the field list the API actually sent.
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<api.InsightArticle>[] = [
    {
      key: "title_fr",
      label: tr("Title"),
      render: (r) => (
        <span className="font-medium text-foreground">{r.title_fr}</span>
      ),
    },
    {
      key: "slug_fr",
      label: tr("Address"),
      // The slug is what the URL is made of, so it is set in the mono face like
      // every other machine value in the product. No slug is a normal state for
      // a draft and says so, rather than showing an empty cell that reads as
      // missing data.
      render: (r) =>
        r.slug_fr || r.slug_en ? (
          <span className="font-mono text-xs">{r.slug_fr || r.slug_en}</span>
        ) : (
          <span className="text-muted-foreground">{tr("Not set")}</span>
        ),
    },
    {
      key: "tags",
      label: tr("Tags"),
      render: (r) =>
        r.tags?.length ? (
          <span className="text-xs">{r.tags.join(", ")}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "is_published",
      label: tr("State"),
      render: (r) => (
        <Pill tone={r.is_published ? "ok" : "mute"}>
          {r.is_published ? tr("Published") : tr("Draft")}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => nav(`/settings/website/articles/${r.insight_article_id}`)}
          >
            {tr("Edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            // Disabled rather than hidden: a writer needs to know the button
            // exists and what it is waiting for, which the title says.
            disabled={!r.is_published && !readyToPublish(r)}
            title={
              !r.is_published && !readyToPublish(r)
                ? tr("Give it an address and a body first.")
                : undefined
            }
            onClick={() => setPublishing(r)}
          >
            {r.is_published ? tr("Unpublish") : tr("Publish")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
            {tr("Delete")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <ListPage<api.InsightArticle>
      eyebrow={<HubCrumb area="Settings" to="/settings" />}
      title={tr("Insights")}
      description="Articles on your public site — what they are called, whether they are live, and what is in them."
      width="wide"
      tabs={<WebsiteNav />}
      action={<Button onClick={() => setCreating(true)}>{tr("New article")}</Button>}
      toolbar={
        meta && !meta.website_enabled ? (
          <Callout className="w-full" tone="warn" title={tr("The public site is off")}>
            Articles can be written and published here, but nothing serves them
            until the website package is switched on for this workspace.
          </Callout>
        ) : undefined
      }
      columns={columns}
      rows={rows ?? []}
      error={error}
      loading={loading}
      rowKey={(r) => r.insight_article_id}
      onRowClick={(r) => nav(`/settings/website/articles/${r.insight_article_id}`)}
      empty={{
        title: tr("No articles yet"),
        hint: "Insights is in your site's navigation, so the page exists whether or not anything is on it. One article is enough to stop it being a dead link.",
        action: (
          <Button onClick={() => setCreating(true)}>{tr("New article")}</Button>
        ),
      }}
    >
      {creating && (
        <ArticleForm onClose={() => setCreating(false)} onSaved={refresh} />
      )}

      <ConfirmDialog
        open={!!publishing}
        onClose={() => setPublishing(null)}
        busy={busy}
        title={
          publishing?.is_published
            ? tr("Take this article off the site?")
            : tr("Publish this article?")
        }
        confirmLabel={
          publishing?.is_published ? tr("Unpublish") : tr("Publish")
        }
        destructive={Boolean(publishing?.is_published)}
        onConfirm={() =>
          run(
            () =>
              api.publishInsight(
                publishing!.insight_article_id,
                !publishing!.is_published,
              ),
            () => setPublishing(null),
          )
        }
        body={
          <>
            {publishing?.is_published
              ? "It stays here as a draft and its address stops answering. Anyone holding the link gets a not-found."
              : "It goes live at its address and appears on the Insights page of your site."}
            {actionError && <ErrorState message={actionError} />}
          </>
        }
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={busy}
        destructive
        title={tr("Delete this article?")}
        confirmLabel={tr("Delete")}
        onConfirm={() =>
          run(
            () => api.deleteInsight(deleting!.insight_article_id),
            () => setDeleting(null),
          )
        }
        body={
          <>
            The text goes with it and cannot be brought back. To take a
            published article off the site without losing it, unpublish it
            instead.
            {actionError && <ErrorState message={actionError} />}
          </>
        }
      />
    </ListPage>
  );
}

/**
 * Creation asks for the headline and nothing else.
 *
 * The table has sixteen writable columns and the server requires one of them.
 * A new-article dialog demanding a slug, an excerpt and an SEO description is a
 * dialog somebody abandons — and every one of those fields can be set on the
 * article's own screen a moment later, which is where a writer will be anyway.
 */
function ArticleForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titleFr, setTitleFr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await api.createInsight({ title_fr: titleFr.trim() });
      onSaved();
      onClose();
      // Straight into the editor. A writer who has just typed a headline wants
      // to write; sending them back to a list to find the row they created is
      // a step that exists only because the code was easier that way.
      nav(`/settings/website/articles/${row.insight_article_id}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("New article")}
      description="It starts as a draft. Nothing is served until you publish it."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Headline (French)")}
          required
          hint="Required — French is what the public page falls back to when there is no translation."
        >
          <Input
            value={titleFr}
            onChange={(e) => setTitleFr(e.target.value)}
            placeholder="Ce que décide vraiment un Incoterm"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !titleFr.trim()}
          onCancel={onClose}
          saveLabel={tr("Create article")}
        />
      </form>
    </Modal>
  );
}

export default WebsiteInsightsPage;
