/**
 * Module catalogue (`/settings/catalogue`) — the read-only MOD-xx reference:
 * every module the platform knows about, with its group and sort order. This is
 * the same catalogue that backs the permission grant-matrix, so it's the place to
 * look up "what is MOD-27?" when reading roles, numbering schemes or audit rows.
 *
 * BE: `GET /catalogue/modules` (read-only, gated **MOD-67 / IAM view**) — there is
 * no write surface, by design. Built on the shared DataList/PageHeader scaffold.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataList, PageHeader, type Column } from "@/components/data-list";
import { fetchModules, type Module } from "@/lib/rbac";
import { errMsg, Chips, MetricTile } from "@/features/sales/ui";

/** "security" → "Security", "master_data" → "Master data". */
function groupLabel(key: string): string {
  const s = String(key || "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

export function ModuleCataloguePage() {
  const [rows, setRows] = React.useState<Module[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [group, setGroup] = React.useState("");

  React.useEffect(() => {
    let live = true;
    fetchModules()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, []);

  const groups = React.useMemo(() => {
    const seen = new Set((rows || []).map((r) => String(r.group_key || "")));
    return [{ value: "", label: "All groups" }, ...Array.from(seen).filter(Boolean).sort().map((g) => ({ value: g, label: groupLabel(g) }))];
  }, [rows]);

  const shown = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows || [])
      .filter((r) => (group ? String(r.group_key) === group : true))
      .filter((r) => (term ? [r.module_key, r.name, r.group_key].some((v) => String(v ?? "").toLowerCase().includes(term)) : true))
      .sort((a, b) => String(a.group_key).localeCompare(String(b.group_key)) || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  }, [rows, q, group]);

  const columns: Column<Module>[] = [
    { key: "module_key", label: "Module", className: "num font-medium text-foreground", render: (r) => r.module_key },
    { key: "name", label: "Name" },
    { key: "group_key", label: "Group", render: (r) => groupLabel(String(r.group_key)) },
    { key: "sort_order", label: "Order", className: "num text-right" },
  ];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader
        title="Module catalogue"
        description="Every MOD-xx the platform knows about — the same list that backs the permission matrix. Read-only."
        action={
          <Link to="/security/permissions">
            <Button variant="outline">Permission matrix</Button>
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile label="Modules" value={rows === null ? "…" : String(rows.length)} accent />
        <MetricTile label="Groups" value={rows === null ? "…" : String(Math.max(groups.length - 1, 0))} />
        <MetricTile label="Showing" value={rows === null ? "…" : String(shown.length)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips value={group} options={groups} onChange={setGroup} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name or group…" className="max-w-xs" />
      </div>

      <DataList<Module>
        columns={columns}
        rows={shown}
        error={error}
        loading={rows === null && !error}
        rowKey={(r) => String(r.module_key)}
        empty={{ title: rows && rows.length ? "No modules match" : "No modules", hint: rows && rows.length ? "Try another group or search term." : "The catalogue came back empty." }}
      />
    </section>
  );
}
