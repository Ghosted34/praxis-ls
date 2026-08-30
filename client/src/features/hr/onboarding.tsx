/**
 * Onboarding — checklists with dates and owners, and the templates they are
 * raised from (0703).
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * A list of strings and a tick box, retyped for every hire. Nothing could be
 * late, because nothing had a date. Nothing had an owner, so every item read as
 * the HR administrator's job while IT issued the laptop and Finance opened the
 * payroll record. And nothing raised one — hiring provisioned an employee row
 * and stopped, leaving the checklist to whoever remembered.
 *
 * ── THE TWO THINGS THIS SCREEN SAYS THAT THE OLD ONE COULD NOT ─────────────
 *
 * WHAT IS LATE. Overdue items are counted on the card and named in the drawer,
 * and the board sorts by them, so the checklist with a statutory registration
 * three days late is the first one you see rather than the one buried at
 * position nine.
 *
 * WHY COMPLETE IS REFUSED, BEFORE IT IS PRESSED. Mandatory items block
 * completion; the server names them. Showing the blockers up front matters
 * because a gate you discover by being rejected is a gate you work around.
 *
 * ── LAYOUT ─────────────────────────────────────────────────────────────────
 *
 * Desktop-first: the board is a three-up grid on a laptop and the drawer is a
 * tall modal that scrolls internally, so a twelve-item checklist is read
 * without the page growing. Templates live behind a toggle on the same screen
 * rather than a new route — they are the same subject, and a separate tab would
 * mean leaving the checklist you were looking at to see the list it came from.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { EmployeePicker } from "@/components/employee-picker";
import { useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { reportActionError } from "@/lib/action-error";
import { usePrompt } from "@/components/ui/use-prompt";

/** Five states, not a boolean `is_late`. DUE_SOON is the only one where acting
 *  now still prevents lateness, and UNDATED is its own thing — an item nobody
 *  dated never appears in a chase list, so it must be visible AS undated rather
 *  than silently filed under fine. */
const STATE_TONE: Record<string, Tone> = {
  DONE: "ok",
  OVERDUE: "bad",
  DUE_SOON: "warn",
  PENDING: "mute",
  UNDATED: "orange",
};
const STATE_LABEL: Record<string, string> = {
  DONE: "Done",
  OVERDUE: "Overdue",
  DUE_SOON: "Due soon",
  PENDING: "Scheduled",
  UNDATED: "No date",
};

/** "day -7" reads as nothing to most people; "7 days before they start" reads
 *  as a plan. The template stores the offset; this is how it is spoken. */
