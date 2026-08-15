/**
 * Milestone scheduling & SLA policy — the ⚙ modal.
 *
 * WHY THIS IS CONFIGURATION AND NOT CODE. Two of the engine's decisions are
 * business judgement, not physics, and they differ by service:
 *
 *   1. When work finishes EARLY, does the promise move forward with it? Holding
 *      it keeps a commitment stable and honest; pulling it forward passes the
 *      gain to the client. A forwarder with a fixed weekly sailing wants one;
 *      an on-demand haulier wants the other.
 *   2. When upstream slip means a locked SLA date can no longer be met — the
 *      remaining stages will not fit even compressed to their floors — does the
 *      system hold the date and shout, quietly move it, or stop and demand a
 *      human re-plan?
 *
 * Neither has a right answer the product can pick, so both are settings, with a
 * per-service override on top of a tenant default. The engine resolves them in
 * three layers (milestone.service resolvePolicy).
 *
 * WHAT THIS DELIBERATELY DOES NOT OFFER. There is no "ignore the floors" and no
 * "let the forecast hide a breach". Those are the guardrails that stop the
 * scheduler producing a plan that looks feasible and is not — configuration
 * ends where honesty begins.
 *
 * Stored in the ONE setting `operations.milestone_policy`: tenant-wide keys at
 * the top, per-service under `by_service.<service_type_id>`.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { errMsg, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";

/** Mirrors DEFAULT_POLICY in milestone.schedule.js. */
export type MilestonePolicy = {
  earlyCompletion?: "HOLD" | "PULL_ON_CONFIRMATION" | "PULL_ALWAYS";
  onFloorReached?: "HOLD_AND_ALERT" | "AUTO_RELEASE" | "REQUIRE_REPLAN";
  riskHours?: number;
  dueHours?: number;
  showForecastToClient?: boolean;
  notifyTiers?: string[];
};

type Stored = MilestonePolicy & {
  by_service?: Record<string, MilestonePolicy>;
};

const DEFAULTS: Required<
  Pick<
    MilestonePolicy,
    "earlyCompletion" | "onFloorReached" | "riskHours" | "dueHours"
  >
> = {
  earlyCompletion: "HOLD",
  onFloorReached: "HOLD_AND_ALERT",
  riskHours: 24,
  dueHours: 48,
};

const EARLY_OPTIONS: {
  value: NonNullable<MilestonePolicy["earlyCompletion"]>;
  label: string;
  hint: string;
}[] = [
  {
    value: "HOLD",
    label: "Hold the promise",
    hint: "The forecast improves; the date the client was given does not move.",
  },
  {
    value: "PULL_ON_CONFIRMATION",
    label: "Pull forward once readiness is confirmed",
    hint: "Someone confirms the next stage can actually start early.",
  },
  {
    value: "PULL_ALWAYS",
    label: "Always pull the promise forward",
    hint: "The commitment tracks the forecast in both directions.",
  },
];

const FLOOR_OPTIONS: {
  value: NonNullable<MilestonePolicy["onFloorReached"]>;
  label: string;
  hint: string;
}[] = [
  {
    value: "HOLD_AND_ALERT",
    label: "Hold the date and raise the breach",
    hint: "The commitment stands, the forecast runs past it, and the owners are told.",
  },
  {
    value: "AUTO_RELEASE",
    label: "Release the lock and move the date",
    hint: "The schedule stays internally consistent; the SLA quietly moves.",
  },
  {
    value: "REQUIRE_REPLAN",
    label: "Stop and require a re-plan",
    hint: "No further automatic movement until a human decides.",
  },
];

const readPolicy = () =>
  tenant<{ value?: Stored } | Stored>("/settings/operations/milestone_policy");
const writePolicy = (value: Stored) =>
  tenant("/settings/operations/milestone_policy", {
    method: "PUT",
    body: { value },
  });

/** The stored shape has moved around; accept either envelope. */
function unwrap(raw: unknown): Stored {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const v =
    r.value && typeof r.value === "object"
      ? (r.value as Stored)
      : (r as Stored);
  return v || {};
}

