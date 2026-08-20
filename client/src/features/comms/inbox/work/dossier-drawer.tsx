/**
 * THE DOSSIER DRAWER (§7.5).
 *
 * What the record looks like, next to the correspondence about it. The whole
 * argument for a mailbox inside an ERP is this panel: the operator answering
 * "where is my container" should not have to leave the thread, open Operations,
 * search for the file and come back having forgotten the question.
 *
 * ── LAZY TABS ARE A DESIGN DECISION, NOT AN OPTIMISATION ────────────────────
 *
 * §7.5: "each tab is a separate lazy call, so the drawer paints instantly and
 * only the tab you open costs anything. That is what makes the 300 ms budget
 * achievable." The header and overview arrive in ONE call; a tab is fetched
 * when it is opened and then kept. Opening the drawer costs one request no
 * matter how many tabs exist.
 *
 * ── `not_built` IS RENDERED, NOT SWALLOWED ──────────────────────────────────
 *
 * A supplier thread flips the pane: same tab names, different content. Some
 * combinations are not implemented, and the server says `not_built` rather than
 * returning an empty list — because an empty Commercial tab on a supplier reads
 * as "this supplier has no quotations", which is a statement about the supplier
 * rather than about us. This component keeps that distinction visible. Erasing
 * it here would undo the reason the server bothers to make it.
 *
 * ── IT READS ────────────────────────────────────────────────────────────────
 *
 * Nothing in this drawer writes. Every row that leads somewhere leads to the
 * owning module's screen, where the record has its own lifecycle, numbering,
 * approval chain and audit. That is `BUILD_CONVENTIONS.md` §1–§5, and it is
 * also the only way this panel can afford to show finance data at all.
 */
import * as React from "react";
import { Pill } from "@/components/ui/pill";
import { TabList } from "@/components/ui/tabs";
import { TabsRoot } from "@/components/ui/tabs";
import { ErrorState, LoadingRow, EmptyState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { humanizeRef, smartCell, fieldLabel } from "@/lib/format";
import * as api from "@/lib/mail-api";

const TAB_LABEL: Record<api.ContextTab, string> = {
  money: "Money",
  operations: "Operations",
  commercial: "Commercial",
  documents: "Documents",
  interactions: "Correspondence",
  compliance: "Compliance",
};

/**
 * A generic table over whatever the tab returned.
 *
 * Deliberately generic: each tab is one query owned by the server, and a
 * hand-written column list per tab per party kind would be twelve lists to keep
 * in step with twelve queries. `fieldLabel` and `smartCell` are the shared
 * humanisers the rest of the ERP already renders dynamic rows through.
 *
 * Columns come from the FIRST row, and ids are dropped: a `dossier_id` column
 * full of UUIDs is four characters of information and half the width.
 */
const HIDDEN = /(^|_)(id|ref_id|uuid)$/;

function TabTable({ rows }: { rows: unknown[] }) {
  const objects = rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
  if (!objects.length) return <EmptyState title="Nothing here yet" />;
  const cols = Object.keys(objects[0]).filter((k) => !HIDDEN.test(k));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap py-1.5 pr-3 font-medium">
                {fieldLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {objects.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap py-1.5 pr-3">
                  {/* `missing`, `blocked` and `expired` are the columns the
                      operator opened the tab to find. They arrive as booleans
                      and would otherwise render as the word "true". */}
                  {typeof row[c] === "boolean" ? (
                    row[c] ? (
                      <Pill tone={/missing|blocked|expired|overdue/.test(c) ? "bad" : "ok"}>
                        {fieldLabel(c)}
                      </Pill>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  ) : (
                    smartCell(row[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabBody({ entityRef, tab }: { entityRef: string; tab: api.ContextTab }) {
  const res = useResource(() => api.mailContextTab(entityRef, tab), [entityRef, tab]);

  if (res.loading) return <LoadingRow label={`Opening ${TAB_LABEL[tab]}…`} />;
  if (res.error) return <ErrorState message={res.error} />;
  const data = res.data;
  if (!data) return <EmptyState title="Nothing to show" />;

  // See the header: this is a different answer from an empty list, and it says
  // so. The alternative reads as a claim about the party.
  if (data.not_built) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
        {TAB_LABEL[tab]} is not built for this kind of record yet. This is not
        the same as it being empty — nothing has been checked.
      </p>
    );
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  return <TabTable rows={rows} />;
}

/** The header row: whatever the server chose to lead with, as label/value pairs. */
function Overview({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k, v]) =>
    !HIDDEN.test(k) && v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{fieldLabel(k)}</dt>
          <dd className="num text-right">{smartCell(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function DossierDrawer({ entityRef }: { entityRef: string }) {
  const ctx = useResource(() => api.mailContext(entityRef), [entityRef]);
  const [tab, setTab] = React.useState<api.ContextTab | null>(null);

  // Reset when the thread changes underneath us, or the drawer opens showing
  // the previous record's Money tab against the new record's header.
  React.useEffect(() => { setTab(null); }, [entityRef]);

  if (ctx.loading) return <LoadingRow label="Opening the record…" />;
  if (ctx.error) return <ErrorState message={ctx.error} />;
  const data = ctx.data;
  if (!data) return null;

  const available = (data.tabs_available || []).filter((t) => TAB_LABEL[t]);
  const current = tab && available.includes(tab) ? tab : available[0] || null;

  return (
    <section className="space-y-3" aria-label="The linked record">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">
            {String(data.header?.name || data.header?.ref || humanizeRef(entityRef))}
          </h3>
          <Pill tone="mute">{data.kind}</Pill>
        </div>
        <Overview data={data.header || {}} />
      </header>

      {Object.keys(data.overview || {}).length > 0 && (
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
          <Overview data={data.overview} />
        </div>
      )}

      {available.length > 0 && current && (
        <TabsRoot value={current} onValueChange={(v) => setTab(v as api.ContextTab)}>
          <TabList
            label="Record detail"
            className="mb-2"
            tabs={available.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
          />
          {/* Only the OPEN tab is mounted, which is what makes the lazy call
              lazy — rendering all six and hiding five would fetch all six. */}
          <TabBody entityRef={entityRef} tab={current} />
        </TabsRoot>
      )}
    </section>
  );
}
