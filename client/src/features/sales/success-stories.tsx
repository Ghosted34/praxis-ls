/** Sales & CRM — governed staff workflow for public success stories. */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { pageShell } from "@/lib/layout";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { FileDrop } from "@/components/ui/file-drop";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { readFileAsDataUrl } from "@/lib/vault-file";
import type { Client } from "@/lib/masterdata-api";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";

const STORY_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SIGNED_OFF", label: "Signed off" },
  { value: "PUBLISHED", label: "Published" },
];
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

type Kpi = { label: string; value: string };
type Dossier = {
  dossier_id: string;
  ref?: string | null;
  client_name?: string | null;
  status?: string | null;
  pol?: string | null;
  pod?: string | null;
  service_category?: string | null;
};
type EligiblePage = { rows: Dossier[]; total: number; limit: number; offset: number };
type Generation = {
  manual_required: boolean;
  draft?: {
    headline: string;
    executive_summary: string;
    operations_execution: string;
    kpis: Kpi[];
  };
  sandbox?: boolean;
};

type StoryFormRow = Row & { dossiers?: Dossier[]; kpis?: Kpi[] };

function storyStatus(row: Row): string {
  if (row.is_published) return "PUBLISHED";
  if (row.signed_off_by) return "SIGNED_OFF";
  return "DRAFT";
}

