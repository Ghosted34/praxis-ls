/**
 * Permission grant-matrix — the real RBAC editor.
 *
 * Layout (rebuilt 2026-07-20 to the Pixie "Org & Workflow › Permissions"
 * reference): **roles down the side, modules across the top**, grouped under
 * spanning category headers. This is the transpose of the previous version,
 * and the reason is density — there are ~70 modules and a handful of roles, so
 * modules-as-rows produced a 70-row × N-role grid where every cell carried five
 * separate letter buttons (350+ hit targets on screen at once). Roles-as-rows
 * gives one row per role, and each cell collapses to a **single dot** showing
 * the strongest grant, which is what makes the whole matrix legible at a glance.
 *
 * Editing is preserved, not traded away: clicking a cell opens a small popover
 * with the five real toggles (read/create/update/delete/approve), each mapping
 * directly to a `permission` table boolean. Saving still upserts via
 * PUT /permissions/grant, still invalidates the grant cache, still fires
 * Watch-the-Watcher, and is still optimistic with revert-on-error.
 *
 * The popover is positioned `fixed` off the cell's bounding rect rather than
 * absolutely inside the cell, because the grid is a horizontally-scrolling
 * container with sticky columns — an absolutely-positioned child would clip.
 *
 * Two things the reference has that we deliberately don't:
 *   - an **Export** permission. Pixie's legend has six; our `permission` table
 *     has five booleans, and rbac.js maps 'export' onto can_read as a
 *     placeholder. Showing a sixth dot would imply a grant that doesn't exist.
 *   - an editable **ceo** row. role.code='CEO' bypasses requirePermission
 *     entirely (src/middleware/rbac.js), so its grants are never consulted —
 *     the row renders as implicitly-all and locked instead of pretending to be
 *     editable.
 *
 * Editing requires the 'approve' grant (or CEO); others get a 403 on save.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import {
  fetchRoles,
  fetchModules,
  fetchPermissions,
  upsertGrant,
  emptyGrant,
  PERMS,
  PERM_TITLE,
  type Role,
  type Module,
  type Grant,
  type PermKey,
} from "@/lib/rbac";
import { ApiError } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

const key = (roleId: string, moduleKey: string) => `${roleId}::${moduleKey}`;
const GROUP_LABEL = (g: string) => g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");

/**
 * Dot colour per permission, strongest-wins. Every colour is a theme token so
 * the matrix re-tints per tenant like everything else.
 *
 * NB `--ok` / `--warn` / `--bad` / `--ink-3` are stored as bare "R G B" triplets
 * (consumed as `rgb(var(--x))`), while `--primary` is already a full `rgb(...)`
 * value and must NOT be wrapped. There is no `--info` in index.css — session 9
 * shipped a bad `rgb(var(--info))` on the Control Tower for exactly this reason.
 */
const PERM_COLOR: Record<PermKey, string> = {
  can_read: "rgb(var(--ink-3))",
  can_create: "var(--primary)",
  can_update: "rgb(var(--warn))",
  can_delete: "rgb(var(--bad))",
  can_approve: "rgb(var(--ok))",
};

/** Weakest → strongest. The cell dot shows the strongest granted permission. */
const STRENGTH: PermKey[] = ["can_read", "can_create", "can_update", "can_delete", "can_approve"];

function strongest(g: Grant | undefined): PermKey | null {
  if (!g) return null;
  for (let i = STRENGTH.length - 1; i >= 0; i--) if (g[STRENGTH[i]]) return STRENGTH[i];
  return null;
}

function grantSummary(g: Grant | undefined): string {
  if (!g) return "No access";
  const on = PERMS.filter((p) => g[p]).map((p) => PERM_TITLE[p]);
  return on.length ? on.join(" · ") : "No access";
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
      <path d="M3 7l4 4 5-6 5 6 4-4v11H3z" />
    </svg>
  );
}

type CellTarget = { role: Role; mod: Module; rect: DOMRect };

