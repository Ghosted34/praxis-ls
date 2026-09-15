/**
 * Pillars — the named sections the public services page is built from.
 *
 * WHY A DIALOG AND NOT A TAB. A pillar is tenant-wide: "Fret international"
 * groups every sea and air service, not one of them. Editing it from inside one
 * service's Website tab would suggest otherwise, and putting it on its own
 * Master-data screen would bury a three-row list two clicks from the only place
 * anyone thinks about it. So it opens from the field that uses it, and closes
 * back to it.
 *
 * WHY IT EXISTS AT ALL. Migration 12755 shipped `service_type_web_group` with
 * full CRUD behind `/service-types/web/groups`, and seed 9084 wrote three rows
 * into it — but nothing in the product could read or write one. A tenant could
 * therefore be shown pillars on their own website that they had no way to
 * rename, reorder, retire or add to. That is the gap this closes.
 *
 * DELETING IS NOT DESTRUCTIVE, and the copy has to say so. The FK is
 * ON DELETE SET NULL: the services under a deleted pillar fall back to the
 * trailing unnamed group and keep rendering. The confirm names the count the
 * server is about to release rather than warning about data loss that cannot
 * happen — and `useConfirm()`, never `window.confirm`, because a native dialog
 * throws the tenant's branding away at the moment we ask them to destroy
 * something (CLAUDE.md, doc/FRONTEND_GUIDE.md §3.10).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useConfirm } from "@/components/ui/use-confirm";
import { errMsg, useResource } from "@/lib/use-resource";
import { ApiError } from "@/lib/api-client";
import { slug as suggestSlug } from "@/lib/slug";
import * as api from "@/lib/operations-api";

const L = api.SERVICE_TYPE_WEB_LIMITS;

/**
 * The icon names the renderer resolves.
 *
 * A NAME, never markup or a URL — `service_type_web_group.icon` is
 * tenant-editable and reaches a public page, so free text there would be stored
 * XSS (12755's own header says this). A closed list also means the picker can
 * only offer glyphs that actually render: the public side maps these, and a
 * typo'd name would draw nothing with no error anywhere.
 */
const ICONS = ["ship", "plane", "truck", "train", "document", "warehouse", "globe"] as const;

type Draft = {
  key: string;
  name_fr: string;
  name_en: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  key: "",
  name_fr: "",
  name_en: "",
  icon: "",
  sort_order: 100,
  is_active: true,
});

const toDraft = (g: api.ServiceTypeWebGroup): Draft => ({
  key: g.key,
  name_fr: g.name_fr,
  name_en: g.name_en ?? "",
  icon: g.icon ?? "",
  sort_order: g.sort_order ?? 100,
  is_active: g.is_active !== false,
});

/* ── The editor for one pillar (new or existing) ─────────────────────────── */

