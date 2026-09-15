/**
 * The role's Control Tower band, edited — scope, default four, locks
 * (doc/KPI_BAND_ENGINEERING_GUIDE.md §7.2).
 *
 * WHY IT LIVES IN THE ROLE FORM, UNDER THE PERMISSION-MATRIX TAB: the ordering
 * IS the feature. Tiles can only follow grants (guide §4: the config can speak
 * of what the role can read, never more), so the step appears where an admin
 * has just decided what the role reads — the matrix tab, then the band, in the
 * same modal, in that order. A separate "KPI settings" page would invite
 * configuring the band first and discovering the grants second, which is the
 * write the server has to reject.
 *
 * THE DRAFT MIRRORS THE BAND, NOT THE ROLE. Every control here is what the
 * members' band actually does with the value: the default list is capped at
 * the fixed four, reorderable, and a lock is only offered on tiles inside the
 * default (locked-without-default is a server rejection, so it is not even a
 * possible click). The scope toggle's "everything readable" is not a
 * client-side approximation of the role's grants — it is the server's OWN
 * eligibility answer echoed back (`eligibleIds`), which is the whole point of
 * this screen being one request and one PUT.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { tenant } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { BAND_DOMAINS, MAX_BAND_TILES, type BandTileMeta } from "@/features/dashboard/kpi-model";
import { iconForKpi } from "@/features/dashboard/components/kpi-icons";

type KpiResponse = {
  tiles: BandTileMeta[];
  eligibleIds: string[];
  config: {
    scopeIds: string[] | null;
    defaultIds: string[];
    lockedIds: string[];
  } | null;
};

export function RoleKpiPanel({ roleId }: { roleId: string }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState<KpiResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // The draft: null scope = dynamic "everything readable"; an array = narrowed.
  const [scope, setScope] = React.useState<string[] | null>(null);
  const [defaults, setDefaults] = React.useState<string[]>([]);
  const [locked, setLocked] = React.useState<string[]>([]);

  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    let dead = false;
    setData(null);
    setLoadError(null);
    setDirty(false);
    tenant<KpiResponse>(`/roles/${roleId}/kpi`)
      .then((d) => {
        if (dead || !d) return;
        setData(d);
        setScope(d.config?.scopeIds ?? null);
        setDefaults(d.config?.defaultIds ?? []);
        setLocked(d.config?.lockedIds ?? []);
      })
      .catch((e) => {
        if (!dead) setLoadError(errMsg(e));
      });
    return () => {
      dead = true;
    };
  }, [roleId]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!data) {
    return (
      <p className="text-label text-muted-foreground">{t("common.loading")}</p>
    );
  }
  // Post-guard alias: the handlers below close over `d`, not the state slot,
  // so TypeScript's narrowing (and the reader's certainty) survives the
  // closures without re-`!`-ing on every line.
  const d = data;

  const scopeAll = scope === null;
  const inScope = (id: string) => scopeAll || scope.includes(id);
  const offerable = d.tiles.filter((tile) => inScope(tile.id));

  function touch() {
    setDirty(true);
    setSavedAt(null);
  }

  /** A scope edit that drops a defaulted tile would be the write the server
   *  rejects (default ⊆ scope); the editor enforces the invariant by dropping
   *  the default (and its lock) too. Applies to BOTH branches — narrowing
   *  from "everything readable" with one click is still a removal. */
  function dropFromBandIfScopedOut(next: string[]) {
    const lost = defaults.filter((x) => !next.includes(x));
    if (!lost.length) return;
    setDefaults((prev) => prev.filter((x) => next.includes(x)));
    setLocked((l) => l.filter((x) => next.includes(x)));
  }

  function toggleScope(id: string) {
    touch();
    if (scopeAll) {
      // Turning "everything readable" into a list starts FROM everything —
      // unchecking a tile must narrow, never accidentally widen to "only
      // this one".
      const started = d.eligibleIds.filter((x) => x !== id);
      dropFromBandIfScopedOut(started);
      setScope(started);
      return;
    }
    setScope((s) => {
      const next = (s ?? []).includes(id)
        ? (s ?? []).filter((x) => x !== id)
        : [...(s ?? []), id];
      dropFromBandIfScopedOut(next);
      return next;
    });
  }

  function toggleDefault(id: string) {
    touch();
    setDefaults((prev) => {
      if (prev.includes(id)) {
        setLocked((l) => l.filter((x) => x !== id));
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= MAX_BAND_TILES) return prev;
      return [...prev, id];
    });
  }

  function moveDefault(id: string, delta: -1 | 1) {
    touch();
    setDefaults((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function send(body: unknown) {
    setBusy(true);
    setSaveError(null);
    try {
      await tenant(`/roles/${roleId}/kpi`, { method: "PUT", body });
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () => send({ config: { scopeIds: scope, defaultIds: defaults, lockedIds: locked } });
  /** Whole-row reset: `config: null` deletes it, which is what "product
   *  default" MEANS here — absence, not an empty config (absence and [] are
   *  different facts; see the preference doctrine). */
  const reset = () => {
    void (async () => {
      setBusy(true);
      setSaveError(null);
      try {
        await tenant(`/roles/${roleId}/kpi`, { method: "PUT", body: { config: null } });
        setScope(null);
        setDefaults([]);
        setLocked([]);
        setDirty(false);
        setSavedAt(Date.now());
      } catch (e) {
        setSaveError(errMsg(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section
      aria-label={t("dash.roleKpiSection")}
      className="rounded-lg border bg-card p-4"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("dash.roleKpiSection")}</h3>
        {savedAt !== null && !dirty && (
          <Pill tone="ok">{t("dash.roleKpiSaved")}</Pill>
        )}
      </div>
      <p className="mb-3 text-label text-muted-foreground">{t("dash.roleKpiDesc")}</p>

      {/* ── default four ─────────────────────────────────────────────────── */}
      <div className="mb-4">
        <p className="mb-1.5 text-micro uppercase text-muted-foreground">
          {t("dash.roleKpiDefaultsLabel")}
        </p>
        {defaults.length === 0 ? (
          <p className="text-label text-muted-foreground">{t("common.none")}</p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {defaults.map((id, i) => {
              const tile = data.tiles.find((x) => x.id === id);
              const isLocked = locked.includes(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-label"
                >
                  <Pill tone="mute">{String(i + 1)}</Pill>
                  <span>{tile ? t(tile.labelKey) : id}</span>
                  <label className="ml-1 flex items-center gap-1 text-micro text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => {
                        touch();
                        setLocked((l) =>
                          isLocked ? l.filter((x) => x !== id) : [...l, id],
                        );
                      }}
                      className="h-3 w-3 rounded border-input"
                    />
                    {t("dash.roleKpiLockCol")}
                  </label>
                  <button
                    type="button"
                    aria-label="move left"
                    disabled={i === 0}
                    onClick={() => moveDefault(id, -1)}
                    className="disabled:opacity-40"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="move right"
                    disabled={i === defaults.length - 1}
                    onClick={() => moveDefault(id, +1)}
                    className="disabled:opacity-40"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => toggleDefault(id)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── scope: what members may pick ─────────────────────────────────── */}
      <p className="mb-1.5 text-micro uppercase text-muted-foreground">
        {scopeAll
          ? t("dash.roleKpiScopeAll")
          : t("dash.roleKpiScopeCustom", { n: scope.length, total: d.tiles.length })}
        {!scopeAll && (
          <button
            type="button"
            onClick={() => {
              touch();
              setScope(null);
            }}
            className="ml-2 text-primary-ink underline"
          >
            {t("dash.roleKpiReset")}
          </button>
        )}
      </p>
      {offerable.length === 0 && scopeAll && d.tiles.length === 0 ? (
        <p className="text-label text-muted-foreground">{t("dash.roleKpiNoTiles")}</p>
      ) : (
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {BAND_DOMAINS.map((g) => {
            const list = d.tiles.filter((x) => x.domain === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="sm:col-span-2">
                <p className="mt-2 text-micro uppercase text-muted-foreground">{t(g.labelKey)}</p>
                {list.map((tile) => {
                  const Icon = iconForKpi(tile.icon, tile.domain);
                  const scoped = inScope(tile.id);
                  const defaulted = defaults.includes(tile.id);
                  return (
                    <div key={tile.id} className="flex items-center gap-2 py-0.5 text-label">
                      <Checkbox
                        checked={scoped}
                        onCheckedChange={() => toggleScope(tile.id)}
                        label={
                          <span className="flex items-center gap-1.5">
                            <Icon width={13} height={13} />
                            {t(tile.labelKey)}
                          </span>
                        }
                      />
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => toggleDefault(tile.id)}
                        disabled={!defaulted && (defaults.length >= MAX_BAND_TILES || !scoped)}
                        className="shrink-0 text-primary-ink disabled:opacity-40"
                      >
                        {defaulted ? "− band" : "+ band"}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {saveError && (
        <p role="alert" className="mt-3 text-label text-[rgb(var(--bad))]">
          {saveError}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={reset}>
          {t("dash.roleKpiReset")}
        </Button>
        <Button type="button" size="sm" loading={busy} disabled={busy || !dirty} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </section>
  );
}