export function MilestonePolicyForm({
  serviceTypeId,
  serviceTypeName,
  onClose,
}: {
  /** Omit to edit the tenant-wide default; pass an id to edit that service's override. */
  serviceTypeId?: string;
  serviceTypeName?: string;
  onClose: () => void;
}) {
  const stored = useResource(() => readPolicy(), []);
  const [form, setForm] = React.useState<MilestonePolicy | null>(null);
  const [overriding, setOverriding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const all = React.useMemo(() => unwrap(stored.data), [stored.data]);
  const tenantWide: MilestonePolicy = React.useMemo(() => {
    const { by_service: _omit, ...rest } = all;
    return { ...DEFAULTS, ...rest };
  }, [all]);

  React.useEffect(() => {
    if (form || !stored.data) return;
    if (!serviceTypeId) {
      setForm(tenantWide);
      return;
    }
    const override = all.by_service?.[serviceTypeId];
    setOverriding(!!override);
    setForm({ ...tenantWide, ...(override || {}) });
  }, [stored.data, form, serviceTypeId, all, tenantWide]);

  const set = (patch: MilestonePolicy) =>
    setForm((f) => ({ ...(f || {}), ...patch }));

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const next: Stored = { ...all };
      if (!serviceTypeId) {
        Object.assign(next, form);
      } else {
        const by = { ...(all.by_service || {}) };
        // Clearing the override is a real action, not "save the same values" —
        // otherwise a service silently keeps a frozen copy of whatever the
        // tenant default happened to be on the day it was set.
        if (overriding) by[serviceTypeId] = form;
        else delete by[serviceTypeId];
        next.by_service = by;
      }
      await writePolicy(next);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const scoped = !!serviceTypeId;
  const disabled = scoped && !overriding;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        scoped
          ? `Scheduling policy — ${serviceTypeName || "this service"}`
          : "Scheduling & SLA policy"
      }
      description={
        scoped
          ? "How this service type schedules and what happens when its SLA cannot be met. Falls back to the tenant default unless overridden."
          : "How every milestone chain schedules by default, and what happens when an SLA date can no longer be met."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={busy || !form}>
            Save policy
          </Button>
        </>
      }
    >
      {stored.error ? (
        <p className="text-sm text-[rgb(var(--bad))]">{stored.error}</p>
      ) : !form ? (
        <p className="micro">Loading the current policy…</p>
      ) : (
        <div className="space-y-4">
          {scoped && (
            <Checkbox
              checked={overriding}
              onCheckedChange={setOverriding}
              label="Override the tenant default for this service type"
              hint="Off means this service follows whatever the tenant-wide policy says, including future changes to it."
            />
          )}

          <Field
            label="When a stage finishes early"
            hint="Delays always push the schedule out. This is only about the other direction."
          >
            <Select
              value={form.earlyCompletion || "HOLD"}
              onChange={(e) =>
                set({
                  earlyCompletion: e.target
                    .value as MilestonePolicy["earlyCompletion"],
                })
              }
              disabled={disabled}
            >
              {EARLY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="micro">
            {
              EARLY_OPTIONS.find(
                (o) => o.value === (form.earlyCompletion || "HOLD"),
              )?.hint
            }
          </p>

          <Field
            label="When an SLA date can no longer be met"
            hint="Raised when the remaining stages will not fit before the locked date even at their minimum durations."
          >
            <Select
              value={form.onFloorReached || "HOLD_AND_ALERT"}
              onChange={(e) =>
                set({
                  onFloorReached: e.target
                    .value as MilestonePolicy["onFloorReached"],
                })
              }
              disabled={disabled}
            >
              {FLOOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="micro">
            {
              FLOOR_OPTIONS.find(
                (o) => o.value === (form.onFloorReached || "HOLD_AND_ALERT"),
              )?.hint
            }
          </p>

          {form.onFloorReached === "AUTO_RELEASE" && (
            <Callout
              tone="warn"
              title="Releasing the lock moves the client's date"
            >
              Every release is recorded and the owners are notified, but a date
              that moves whenever it is inconvenient stops being a commitment.
              Prefer holding it and acting on the alert.
            </Callout>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Flag as at risk within (working hours)">
              <Input
                value={String(form.riskHours ?? DEFAULTS.riskHours)}
                onChange={(e) =>
                  set({
                    riskHours:
                      Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                  })
                }
                className="num"
                disabled={disabled}
              />
            </Field>
            <Field label="Flag as due within (working hours)">
              <Input
                value={String(form.dueHours ?? DEFAULTS.dueHours)}
                onChange={(e) =>
                  set({
                    dueHours:
                      Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                  })
                }
                className="num"
                disabled={disabled}
              />
            </Field>
          </div>

          <Checkbox
            checked={form.showForecastToClient !== false}
            onCheckedChange={(v) => set({ showForecastToClient: v })}
            label="Show the client the forecast as well as the committed date"
            hint="Off shows only the commitment on the portal. The forecast is always visible internally."
            disabled={disabled}
          />

          <p className="micro">
            The scan that raises these runs twice a day by default, at 06:00 and
            18:00 in the entity&apos;s timezone, and only when a
            milestone&apos;s health actually changes.
          </p>

          {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
