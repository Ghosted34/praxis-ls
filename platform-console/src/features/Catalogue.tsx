import { useState } from "react";
import { platform } from "@/lib/api";
import type { CatalogueFeature, ModuleRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { Button, Empty, Loading, PageHeader, Pill } from "@/components/ui";

export function Catalogue() {
  const [tab, setTab] = useState<"modules" | "features">("modules");
  return (
    <>
      <PageHeader title="Catalogue" desc="The shippable module & feature catalogue — the source of truth for what can be toggled per tenant." />
      <div className="banner info">
        Reference only. Per-tenant on/off lives on each tenant’s&nbsp;<b>Features</b>&nbsp;tab; this is the master list.
      </div>
      <div className="toolbar">
        <Button size="sm" variant={tab === "modules" ? "primary" : "default"} onClick={() => setTab("modules")}>Modules</Button>
        <Button size="sm" variant={tab === "features" ? "primary" : "default"} onClick={() => setTab("features")}>Features</Button>
      </div>
      {tab === "modules" ? <ModulesTable /> : <FeaturesTable />}
    </>
  );
}

function ModulesTable() {
  const { data, loading, error } = useAsync<ModuleRow[]>(() => platform.modules() as Promise<ModuleRow[]>);
  const rows = data || [];
  if (loading) return <Loading />;
  if (error) return <Empty>Couldn’t load modules — {error.message}</Empty>;
  if (!rows.length) return <Empty>Nothing in the catalogue.</Empty>;
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Module</th><th>Name</th><th>Phase</th><th>Description</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.module_key}>
              <td><span className="mono">{m.module_key}</span></td>
              <td style={{ fontWeight: 600 }}>{m.name}</td>
              <td className="dim">{m.phase ?? "—"}</td>
              <td className="dim">{m.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeaturesTable() {
  const { data, loading, error } = useAsync<CatalogueFeature[]>(() => platform.catalogueFeatures() as Promise<CatalogueFeature[]>);
  const rows = data || [];
  if (loading) return <Loading />;
  if (error) return <Empty>Couldn’t load features — {error.message}</Empty>;
  if (!rows.length) return <Empty>Nothing in the catalogue.</Empty>;
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Feature</th><th>Name</th><th>Module</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.feature_key}>
              <td><span className="mono">{f.feature_key}</span></td>
              <td style={{ fontWeight: 600 }}>{f.name}</td>
              <td className="mono dim">{f.module_key || "—"}</td>
              <td>{f.default_state === "on" ? <Pill tone="ok">On</Pill> : <Pill tone="mute">Off</Pill>}</td>
              <td className="dim">{f.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
