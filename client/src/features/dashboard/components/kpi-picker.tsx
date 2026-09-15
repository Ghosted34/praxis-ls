/**
 * The KPI band picker — inline panel over the tower, the one door for this
 * choice (D6).
 *
 * WHY IT ONLY EVER OFFERS PICKABLE TILES. The candidate list is the server's
 * `offer` set — live ∩ readable ∩ installed-here — and the role's narrowed
 * scope, already applied upstream. A tile the caller cannot read is NOT listed
 * and NOT greyed (guide §4: "not dimmed, not 'You don't have permission', not
 * a placeholder — it does not exist"), and the count line says how many live
 * tiles the grants leave out without enumerating them: the number is useful
 * ("your band could be bigger"), the list of what you lack is an inventory of
 * the tenant's modules handed to whoever is not allowed them.
 *
 * Draft-then-Apply, never live writes on click: the band repaints on the same
 * query the tower polls, and a picker that saved on every toggle would refetch
 * the tower mid-decision and reorder the tiles under the cursor. Cancel
 * therefore genuinely means cancel — no optimistic write to roll back, no
 * half-chosen state for a second reader to see.
 *
 * The footer's two resets answer two different confusions. "Restore role
 * default" writes NULL — stop overriding, follow the role — so the band keeps
 * following the role's next change (someone's Apply must not freeze the
 * default as a copy of it). "Clear my choice" is that same write, labeled for
 * users who never knew a default existed and only want out.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { tr } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { saveShellPrefs } from "@/lib/preferences";
import {
  MAX_BAND_TILES,
  BAND_DOMAINS,
  draftAdd,
  draftRemove,
  draftMove,
  draftInitial,
  draftDirty,
  draftToPins,
  type KpiCatalog,
  type BandTileMeta,
} from "../kpi-model";
import { iconForKpi } from "./kpi-icons";

export function KpiPicker({
  open,
  onClose,
  catalog,
  bandSlotIds,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  catalog: KpiCatalog | null;
  /** What the band paints right now — the draft's fallback if the user has
   *  never chosen and no role default is set. */
  bandSlotIds: string[];
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Re-seed the draft every time the picker opens, and when the catalog
  // arrives while it is open (cold first fetch) — but NEVER while the user
  // is mid-edit: the effect keys on `open` and catalog IDENTITY, not on
  // catalog content, so a background tower refresh cannot reorder slots.
  React.useEffect(() => {
    if (!open) return;
    setSearch("");
    setSaveError(null);
    if (catalog) setDraft(draftInitial(catalog, bandSlotIds));
  }, [open, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const locked = new Set(catalog?.lockedIds ?? []);
  const full = draft.length >= MAX_BAND_TILES;
  const tiles = catalog?.tiles ?? [];
  const stored = catalog?.currentIds ?? [];
  const dirty = catalog ? draftDirty(draft, stored.length ? stored : catalog.roleDefaultIds) : false;

  const byDomain = new Map<string, BandTileMeta[]>();
  const q = search.trim().toLowerCase();
  for (const tile of tiles) {
    const label = t(tile.labelKey).toLowerCase();
    const hint = t(tile.hintKey).toLowerCase();
    if (q && !label.includes(q) && !hint.includes(q)) continue;
    const list = byDomain.get(tile.domain) ?? [];
    list.push(tile);
    byDomain.set(tile.domain, list);
  }

  async function apply() {
    if (!catalog) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveShellPrefs({ kpiPins: draftToPins(draft, catalog.roleDefaultIds) });
      // The band resolves server-side from these prefs — the same
      // invalidate-everything refresh the tower's manual button uses, for the
      // same reason: the next painted band must come from the server's re-
      // resolution (eligibility, locks, defaults), not from the client's draft.
      void qc.invalidateQueries();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearChoice() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveShellPrefs({ kpiPins: null });
      void qc.invalidateQueries();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      title={t("dash.kpiPickerTitle")}
      description={t("dash.kpiPickerDesc")}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {catalog && catalog.roleDefaultIds.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setDraft([...catalog.roleDefaultIds])}
              >
                {t("dash.kpiRestore")}
              </Button>
            )}
            {catalog && catalog.currentIds !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={clearChoice}
              >
                {t("dash.kpiClear")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saveError && (
              <span role="alert" className="text-label text-[rgb(var(--bad))]">
                {saveError}
              </span>
            )}
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" loading={saving} disabled={!dirty || saving} onClick={apply}>
              {t("dash.kpiApply")}
            </Button>
          </div>
        </div>
      }
    >
      {loading || !catalog ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-[rgb(var(--bad))]">{error}</p>
      ) : (
        <>
          {/* ── slots ─────────────────────────────────────────────────────── */}
          <div
            className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label={
              full
                ? t("dash.kpiSlotsFull")
                : t("dash.kpiSlotsFree", { n: draft.length })
            }
          >
            {Array.from({ length: MAX_BAND_TILES }).map((_, i) => {
              const id = draft[i];
              const tile = id ? tiles.find((x) => x.id === id) : null;
              const isLocked = !!id && locked.has(id);
              if (!tile) {
                return (
                  <div
                    key={i}
                    className="flex min-h-[74px] items-center justify-center rounded-md border border-dashed text-micro uppercase text-muted-foreground"
                  >
                    {t("common.none")}
                  </div>
                );
              }
              const Icon = iconForKpi(tile.icon, tile.domain);
              return (
                <div
                  key={id}
                  className="flex min-h-[74px] flex-col justify-between rounded-md border bg-card p-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1.5 truncate text-label">
                      <Icon width={14} height={14} />
                      <span className="truncate">{t(tile.labelKey)}</span>
                    </span>
                    <Pill tone={tile.tone}>{String(i + 1)}</Pill>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex gap-1">
                      <SlotAction label="←" disabled={i === 0} onClick={() => setDraft((d) => draftMove(d, id, -1))} />
                      <SlotAction label="→" disabled={i === draft.length - 1} onClick={() => setDraft((d) => draftMove(d, id, +1))} />
                    </span>
                    <button
                      type="button"
                      disabled={isLocked}
                      title={isLocked ? t("dash.kpiLocked") : undefined}
                      onClick={() => setDraft((d) => draftRemove(d, id, [...locked]))}
                      className="rounded px-1.5 text-label text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      ✕<span className="sr-only">{tr("Remove")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── search + grouped catalog ──────────────────────────────────── */}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dash.kpiSearch")}
            className="mb-3"
          />
          {BAND_DOMAINS.filter((g) => (byDomain.get(g.key) ?? []).length > 0).map((g) => (
            <section key={g.key} aria-label={t(g.labelKey)} className="mb-3">
              <h3 className="mb-1.5 text-micro uppercase text-muted-foreground">{t(g.labelKey)}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {(byDomain.get(g.key) ?? []).map((tile) => {
                  const picked = draft.includes(tile.id);
                  const isLocked = locked.has(tile.id);
                  return (
                    <li key={tile.id}>
                      <button
                        type="button"
                        // Full band: new picks are refused (draftAdd is also
                        // total, but a dead cursor is kinder than a no-op
                        // click). Picked tiles always answer, to unpick.
                        disabled={!picked && full}
                        onClick={() =>
                          setDraft((d) => (d.includes(tile.id) ? draftRemove(d, tile.id, [...locked]) : draftAdd(d, tile.id)))
                        }
                        aria-pressed={picked}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors",
                          picked
                            ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] bg-accent/40"
                            : "hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-accent/30",
                          !picked && full && "opacity-50",
                        )}
                      >
                        {(() => {
                          const Icon = iconForKpi(tile.icon, tile.domain);
                          return <Icon width={15} height={15} />;
                        })()}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label">{t(tile.labelKey)}</span>
                          <span className="block truncate text-micro text-muted-foreground">{t(tile.hintKey)}</span>
                        </span>
                        {isLocked && (
                          <span title={t("dash.kpiLocked")} className="text-micro uppercase text-muted-foreground">
                            🔒
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {byDomain.size === 0 && (
            <p className="text-sm text-muted-foreground">{t("common.none")}</p>
          )}

          <p className="mt-2 text-label text-muted-foreground" aria-live="polite">
            {t("dash.kpiOfferCount", { offered: catalog.tiles.length, total: catalog.totalLive })}
            {catalog.hiddenTileCount > 0 ? ` · ${t("dash.kpiHiddenHint")}` : ""}
          </p>
        </>
      )}
    </Dialog>
  );
}

/** The reorder arrows as tiny labelled buttons — real focus targets, not
 *  click areas (same rule as the cards themselves). */
function SlotAction({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border px-1.5 text-label leading-tight hover:bg-accent/50 disabled:opacity-40"
    >
      {label}
      <span className="sr-only">{label === "←" ? tr("Move left") : tr("Move right")}</span>
    </button>
  );
}
