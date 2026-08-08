/**
 * Error Command Center — the full view (spec §3.1).
 *
 * Layout follows the mockup top to bottom: connection badge + filters, KPI row,
 * 24h activity chart, then the grouped error feed. Clicking a card opens the
 * detail drawer (§3.2).
 *
 * REALTIME UPDATES ARE MERGED, NOT APPENDED. A pushed error is usually a repeat
 * of a group already on screen, so it replaces that row and re-sorts rather
 * than adding a duplicate — the feed shows error GROUPS, and a live feed that
 * grows a new card per occurrence would be unreadable within seconds of the
 * incident it exists to show.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  errorsApi, LEVELS, LEVEL_STYLE, ago, duration,
  type ErrorLevel, type ErrorQuery, type ErrorRow, type ErrorStats, type Trends,
} from "@/lib/errors-api";
import { platform, can } from "@/lib/api";
import type { TenantListRow } from "@/lib/types";
import { useErrorStream } from "@/lib/useErrorStream";
import { Button, Empty, Loading, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { ErrorDetailDrawer } from "@/components/ErrorDetailDrawer";
import { ShareErrorModal } from "@/components/ShareErrorModal";

// The scope dropdown needs a slug and something human to show next to it.
//
// This was a local `{ slug: string; name: string }`, and `name` is not a field
// GET /tenants returns — platform.tenant's column is `display_name`, so every
// option silently fell through to the slug. Structural typing means TypeScript
// had nothing to object to: the shape was simply declared wrong. Picking the
// fields off the real TenantListRow is what stops that being possible.
type Tenant = Pick<TenantListRow, "slug" | "display_name">;

const TIME_RANGES = [
  { label: "Last hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 30 days", hours: 720 },
];

export function ErrorCenter() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  // ── Filter state (§3.4) ───────────────────────────────────────────────────
  const [status, setStatus] = useState<"active" | "resolved" | "all">("active");
  const [levels, setLevels] = useState<ErrorLevel[]>([]);
  const [hours, setHours] = useState(24);
  const [scope, setScope] = useState<string>("all");
  const [moduleF, setModuleF] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "count" | "severity">("recent");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [modules, setModules] = useState<{ module: string; count: number }[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Appendix A.8 — multi-select for bulk copy. Keyed by error id. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** §3.4 "Custom" time range. Empty strings until the user picks a date. */
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const [shareId, setShareId] = useState<string | null>(null);

  // Debounce the search box so typing doesn't fire a query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query: ErrorQuery = useMemo(() => {
    // §3.4's "Custom" range. `hours === 0` is the sentinel for it, so the five
    // preset windows keep working off a single number and only the custom case
    // carries two dates. The API has always accepted from/to — it was only the
    // control that was missing.
    const custom = hours === 0 && (customFrom || customTo);
    const from = custom
      ? (customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : undefined)
      : new Date(Date.now() - hours * 3600_000).toISOString();
    // Inclusive of the chosen end DAY, not midnight at its start — "1st to the
    // 3rd" that silently excludes the 3rd is the classic date-range bug.
    const to = custom && customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : undefined;

    return {
      status,
      level: levels.length ? levels.join(",") : undefined,
      scope: scope === "platform" ? "platform" : undefined,
      tenant: scope !== "all" && scope !== "platform" ? scope : undefined,
      module: moduleF || undefined,
      search: debouncedSearch || undefined,
      sort,
      from,
      to,
      page,
      limit: 20,
    };
  }, [status, levels, scope, moduleF, debouncedSearch, sort, hours, customFrom, customTo, page]);

  /**
   * The activity chart is sized in HOURS, but a custom range is two dates.
   * `hours === 0` is the custom sentinel and the trends endpoint rejects a
   * non-positive value (422), so derive a real span from the dates and clamp to
   * the 720h retention ceiling the server enforces anyway.
   */
  const trendHours = useMemo(() => {
    if (hours !== 0) return hours;
    if (!query.from) return 24;
    const span = (query.to ? Date.parse(query.to) : Date.now()) - Date.parse(query.from);
    return Math.min(720, Math.max(1, Math.ceil(span / 3600_000)));
  }, [hours, query.from, query.to]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [feed, s, t] = await Promise.all([
        errorsApi.list(query),
        errorsApi.stats(query),
        errorsApi.trends({ ...query, hours: trendHours }),
      ]);
      setRows(feed.items);
      setTotal(feed.total);
      setPages(feed.pages);
      setStats(s);
      setTrends(t);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, trendHours]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    errorsApi.modules().then(setModules).catch(() => setModules([]));
    (platform.tenants() as Promise<Tenant[]>).then(setTenants).catch(() => setTenants([]));
  }, []);

  // Reset to page 1 whenever the filter changes, or you can end up on page 4 of
  // a 1-page result and see an empty feed that looks like a broken dashboard.
  useEffect(() => {
    setPage(1);
  }, [status, levels, scope, moduleF, debouncedSearch, sort, hours]);

  // ── Live feed ─────────────────────────────────────────────────────────────
  const statsRef = useRef(stats);
  statsRef.current = stats;

  const onLiveError = useCallback(
    (row: ErrorRow) => {
      setRows((prev) => {
        const i = prev.findIndex((r) => r.id === row.id);
        if (i === -1) {
          // Only surface a genuinely new group if it passes the active filter —
          // otherwise a fatal arrives while you are filtered to warnings.
          if (status === "resolved") return prev;
          if (levels.length && !levels.includes(row.level)) return prev;
          return [row, ...prev].slice(0, 20);
        }
        const next = [...prev];
        next[i] = { ...next[i], ...row };
        return next;
      });
      // Keep the counters honest without a full refetch on every event.
      setStats((s) =>
        s ? { ...s, total_occurrences: s.total_occurrences + 1 } : s,
      );
    },
    [status, levels],
  );

  const onLiveResolved = useCallback(
    (p: { id: string; resolved_at: string }) => {
      setRows((prev) =>
        status === "active"
          ? prev.filter((r) => r.id !== p.id)
          : prev.map((r) => (r.id === p.id ? { ...r, resolved_at: p.resolved_at } : r)),
      );
    },
    [status],
  );

  const { mode, lastEventAt } = useErrorStream({
    scope,
    onError: onLiveError,
    onResolved: onLiveResolved,
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const resolve = async (row: ErrorRow) => {
    try {
      await errorsApi.resolve(row.id);
      toast("Marked resolved");
      setRows((prev) => (status === "active" ? prev.filter((r) => r.id !== row.id) : prev));
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not resolve");
    }
  };

  const copyPlain = async (row: ErrorRow) => {
    try {
      const s = await errorsApi.share(row.id);
      await navigator.clipboard.writeText(s.plain);
      toast("Copied — ready to paste into an LLM");
    } catch {
      toast("Copy failed");
    }
  };

  /**
   * Appendix A.8 — copy several errors at once.
   *
   * The legacy PHP monitor had this and it is the difference between pasting
   * one error into a model and pasting the SHAPE of an incident. Three related
   * failures across two modules are usually one cause, and a model given all
   * three says so; given them one at a time it explains each in isolation.
   *
   * Sequential rather than Promise.all: this is N share-payload builds, and
   * firing twenty at once at a database already under incident load is the
   * behaviour the escalation evaluator was deliberately designed to avoid.
   */
  const copySelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const blocks: string[] = [];
      for (const id of ids) {

        const s = await errorsApi.share(id);
        blocks.push(s.plain);
      }
      await navigator.clipboard.writeText(
        `${ids.length} errors from Praxis LS — ${new Date().toISOString()}\n\n${blocks.join("\n\n──────────\n\n")}`,
      );
      toast(`${ids.length} error${ids.length === 1 ? "" : "s"} copied`);
      setSelected(new Set());
    } catch {
      toast("Copy failed");
    }
  };

  const doExport = async () => {
    try {
      const blob = await errorsApi.exportUrl({ ...query, format: "csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `praxis-errors-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed");
    }
  };

  const toggleLevel = (l: ErrorLevel) =>
    setLevels((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  useEffect(() => {
    if (openId) setParams({ id: openId }, { replace: true });
    else if (params.get("id")) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <>
      <PageHeader
        title="Error Command Center"
        desc="Real-time errors across every tenant and the platform itself — detect, diagnose, explain, share."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <ConnectionBadge mode={mode} lastEventAt={lastEventAt} />
            <Button size="sm" variant="ghost" onClick={doExport}>Export CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {/* Filter bar (§3.4) */}
      <div className="toolbar wrap" style={{ gap: 8 }}>
        <input
          className="search"
          placeholder="Search message, file path, route, stack trace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: "auto" }}>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
          <option value="all">All statuses</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: "auto" }}>
          <option value="all">All scopes</option>
          <option value="platform">Platform-wide</option>
          {tenants.map((t) => (
            <option key={t.slug} value={t.slug}>{t.display_name || t.slug}</option>
          ))}
        </select>
        <select value={moduleF} onChange={(e) => setModuleF(e.target.value)} style={{ width: "auto" }}>
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.module} value={m.module}>{m.module} ({m.count})</option>
          ))}
        </select>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: "auto" }}>
          {TIME_RANGES.map((r) => (
            <option key={r.hours} value={r.hours}>{r.label}</option>
          ))}
          {/* §3.4 — "Custom", with the date pair the spec's table asks for. */}
          <option value={0}>Custom…</option>
        </select>
        {hours === 0 && (
          <>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="From date"
              style={{ width: "auto" }}
            />
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="To date"
              style={{ width: "auto" }}
            />
          </>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto" }}>
          <option value="recent">Most recent</option>
          <option value="count">Most frequent</option>
          <option value="severity">Most severe</option>
        </select>
      </div>

      {/* Level multi-select */}
      <div className="row wrap" style={{ gap: 6, margin: "0 0 14px" }}>
        {LEVELS.map((l) => {
          const on = levels.includes(l);
          const st = LEVEL_STYLE[l];
          return (
            <button
              key={l}
              onClick={() => toggleLevel(l)}
              className="btn sm"
              style={{
                background: on ? st.bg : "transparent",
                color: on ? st.fg : "var(--ink-3)",
                borderColor: on ? st.border : "var(--line-2)",
                fontWeight: on ? 650 : 500,
              }}
            >
              {st.badge} {st.label}
            </button>
          );
        })}
        {levels.length > 0 && (
          <button className="btn ghost sm" onClick={() => setLevels([])}>Clear</button>
        )}
      </div>

      {/* KPI row (§3.1) */}
      <StatsCards stats={stats} />

      {/* 24h activity (§3.1) */}
      {trends && <ActivityChart trends={trends} />}

      {loading ? (
        <Loading />
      ) : loadError ? (
        <Empty>Couldn’t load errors — {loadError}</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          No errors match these filters
          {status === "active" ? " — nothing is currently broken." : "."}
        </Empty>
      ) : (
        <>
          {/* Selection bar appears only once something is selected — an always-on
              "0 selected" toolbar is a permanent reminder of a feature most
              visits do not use. */}
          {selected.size > 0 && (
            <div
              className="row between"
              style={{
                marginBottom: 10, padding: "8px 12px", borderRadius: 8,
                background: "var(--panel-2, rgba(0,0,0,.25))", border: "1px solid var(--line-2)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {selected.size} selected
              </span>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="primary" onClick={() => void copySelected()}>
                  📋 Copy {selected.size}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((row) => (
              <ErrorCard
                key={row.id}
                row={row}
                selected={selected.has(row.id)}
                onToggleSelect={() =>
                  setSelected((cur) => {
                    const next = new Set(cur);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  })
                }
                onOpen={() => setOpenId(row.id)}
                onResolve={() => void resolve(row)}
                onCopy={() => void copyPlain(row)}
                onShare={() => setShareId(row.id)}
                canResolve={can("errors.resolve")}
              />
            ))}
          </div>

          {pages > 1 && (
            <div className="row between" style={{ marginTop: 14 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Page {page} of {pages} · {total} error group{total === 1 ? "" : "s"}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {openId && (
        <ErrorDetailDrawer
          errorId={openId}
          onClose={() => setOpenId(null)}
          onResolved={() => { setOpenId(null); void load(); }}
          onShare={(id) => setShareId(id)}
        />
      )}
      {shareId && <ShareErrorModal errorId={shareId} onClose={() => setShareId(null)} />}
    </>
  );
}

/* ── Connection status (§2.1) ───────────────────────────────────────────── */
function ConnectionBadge({ mode, lastEventAt }: { mode: string; lastEventAt: string | null }) {
  const map: Record<string, { tone: "ok" | "warn" | "bad" | "mute"; label: string }> = {
    live: { tone: "ok", label: "🔴 Live" },
    polling: { tone: "warn", label: "📡 Polling" },
    connecting: { tone: "mute", label: "Connecting…" },
    offline: { tone: "bad", label: "⚠ Offline" },
  };
  const m = map[mode] || map.connecting;
  return (
    <span title={lastEventAt ? `Last event ${ago(lastEventAt)}` : "No events yet this session"}>
      <Pill tone={m.tone}>{m.label}</Pill>
    </span>
  );
}

/* ── KPI cards ──────────────────────────────────────────────────────────── */
function StatsCards({ stats }: { stats: ErrorStats | null }) {
  const cards = [
    { value: stats ? stats.total_occurrences.toLocaleString() : "—", label: "Total" },
    { value: stats ? stats.fatal : "—", label: "Fatal", tone: "#991B1B" },
    { value: stats ? stats.unique_errors : "—", label: "Unique" },
    { value: stats ? `${stats.resolved_rate}%` : "—", label: "Resolved" },
    { value: stats ? duration(stats.avg_resolution_seconds) : "—", label: "Avg fix" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
      {cards.map((c) => (
        <div key={c.label} className="card">
          <div className="bd" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.tone || "var(--ink-1)", lineHeight: 1.1 }}>
              {c.value}
            </div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 3 }}>
              {c.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Activity chart ─────────────────────────────────────────────────────── */
function ActivityChart({ trends }: { trends: Trends }) {
  const max = Math.max(1, ...trends.points.map((p) => p.occurrences));
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="bd" style={{ padding: "12px 14px" }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
            Activity · last {trends.hours < 48 ? `${trends.hours}h` : `${Math.round(trends.hours / 24)}d`}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>peak {max.toLocaleString()}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56 }}>
          {trends.points.map((p) => {
            const h = Math.max(2, Math.round((p.occurrences / max) * 56));
            return (
              <div
                key={p.bucket}
                title={`${new Date(p.bucket).toLocaleString()} — ${p.occurrences} occurrence(s), ${p.fatal} fatal`}
                style={{
                  flex: 1,
                  height: h,
                  minWidth: 2,
                  borderRadius: 2,
                  background: p.fatal > 0 ? "#991B1B" : p.occurrences > 0 ? "var(--accent, #4F7CFF)" : "var(--line-2)",
                  opacity: p.occurrences > 0 ? 1 : 0.35,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Feed card (§3.1) ───────────────────────────────────────────────────── */
function ErrorCard({
  row, selected, onToggleSelect, onOpen, onResolve, onCopy, onShare, canResolve,
}: {
  row: ErrorRow;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onResolve: () => void;
  onCopy: () => void;
  onShare: () => void;
  canResolve: boolean;
}) {
  const st = LEVEL_STYLE[row.level];
  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${st.fg}`,
        ...(selected ? { outline: "1px solid var(--accent, #3B82F6)", outlineOffset: -1 } : {}),
      }}
    >
      <div className="bd" style={{ padding: "12px 14px" }}>
        <div className="row between wrap" style={{ gap: 8, marginBottom: 6 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${row.message.slice(0, 60)}`}
              style={{ marginRight: 2, cursor: "pointer" }}
            />
            <span
              className="pill"
              style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}`, fontWeight: 700 }}
            >
              {st.badge} {st.label.toUpperCase()} ×{row.occurrence_count}
            </span>
            <span className="mono muted" style={{ fontSize: 11.5 }}>
              {row.file_path || "—"}{row.line_number ? `:${row.line_number}` : ""}
            </span>
            {row.resolved_at && <Pill tone="ok">Resolved</Pill>}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>{ago(row.last_seen)}</span>
        </div>

        <button
          onClick={onOpen}
          style={{
            background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer",
            fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)", lineHeight: 1.35, width: "100%",
          }}
        >
          {row.message}
        </button>

        <div className="muted" style={{ fontSize: 11.5, margin: "6px 0 10px" }}>
          Module: <strong>{row.module || "—"}</strong>
          {row.route ? <> · Route: <span className="mono">{row.route}</span></> : null}
          {" · "}
          {row.tenant_slug ? <>Tenant: <strong>{row.tenant_slug}</strong></> : <>Scope: <strong>platform-wide</strong></>}
          {" · "}First: {ago(row.first_seen)}
        </div>

        <div className="row wrap" style={{ gap: 6 }}>
          {/*
            §3.1's action row names Explain first. It opens the drawer rather
            than generating inline, and that is the cost decision from §7.1
            ("on-demand") applied to the FEED: a one-click Explain on every card
            in a twenty-row list is twenty model calls one misclick apart. The
            drawer is where the call is made, deliberately one step away.
          */}
          <Button size="sm" variant="ghost" onClick={onOpen}>🤖 Explain</Button>
          <Button size="sm" variant="ghost" onClick={onOpen}>🔍 Trace</Button>
          <Button size="sm" variant="ghost" onClick={onCopy}>📋 Copy</Button>
          <Button size="sm" variant="ghost" onClick={onShare}>🔗 Share</Button>
          {canResolve && !row.resolved_at && (
            <Button size="sm" variant="ghost" onClick={onResolve}>✓ Resolve</Button>
          )}
        </div>
      </div>
    </div>
  );
}
