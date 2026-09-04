/**
 * Website pages — the tenant's own public site, page by page.
 *
 * ── WHAT THIS SCREEN IS FOR ────────────────────────────────────────────────
 *
 * The marketing site reads content the tenant authors here. Until this screen
 * existed the API was the only way in: `site_content` shipped with pages,
 * blocks, publishing and a metric registry, and nothing in the product rendered
 * a form for any of it — so the one band on the home page that carries a
 * FIGURE could only be filled in with curl. That is the gap this closes.
 *
 * ── WHY THE LIST IS PAGES AND THE CONTENT IS ELSEWHERE ────────────────────
 *
 * A page is identity, SEO and publish state; its content is an ordered list of
 * blocks. They are edited at different rhythms — a key and a meta description
 * are set once, blocks are rearranged all afternoon — and putting both on one
 * screen means every block save re-renders the identity form and every rename
 * risks the block order. So this screen owns the page row and hands the blocks
 * to `website-page-editor.tsx`.
 *
 * ── PUBLISHING IS A ROW ACTION, NOT A CHECKBOX ────────────────────────────
 *
 * The API gives publishing its own endpoint precisely so an ordinary field edit
 * cannot flip it — it stamps who and when. The UI keeps that shape: a deliberate
 * action with a confirmation sentence, not a toggle somebody brushes past on the
 * way to fixing a typo.
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
import { WebsiteNav } from "./website-nav";
import { useList, useRefresh, errMsg } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/site-content-api";

export function WebsitePagesPage() {
  const { rows, error, loading } = useList<api.SitePage>("/site/pages");
  const refresh = useRefresh();
  const nav = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [publishing, setPublishing] = React.useState<api.SitePage | null>(null);
  const [deleting, setDeleting] = React.useState<api.SitePage | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<api.SiteMeta | null>(null);

  React.useEffect(() => {
    let alive = true;
    // The uncached read, not `loadSiteMeta`: that cache exists so the Settings
    // hub does not ask once per visit, and a screen ABOUT the website should
    // notice the package being switched on without a reload. A 403 (no MOD-29
    // view) simply leaves the notice undrawn.
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

  const columns: Column<api.SitePage>[] = [
    {
      key: "key",
      label: tr("Key"),
      // The key is a code — it is what the router and this app's `home` lookup
      // match on — so it is set in the mono face like every other machine value
      // in the product.
      render: (r) => <span className="font-mono text-xs">{r.key}</span>,
    },
    {
      key: "title_fr",
      label: tr("Title"),
      render: (r) => (
        <span className="font-medium text-foreground">{r.title_fr}</span>
      ),
    },
    {
      key: "title_en",
      label: tr("English"),
      // A blank English title is a normal state, not a defect: French is the
      // required half and the public page falls back to it. Saying so beats an
      // empty cell that reads as missing data.
      render: (r) =>
        r.title_en ? (
          r.title_en
        ) : (
          <span className="text-muted-foreground">{tr("Not translated")}</span>
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
            onClick={() => nav(`/settings/website/${r.page_id}`)}
          >
            {tr("Content")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPublishing(r)}>
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
    <ListPage<api.SitePage>
      eyebrow={<HubCrumb area="Settings" to="/settings" />}
      title={tr("Website pages")}
      description="The pages of your public site — what they are called, whether they are live, and what is on them."
      width="wide"
      tabs={<WebsiteNav />}
      action={<Button onClick={() => setCreating(true)}>{tr("New page")}</Button>}
      toolbar={
        /* The commercial switch, stated rather than enforced. This screen is
           deliberately reachable with the package off — a site has to be
           preparable before it is bought — but a page that says "Published"
           while nothing serves it is a lie the editor should not tell. */
        meta && !meta.website_enabled ? (
          <Callout className="w-full" tone="warn" title={tr("The public site is off")}>
            Pages can be written and published here, but nothing serves them
            until the website package is switched on for this workspace.
          </Callout>
        ) : undefined
      }
      columns={columns}
      rows={rows ?? []}
      error={error}
      loading={loading}
      rowKey={(r) => r.page_id}
      onRowClick={(r) => nav(`/settings/website/${r.page_id}`)}
      empty={{
        title: tr("No pages yet"),
        hint: "The home page is the one the marketing site reads its figures from — create it with the key “home”.",
        action: (
          <Button onClick={() => setCreating(true)}>{tr("New page")}</Button>
        ),
      }}
    >
      {creating && (
        <PageForm onClose={() => setCreating(false)} onSaved={refresh} />
      )}

      <ConfirmDialog
        open={!!publishing}
        onClose={() => setPublishing(null)}
        busy={busy}
        title={
          publishing?.is_published
            ? tr("Take this page off the site?")
            : tr("Publish this page?")
        }
        body={
          publishing?.is_published
            ? "It will answer 404 to visitors immediately. Nothing is deleted — republishing puts it back as it was."
            : "It becomes readable by anyone with the address, in both languages, as soon as you confirm."
        }
        confirmLabel={
          publishing?.is_published ? tr("Unpublish") : tr("Publish")
        }
        destructive={!!publishing?.is_published}
        onConfirm={() => {
          const row = publishing;
          if (!row) return;
          void run(
            () => api.publishSitePage(row.page_id, !row.is_published),
            () => setPublishing(null),
          );
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={busy}
        destructive
        dismissible={false}
        title={tr("Delete this page?")}
        body={`Every block on “${deleting?.title_fr ?? ""}” goes with it, and neither can be recovered. Unpublishing takes it off the site without losing the copy.`}
        confirmLabel={tr("Delete page")}
        onConfirm={() => {
          const row = deleting;
          if (!row) return;
          void run(
            () => api.deleteSitePage(row.page_id),
            () => setDeleting(null),
          );
        }}
      />

      {actionError && (
        <div className="mt-4">
          <ErrorState message={actionError} />
        </div>
      )}
    </ListPage>
  );
}

/**
 * The create form — key and titles only.
 *
 * Slugs, meta titles and descriptions are deliberately not here. A create
 * dialog that asks for nine fields is a dialog people abandon, and every one of
 * those nine can be set on the page's own screen a moment later; the two that
 * cannot be deferred are the key (it is the identity, and it is what `home`
 * means to the marketing site) and the French title (the API requires it).
 */
function PageForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = React.useState("");
  const [titleFr, setTitleFr] = React.useState("");
  const [titleEn, setTitleEn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const keyOk = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(key);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createSitePage({
        key,
        title_fr: titleFr.trim(),
        // Blank means "not translated", which is null upstream — never an empty
        // string, which would render as a translated-to-nothing title.
        title_en: titleEn.trim() || null,
      });
      onSaved();
      onClose();
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
      title={tr("New page")}
      description="A page starts unpublished and empty. Nothing is served until you publish it."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Key")}
          required
          hint="Lowercase letters, digits and hyphens. The marketing site reads its figures from the page keyed “home”."
          error={
            key && !keyOk ? tr("Use lowercase letters, digits and hyphens.") : undefined
          }
        >
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="home"
            className="font-mono"
          />
        </Field>
        <Field label={tr("Title (French)")} required hint="Required — French is the fallback every page falls back to.">
          <Input
            value={titleFr}
            onChange={(e) => setTitleFr(e.target.value)}
            placeholder="Accueil"
          />
        </Field>
        <Field label={tr("Title (English)")} hint="Optional. Left blank, the French title is used.">
          <Input
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder="Home"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !keyOk || !titleFr.trim()}
          onCancel={onClose}
          saveLabel={tr("Create page")}
        />
      </form>
    </Modal>
  );
}

export default WebsitePagesPage;
