/**
 * House rules (0697) — the clauses the system actually enforces.
 *
 * ── WHY THIS SITS INSIDE SOPs ─────────────────────────────────────────────
 *
 * A lateness deduction is not an attendance setting; it is a clause, and the
 * clause is in the staff handbook. Putting the switch beside the document is
 * what makes "which page says I can be charged for this?" answerable, and it
 * puts the person editing the handbook in the same place as the switch.
 *
 * ── THE ACTIVATION AFFORDANCE IS DELIBERATELY BLUNT ───────────────────────
 *
 * Every rule ships INACTIVE. Turning one on is the moment the company starts
 * taking money off its staff's payslips, so the toggle says what it will do in
 * money terms and the inactive state is stated rather than implied by a pale
 * switch nobody reads.
 *
 * Desktop-first: a two-column grid of rule cards on a laptop, one column on a
 * phone, with the tier editor inline rather than behind another modal — editing
 * a tier is the main thing anybody comes here to do.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const KIND_TONE: Record<string, Tone> = {
  LATENESS: "warn",
  ABSENCE: "bad",
  REWARD: "ok",
  CONDUCT: "blue",
};

const KIND_LABEL: Record<string, string> = {
  LATENESS: "Lateness",
  ABSENCE: "Absence",
  REWARD: "Reward",
  CONDUCT: "Conduct",
};

/** What the rule does, in the terms an HR manager would use out loud. */
function effectLine(r: api.HrRule): string {
  const v = Number(r.effect_value || 0);
  switch (r.effect) {
    case "DEDUCT_PCT_DAY":
      return r.tiers?.length
        ? `Deducts a share of the day's pay: ${r.tiers.map((t) => `${t.deduction_pct}% after ${t.after_minutes} min`).join(", ")}`
        : `Deducts ${v}% of the day's pay`;
    case "DEDUCT_FIXED":
      return `Deducts ${money(v)}`;
    case "BONUS_FIXED":
      return `Awards ${money(v)}`;
    case "BONUS_PCT_SALARY":
      return `Awards ${v}% of monthly salary`;
    case "SALARY_INCREASE_PCT":
      return `Proposes a ${v}% salary increase`;
    default:
      return "Raises a query. Costs nothing.";
  }
}

type SopDoc = { sop_document_id: string; title: string };

/* ══ New rule ══════════════════════════════════════════════════════════════
 *
 * There was no way to add a house rule. `RuleEditor` only ever opened an
 * existing one, so a tenant was limited to whatever 0697 seeded — a lateness
 * deduction and an unexcused absence. The endpoint (`POST /sops/rules`) and the
 * API client function have existed the whole time; the screen simply never
 * offered the action.
 *
 * The practical effect was worse than "cannot add a rule": REWARD and CONDUCT
 * are valid kinds with tones and labels in this very file, and nothing seeded
 * one, so the two halves of the engine that PAY people and ASK people were
 * unreachable while the two that CHARGE them shipped ready to switch on.
 */
function NewRuleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: sops } = useList<SopDoc>("/sops");
  const [f, setF] = React.useState({
    code: "",
    name: "",
    kind: "REWARD",
    description: "",
    effect: "BONUS_FIXED",
    effect_value: "",
    metric: "",
    comparator: "gte",
    threshold: "",
    auto_query: false,
    query_severity: "WARNING",
    query_due_days: "2",
    sop_document_id: "",
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isReward = f.kind === "REWARD";
  const charges = f.effect !== "QUERY_ONLY";
  // The server refuses a charging rule with no figure — a rule that deducts
  // "nothing" silently charges 0% for ever, which is worse than no rule. Said
  // here so the refusal is not a surprise at save time.
  const needsValue = charges && f.effect_value === "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createHrRule({
        code: f.code.trim().toUpperCase(),
        name: f.name.trim(),
        kind: f.kind as api.HrRule["kind"],
        description: f.description || undefined,
        effect: f.effect as api.HrRule["effect"],
        effect_value: f.effect_value === "" ? null : Number(f.effect_value),
        ...(isReward
          ? {
              metric: f.metric || null,
              comparator: f.comparator as "gte" | "lte",
              threshold: f.threshold === "" ? null : Number(f.threshold),
            }
          : {}),
        auto_query: f.auto_query,
        query_severity: f.query_severity as api.HrRule["query_severity"],
        query_due_days: Number(f.query_due_days) || 0,
        sop_document_id: f.sop_document_id || null,
        // Created OFF, always. Turning a rule on is the moment the company
        // starts moving money, and that is a decision somebody takes after
        // reading it — never a side effect of filling in a form.
        is_active: false,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New house rule"
      description="A clause the system applies evenly. Created switched off."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required hint="Letters, numbers and underscores. Cannot be changed later.">
            <Input
              value={f.code}
              onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="REWARD_LONG_SERVICE"
            />
          </Field>
          <Field label="Name" required>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Long-service bonus" />
          </Field>
        </div>
        <Field label="Kind" required hint="What the rule is for. Rewards pay; conduct asks; the other two charge.">
          <Select
            value={f.kind}
            onChange={(e) => {
              const kind = e.target.value;
              set("kind", kind);
              // A sensible effect for the kind, so the form is never in a
              // combination the server will refuse.
              set("effect", kind === "REWARD" ? "BONUS_FIXED" : kind === "CONDUCT" ? "QUERY_ONLY" : "DEDUCT_PCT_DAY");
            }}
          >
            <option value="REWARD">Reward — pays</option>
            <option value="CONDUCT">Conduct — asks</option>
            <option value="LATENESS">Lateness — charges</option>
            <option value="ABSENCE">Absence — charges</option>
          </Select>
        </Field>
        <Field label="Description">
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Effect">
            <Select value={f.effect} onChange={(e) => set("effect", e.target.value)}>
              <option value="QUERY_ONLY">Raise a query only</option>
              <option value="BONUS_FIXED">Award a fixed amount</option>
              <option value="BONUS_PCT_SALARY">Award a % of monthly salary</option>
              <option value="SALARY_INCREASE_PCT">Propose a % salary increase</option>
              <option value="DEDUCT_PCT_DAY">Deduct a % of the day</option>
              <option value="DEDUCT_FIXED">Deduct a fixed amount</option>
            </Select>
          </Field>
          {charges && (
            <Field label="Amount / percentage" required>
              <Input
                type="number"
                min="0"
                className="num text-right"
                value={f.effect_value}
                onChange={(e) => set("effect_value", e.target.value)}
              />
            </Field>
          )}
        </div>

        {isReward && (
          /* A reward is MEASURED over a month. Without a metric it is a payment
             somebody authorises by hand, which is not what this table is for —
             and it would sit in the list looking configured while computing
             nothing. */
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
            <Field label="Measured on" hint="e.g. punctuality_pct, late_days">
              <Input value={f.metric} onChange={(e) => set("metric", e.target.value)} placeholder="punctuality_pct" />
            </Field>
            <Field label="Comparison">
              <Select value={f.comparator} onChange={(e) => set("comparator", e.target.value)}>
                <option value="gte">At or above</option>
                <option value="lte">At or below</option>
              </Select>
            </Field>
            <Field label="Threshold">
              <Input
                type="number"
                className="num text-right"
                value={f.threshold}
                onChange={(e) => set("threshold", e.target.value)}
              />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ask the employee">
            <Checkbox
              checked={f.auto_query}
              onCheckedChange={(v: boolean) => set("auto_query", v === true)}
              label="Raise a query"
            />
          </Field>
          <Field label="Severity">
            <Select value={f.query_severity} onChange={(e) => set("query_severity", e.target.value)} disabled={!f.auto_query}>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="SERIOUS">Serious</option>
            </Select>
          </Field>
          <Field label="Days to answer">
            <Input
              type="number"
              min="0"
              className="num text-right"
              value={f.query_due_days}
              onChange={(e) => set("query_due_days", e.target.value)}
              disabled={!f.auto_query}
            />
          </Field>
        </div>

        <Field label="SOP clause it enforces" hint="A deduction an employee can trace to the handbook is a rule; one they cannot is a surprise.">
          <Select value={f.sop_document_id} onChange={(e) => set("sop_document_id", e.target.value)}>
            <option value="">— none yet —</option>
            {(sops || []).map((d) => (
              <option key={d.sop_document_id} value={d.sop_document_id}>
                {d.title}
              </option>
            ))}
          </Select>
        </Field>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.code || !f.name || needsValue || busy}>
            Create, switched off
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RuleEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: api.HrRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: sops } = useList<SopDoc>("/sops");
  const [f, setF] = React.useState({
    name: rule.name,
    description: rule.description || "",
    effect: rule.effect,
    effect_value: rule.effect_value == null ? "" : String(rule.effect_value),
    auto_query: rule.auto_query,
    query_severity: rule.query_severity,
    query_due_days: String(rule.query_due_days),
    sop_document_id: rule.sop_document_id || "",
  });
  const [tiers, setTiers] = React.useState(rule.tiers || []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const isLateness = rule.kind === "LATENESS";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateHrRule(rule.hr_rule_id, {
        name: f.name,
        description: f.description || undefined,
        effect: f.effect,
        effect_value: f.effect_value === "" ? null : Number(f.effect_value),
        auto_query: f.auto_query,
        query_severity: f.query_severity,
        query_due_days: Number(f.query_due_days) || 0,
        // "" is the "no document" option; the column is nullable, and sending
        // an empty string would fail the uuid check rather than clearing it.
        sop_document_id: f.sop_document_id || null,
        ...(isLateness ? { tiers } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={rule.name} description={KIND_LABEL[rule.kind]}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field
            label="What it does"
            required
            hint={
              f.effect === "QUERY_ONLY"
                ? "Flags the breach and asks the employee about it. No money moves."
                : "This moves money on a payslip."
            }
          >
            <Select value={f.effect} onChange={(e) => set("effect", e.target.value)}>
              <option value="QUERY_ONLY">Raise a query only</option>
              <option value="DEDUCT_PCT_DAY">Deduct a share of the day</option>
              <option value="DEDUCT_FIXED">Deduct a fixed amount</option>
              <option value="BONUS_FIXED">Award a fixed bonus</option>
              <option value="BONUS_PCT_SALARY">Award a % of salary</option>
              <option value="SALARY_INCREASE_PCT">Propose a salary increase</option>
            </Select>
          </Field>
          {f.effect !== "QUERY_ONLY" && !(isLateness && f.effect === "DEDUCT_PCT_DAY") && (
            <Field label="Amount or percentage" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num text-right"
                value={f.effect_value}
                onChange={(e) => set("effect_value", e.target.value)}
              />
            </Field>
          )}

          {/* THE CLAUSE. The whole reason this table exists — a deduction an
              employee can trace to a document is a rule, one they cannot is a
              surprise. */}
          <Field
            label="SOP clause this enforces"
            className="sm:col-span-2"
            hint="Shown beside every charge this rule makes."
          >
            <Select
              value={f.sop_document_id}
              onChange={(e) => set("sop_document_id", e.target.value)}
            >
              <option value="">No document linked</option>
              {(sops || []).map((s) => (
                <option key={s.sop_document_id} value={s.sop_document_id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {isLateness && f.effect === "DEDUCT_PCT_DAY" && (
          <div className="space-y-2">
            <p className="micro">Tiers</p>
            <p className="text-xs text-muted-foreground">
              The highest tier the lateness reaches is the one charged. Order does
              not matter.
            </p>
            <div className="flex flex-col gap-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">After</span>
                  <Input
                    type="number"
                    min="0"
                    className="num w-24 text-right"
                    value={t.after_minutes}
                    onChange={(e) =>
                      setTiers((list) =>
                        list.map((x, j) => (j === i ? { ...x, after_minutes: Number(e.target.value) } : x)),
                      )
                    }
                    aria-label={`Tier ${i + 1} minutes`}
                  />
                  <span className="text-xs text-muted-foreground">min, deduct</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    className="num w-20 text-right"
                    value={t.deduction_pct}
                    onChange={(e) =>
                      setTiers((list) =>
                        list.map((x, j) => (j === i ? { ...x, deduction_pct: Number(e.target.value) } : x)),
                      )
                    }
                    aria-label={`Tier ${i + 1} percentage`}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setTiers((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setTiers((list) => [...list, { after_minutes: 60, deduction_pct: 10 }])}
                >
                  Add tier
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Checkbox
            checked={f.auto_query}
            onCheckedChange={(v) => set("auto_query", v === true)}
            label="Ask the employee about it"
            hint="Raises an HR query they must answer. The deduction stands until it is waived."
          />
          {f.auto_query && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Severity">
                <Select value={f.query_severity} onChange={(e) => set("query_severity", e.target.value)}>
                  <option value="INFO">Info</option>
                  <option value="WARNING">Warning</option>
                  <option value="SERIOUS">Serious</option>
                </Select>
              </Field>
              <Field label="Days to answer">
                <Input
                  type="number"
                  min="0"
                  max="30"
                  className="num text-right"
                  value={f.query_due_days}
                  onChange={(e) => set("query_due_days", e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save rule
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function HouseRulesView() {
  const q = useResource(() => api.listHrRules(), []);
  const [editing, setEditing] = React.useState<api.HrRule | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const rules = q.data || [];
  const anyActive = rules.some((r) => r.is_active);

  async function toggle(r: api.HrRule) {
    setBusy(r.hr_rule_id);
    setError(null);
    try {
      await api.updateHrRule(r.hr_rule_id, { is_active: !r.is_active });
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="micro">
          Rules apply the handbook evenly. Rewards pay, conduct asks, lateness
          and absence charge.
        </p>
        <Button onClick={() => setCreating(true)}>New rule</Button>
      </div>
      {/* Stated, not implied. Nothing charges anybody until somebody here
          decides it should, and that is worth saying once at the top. */}
      {!anyActive && rules.length > 0 && (
        <Callout tone="info" title="No rule is switched on">
          Attendance is being recorded and nothing is being charged. Turn a rule on
          when the clause behind it is in the handbook and the team has been told.
        </Callout>
      )}
      {error && <ErrorState message={error} />}

      {q.error ? (
        <ErrorState message={q.error} />
      ) : rules.length === 0 && !q.loading ? (
        <EmptyState
          title="No house rules"
          hint="Rules turn a clause in the handbook into something the system applies evenly."
          action={<Button onClick={() => setCreating(true)}>New rule</Button>}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <div
              key={r.hr_rule_id}
              className={cn("lux-card flex flex-col gap-2 p-4", !r.is_active && "opacity-70")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{r.name}</span>
                  <Pill tone={KIND_TONE[r.kind] || "mute"}>{KIND_LABEL[r.kind] || r.kind}</Pill>
                  <Pill tone={r.is_active ? "ok" : "mute"}>{r.is_active ? "On" : "Off"}</Pill>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={r.is_active ? "outline" : "default"}
                    loading={busy === r.hr_rule_id}
                    onClick={() => toggle(r)}
                  >
                    {r.is_active ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </div>
              {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
              <p className="text-xs text-foreground">{effectLine(r)}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.sop_title ? (
                  <>Enforces: {r.sop_title}</>
                ) : (
                  // Named as a gap rather than left blank: a rule that charges
                  // money with no document behind it is the one an employee
                  // will successfully contest.
                  <span className="text-[rgb(var(--warn))]">No SOP clause linked</span>
                )}
                {r.auto_query && <> · Asks the employee, {r.query_due_days} day(s) to answer</>}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor rule={editing} onClose={() => setEditing(null)} onSaved={q.reload} />
      )}
      {creating && (
        <NewRuleForm onClose={() => setCreating(false)} onSaved={q.reload} />
      )}
    </div>
  );
}

export default HouseRulesView;