function imageProblem(file: File): string | null {
  if (!file.size) return "That image is empty.";
  if (file.size > IMAGE_MAX_BYTES) return "Images must be no larger than 10 MB.";
  if (!IMAGE_ACCEPT.split(",").includes(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG or WebP image.";
  }
  return null;
}

function StoryForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: StoryFormRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: clients } = useList<Client>("/clients");
  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [headline, setHeadline] = React.useState("");
  const [serviceCategory, setServiceCategory] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [execution, setExecution] = React.useState("");
  const [kpis, setKpis] = React.useState<Kpi[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [roughNotes, setRoughNotes] = React.useState("");
  const [coverFile, setCoverFile] = React.useState<File | null>(null);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = React.useState<File[]>([]);
  const [mediaError, setMediaError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [eligible, setEligible] = React.useState<EligiblePage | null>(null);
  const [pickerError, setPickerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(String(editing?.title ?? ""));
    setSlug(String(editing?.slug ?? ""));
    setClientId(String(editing?.client_id ?? ""));
    setHeadline(String(editing?.headline ?? ""));
    setServiceCategory(String(editing?.service_category ?? ""));
    setSummary(String(editing?.executive_summary ?? editing?.summary ?? ""));
    setExecution(String(editing?.operations_execution ?? editing?.body ?? ""));
    setKpis(Array.isArray(editing?.kpis) ? editing.kpis : []);
    setSelected((editing?.dossiers ?? []).map((dossier) => dossier.dossier_id));
    setRoughNotes("");
    setCoverFile(null);
    setLogoFile(null);
    setGalleryFiles([]);
    setMediaError(null);
    setQuery("");
    setOffset(0);
    setError(null);
    setNotice(null);
  }, [open, editing]);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setPickerError(null);
    tenant<EligiblePage>(
      `/success-stories/eligible-dossiers?limit=25&offset=${offset}&q=${encodeURIComponent(query)}`,
    ).then((data) => {
      if (live) setEligible(data);
    }).catch((caught: unknown) => {
      if (live) setPickerError(errMsg(caught));
    });
    return () => { live = false; };
  }, [open, query, offset]);

  function toggleDossier(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }

  function chooseImage(file: File | null, setter: (value: File | null) => void) {
    setMediaError(null);
    if (!file) return setter(null);
    const problem = imageProblem(file);
    if (problem) {
      setMediaError(problem);
      return setter(null);
    }
    return setter(file);
  }

  async function generate() {
    if (!selected.length) {
      setError("Select at least one eligible operations file before generating.");
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const generated = await tenant<Generation>("/success-stories/generate", {
        method: "POST",
        body: { dossier_ids: selected, rough_notes: roughNotes.trim() || undefined },
      });
      if (generated.manual_required || !generated.draft) {
        setNotice(generated.sandbox
          ? "AI drafting is disabled in sandbox. The selected files and notes are ready for manual drafting."
          : "The model did not return a safe structured draft. Continue manually; nothing was saved.");
        return;
      }
      setHeadline(generated.draft.headline);
      setSummary(generated.draft.executive_summary);
      setExecution(generated.draft.operations_execution);
      setKpis(generated.draft.kpis);
      setNotice("Generated draft loaded. Review every statement and KPI before saving.");
    } catch (caught) {
      setError(errMsg(caught));
    } finally {
      setGenerating(false);
    }
  }

  async function upload(id: string, role: "COVER" | "CLIENT_LOGO" | "GALLERY", file: File) {
    await tenant(`/success-stories/${id}/media`, {
      method: "POST",
      body: {
        role,
        data_url: await readFileAsDataUrl(file),
        original_name: file.name,
      },
    });
  }

  async function submit() {
    setError(null);
    if (!selected.length) {
      setError("Select at least one eligible operations file.");
      return;
    }
    if (mediaError) {
      setError(mediaError);
      return;
    }
    const cleanedKpis = kpis
      .map((item) => ({ label: item.label.trim(), value: item.value.trim() }))
      .filter((item) => item.label || item.value);
    if (cleanedKpis.some((item) => !item.label || !item.value)) {
      setError("Every KPI needs both a label and a value.");
      return;
    }
    setBusy(true);
    try {
      const request = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        client_id: clientId || null,
        headline: headline.trim() || null,
        executive_summary: summary.trim() || null,
        operations_execution: execution.trim() || null,
        service_category: serviceCategory.trim() || null,
        dossier_ids: selected,
        kpis: cleanedKpis,
      };
      const story = editing
        ? await tenant<StoryFormRow>(`/success-stories/${String(editing.success_story_id)}`, {
            method: "PATCH",
            body: request,
          })
        : await tenant<StoryFormRow>("/success-stories", { method: "POST", body: request });
      const id = String(story.success_story_id);
      if (coverFile) await upload(id, "COVER", coverFile);
      if (logoFile) await upload(id, "CLIENT_LOGO", logoFile);
      for (const file of galleryFiles) {
        // Intentionally sequential: each upload binds and audits one vault object.
        // eslint-disable-next-line no-await-in-loop
        await upload(id, "GALLERY", file);
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(errMsg(caught));
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function removeMedia(documentId: string) {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/success-stories/${String(editing.success_story_id)}/media/${documentId}`, {
        method: "DELETE",
      });
      setNotice("Media removed. Reopen this story to refresh the media references.");
      onSaved();
    } catch (caught) {
      setError(errMsg(caught));
    } finally {
      setBusy(false);
    }
  }

  const pageStart = eligible ? eligible.offset + 1 : 0;
  const pageEnd = eligible ? Math.min(eligible.offset + eligible.rows.length, eligible.total) : 0;
  const priorMedia = [
    editing?.cover_vault_id ? { role: "Cover", id: String(editing.cover_vault_id) } : null,
    editing?.client_logo_vault_id ? { role: "Client logo", id: String(editing.client_logo_vault_id) } : null,
    ...(Array.isArray(editing?.gallery_vault_ids)
      ? editing.gallery_vault_ids.map((id) => ({ role: "Gallery", id: String(id) }))
      : []),
  ].filter((item): item is { role: string; id: string } => Boolean(item));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit success story" : "New success story"}
      description="Choose completed files, draft and review the story, attach governed images, then save for sign-off."
      size="xl"
    >
      <div className="space-y-5">
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="font-semibold">1. Operations files</h3>
            <p className="text-xs text-muted-foreground">Only completed, financially pending and closed files are eligible.</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
              placeholder="Search reference, client, route or service"
              aria-label="Search eligible operations files"
            />
          </div>
          {pickerError && <ErrorState message={pickerError} />}
          {!eligible ? (
            <p className="text-sm text-muted-foreground">Loading eligible files…</p>
          ) : eligible.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible files match this search.</p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {eligible.rows.map((dossier) => (
                <label key={dossier.dossier_id} className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(dossier.dossier_id)}
                    onChange={() => toggleDossier(dossier.dossier_id)}
                  />
                  <span>
                    <strong>{dossier.ref || dossier.dossier_id}</strong>
                    <span className="ml-2 text-muted-foreground">
                      {[dossier.client_name, dossier.service_category, dossier.pol && dossier.pod ? `${dossier.pol} → ${dossier.pod}` : null]
                        .filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{selected.length} selected · {eligible?.total ?? 0} eligible</span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!eligible || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{tr("Previous")}</Button>
              <span>{pageStart}–{pageEnd}</span>
              <Button size="sm" variant="outline" disabled={!eligible || pageEnd >= eligible.total} onClick={() => setOffset(offset + 25)}>{tr("Next")}</Button>
            </span>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">2. Governed drafting</h3>
          <Field label="Rough notes" hint="Optional context. Do not include costs, margin or confidential data.">
            <Textarea value={roughNotes} onChange={(event) => setRoughNotes(event.target.value)} rows={3} />
          </Field>
          <Button variant="outline" onClick={generate} loading={generating} disabled={!selected.length || generating}>
            Generate structured draft
          </Button>
          {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
        </section>

        <section className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <h3 className="md:col-span-2 font-semibold">3. Review and structure</h3>
          <Field label={tr("Title")} required><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Public slug"><Input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="generated-from-title-if-empty" /></Field>
          <Field label={tr("Client")} hint="Name and logo appear publicly only with NAMED consent.">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">No named client</option>
              {(clients || []).map((client) => <option key={client.client_id} value={client.client_id}>{client.name || client.client_id}</option>)}
            </select>
          </Field>
          <Field label={tr("Service category")}><Input value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)} /></Field>
          <Field label="Headline"><Input value={headline} onChange={(event) => setHeadline(event.target.value)} /></Field>
          <div />
          <div className="md:col-span-2"><Field label="Executive summary"><Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} /></Field></div>
          <div className="md:col-span-2"><Field label="Operations execution"><Textarea value={execution} onChange={(event) => setExecution(event.target.value)} rows={7} /></Field></div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">KPIs</span>
              <Button size="sm" variant="outline" disabled={kpis.length >= 4} onClick={() => setKpis([...kpis, { label: "", value: "" }])}>Add KPI</Button>
            </div>
            {kpis.length === 0 && <p className="text-xs text-muted-foreground">Add up to four verified KPI label/value pairs.</p>}
            {kpis.map((kpi, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label={`KPI ${index + 1} label`} value={kpi.label} placeholder={tr("Label")} onChange={(event) => setKpis(kpis.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                <Input aria-label={`KPI ${index + 1} value`} value={kpi.value} placeholder={tr("Value")} onChange={(event) => setKpis(kpis.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
                <Button size="sm" variant="ghost" onClick={() => setKpis(kpis.filter((_, i) => i !== index))}>{tr("Remove")}</Button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="font-semibold">4. Public images</h3>
            <p className="text-xs text-muted-foreground">Images are content-checked, classified and bound to this story. Raw vault IDs are not accepted.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FileDrop file={coverFile} onPick={(file) => chooseImage(file, setCoverFile)} accept={IMAGE_ACCEPT} label="Cover image" hint="PNG, JPEG or WebP · 10 MB maximum" />
            <FileDrop file={logoFile} onPick={(file) => chooseImage(file, setLogoFile)} accept={IMAGE_ACCEPT} label="Client logo" hint="Shown only when client consent is NAMED" />
          </div>
          <FileDrop
            file={null}
            onPick={(file) => {
              if (!file) return;
              const problem = imageProblem(file);
              if (problem) return setMediaError(problem);
              setMediaError(null);
              setGalleryFiles((current) => [...current, file]);
            }}
            accept={IMAGE_ACCEPT}
            label="Add gallery images"
            hint="Choose repeatedly to queue more than one image"
          />
          {galleryFiles.length > 0 && (
            <ul className="space-y-1 text-sm">
              {galleryFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded border px-3 py-2">
                  <span>{file.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setGalleryFiles(galleryFiles.filter((_, i) => i !== index))}>{tr("Remove")}</Button>
                </li>
              ))}
            </ul>
          )}
          {priorMedia.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Existing governed media</p>
              {priorMedia.map((media) => (
                <div key={media.id} className="flex items-center justify-between text-xs">
                  <span>{media.role} · {media.id}</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeMedia(media.id)}>{tr("Remove")}</Button>
                </div>
              ))}
            </div>
          )}
          {mediaError && <p className="text-xs text-destructive">{mediaError}</p>}
        </section>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || !selected.length || busy}>
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
  const [editing, setEditing] = React.useState<StoryFormRow | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function act(id: string, action: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await action();
      reload();
    } catch (caught) {
      setRowError(errMsg(caught));
    } finally {
      setRowBusy(null);
    }
  }

  async function openEdit(id: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      setEditing(await tenant<StoryFormRow>(`/success-stories/${id}`));
      setFormOpen(true);
    } catch (caught) {
      setRowError(errMsg(caught));
    } finally {
      setRowBusy(null);
    }
  }

  const filtered = React.useMemo(
    () => (rows || []).filter((row) => !filter || storyStatus(row) === filter),
    [rows, filter],
  );

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Success stories"
        description="Build from completed operation files, sign off, then publish to the portfolio."
        action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>New story</Button>}
      />
      <HubTabs />
      <div className="mb-4">
        <Chips label="Filter stories by status" value={filter} options={STORY_FILTERS} onChange={setFilter} />
      </div>
      {rowError && <div className="mb-3"><ErrorState message={rowError} /></div>}
      {error ? <ErrorState message={error} /> : rows === null ? <SkeletonTable /> : filtered.length === 0 ? (
        <EmptyState
          title={rows.length ? "No stories match" : "No success stories yet"}
          hint={rows.length ? "Try another filter." : "Build the first story from one or more completed operations files."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((row) => {
            const id = String(row.success_story_id);
            const status = storyStatus(row);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{cell(row.title)}</p>
                  <StatusPill status={status} />
                </div>
                {row.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{cell(row.summary)}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.is_published ? `Published ${dateFmt(row.published_at)}` : `Created ${dateFmt(row.created_at)}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!row.is_published && <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => openEdit(id)}>{tr("Edit")}</Button>}
                  {status === "DRAFT" && (
                    <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => act(id, () => tenant(`/success-stories/${id}/sign-off`, { method: "POST", body: {} }))}>{tr("Sign off")}</Button>
                  )}
                  {status === "SIGNED_OFF" && (
                    <Button size="sm" loading={rowBusy === id} onClick={() => act(id, () => tenant(`/success-stories/${id}/publish`, { method: "POST", body: {} }))}>Publish</Button>
                  )}
                  {status === "PUBLISHED" && (
                    <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => act(id, () => tenant(`/success-stories/${id}/unpublish`, { method: "POST", body: {} }))}>Unpublish</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <StoryForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}
