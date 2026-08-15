/**
 * Delay attribution — "who is costing us time".
 *
 * WHAT MAKES THIS ANSWERABLE AT ALL. When a stage completes, the engine measures
 * how late it ran against the commitment and charges that to the tier that owns
 * THAT stage — never the stage whose forecast moved as a consequence. Without
 * that rule every carrier delay would land on internal ops, because ops owns the
 * delivery stage that got pushed, and this screen would be confidently wrong.
 *
 * EXCUSED TIME IS SHOWN, NOT NETTED AWAY. "The carrier cost us four days" and
 * "four days went to a port strike we published as a risk" are different
 * sentences. Collapsing them into one average is how a scorecard stops being
 * trusted by the people it scores — so force-majeure hours sit beside the total
 * rather than being quietly subtracted from it.
 *
 * WHERE IT LIVES. On the Milestones screen rather than a party 360° tab: the
 * tiers here are ROLES (carrier, terminal, customs), not parties, so there is no
 * single counterparty record to hang it on. When per-carrier scoring arrives it
 * belongs on the party; this is the fleet-wide view.
 */
import { Pill } from "@/components/ui/pill";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useResource } from "@/lib/use-resource";
import { num } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import * as api from "@/lib/operations-api";

type TierRow = {
  owner_tier: api.OwnerTier;
  slips: number;
  total_hours: number;
  avg_hours: number;
  excused: number;
  excused_hours: number;
};
type StageRow = {
  code: string;
  label?: string | null;
  owner_tier: api.OwnerTier;
  service_fr?: string | null;
  service_en?: string | null;
  slips: number;
  avg_hours: number;
  total_hours: number;
};

const getAttribution = () =>
  tenant<{ by_tier: TierRow[]; by_stage: StageRow[] }>(
    "/milestones/attribution",
  );

/** Working hours read better as days once they pass a working week. */
const asDuration = (hours: number) => {
  const h = Number(hours) || 0;
  if (h < 10) return `${Math.round(h)}h`;
  return `${(h / 9.5).toFixed(1)} days`;
};

export function MilestoneAttribution() {
  const data = useResource(() => getAttribution(), []);

  if (data.loading) return <SkeletonTable rows={4} cols={4} />;
  if (data.error) return <ErrorState message={data.error} />;

  const tiers = data.data?.by_tier || [];
  const stages = data.data?.by_stage || [];

  if (!tiers.length) {
    return (
      <EmptyState
        title="No delays recorded yet"
        hint="A stage that completes late is measured against its commitment and charged to whoever owns it. Nothing has run late so far."
      />
    );
  }

  const worst = tiers[0];

  return (
    <div className="space-y-4">
      <p className="micro max-w-3xl">
        Every completed stage that ran past its commitment is charged to the
        tier that owns it — the one that actually slipped, not the one whose
        dates moved as a result. Hours are working hours.
      </p>

      <Table>
        <THead>
          <TR>
            <TH>Owner</TH>
            <TH className="text-right">Late stages</TH>
            <TH className="text-right">Total lost</TH>
            <TH className="text-right">Average slip</TH>
            <TH className="text-right">Of which excused</TH>
          </TR>
        </THead>
        <TBody>
          {tiers.map((t) => (
            <TR key={t.owner_tier}>
              <TD>
                <div className="flex items-center gap-2">
                  <span className="text-foreground">
                    {api.OWNER_TIER_LABEL[t.owner_tier]}
                  </span>
                  {t.owner_tier === worst.owner_tier && (
                    <Pill tone="bad">most time lost</Pill>
                  )}
                </div>
              </TD>
              <TD className="num text-right">{num(t.slips)}</TD>
              <TD className="num text-right">{asDuration(t.total_hours)}</TD>
              <TD className="num text-right">{asDuration(t.avg_hours)}</TD>
              <TD className="num text-right">
                {t.excused > 0 ? (
                  <span title="Force majeure — recorded alongside the measured delay, never subtracted from it">
                    {asDuration(t.excused_hours)} ({t.excused})
                  </span>
                ) : (
                  "—"
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <div>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          Where the time goes
        </h3>
        <p className="micro mb-2">
          The stages behind each tier&apos;s number, so a scorecard entry can be
          explained rather than just asserted.
        </p>
        <Table>
          <THead>
            <TR>
              <TH>Stage</TH>
              <TH>Service</TH>
              <TH>Owner</TH>
              <TH className="text-right">Times late</TH>
              <TH className="text-right">Average</TH>
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            {stages.map((s) => (
              <TR key={s.code + s.owner_tier + (s.service_en || "")}>
                <TD>{s.label || s.code}</TD>
                <TD className="micro">{s.service_en || s.service_fr || "—"}</TD>
                <TD className="micro">{api.OWNER_TIER_LABEL[s.owner_tier]}</TD>
                <TD className="num text-right">{num(s.slips)}</TD>
                <TD className="num text-right">{asDuration(s.avg_hours)}</TD>
                <TD className="num text-right">{asDuration(s.total_hours)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