function offsetLabel(days: number): string {
  const n = Number(days) || 0;
  if (n === 0) return "First day";
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} before`;
  return `Day ${n}`;
}

/* ══ New checklist ═════════════════════════════════════════════════════════ */

function NewChecklistForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const templates = useResource(() => api.listOnboardingTemplates(), []);
  const [employeeId, setEmployeeId] = React.useState("");
  const [employeeName, setEmployeeName] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [startsOn, setStartsOn] = React.useState(todayISO());
  const [itemsText, setItemsText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tpl = (templates.data || []).find((t) => t.onboarding_template_id === templateId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createChecklist({
        employee_id: employeeId || undefined,
        template_id: templateId || undefined,
        starts_on: startsOn || null,
        items: itemsText.split("\n").map((x) => x.trim()).filter(Boolean),
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
      title="New onboarding checklist"
      description="Pick a template and a start date — every due date is worked out from it."
    >
      <form className="space-y-4" onSubmit={submit}>
        {/* Was a <Select> over an unpaginated /employees call the API caps at 50
            rows, so the fifty-first employee onwards could not be given a
            checklist at all. */}
        <EmployeePicker
          id="onboarding-employee"
          label={employeeName ? `Employee — ${employeeName}` : "Employee"}
          onPick={(e) => {
            setEmployeeId(e.employee_id);
            setEmployeeName(e.full_name || e.employee_id);
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template" hint="Leave blank to build the list by hand.">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">— none —</option>
              {(templates.data || []).map((t) => (
                <option key={t.onboarding_template_id} value={t.onboarding_template_id}>
                  {t.name} ({t.item_count ?? 0} items)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" hint="Every due date is an offset from this.">
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
        </div>
        {tpl && !startsOn && (
          <Callout tone="warn" title="No start date">
            The template's items will be raised without dates, so nothing can be
            chased. Set a start date, or reschedule the checklist later.
          </Callout>
        )}
        <Field label="Extra steps" hint="One per line. Optional — for anything the template does not cover.">
          <textarea
            className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
            rows={3}
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ══ One checklist ═════════════════════════════════════════════════════════ */

function ChecklistDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useResource(() => api.getChecklist(id), [id]);
  const [newItem, setNewItem] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [prompt, promptDialog] = usePrompt();
  const c = detail.data;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      detail.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={c?.employee_name ? `Onboarding · ${c.employee_name}` : "Onboarding checklist"}
      description={
        c
          ? `${c.progress.done}/${c.progress.total} done${c.starts_on ? ` · starts ${dateFmt(c.starts_on)}` : ""}${c.template_name ? ` · ${c.template_name}` : ""}`
          : undefined
      }
    >
      {promptDialog}
      {detail.error ? (
        <ErrorState message={detail.error} />
      ) : !c ? (
        <LoadingRow />
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          {c.progress.overdue > 0 && (
            <Callout tone="bad" title={`${c.progress.overdue} item${c.progress.overdue === 1 ? "" : "s"} overdue`}>
              Past their date and not done.
            </Callout>
          )}
          {/* The refusal, stated before the button is pressed. */}
          {c.blockers.length > 0 && c.status !== "COMPLETED" && (
            <Callout tone="warn" title="Cannot be completed yet">
              These must be done first: {c.blockers.map((b) => b.label).join("; ")}.
            </Callout>
          )}

          <div className="space-y-1.5">
            {c.items.length === 0 ? (
              <p className="micro">No items yet — add the first step below.</p>
            ) : (
              c.items.map((item) => (
                <div
                  key={item.onboarding_item_id}
                  className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!item.is_done}
                    aria-label={item.label}
                    disabled={busy === item.onboarding_item_id || c.status === "COMPLETED"}
                    onChange={() =>
                      run(item.onboarding_item_id, () =>
                        api.updateChecklistItem(item.onboarding_item_id, { is_done: !item.is_done }),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={item.is_done ? "text-muted-foreground line-through" : "text-foreground"}>
                        {item.label}
                      </span>
                      {item.is_mandatory && <Pill tone="orange">Required</Pill>}
                      {item.state && item.state !== "DONE" && (
                        <Pill tone={STATE_TONE[item.state] || "mute"}>{STATE_LABEL[item.state]}</Pill>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.due_on ? `Due ${dateFmt(item.due_on)}` : "No date"}
                      {item.owner_role ? ` · ${item.owner_role}` : ""}
                      {item.sop_title ? ` · ${item.sop_title}` : ""}
                      {/* Who ticked it. `done_at` records that it happened and
                          not who, and for a statutory registration that is the
                          question asked afterwards. */}
                      {item.is_done && item.done_by_name ? ` · done by ${item.done_by_name}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {c.status !== "COMPLETED" && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newItem.trim()) return;
                run("add", async () => {
                  await api.addChecklistItem(id, { label: newItem.trim() });
                  setNewItem("");
                });
              }}
            >
              <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step…" />
              <Button type="submit" loading={busy === "add"} disabled={!newItem.trim()}>
                Add
              </Button>
            </form>
          )}

          {error && <ErrorState message={error} />}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Pill tone={c.status === "COMPLETED" ? "ok" : "warn"}>
              {c.status === "COMPLETED" ? "Completed" : "In progress"}
            </Pill>
            {c.status !== "COMPLETED" && (
              <div className="flex gap-2">
                {/* Rescheduling is an ACT: silently re-dating a checklist
                    somebody is working through turns a task they did yesterday
                    into one that is overdue tomorrow. */}
                {c.onboarding_template_id && (
                  <Button
                    variant="outline"
                    loading={busy === "resched"}
                    onClick={() => {
                      // Was a text prompt asking the user to type YYYY-MM-DD.
                      // `type: "date"` gives the platform date picker and makes
                      // the format the control's problem rather than a person's.
                      void (async () => {
                        const next = await prompt({
                          title: "Change the start date",
                          description:
                            "Every task in the checklist shifts to keep its offset from day one.",
                          label: "New start date",
                          type: "date",
                          defaultValue: c.starts_on || todayISO(),
                          confirmLabel: "Reschedule checklist",
                          validate: (v) =>
                            /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "Pick a date.",
                        });
                        if (next) run("resched", () => api.rescheduleChecklist(id, next));
                      })();
                    }}
                  >
                    Change start date
                  </Button>
                )}
                <Button
                  variant="outline"
                  loading={busy === "complete"}
                  disabled={c.blockers.length > 0}
                  onClick={() =>
                    run("complete", () => api.completeChecklist(id)).catch(reportActionError)
                  }
                >
                  Mark complete
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ══ Templates ═════════════════════════════════════════════════════════════ */

function TemplateDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useResource(() => api.getOnboardingTemplate(id), [id]);
  const [f, setF] = React.useState({ label: "", due_days: "0", owner_role: "", is_mandatory: false });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const t = detail.data;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      detail.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t?.name || "Template"}
      description={
        t
          ? [t.department, t.job_title].filter(Boolean).join(" · ") || "Applies to every new hire"
          : undefined
      }
    >
      {detail.error ? (
        <ErrorState message={detail.error} />
      ) : !t ? (
        <LoadingRow />
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          {!t.is_active && (
            <Callout tone="info" title="Not active">
              Inactive templates are never picked when a hire is onboarded. Turn
              it on once the owner roles match your own org chart.
            </Callout>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              loading={busy === "toggle"}
              onClick={() => run("toggle", () => api.updateOnboardingTemplate(id, { is_active: !t.is_active }))}
            >
              {t.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>

          <div className="space-y-1.5">
            {t.items.length === 0 ? (
              <p className="micro">No steps yet.</p>
            ) : (
              t.items.map((i) => (
                <div key={i.onboarding_template_item_id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground">{i.label}</span>
                      {i.is_mandatory && <Pill tone="orange">Required</Pill>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {offsetLabel(i.due_days)}
                      {i.owner_role ? ` · ${i.owner_role}` : ""}
                      {i.sop_title ? ` · ${i.sop_title}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === i.onboarding_template_item_id}
                    onClick={() =>
                      run(i.onboarding_template_item_id, () =>
                        api.removeOnboardingTemplateItem(i.onboarding_template_item_id),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>

          <form
            className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!f.label.trim()) return;
              run("add", async () => {
                await api.addOnboardingTemplateItem(id, {
                  label: f.label.trim(),
                  due_days: Number(f.due_days) || 0,
                  owner_role: f.owner_role || null,
                  is_mandatory: f.is_mandatory,
                });
                setF({ label: "", due_days: "0", owner_role: "", is_mandatory: false });
              });
            }}
          >
            <Field label="Step">
              <Input value={f.label} onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))} />
            </Field>
            <Field label="Day" hint="Negative = before">
              <Input
                type="number"
                className="num text-right"
                value={f.due_days}
                onChange={(e) => setF((s) => ({ ...s, due_days: e.target.value }))}
              />
            </Field>
            <Field label="Owner role">
              <Input
                value={f.owner_role}
                placeholder="HR, IT, Finance…"
                onChange={(e) => setF((s) => ({ ...s, owner_role: e.target.value }))}
              />
            </Field>
            <div className="flex items-center gap-3 pb-2">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={f.is_mandatory}
                  onChange={(e) => setF((s) => ({ ...s, is_mandatory: e.target.checked }))}
                />
                Required
              </label>
              <Button type="submit" size="sm" loading={busy === "add"} disabled={!f.label.trim()}>
                Add
              </Button>
            </div>
          </form>
          {error && <ErrorState message={error} />}
        </div>
      )}
    </Modal>
  );
}

function NewTemplateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: "", department: "", job_title: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="New onboarding template"
      description="Leave department and job title blank to cover every new hire."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.createOnboardingTemplate({
              name: f.name,
              department: f.department || null,
              job_title: f.job_title || null,
              // Created inactive: a template that starts raising real checklists
              // against real people the moment it is saved changes somebody's
              // week before anybody has read it.
              is_active: false,
            });
            onSaved();
            onClose();
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name" required>
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Warehouse new starter" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <Input value={f.department} onChange={(e) => setF((s) => ({ ...s, department: e.target.value }))} />
          </Field>
          <Field label="Job title">
            <Input value={f.job_title} onChange={(e) => setF((s) => ({ ...s, job_title: e.target.value }))} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Created inactive. Add its steps, then activate it — the most specific
          matching template wins when somebody is hired.
        </p>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.name || busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ══ The view ══════════════════════════════════════════════════════════════ */

export function OnboardingView() {
  const board = useResource(() => api.listChecklists(), []);
  const templates = useResource(() => api.listOnboardingTemplates(true), []);
  const [tab, setTab] = React.useState<"checklists" | "templates">("checklists");
  const [creating, setCreating] = React.useState(false);
  const [newTemplate, setNewTemplate] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [openTemplate, setOpenTemplate] = React.useState<string | null>(null);

  const list = board.data || [];
  const openCount = list.filter((c) => c.status !== "COMPLETED").length;
  const overdue = list.reduce((a, c) => a + (c.overdue_items || 0), 0);

  return (
    <>
      <KpiRow>
        <KpiTile label="Checklists" value={num(list.length)} />
        <KpiTile label="In progress" value={num(openCount)} />
        {/* The number nobody could see before. It is what turns a set of
            checklists into a queue somebody works. */}
        <KpiTile label="Overdue items" value={num(overdue)} />
        <KpiTile label="Completed" value={num(list.length - openCount)} />
      </KpiRow>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={cn("chip", tab === "checklists" && "on")} onClick={() => setTab("checklists")}>
            Checklists
          </button>
          <button type="button" className={cn("chip", tab === "templates" && "on")} onClick={() => setTab("templates")}>
            Templates
          </button>
        </div>
        <Button onClick={() => (tab === "templates" ? setNewTemplate(true) : setCreating(true))}>
          {tab === "templates" ? "New template" : "New checklist"}
        </Button>
      </div>

      {tab === "templates" ? (
        templates.error ? (
          <ErrorState message={templates.error} />
        ) : (templates.data || []).length === 0 ? (
          <EmptyState
            title="No onboarding templates"
            hint="A template states what every new hire is asked to do, with each step dated from their start day. Without one, every checklist is retyped and the step somebody forgets is the one that gets missed."
            action={<Button onClick={() => setNewTemplate(true)}>New template</Button>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(templates.data || []).map((t) => (
              <button
                key={t.onboarding_template_id}
                onClick={() => setOpenTemplate(t.onboarding_template_id)}
                className="lux-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] hover:shadow-[var(--shadow-m)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground">{t.name}</div>
                  <Pill tone={t.is_active ? "ok" : "mute"}>{t.is_active ? "Active" : "Inactive"}</Pill>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {[t.department, t.job_title].filter(Boolean).join(" · ") || "Every new hire"}
                </p>
                <p className="mt-1 num text-xs text-muted-foreground">{t.item_count ?? 0} steps</p>
              </button>
            ))}
          </div>
        )
      ) : board.error ? (
        <ErrorState message={board.error} />
      ) : list.length === 0 ? (
        <EmptyState title="No onboarding checklists" hint="Start a checklist for a new hire, or hire an applicant — one is raised automatically." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const pct = c.total_items ? Math.round((c.done_items / c.total_items) * 100) : 0;
            return (
              <button
                key={c.onboarding_checklist_id}
                onClick={() => setOpenId(c.onboarding_checklist_id)}
                className="lux-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] hover:shadow-[var(--shadow-m)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{c.employee_name || "Unassigned"}</div>
                    {c.starts_on && <p className="num text-xs text-muted-foreground">Starts {dateFmt(c.starts_on)}</p>}
                  </div>
                  {c.overdue_items ? (
                    <Pill tone="bad">{c.overdue_items} overdue</Pill>
                  ) : (
                    <Pill tone={c.status === "COMPLETED" ? "ok" : "warn"}>
                      {c.status === "COMPLETED" ? "Completed" : "In progress"}
                    </Pill>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-1.5 flex-1 rounded-full bg-[rgb(var(--ink)/0.08)]">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="num text-xs text-muted-foreground">
                    {c.done_items}/{c.total_items}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {creating && <NewChecklistForm onClose={() => setCreating(false)} onSaved={board.reload} />}
      {newTemplate && <NewTemplateForm onClose={() => setNewTemplate(false)} onSaved={templates.reload} />}
      {openId && <ChecklistDrawer id={openId} onClose={() => setOpenId(null)} onChanged={board.reload} />}
      {openTemplate && (
        <TemplateDrawer id={openTemplate} onClose={() => setOpenTemplate(null)} onChanged={templates.reload} />
      )}
    </>
  );
}

export default OnboardingView;
