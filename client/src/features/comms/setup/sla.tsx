/**
 * Comms → Setup → Response times (§9.2).
 *
 * How long a first reply is allowed to take, and which hours count.
 *
 * ── THE CALENDAR IS HALF THE POLICY ─────────────────────────────────────────
 *
 * "Four hours" means nothing on its own. Four working hours starting 17:00 on a
 * Friday is Monday lunchtime; four clock hours is 21:00 the same evening, and a
 * breach nobody could have prevented. The sweep computes against the business
 * calendar, so the calendar has to be editable next to the policy rather than
 * buried somewhere else — otherwise every tenant gets whatever the default is
 * and the SLA reports on a week their staff do not work.
 *
 * ── EDITING RE-BASES THE THREADS ALREADY IN THE QUEUE ───────────────────────
 *
 * `workflow.afterPolicyChange` clears the computed due dates so the next sweep
 * re-applies them. That means a change here moves the deadline on conversations
 * that are already open, which is the correct behaviour and a surprising one —
 * so the screen says it, rather than letting an administrator discover it from
 * a breach alert that fires or stops firing for no visible reason.
 *
 * ── NO SLA IS A VALID ANSWER ────────────────────────────────────────────────
 *
 * A tenant with no policy is not misconfigured; it is a tenant that does not
 * measure response times. The empty state says that instead of nagging.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal, Select } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { Pill } from "@/components/ui/pill";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_KEY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Minutes → the sentence a person would say. */
function humanMinutes(m?: number | null): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m} ${tr("minutes")}`;
  if (m % 60 === 0) return `${m / 60} ${m / 60 === 1 ? tr("hour") : tr("hours")}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ── Policies ─────────────────────────────────────────────────────────────── */

