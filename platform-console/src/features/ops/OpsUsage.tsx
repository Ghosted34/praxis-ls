import { useState } from "react";
import { platform } from "@/lib/api";
import {
  ops, ago, canOperate,
  type FleetUsage, type MetricSpec, type Entitlement, type UsageMetric,
} from "@/lib/ops-api";
import type { Plan } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { Button, Card, Empty, Field, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { OpsNav } from "./OpsNav";
import { can } from "@/lib/api";

/**
 * WS-S3 — usage against plan.
 *
 * Feature gating answers "may this tenant use invoicing". This answers "how much
 * of what they pay for have they used", which is the question that turns a plan
 * from a marketing document into a control, and the one billing eventually
 * reads.
 *
 * TWO THINGS THIS SCREEN REFUSES TO BLUR
 *
 *   1. NO LIMIT IS "UNLIMITED", NOT ZERO. A metric with no entitlement is
 *      uncapped. Rendering it as 0 — or as a full bar — would read as "at their
 *      limit" and is exactly backwards.
 *
 *   2. SOFT AND HARD LOOK DIFFERENT. A soft limit warns; a hard one blocks the
 *      action with a 402. Showing them the same way would mean nobody could
 *      tell, from the console, whether a tenant at 105% is inconvenienced or
 *      locked out.
 */

const pctTone = (m: UsageMetric): "ok" | "warn" | "bad" | "mute" => {
  if (m.limit === null) return "mute";
  if (m.over) return m.hard ? "bad" : "warn";
  if (m.pct !== null && m.pct >= 80) return "warn";
  return "ok";
};

function fmtValue(v: number, unit: string | null): string {
  const n = Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

export function OpsUsage() {
  const { toast, fail } = useToast();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const usage = useAsync<FleetUsage>(() => ops.usage());
  const metrics = useAsync<MetricSpec[]>(() => ops.usageMetrics());
  const plans = useAsync<Plan[]>(() => platform.plans() as Promise<Plan[]>);
  const ents = useAsync<Entitlement[]>(() => ops.entitlements());

  const measure = () => {
    setBusy(true);
    ops.measureUsage()
      .then(() => toast("Metering started — figures refresh when it finishes"))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const rows = usage.data?.tenants || [];
  const unmetered = (metrics.data || []).filter((m) => !m.metered);

  return (
    <>
      <PageHeader
        title="Usage & limits"
        desc="What each tenant has consumed against what their plan grants."
        actions={
          <div className="row" style={{ gap: 6 }}>
            {can("plans.write") && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Plan limits</Button>
            )}
            {canOperate() && (
              <Button variant="primary" loading={busy} onClick={measure}>Measure now</Button>
            )}
          </div>
        }
      />
      <OpsNav />

      {usage.loading ? (
        <Loading />
      ) : usage.error ? (
        <Empty>Couldn’t load usage — {usage.error.message}</Empty>
      ) : (
        <>
          <div className="toolbar">
            <span className="muted">Period {usage.data?.period}</span>
            {(usage.data?.over.length || 0) > 0 && (
              <Pill tone="bad">{usage.data?.over.length} tenant(s) over a limit</Pill>
            )}
          </div>

          {unmetered.length > 0 && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              Not yet measured: {unmetered.map((m) => m.label).join(", ")}. A limit can be set, but nothing
              reports usage against it yet, so it will always read zero — it is shown so that is visible
              rather than mistaken for a tenant using nothing.
            </div>
          )}

          {rows.length === 0 ? (
            <Empty>No live tenants.</Empty>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {rows.map((t) => (
                <Card
                  key={t.tenant_id}
                  title={<span className="row" style={{ gap: 8 }}><span className="mono">{t.slug}</span>{t.plan && <Pill tone="mute">{t.plan}</Pill>}</span>}
                >
                  {t.metrics.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Nothing measured yet — run “Measure now”, or wait for the hourly sweep.
                    </div>
                  ) : (
                    <div className="tbl-wrap">
                      <table>
                        <thead>
                          <tr><th>Metric</th><th>Used</th><th>Limit</th><th>Of limit</th><th>Enforcement</th><th>Measured</th></tr>
                        </thead>
                        <tbody>
                          {t.metrics.map((m) => (
                            <tr key={m.metric}>
                              <td>{m.label}</td>
                              <td>{fmtValue(m.used, m.unit)}</td>
                              <td>
                                {m.limit === null
                                  ? <span className="muted">unlimited</span>
                                  : fmtValue(m.limit, m.unit)}
                              </td>
                              <td>
                                {m.pct === null
                                  ? <span className="muted">—</span>
                                  : <Pill tone={pctTone(m)}>{m.pct}%</Pill>}
                              </td>
                              <td>
                                {m.limit === null
                                  ? <span className="muted">—</span>
                                  : m.hard
                                    ? <Pill tone={m.over ? "bad" : "mute"}>{m.over ? "blocked" : "hard"}</Pill>
                                    : <Pill tone={m.over ? "warn" : "mute"}>{m.over ? "over (allowed)" : "soft"}</Pill>}
                              </td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(m.measured_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <PlanLimitsModal
          plans={plans.data || []}
          metrics={metrics.data || []}
          entitlements={ents.data || []}
          onClose={() => setEditing(false)}
          onChanged={() => { ents.reload(); usage.reload(); }}
        />
      )}
    </>
  );
}

function PlanLimitsModal({
  plans, metrics, entitlements, onClose, onChanged,
}: {
  plans: Plan[];
  metrics: MetricSpec[];
  entitlements: Entitlement[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast, fail } = useToast();
  const [planId, setPlanId] = useState(plans[0]?.plan_id || "");
  const [metric, setMetric] = useState(metrics[0]?.metric || "seats");
  const [limit, setLimit] = useState("");
  const [hard, setHard] = useState(false);
  const [busy, setBusy] = useState(false);

  const forPlan = entitlements.filter((e) => e.plan_id === planId);
  const spec = metrics.find((m) => m.metric === metric);

  const save = () => {
    setBusy(true);
    ops.setEntitlement(planId, { metric, limit_value: Number(limit), hard })
      .then(() => { toast("Limit saved"); setLimit(""); onChanged(); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const remove = (m: string) => {
    ops.removeEntitlement(planId, m)
      .then(() => { toast(`${m} is unlimited again`); onChanged(); })
      .catch(fail);
  };

  return (
    <Modal title="Plan limits" onClose={onClose} maxWidth={640}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Plan">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name || p.code}</option>)}
          </select>
        </Field>

        {forPlan.length > 0 && (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Metric</th><th>Limit</th><th>Enforcement</th><th></th></tr></thead>
              <tbody>
                {forPlan.map((e) => (
                  <tr key={e.metric}>
                    <td>{metrics.find((m) => m.metric === e.metric)?.label || e.metric}</td>
                    <td>{Number(e.limit_value).toLocaleString()}</td>
                    <td>{e.hard ? <Pill tone="bad">hard — blocks</Pill> : <Pill tone="mute">soft — warns</Pill>}</td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="sm" variant="ghost" onClick={() => remove(e.metric)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid2">
          <Field label="Metric" hint={spec && !spec.metered ? "No meter reports this yet — usage will read zero." : undefined}>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metrics.map((m) => (
                <option key={m.metric} value={m.metric}>{m.label}{m.metered ? "" : " (not measured yet)"}</option>
              ))}
            </select>
          </Field>
          <Field label={`Limit${spec?.unit ? ` (${spec.unit})` : ""}`}>
            <input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Enforcement"
          hint={
            hard
              ? "Hard: the action is blocked with a clear 'limit reached' error. Use only where going over is genuinely not allowed — a mistyped limit locks a paying tenant out."
              : "Soft: the tenant goes over and is warned. Nothing is blocked."
          }
        >
          <select value={hard ? "hard" : "soft"} onChange={(e) => setHard(e.target.value === "hard")}>
            <option value="soft">Soft — warn only</option>
            <option value="hard">Hard — block the action</option>
          </select>
        </Field>

        {hard && (
          <div className="banner warn">
            A hard limit blocks real work for that tenant the moment they reach it.
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!planId || limit === ""}>
            Save limit
          </Button>
        </div>
      </div>
    </Modal>
  );
}
