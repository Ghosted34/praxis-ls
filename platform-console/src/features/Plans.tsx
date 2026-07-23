import { platform } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { money } from "@/lib/format";
import { Empty, Loading, PageHeader, Pill } from "@/components/ui";

export function Plans() {
  const { data, loading, error } = useAsync<Plan[]>(() => platform.plans() as Promise<Plan[]>);
  const rows = data || [];
  return (
    <>
      <PageHeader title="Plans" desc="Subscription plans defined in the platform registry." />
      {loading ? <Loading /> : error ? <Empty>Couldn’t load plans — {error.message}</Empty> : rows.length === 0 ? (
        <Empty>No plans defined.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Setup (XAF)</th><th>Yearly (XAF)</th><th>Active</th><th>Description</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.code}>
                  <td><span className="mono">{p.code}</span></td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td className="dim">{money(p.price_setup_xaf)}</td>
                  <td className="dim">{money(p.price_yearly_xaf)}</td>
                  <td>{p.is_active === false ? <Pill tone="mute">No</Pill> : <Pill tone="ok">Yes</Pill>}</td>
                  <td className="dim">{p.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