function PillarForm({
  draft,
  setDraft,
  isNew,
  disabled,
  onSave,
  onCancel,
  busy,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  isNew: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft({ ...draft, [k]: v });

  // The key is the anchor a shared link lands on, so it is suggested from the
  // French name on a NEW pillar and never rewritten afterwards: changing it
  // silently would break /services#freight for everyone who bookmarked it.
  const keySuggestion = suggestSlug(draft.name_fr, "pillar");

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={`${tr("Name")} (FR)`}
          required
          hint={tr("What the section is called on the French site.")}
        >
          <Input
            value={draft.name_fr}
            disabled={disabled || busy}
            maxLength={L.GROUP_NAME_MAX}
            onChange={(e) => set("name_fr", e.target.value)}
          />
        </Field>
        <Field label={`${tr("Name")} (EN)`}>
          <Input
            value={draft.name_en}
            disabled={disabled || busy}
            maxLength={L.GROUP_NAME_MAX}
            onChange={(e) => set("name_en", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field
          label={tr("Anchor")}
          required
          hint={
            isNew
              ? `${tr("Suggestion")}: ${keySuggestion || "—"}`
              : tr("Changing this breaks links already shared to this section.")
          }
        >
          <div className="flex gap-2">
            <Input
              value={draft.key}
              disabled={disabled || busy}
              aria-label={tr("Anchor")}
              placeholder="freight"
              onChange={(e) => set("key", e.target.value.toLowerCase())}
            />
            {isNew && keySuggestion && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => set("key", keySuggestion)}
              >
                {tr("Use suggestion")}
              </Button>
            )}
          </div>
          <p className="micro text-muted-foreground mt-1">
            /services#{draft.key || keySuggestion || "…"}
          </p>
        </Field>
        <Field label={tr("Icon")} hint={tr("Optional glyph beside the heading.")}>
          <Select
            value={draft.icon}
            disabled={disabled || busy}
            onChange={(e) => set("icon", e.target.value)}
          >
            <option value="">{tr("None")}</option>
            {ICONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tr("Order")}
          hint={tr("Lower shows first on the page.")}
        >
          <Input
            type="number"
            min={0}
            max={10000}
            value={String(draft.sort_order)}
            disabled={disabled || busy}
            onChange={(e) =>
              set("sort_order", Math.max(0, Math.min(10000, Number(e.target.value) || 0)))
            }
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.is_active}
          disabled={disabled || busy}
          onChange={(e) => set("is_active", e.target.checked)}
        />
        {tr("Show this section on the public site")}
      </label>
      <p className="micro text-muted-foreground">
        {tr(
          "Switching a section off leaves its services published — they move to the unnamed group at the foot of the page.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={onSave} data-testid="pillar-save">
          {isNew ? tr("Add pillar") : tr("Save pillar")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {tr("Cancel")}
        </Button>
      </div>
    </div>
  );
}

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function ServiceTypeWebPillars({
  open,
  onClose,
  onChanged,
  canWrite = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after any write, so the caller can re-read the pillar list. */
  onChanged?: () => void;
  canWrite?: boolean;
}) {
  const groups = useResource(() => api.listServiceTypeWebGroups(), []);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const rows = React.useMemo(() => groups.data || [], [groups.data]);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setCreating(true);
    setError(null);
  }

  function startEdit(g: api.ServiceTypeWebGroup) {
    setCreating(false);
    setEditingId(g.group_id);
    setDraft(toDraft(g));
    setError(null);
  }

  function stopEditing() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      groups.reload();
      onChanged?.();
      stopEditing();
    } catch (e) {
      // Server messages verbatim — KEY_TAKEN names the field, and re-phrasing it
      // would lose which of the two the person has to change.
      setError(e instanceof ApiError ? e.message || errMsg(e) : errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body: api.ServiceTypeWebGroupPatch = {
      key: draft.key.trim(),
      name_fr: draft.name_fr.trim(),
      name_en: draft.name_en.trim() || null,
      icon: draft.icon.trim() || null,
      sort_order: draft.sort_order,
      is_active: draft.is_active,
    };
    if (!body.name_fr) {
      setError(tr("A pillar needs a French name."));
      return;
    }
    if (!body.key) {
      setError(tr("A pillar needs an anchor."));
      return;
    }
    setNote(null);
    if (creating) {
      await run(() => api.createServiceTypeWebGroup(body));
    } else if (editingId) {
      await run(() => api.updateServiceTypeWebGroup(editingId, body));
    }
  }

  async function remove(g: api.ServiceTypeWebGroup) {
    const count = g.service_count ?? 0;
    const ok = await confirm({
      title: tr("Delete this pillar?"),
      body: count
        ? `${tr("The")} ${count} ${tr(
            "service(s) under it stay published and move to the unnamed group at the foot of the services page.",
          )}`
        : tr("No services sit under it, so nothing on the page moves."),
      confirmLabel: tr("Delete pillar"),
      cancelLabel: tr("Keep it"),
      destructive: true,
    });
    if (!ok) return;
    setNote(null);
    await run(async () => {
      const out = await api.deleteServiceTypeWebGroup(g.group_id);
      if (out.released_services > 0) {
        setNote(
          `${out.released_services} ${tr(
            "service(s) moved to the unnamed group at the foot of the services page.",
          )}`,
        );
      }
    });
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={tr("Pillars")}
        description={tr(
          "The named sections your services page is built from. Every published service sits under one, or in the unnamed group at the foot of the page.",
        )}
        size="lg"
        footer={
          <Button variant="outline" onClick={onClose}>
            {tr("Done")}
          </Button>
        }
      >
        <div className="space-y-3" data-testid="pillar-manager">
          {error && <ErrorState message={error} />}
          {note && <Callout tone="info">{note}</Callout>}

          {groups.loading ? (
            <LoadingRow label={tr("Loading pillars…")} />
          ) : groups.error ? (
            <ErrorState message={groups.error} />
          ) : rows.length === 0 && !creating ? (
            <EmptyState
              title={tr("No pillars yet")}
              hint={tr(
                "Without one, every published service collects into a single unnamed group. Three or four sections is usual.",
              )}
            />
          ) : (
            <ul className="space-y-2">
              {rows.map((g) => (
                <li key={g.group_id} className="rounded-lg border p-3">
                  {editingId === g.group_id ? (
                    <PillarForm
                      draft={draft}
                      setDraft={setDraft}
                      isNew={false}
                      busy={busy}
                      onSave={() => void save()}
                      onCancel={stopEditing}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {g.name_fr}
                          </span>
                          {g.name_en && (
                            <span className="micro text-muted-foreground truncate">
                              · {g.name_en}
                            </span>
                          )}
                          {!g.is_active && <Pill tone="mute">{tr("Hidden")}</Pill>}
                        </div>
                        <span className="micro text-muted-foreground">
                          <span className="font-mono">#{g.key}</span>
                          {g.icon ? ` · ${g.icon}` : ""}
                          {" · "}
                          {g.service_count ?? 0} {tr("service(s)")}
                        </span>
                      </div>
                      {canWrite && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => startEdit(g)}
                          >
                            {tr("Edit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void remove(g)}
                          >
                            {tr("Delete")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {creating && (
            <PillarForm
              draft={draft}
              setDraft={setDraft}
              isNew
              busy={busy}
              onSave={() => void save()}
              onCancel={stopEditing}
            />
          )}

          {canWrite && !creating && !editingId && (
            <Button
              size="sm"
              variant="outline"
              onClick={startCreate}
              data-testid="pillar-add"
            >
              {tr("Add pillar")}
            </Button>
          )}
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

export default ServiceTypeWebPillars;
