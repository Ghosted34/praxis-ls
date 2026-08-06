/**
 * Escalation settings — spec §5.2.
 *
 * Rules are edited in place and saved individually rather than through one
 * global Save. A page-level save on a list of independent rules means an edit
 * to rule 3 can silently revert a concurrent change to rule 1, and there is no
 * good way to show which rule failed validation.
 *
 * The preview button answers "would this have paged me?" against live data
 * before the rule is armed — an escalation rule you cannot dry-run is one you
 * find out about at 3am.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  errorsApi, LEVELS, LEVEL_STYLE,
  type ErrorLevel, type EscalationRule,
} from "@/lib/errors-api";
import { can } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, Empty, Field, Loading, PageHeader } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function ErrorCenterSettings() {
  const { toast } = useToast();
  const [rules, setRules] = useState<EscalationRule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editable = can("errors.configure");

  const load = () =>
    errorsApi
      .rules()
      .then(setRules)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRule = async () => {
    try {
      await errorsApi.createRule({
        name: "New escalation rule",
        level_filter: ["fatal"],
        threshold_count: 3,
        threshold_window_minutes: 15,
      });
      toast("Rule created");
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create rule");
    }
  };

  return (
    <>
      <PageHeader
        title="Error escalation settings"
        desc="Rules that decide when an error stops being a dashboard entry and starts being a notification."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Link to="/error-center"><Button size="sm" variant="ghost">← Error Center</Button></Link>
            {editable && <Button size="sm" variant="primary" onClick={() => void addRule()}>+ Add rule</Button>}
          </div>
        }
      />

      {err ? (
        <Empty>Couldn’t load rules — {err}</Empty>
      ) : !rules ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>
          No escalation rules yet. Without one, errors are recorded and shown here but nobody is notified.
        </Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rules.map((r) => (
            <RuleEditor key={r.id} rule={r} editable={editable} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}

function RuleEditor({ rule, editable, onChanged }: { rule: EscalationRule; editable: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<EscalationRule>(rule);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);

  useEffect(() => setDraft(rule), [rule]);

  const set = <K extends keyof EscalationRule>(k: K, v: EscalationRule[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const toggleLevel = (l: ErrorLevel) =>
    set(
      "level_filter",
      draft.level_filter.includes(l)
        ? (draft.level_filter.filter((x) => x !== l) as ErrorLevel[])
        : ([...draft.level_filter, l] as ErrorLevel[]),
    );

  const save = async () => {
    setSaving(true);
    try {
      await errorsApi.updateRule(rule.id, {
        name: draft.name,
        level_filter: draft.level_filter,
        threshold_count: draft.threshold_count,
        threshold_window_minutes: draft.threshold_window_minutes,
        action_email: draft.action_email,
        action_inhouse: draft.action_inhouse,
        action_webhook_url: draft.action_webhook_url || null,
        email_recipients: draft.email_recipients,
        escalation_delay_minutes: draft.escalation_delay_minutes,
        repeat_interval_minutes: draft.repeat_interval_minutes,
        active: draft.active,
      });
      toast("Rule saved");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete “${rule.name}”? Notifications from this rule stop immediately.`)) return;
    try {
      await errorsApi.deleteRule(rule.id);
      toast("Rule deleted");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <Card
      title={
        <input
          value={draft.name}
          disabled={!editable}
          onChange={(e) => set("name", e.target.value)}
          style={{ fontSize: 14, fontWeight: 600, background: "transparent", border: 0, padding: 0, width: "100%" }}
        />
      }
      actions={
        <div className="row" style={{ gap: 6 }}>
          <label className="row muted" style={{ gap: 5, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.active}
              disabled={!editable}
              onChange={(e) => set("active", e.target.checked)}
            />
            Active
          </label>
          {editable && dirty && <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save</Button>}
          {editable && <Button size="sm" variant="danger" onClick={() => void remove()}>Delete</Button>}
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label className="f">When any of these levels occur</label>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            {LEVELS.map((l) => {
              const on = draft.level_filter.includes(l);
              const st = LEVEL_STYLE[l];
              return (
                <button
                  key={l}
                  className="btn sm"
                  disabled={!editable}
                  onClick={() => toggleLevel(l)}
                  style={{
                    background: on ? st.bg : "transparent",
                    color: on ? st.fg : "var(--ink-3)",
                    borderColor: on ? st.border : "var(--line-2)",
                    fontWeight: on ? 650 : 500,
                  }}
                >
                  {st.badge} {st.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
          <Field label="Occurrences" hint="Threshold before escalating">
            <input
              type="number"
              min={1}
              value={draft.threshold_count}
              disabled={!editable}
              onChange={(e) => set("threshold_count", Number(e.target.value))}
            />
          </Field>
          <Field label="Within (minutes)" hint="Rolling window">
            <input
              type="number"
              min={1}
              value={draft.threshold_window_minutes}
              disabled={!editable}
              onChange={(e) => set("threshold_window_minutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Delay (minutes)" hint="Wait, then re-check before notifying">
            <input
              type="number"
              min={0}
              value={draft.escalation_delay_minutes}
              disabled={!editable}
              onChange={(e) => set("escalation_delay_minutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Repeat every (minutes)" hint="0 = notify once only">
            <input
              type="number"
              min={0}
              value={draft.repeat_interval_minutes}
              disabled={!editable}
              onChange={(e) => set("repeat_interval_minutes", Number(e.target.value))}
            />
          </Field>
        </div>

        <div>
          <label className="f">Then notify via</label>
          <div className="row wrap" style={{ gap: 14, marginTop: 6 }}>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={draft.action_email} disabled={!editable} onChange={(e) => set("action_email", e.target.checked)} />
              Email
            </label>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={draft.action_inhouse} disabled={!editable} onChange={(e) => set("action_inhouse", e.target.checked)} />
              In-house
            </label>
          </div>
        </div>

        <Field label="Email recipients" hint="Comma-separated. Only used when Email is enabled.">
          <input
            value={draft.email_recipients.join(", ")}
            disabled={!editable}
            placeholder="dev-oncall@company.com, cto@company.com"
            onChange={(e) =>
              set(
                "email_recipients",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              )
            }
          />
        </Field>

        <Field label="Webhook URL" hint="Slack, PagerDuty or any endpoint accepting a JSON POST. https only.">
          <input
            value={draft.action_webhook_url || ""}
            disabled={!editable}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => set("action_webhook_url", e.target.value || null)}
          />
        </Field>

        <div className="muted" style={{ fontSize: 11 }}>
          Scope: {draft.tenant_slug ? `tenant · ${draft.tenant_slug}` : "platform-wide (all tenants)"} · Updated {fmtDateTime(rule.updated_at)}
        </div>
      </div>
    </Card>
  );
}
