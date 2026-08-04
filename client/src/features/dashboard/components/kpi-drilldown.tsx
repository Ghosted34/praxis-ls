/**
 * KPI drill-down — the detail behind a Control Tower card.
 *
 * On the app's Dialog primitive, so it inherits the focus trap, focus
 * restoration and `aria-labelledby` wiring the hand-rolled Modal never had
 * (audit F13) — and, unlike the iframe's version, it is reachable by keyboard
 * from the page at all.
 *
 * Three behaviours of the mock are deliberately NOT carried over:
 *   - the simulated ~18% random load failure (`Math.random() < 0.18`), which was
 *     a demo device and has no place over real ledger data;
 *   - the hardcoded sample rows underneath live card values;
 *   - "All clear" as the response to a failed fetch. A 403 now says so. In a
 *     finance context, a reassuring answer to a question that was never asked is
 *     worse than an error.
 */
import { useNavigate } from "react-router-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import type { Drill, KpiId } from "../drilldowns";
import type { ControlTowerKpis } from "../use-control-tower";
import { useKpiDrilldown } from "../use-control-tower";

function DrillTable({ drill }: { drill: Drill }) {
  return (
    <>
      <Table>
        <THead>
          <TR>
            {drill.columns.map((c) => (
              <TH key={c.label} scope="col" className={c.align === "right" ? "text-right" : undefined}>
                {c.label}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {drill.rows.map((r) => (
            <TR key={r.key}>
              {r.cells.map((cell, i) => {
                const align = drill.columns[i]?.align;
                return (
                  <TD
                    key={drill.columns[i]?.label ?? i}
                    className={cn(align === "right" && "num text-right", i === 0 && "font-medium text-foreground")}
                  >
                    {typeof cell === "string" ? cell : <Pill tone={cell.tone}>{cell.text}</Pill>}
                  </TD>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>
      {drill.note && <p className="mt-2 text-label text-muted-foreground">{drill.note}</p>}
    </>
  );
}

export function KpiDrilldown({
  id,
  kpis,
  onClose,
}: {
  id: KpiId | null;
  kpis: ControlTowerKpis | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { drill, loading, error } = useKpiDrilldown(id, kpis);

  // Title has to exist before the data does — Dialog labels itself from it, and
  // an untitled dialog is an unnamed one for a screen reader.
  const title = drill?.title ?? "Loading detail";
  const cta = drill?.cta;

  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      title={title}
      size="xl"
      headerRight={drill ? <Pill tone={drill.badge.tone}>{drill.badge.text}</Pill> : undefined}
      footer={
        cta ? (
          <Button
            onClick={() => {
              onClose();
              navigate(cta.to);
            }}
            icon={null}
          >
            {cta.label} →
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : loading || !drill ? (
        <SkeletonTable rows={5} cols={4} />
      ) : (
        <div className="space-y-4">
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {drill.meta.map((m) => (
              <div key={m.label}>
                <dt className="text-micro uppercase text-muted-foreground">{m.label}</dt>
                <dd className="num mt-0.5 text-base font-semibold">{m.value}</dd>
              </div>
            ))}
          </dl>

          {drill.rows.length ? (
            <DrillTable drill={drill} />
          ) : (
            <EmptyState title={drill.empty.title} hint={drill.empty.hint} />
          )}
        </div>
      )}
    </Dialog>
  );
}