function PolicyDialog({
  policy,
  onClose,
  onSaved,
}: {
  policy: api.SlaPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(policy?.name || "");
  const [first, setFirst] = React.useState(String(policy?.first_response_minutes ?? 240));
  const [resolve, setResolve] = React.useState(String(policy?.resolution_minutes ?? 1440));
  const [active, setActive] = React.useState(policy?.is_active ?? true);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        first_response_minutes: Number(first) || null,
        resolution_minutes: Number(resolve) || null,
        is_active: active,
      };
      if (policy) await api.updateSlaPolicy(policy.mail_sla_policy_id, body);
      else await api.createSlaPolicy(body);
      onSaved();
      onClose();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={policy ? tr("Edit response target") : tr("New response target")}>
      <div className="space-y-3">
        <Field label={tr("Name")} hint={tr("What this covers — “Client enquiries”, “Supplier chasers”.")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr("First reply within (minutes)")} hint={tr("Counted in working hours, not clock hours.")}>
          <Input type="number" min={1} value={first} onChange={(e) => setFirst(e.target.value)} />
        </Field>
        <Field label={tr("Resolved within (minutes)")}>
          <Input type="number" min={1} value={resolve} onChange={(e) => setResolve(e.target.value)} />
        </Field>
        <Field label={tr("Active")}>
          <Select value={active ? "yes" : "no"} onChange={(e) => setActive(e.target.value === "yes")}>
            <option value="yes">{tr("Measuring")}</option>
            <option value="no">{tr("Paused")}</option>
          </Select>
        </Field>

        {/* Surprising, and true. Better said here than discovered from a breach
            alert that starts or stops firing for no visible reason. */}
        <Callout tone="info" title={tr("This applies to conversations already open.")}>
          {tr("Saving clears the computed deadlines, and the next sweep re-applies them — so threads in the queue get the new target, not the old one.")}
        </Callout>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button size="sm" onClick={save} disabled={busy || !name.trim()}>{tr("Save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Working hours ────────────────────────────────────────────────────────── */

type Hours = Record<string, { open?: string; close?: string; closed?: boolean }>;

function WorkingHours({ initial, onSaved }: { initial: Hours; onSaved: () => void }) {
  const [hours, setHours] = React.useState<Hours>(initial);
  const [busy, setBusy] = React.useState(false);

  const set = (key: string, patch: Partial<Hours[string]>) =>
    setHours((h) => ({ ...h, [key]: { ...h[key], ...patch } }));

  async function save() {
    setBusy(true);
    try {
      await api.putBusinessHours({ business_hours: hours });
      onSaved();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">{tr("Day")}</th>
            <th className="py-1 font-medium">{tr("Opens")}</th>
            <th className="py-1 font-medium">{tr("Closes")}</th>
            <th className="py-1 font-medium">{tr("Closed")}</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((label, i) => {
            const key = DAY_KEY[i];
            const row = hours[key] || {};
            return (
              <tr key={key} className="border-t border-border/50">
                <td className="py-1.5">{tr(label)}</td>
                <td className="py-1.5">
                  <Input
                    type="time"
                    value={row.open || ""}
                    disabled={row.closed}
                    aria-label={`${tr(label)} ${tr("opens")}`}
                    onChange={(e) => set(key, { open: e.target.value })}
                    className="h-8 w-28 text-xs"
                  />
                </td>
                <td className="py-1.5">
                  <Input
                    type="time"
                    value={row.close || ""}
                    disabled={row.closed}
                    aria-label={`${tr(label)} ${tr("closes")}`}
                    onChange={(e) => set(key, { close: e.target.value })}
                    className="h-8 w-28 text-xs"
                  />
                </td>
                <td className="py-1.5">
                  <input
                    type="checkbox"
                    checked={Boolean(row.closed)}
                    aria-label={`${tr(label)} ${tr("closed")}`}
                    onChange={(e) => set(key, { closed: e.target.checked })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button size="sm" onClick={save} disabled={busy}>{tr("Save hours")}</Button>
    </div>
  );
}

/* ── Holidays ─────────────────────────────────────────────────────────────── */

function Holidays({
  initial,
  onSaved,
}: {
  initial: { on_date: string; label?: string | null }[];
  onSaved: () => void;
}) {
  const [rows, setRows] = React.useState(initial.map((h) => ({ on_date: h.on_date, label: h.label || "" })));
  const [date, setDate] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save(next: { on_date: string; label: string }[]) {
    setBusy(true);
    try {
      await api.putHolidays(next);
      setRows(next);
      onSaved();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {tr("No holidays set. Response targets will count public holidays as working days.")}
        </p>
      )}
      <ul className="space-y-1">
        {rows.map((h) => (
          <li key={h.on_date} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="num">{h.on_date}</span>
              {h.label ? <span className="text-muted-foreground"> — {h.label}</span> : null}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => save(rows.filter((r) => r.on_date !== h.on_date))}
            >
              {tr("Remove")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="date"
          value={date}
          aria-label={tr("Holiday date")}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 w-40 text-xs"
        />
        <Input
          value={label}
          aria-label={tr("Holiday name")}
          placeholder="Fête du Travail"
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          disabled={busy || !date}
          onClick={() => {
            save([...rows.filter((r) => r.on_date !== date), { on_date: date, label }]);
            setDate("");
            setLabel("");
          }}
        >
          {tr("Add")}
        </Button>
      </div>
    </div>
  );
}

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function SlaTab() {
  const policies = useResource(() => api.listSlaPolicies(), []);
  const calendar = useResource(() => api.getBusinessCalendar(), []);
  const [editing, setEditing] = React.useState<api.SlaPolicy | null>(null);
  const [creating, setCreating] = React.useState(false);

  const columns: Column<api.SlaPolicy>[] = [
    { key: "name", label: tr("Target"), render: (r) => r.name },
    {
      key: "first",
      label: tr("First reply"),
      render: (r) => humanMinutes(r.first_response_minutes),
    },
    {
      key: "resolution",
      label: tr("Resolved"),
      render: (r) => humanMinutes(r.resolution_minutes),
    },
    {
      key: "state",
      label: tr("State"),
      render: (r) => <Pill tone={r.is_active ? "ok" : "mute"}>{r.is_active ? tr("Measuring") : tr("Paused")}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>{tr("Edit")}</Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PageHeader
          title={tr("Response times")}
          description={tr("How long a first reply is allowed to take. Counted in working hours, so the calendar below is half the answer.")}
          action={<Button size="sm" onClick={() => setCreating(true)}>{tr("New target")}</Button>}
        />
        <DataList
          columns={columns}
          rows={policies.data ?? null}
          error={policies.error}
          loading={policies.loading}
          rowKey={(r) => r.mail_sla_policy_id}
          empty={{
            title: tr("No response targets"),
            // Not a nag. A tenant that does not measure response times is a
            // valid tenant.
            hint: tr("Nothing is measured until you set one, and that is a fine way to run a mailbox."),
            action: <Button size="sm" onClick={() => setCreating(true)}>{tr("New target")}</Button>,
          }}
        />
      </div>

      <div className="space-y-3">
        <PageHeader
          title={tr("Working hours")}
          description={tr("“Four hours” starting at 17:00 on a Friday should mean Monday morning, not Friday evening.")}
        />
        {calendar.loading && <LoadingRow label={tr("Loading the calendar…")} />}
        {calendar.error && <ErrorState message={calendar.error} />}
        {calendar.data && (
          <>
            <WorkingHours
              initial={(calendar.data.business_hours as Hours) || {}}
              onSaved={calendar.reload}
            />
            <div className="pt-2">
              <h3 className="mb-1 text-sm font-semibold">{tr("Public holidays")}</h3>
              <Holidays initial={calendar.data.holidays || []} onSaved={calendar.reload} />
            </div>
          </>
        )}
      </div>

      {(creating || editing) && (
        <PolicyDialog
          policy={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={policies.reload}
        />
      )}
    </div>
  );
}
