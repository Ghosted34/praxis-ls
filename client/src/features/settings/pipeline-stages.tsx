/**
 * Settings — CRM pipeline stages (the columns on the opportunities board).
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import { useList } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";

export function PipelineStagesPage() {
  const { rows, error } = useList("/opportunities/stages");

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Pipeline stages"
        description="The CRM opportunity pipeline stages. Read-only — stage editing is not yet exposed by the backend."
      />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No stages"
          hint="Pipeline stages are seeded per tenant."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Probability %</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={String(r.pipeline_stage_id ?? i)}>
                <TD className="num text-sm">{cell(r.sort_order)}</TD>
                <TD className="text-sm font-medium">{cell(r.code)}</TD>
                <TD className="text-sm">{cell(r.name)}</TD>
                <TD className="num text-sm">
                  {cell(r.default_probability ?? r.probability)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/* ─────────────────────── Document numbering ─────────────────────── */
