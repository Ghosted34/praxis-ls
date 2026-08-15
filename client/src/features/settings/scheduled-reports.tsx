/**
 * Settings — scheduled report runs and their delivery cadence.
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { PageError } from "./shared";

const CADENCES = ["daily", "weekly", "monthly", "quarterly", "on_event"];
const REPORT_FORMATS = ["pdf", "csv", "xlsx"];

function ScheduleForm({
  open,
  onClose,
  onCreated,
  catalogue,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  catalogue: Row[];
}) {
  const [name, setName] = React.useState("");
  const [reportKey, setReportKey] = React.useState("");
  const [cadence, setCadence] = React.useState("monthly");
  const [recipients, setRecipients] = React.useState("");
  const [formats, setFormats] = React.useState<string[]>(["pdf"]);
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setReportKey("");
    setCadence("monthly");
    setRecipients("");
    setFormats(["pdf"]);
    setActive(true);
    setError(null);
  }, [open]);

  function toggleFormat(f: string) {
    setFormats((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f],
    );
  }

  const emails = recipients
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badEmail = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const canSubmit = !!name.trim() && !!reportKey && !badEmail && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/reports/scheduled", {
        method: "POST",
        body: {
          name: name.trim(),
          report_key: reportKey,
          cadence,
          recipients: emails.length ? emails : undefined,
          formats: formats.length ? formats : undefined,
          active,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a report"
      description="Automated report delivery on a cadence. Recipients receive the generated file by email."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monthly receivables ageing"
            />
          </Field>
          <Field label="Report" required>
            <Select
              value={reportKey}
              onChange={(e) => setReportKey(e.target.value)}
            >
              <option value="">Select…</option>
              {catalogue.map((c) => (
                <option key={String(c.report_key)} value={String(c.report_key)}>
                  {cell(c.report_key)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cadence" required>
            <Select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Recipients"
            hint="Comma-separated emails"
            error={badEmail ? `Invalid email: ${badEmail}` : undefined}
          >
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="cfo@acme.cm, ops@acme.cm"
            />
          </Field>
        </div>
        {reportKey && (
          <p className="text-xs text-muted-foreground">
            {cell(
              catalogue.find((c) => String(c.report_key) === reportKey)
                ?.describe,
            )}
          </p>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">Formats</p>
          <div className="flex gap-4">
            {REPORT_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formats.includes(f)}
                  onChange={() => toggleFormat(f)}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active (start delivering on the next due date)
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ScheduledReportsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/reports/scheduled");
  const { rows: catalogue } = useList("/reports/catalogue");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function toggle(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/reports/scheduled/${id}`, {
        method: "PATCH",
        body: { active },
      });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete the scheduled report "${name}"?`)) return;
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/reports/scheduled/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Scheduled reports"
        description="Automated report delivery — pick a report, a cadence and recipients."
        action={
          <Button onClick={() => setCreateOpen(true)}>Schedule report</Button>
        }
      />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          hint="Schedule a report to have it delivered automatically."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Report</TH>
              <TH>Cadence</TH>
              <TH>Recipients</TH>
              <TH>Formats</TH>
              <TH>Next run</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.scheduled_report_id);
              const active = r.active !== false;
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.name)}</TD>
                  <TD className="text-sm">{cell(r.report_key)}</TD>
                  <TD className="text-sm">{cell(r.cadence)}</TD>
                  <TD className="text-sm">{cell(r.recipients)}</TD>
                  <TD className="text-sm">{cell(r.formats)}</TD>
                  <TD className="text-sm">{dateFmt(r.next_run_at)}</TD>
                  <TD className="text-sm">
                    <Pill tone={active ? "ok" : "mute"}>
                      {active ? "Active" : "Paused"}
                    </Pill>
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={active ? "outline" : "default"}
                        loading={rowBusy === id}
                        onClick={() => toggle(id, !active)}
                      >
                        {active ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        loading={rowBusy === id}
                        onClick={() => remove(id, String(r.name))}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ScheduleForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        catalogue={catalogue || []}
      />
    </section>
  );
}

/* ─────────────────────── API keys & integration secrets ─────────────────────── */

/* Generic tenant integration secrets, wired to /settings/integration_secret
 * (write-only; only last4 is ever returned). Domain-owned keys live on their own
 * screens and are hidden here: FX → Currencies & FX, SMTP → Comms →
 * Setup, AI providers → AI Control → Vendors. */
