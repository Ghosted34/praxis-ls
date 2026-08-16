/**
 * Sales & CRM — published customer success stories.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";

/* ═══════════════════════════════ SUCCESS STORIES ═══════════════════════════════ */

const STORY_AI: AiAction[] = [
  {
    label: "Draft success story",
    kind: "assist",
    describe:
      "Draft a case study from a delivered dossier — title, summary and body.",
  },
  {
    label: "Polish for publishing",
    kind: "assist",
    describe: "Tighten a success story's copy before sign-off.",
  },
];

const STORY_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SIGNED_OFF", label: "Signed off" },
  { value: "PUBLISHED", label: "Published" },
];

function storyStatus(r: Row): string {
  if (r.is_published) return "PUBLISHED";
  if (r.signed_off_by) return "SIGNED_OFF";
  return "DRAFT";
}

function StoryForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [body, setBody] = React.useState("");
  const [headline,setHeadline]=React.useState(""); const [serviceCategory,setServiceCategory]=React.useState("");
  const [dossierIds,setDossierIds]=React.useState(""); const [kpis,setKpis]=React.useState("[]");
  const [coverId,setCoverId]=React.useState(""); const [logoId,setLogoId]=React.useState(""); const [galleryIds,setGalleryIds]=React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ? String(editing.title) : "");
    setSummary(editing?.summary ? String(editing.summary) : "");
    setBody(editing?.body ? String(editing.body) : "");
setHeadline(String(editing?.headline??"")); setServiceCategory(String(editing?.service_category??"")); setDossierIds(Array.isArray(editing?.dossiers)?(editing.dossiers as Row[]).map(d=>d.dossier_id).join(", "):""); setKpis(JSON.stringify(editing?.kpis??[],null,2)); setCoverId(String(editing?.cover_vault_id??"")); setLogoId(String(editing?.client_logo_vault_id??"")); setGalleryIds(Array.isArray(editing?.gallery_vault_ids)?editing.gallery_vault_ids.join(", "):"");
    setError(null);
  }, [open, editing]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body_ = {
      title: title.trim(),
      summary: summary.trim() || undefined,
      body: body.trim() || undefined, headline:headline.trim()||undefined, executive_summary:summary.trim()||undefined, operations_execution:body.trim()||undefined, service_category:serviceCategory.trim()||undefined, dossier_ids:dossierIds.split(",").map(x=>x.trim()).filter(Boolean), kpis:JSON.parse(kpis||"[]"), cover_vault_id:coverId||null, client_logo_vault_id:logoId||null, gallery_vault_ids:galleryIds.split(",").map(x=>x.trim()).filter(Boolean),
    };
    try {
      if (editing)
        await tenant(`/success-stories/${String(editing.success_story_id)}`, {
          method: "PATCH",
          body: body_,
        });
      else
        await tenant("/success-stories", {
          method: "POST",
          body: body_,
        });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit success story" : "New success story"}
      description="A portfolio case study — draft, sign off, then publish."
      size="lg"
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Cutting Acme's customs clearance time by 40%"
          />
        </Field>
        <Field label="Summary" hint="One or two lines for the portfolio card">
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="How we streamlined a multi-modal import lane."
          />
        </Field>
        <Field label="Headline"><Input value={headline} onChange={e=>setHeadline(e.target.value)} /></Field><Field label="Service category"><Input value={serviceCategory} onChange={e=>setServiceCategory(e.target.value)} /></Field><Field label="Completed operation file IDs" hint="Comma separated; use the eligible-file picker API"><Input value={dossierIds} onChange={e=>setDossierIds(e.target.value)} /></Field><Field label="KPIs" hint='JSON: [{"label":"Containers","value":"40"}]'><Textarea value={kpis} onChange={e=>setKpis(e.target.value)} rows={4}/></Field><Field label="Cover vault ID"><Input value={coverId} onChange={e=>setCoverId(e.target.value)}/></Field><Field label="Client logo vault ID"><Input value={logoId} onChange={e=>setLogoId(e.target.value)}/></Field><Field label="Gallery vault IDs" hint="Comma separated"><Input value={galleryIds} onChange={e=>setGalleryIds(e.target.value)}/></Field>
        <Field label="Operations execution">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            placeholder="The full case study…"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!title.trim() || busy}
          >
            {editing ? "Save changes" : "Create draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SuccessStoriesPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/success-stories");
  const [filter, setFilter] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const signOff = (id: string) =>
    act(id, () =>
      tenant(`/success-stories/${id}/sign-off`, { method: "POST", body: {} }),
    );
  const publish = (id: string) =>
    act(id, () =>
      tenant(`/success-stories/${id}/publish`, { method: "POST", body: {} }),
    );
  const unpublish = (id: string) =>
    act(id, () =>
      tenant(`/success-stories/${id}/unpublish`, { method: "POST", body: {} }),
    );

  const filtered = React.useMemo(
    () => (rows || []).filter((r) => !filter || storyStatus(r) === filter),
    [rows, filter],
  );

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Success stories"
        description="Portfolio case studies — draft, sign off, then publish."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New story
          </Button>
        }
      />
      <HubTabs />

      <div className="mb-4">
        <Chips
          label="Filter stories by status"
          value={filter}
          options={STORY_FILTERS}
          onChange={setFilter}
        />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length ? "No stories match" : "No success stories yet"}
          hint={
            rows.length
              ? "Try another filter."
              : "Draft your first case study, or generate one with AI from a delivered dossier."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r) => {
            const id = String(r.success_story_id);
            const status = storyStatus(r);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {cell(r.title)}
                  </p>
                  <StatusPill status={status} />
                </div>
                {r.summary ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {cell(r.summary)}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.is_published
                    ? `Published ${dateFmt(r.published_at)}`
                    : `Created ${dateFmt(r.created_at)}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!r.is_published && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  {status === "DRAFT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={rowBusy === id}
                      onClick={() => signOff(id)}
                    >
                      Sign off
                    </Button>
                  )}
                  {status === "SIGNED_OFF" && (
                    <Button
                      size="sm"
                      loading={rowBusy === id}
                      onClick={() => publish(id)}
                    >
                      Publish
                    </Button>
                  )}
                  {status === "PUBLISHED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={rowBusy === id}
                      onClick={() => unpublish(id)}
                    >
                      Unpublish
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={STORY_AI} />

      <StoryForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}