export function PermissionMatrixPage() {
  const [roles, setRoles] = React.useState<Role[]>([]);
  const [modules, setModules] = React.useState<Module[]>([]);
  const [grants, setGrants] = React.useState<Record<string, Grant>>({});
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<Set<string>>(new Set());
  const [toast, setToast] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<CellTarget | null>(null);

  React.useEffect(() => {
    Promise.all([fetchRoles(), fetchModules(), fetchPermissions()])
      .then(([r, m, p]) => {
        setRoles(r);
        setModules(m);
        const map: Record<string, Grant> = {};
        for (const g of p) map[key(g.role_id, g.module_key)] = g;
        setGrants(map);
      })
      .catch((e) =>
        setLoadErr(
          e instanceof ApiError && e.status === 403
            ? "You need the IAM view permission to see the matrix."
            : e instanceof ApiError
              ? e.message
              : "Failed to load the permission matrix.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  // Close the editor on ESC or any outside click.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-grant-editor]")) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Modules grouped, catalogue sort order preserved, filtered by the search box.
  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? modules.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.module_key.toLowerCase().includes(q) ||
            m.group_key.toLowerCase().includes(q),
        )
      : modules;
    const out: { group: string; items: Module[] }[] = [];
    const idx = new Map<string, number>();
    for (const m of visible) {
      if (!idx.has(m.group_key)) {
        idx.set(m.group_key, out.length);
        out.push({ group: m.group_key, items: [] });
      }
      out[idx.get(m.group_key)!].items.push(m);
    }
    return out;
  }, [modules, query]);

  const flatModules = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  async function toggle(role: Role, mod: Module, perm: PermKey) {
    const k = key(role.role_id, mod.module_key);
    const current = grants[k] || emptyGrant(role.role_id, mod.module_key);
    const next: Grant = { ...current, [perm]: !current[perm] };
    setGrants((g) => ({ ...g, [k]: next }));
    setSaving((s) => new Set(s).add(k));
    setToast(null);
    try {
      const saved = await upsertGrant(next);
      setGrants((g) => ({ ...g, [k]: saved }));
    } catch (e) {
      setGrants((g) => ({ ...g, [k]: current })); // revert
      setToast(
        e instanceof ApiError && e.status === 403
          ? "You need the IAM approve permission to edit grants."
          : e instanceof ApiError
            ? e.message
            : "Couldn't save. Try again.",
      );
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }

  if (loading) return <PageSkeleton rows={8} cols={6} />;
  if (loadErr) return <ErrorState message={loadErr} />;

  const openGrant = open
    ? grants[key(open.role.role_id, open.mod.module_key)] ||
      emptyGrant(open.role.role_id, open.mod.module_key)
    : null;

  return (
    <section className="animate-fade-in">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Permission matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Role × module access. Each dot is the strongest grant on that pair — click any cell to edit
          the five underlying permissions. Changes save instantly and are audited.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {PERMS.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: PERM_COLOR[p] }}
              />
              {PERM_TITLE[p].replace(" / view", "").replace(" / edit", "")}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module…"
            aria-label="Filter modules"
            className="h-9 w-56 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Link
            to="/security/roles"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            + New role
          </Link>
        </div>
      </div>

      {toast && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {toast}
        </p>
      )}

      {flatModules.length === 0 ? (
        <ErrorState message={`No module matches “${query}”.`} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="border-collapse text-sm">
            <thead>
              {/* Group band — one spanning cell per module group. */}
              <tr>
                <th className="sticky left-0 z-20 min-w-[220px] border-b border-r bg-muted/60 px-3 py-1.5" />
                {groups.map(({ group, items }) => (
                  <th
                    key={group}
                    colSpan={items.length}
                    className="border-b border-l bg-muted/60 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-primary"
                  >
                    {GROUP_LABEL(group)}
                  </th>
                ))}
              </tr>
              {/* Module band. */}
              <tr>
                <th className="sticky left-0 z-20 border-b border-r bg-muted/50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                {flatModules.map((m) => (
                  <th
                    key={m.module_key}
                    title={`${m.name} (${m.module_key})`}
                    className="w-[92px] min-w-[92px] max-w-[92px] border-b bg-muted/50 px-1 py-2 text-center align-bottom text-[11px] font-medium"
                  >
                    <span className="block truncate">{m.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => {
                const isCeo = r.code === "CEO";
                return (
                  <tr key={r.role_id} className="border-t hover:bg-muted/20">
                    <td className="sticky left-0 z-10 border-r bg-background px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">
                          {r.is_system ? <LockIcon /> : null}
                        </span>
                        <span className="font-mono text-xs font-medium">{r.code}</span>
                        {isCeo && (
                          <span className="text-primary" title="Bypasses RBAC by design">
                            <CrownIcon />
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{r.name}</div>
                    </td>

                    {flatModules.map((m) => {
                      const k = key(r.role_id, m.module_key);
                      const g = grants[k];
                      const isSaving = saving.has(k);

                      // CEO short-circuits requirePermission, so its stored grants
                      // are never read. Render it as implicitly-all and inert
                      // rather than offering toggles that change nothing.
                      if (isCeo) {
                        return (
                          <td key={m.module_key} className="border-l px-1 py-2 text-center">
                            <span
                              title={`CEO bypasses RBAC — full access to ${m.name} regardless of grants`}
                              className="inline-block h-2.5 w-2.5 rounded-full opacity-90"
                              style={{ background: PERM_COLOR.can_approve }}
                            />
                          </td>
                        );
                      }

                      const top = strongest(g);
                      const isOpen =
                        open?.role.role_id === r.role_id && open?.mod.module_key === m.module_key;
                      return (
                        <td key={m.module_key} className="border-l px-1 py-1 text-center">
                          <button
                            data-grant-editor
                            title={`${r.code} · ${m.name}\n${grantSummary(g)}`}
                            aria-label={`${r.code} on ${m.name}: ${grantSummary(g)}`}
                            onClick={(e) =>
                              setOpen(
                                isOpen
                                  ? null
                                  : { role: r, mod: m, rect: e.currentTarget.getBoundingClientRect() },
                              )
                            }
                            className={cn(
                              "grid h-7 w-full place-items-center rounded transition-colors hover:bg-accent",
                              isOpen && "bg-accent ring-1 ring-ring",
                              isSaving && "opacity-50",
                            )}
                          >
                            {top ? (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ background: PERM_COLOR[top] }}
                              />
                            ) : (
                              <span className="inline-block h-2.5 w-2.5 rounded-full border border-input" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Grant editor — fixed-positioned so the scrolling grid can't clip it. */}
      {open && openGrant && (
        <div
          data-grant-editor
          role="dialog"
          aria-label={`Permissions for ${open.role.code} on ${open.mod.name}`}
          style={{
            position: "fixed",
            top: Math.min(open.rect.bottom + 6, window.innerHeight - 210),
            left: Math.min(open.rect.left - 80, window.innerWidth - 260),
            width: 240,
          }}
          className="z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-l"
        >
          <div className="mb-1 font-mono text-xs font-semibold">{open.role.code}</div>
          <div className="mb-2 truncate text-xs text-muted-foreground" title={open.mod.module_key}>
            {open.mod.name} · {open.mod.module_key}
          </div>
          <div className="space-y-1">
            {PERMS.map((p) => {
              const on = openGrant[p];
              return (
                <button
                  key={p}
                  onClick={() => toggle(open.role, open.mod, p)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    on ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: on ? PERM_COLOR[p] : "transparent",
                      border: on ? undefined : "1px solid var(--input)",
                    }}
                  />
                  <span className={cn(!on && "text-muted-foreground")}>{PERM_TITLE[p]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        CEO bypasses RBAC by design (<span className="font-mono">role.code = &apos;CEO&apos;</span>), so its
        row is shown as full access and isn&apos;t editable. Seeded defaults come from{" "}
        <span className="font-mono">9021_seed_default_permissions.sql</span>. Note that a granted module
        can still return 403 if its <em>feature</em> is off for the tenant — that gate is separate from
        RBAC and applies to everyone.
      </p>
    </section>
  );
}
