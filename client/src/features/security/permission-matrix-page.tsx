/**
 * Permission grant-matrix — the real RBAC editor. Roles across the top, modules
 * down the side (grouped/collapsible by module group). Each cell is five toggles
 * — R(ead) C(reate) U(pdate) D(elete) A(pprove) — mapping directly to the
 * `permission` table's booleans. Toggling a chip upserts that role×module grant
 * (PUT /permissions/grant), which invalidates the grant cache and fires
 * Watch-the-Watcher. Optimistic UI with revert-on-error.
 *
 * Editing requires the 'approve' grant (or CEO); others get a 403 on save.
 */
import * as React from "react";
import {
  fetchRoles,
  fetchModules,
  fetchPermissions,
  upsertGrant,
  emptyGrant,
  PERMS,
  PERM_LABEL,
  PERM_TITLE,
  type Role,
  type Module,
  type Grant,
  type PermKey,
} from "@/lib/rbac";
import { ApiError } from "@/lib/api-client";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

const key = (roleId: string, moduleKey: string) => `${roleId}::${moduleKey}`;
const GROUP_LABEL = (g: string) => g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");

export function PermissionMatrixPage() {
  const [roles, setRoles] = React.useState<Role[]>([]);
  const [modules, setModules] = React.useState<Module[]>([]);
  const [grants, setGrants] = React.useState<Record<string, Grant>>({});
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<Set<string>>(new Set());
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    Promise.all([fetchRoles(), fetchModules(), fetchPermissions()])
      .then(([r, m, p]) => {
        setRoles(r);
        setModules(m);
        const map: Record<string, Grant> = {};
        for (const g of p) map[key(g.role_id, g.module_key)] = g;
        setGrants(map);
        setOpenGroups(new Set(m.map((x) => x.group_key))); // all groups open by default
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

  // modules grouped, preserving catalogue sort order
  const groups = React.useMemo(() => {
    const out: { group: string; items: Module[] }[] = [];
    const idx = new Map<string, number>();
    for (const m of modules) {
      if (!idx.has(m.group_key)) {
        idx.set(m.group_key, out.length);
        out.push({ group: m.group_key, items: [] });
      }
      out[idx.get(m.group_key)!].items.push(m);
    }
    return out;
  }, [modules]);

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
      setToast({
        kind: "err",
        text:
          e instanceof ApiError && e.status === 403
            ? "You need the IAM approve permission to edit grants."
            : e instanceof ApiError
              ? e.message
              : "Couldn't save. Try again.",
      });
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }

  if (loading) return <LoadingRow label="Loading permission matrix…" />;
  if (loadErr) return <ErrorState message={loadErr} />;

  return (
    <section className="animate-fade-in">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Permission matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Role × module access. Toggle{" "}
          {PERMS.map((p, i) => (
            <span key={p}>
              <span className="font-medium text-foreground">{PERM_LABEL[p]}</span>={PERM_TITLE[p].toLowerCase()}
              {i < PERMS.length - 1 ? ", " : ""}
            </span>
          ))}
          . Changes save instantly and are audited.
        </p>
      </header>

      {toast && (
        <p
          className={cn(
            "mb-3 rounded-md border px-3 py-2 text-sm",
            toast.kind === "ok"
              ? "border-primary/30 bg-primary/5"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {toast.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                Module
              </th>
              {roles.map((r) => (
                <th key={r.role_id} title={r.name} className="whitespace-nowrap px-2 py-2 text-center text-xs font-semibold">
                  {r.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, items }) => {
              const open = openGroups.has(group);
              return (
                <React.Fragment key={group}>
                  <tr
                    className="cursor-pointer border-t bg-accent/40 hover:bg-accent/60"
                    onClick={() =>
                      setOpenGroups((s) => {
                        const n = new Set(s);
                        n.has(group) ? n.delete(group) : n.add(group);
                        return n;
                      })
                    }
                  >
                    <td
                      colSpan={roles.length + 1}
                      className="sticky left-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {open ? "▾" : "▸"} {GROUP_LABEL(group)} <span className="opacity-60">({items.length})</span>
                    </td>
                  </tr>
                  {open &&
                    items.map((m) => (
                      <tr key={m.module_key} className="border-t hover:bg-muted/30">
                        <td className="sticky left-0 z-10 bg-background px-3 py-2">
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs text-muted-foreground">{m.module_key}</div>
                        </td>
                        {roles.map((r) => {
                          const k = key(r.role_id, m.module_key);
                          const g = grants[k] || emptyGrant(r.role_id, m.module_key);
                          const isSaving = saving.has(k);
                          return (
                            <td key={r.role_id} className={cn("px-1 py-1 text-center", isSaving && "opacity-60")}>
                              <div className="inline-flex gap-0.5">
                                {PERMS.map((perm) => {
                                  const on = g[perm];
                                  return (
                                    <button
                                      key={perm}
                                      title={`${r.code} · ${m.module_key} · ${PERM_TITLE[perm]}`}
                                      aria-pressed={on}
                                      onClick={() => toggle(r, m, perm)}
                                      className={cn(
                                        "h-5 w-5 rounded text-[10px] font-semibold leading-none transition-colors",
                                        on
                                          ? "bg-primary text-primary-foreground"
                                          : "border border-input text-muted-foreground hover:bg-accent",
                                      )}
                                    >
                                      {PERM_LABEL[perm]}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Note: CEO bypasses RBAC by design, so its row is informational. Seeded defaults come from
        <span className="font-mono"> 9021_seed_default_permissions.sql</span>.
      </p>
    </section>
  );
}
