/**
 * Contracts — lifecycle workstation (replaces the CRUD table). Issue a contract
 * to an employee and move it DRAFT → ISSUED → SIGNED → ENDED. A signed/ended
 * contract is terminal for forward flow.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { ContractEditor } from "./contract-editor";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { groupContracts, type ContractGroup } from "./contracts-grouping";

const shell = pageShell.wide;
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  ISSUED: "blue",
  SIGNED: "ok",
  ENDED: "mute",
};
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["SIGNED", "ENDED"],
  SIGNED: ["ENDED"],
  ENDED: [],
};
const STATUS_LABEL: Record<string, string> = {
  ISSUED: "Issue",
  SIGNED: "Mark signed",
  ENDED: "End",
};
const KIND_LABEL: Record<string, string> = {
  OFFER_LETTER: "Offer letter",
  EMPLOYMENT: "Employment",
  CONFIRMATION: "Confirmation",
  TERMINATION: "Termination",
};

function NewContractForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: employees } = useList<{
    employee_id: string;
    full_name?: string;
  }>("/employees");
  const [f, setF] = React.useState({
    employee_id: "",
    kind: "EMPLOYMENT",
    effective_on: "",
    end_on: "",
    email: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const created = await api.createContract({
        employee_id: f.employee_id || undefined,
        kind: f.kind,
        effective_on: f.effective_on || undefined,
        end_on: f.end_on || undefined,
      });
      // Draft the contract from the template and email it to the employee.
      if (f.email.trim() && created.hr_contract_id) {
        try {
          await api.sendContract(created.hr_contract_id, f.email.trim());
        } catch (sendErr) {
          setNote(`Contract created, but the email failed: ${errMsg(sendErr)}`);
        }
      }
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
      title="New contract"
      description="Draft a contract for an employee. It starts in draft."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Employee")} required>
          <Select
            value={f.employee_id}
            onChange={(e) => set("employee_id", e.target.value)}
          >
            <option value="">—</option>
            {(employees || []).map((d) => (
              <option key={d.employee_id} value={d.employee_id}>
                {d.full_name || d.employee_id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Kind")} required>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="OFFER_LETTER">Offer letter</option>
            <option value="EMPLOYMENT">Employment</option>
            <option value="CONFIRMATION">Confirmation</option>
            <option value="TERMINATION">{tr("Termination")}</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Effective on">
            <Input
              type="date"
              value={f.effective_on}
              onChange={(e) => set("effective_on", e.target.value)}
            />
          </Field>
          <Field label="Ends on">
            <Input
              type="date"
              value={f.end_on}
              onChange={(e) => set("end_on", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Email contract to (optional)">
          <Input
            type="email"
            placeholder="employee@company.cm"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        {note && (
          <div className="rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-3 py-2 text-sm">
            {note}
          </div>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!f.employee_id || busy}
          >
            {f.email.trim() ? "Create & send" : "Create draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/** Upload an already-signed contract PDF and tie it to the contract row. */
export function UploadSigned({
  contract,
  onDone,
}: {
  contract: api.Contract;
  onDone: () => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadContractSigned(
        contract.hr_contract_id,
        await readAsDataUrl(file),
      );
      onDone();
    } catch (err) {
      window.alert(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={pick}
      />
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={() => ref.current?.click()}
      >
        {contract.pdf_vault_id ? "Replace signed" : "Upload signed"}
      </Button>
    </>
  );
}

/**
 * What lapses soon.
 *
 * A fixed term that expires unnoticed is an employee working without a
 * contract; a probation that passes unnoticed is a confirmation nobody made —
 * and in most jurisdictions silence confirms them, so the deadline the employer
 * needed to act before goes by and the decision is made by default. Neither was
 * visible anywhere until 0700, because nothing had ever read `end_on`.
 *
 * Rendered as a strip rather than a table: it is a prompt to act, and it should
 * cost no vertical space at all on the common day when nothing is lapsing.
 */
function LapsingPanel({
  data,
  rows,
  onOpen,
}: {
  data: { expiring: api.LapsingContract[]; probation: api.LapsingContract[] } | null;
  rows: api.Contract[] | null;
  onOpen: (c: api.Contract) => void;
}) {
  if (!data) return null;
  const items = [
    ...data.probation.map((l) => ({ ...l, what: "probation ends" as const })),
    ...data.expiring.map((l) => ({ ...l, what: "expires" as const })),
  ].sort((a, b) => a.days_left - b.days_left);
  if (!items.length) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {items.slice(0, 6).map((l) => {
        const full = (rows || []).find((r) => r.hr_contract_id === l.hr_contract_id);
        return (
          <div
            key={`${l.hr_contract_id}-${l.what}`}
            className="lux-card flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm"
          >
            <span>
              <span className="font-medium text-foreground">{l.employee_name || "—"}</span>{" "}
              <span className="text-muted-foreground">
                — {l.what} {dateFmt(l.what === "expires" ? l.end_on : l.probation_ends_on)}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <Pill tone={l.days_left <= 7 ? "bad" : "warn"}>
                {l.days_left === 0 ? "today" : `${l.days_left} day(s)`}
              </Pill>
              {full && (
                <Button size="sm" variant="outline" onClick={() => onOpen(full)}>
                  Open
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {items.length > 6 && (
        <p className="text-xs text-muted-foreground">
          …and {items.length - 6} more in the next 60 days.
        </p>
      )}
    </div>
  );
}

export function ContractsPage() {
  const rows = useResource(() => api.listContracts(), []);
  // The two dates nothing has ever read (0700). Asked for once, above the
  // table, because "six contracts lapse this month" is the thing somebody
  // opening this screen most needs to know and it was previously unanswerable.
  const lapsing = useResource(() => api.lapsingContracts(60), []);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<api.Contract | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [renewing, setRenewing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());

  const groups = React.useMemo(() => groupContracts(rows.data), [rows.data]);
  /** Which group each contract belongs to, and whether it is a superseded
   *  term — the two things the cell renderers need and a row does not carry. */
  const meta = React.useMemo(() => {
    const m = new Map<string, { group: ContractGroup; isHistory: boolean }>();
    for (const g of groups) {
      m.set(g.head.hr_contract_id, { group: g, isHistory: false });
      for (const h of g.history) m.set(h.hr_contract_id, { group: g, isHistory: true });
    }
    return m;
  }, [groups]);
  /** Head rows, each followed by its earlier terms while the row is open. */
  const visible = React.useMemo(
    () =>
      groups.flatMap((g) =>
        open.has(g.key) ? [g.head, ...g.history] : [g.head],
      ),
    [groups, open],
  );
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  async function toStatus(c: api.Contract, status: string) {
    setBusy(c.hr_contract_id + status);
    setError(null);
    try {
      await api.setContractStatus(c.hr_contract_id, status);
      rows.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Renewal (10708). A NEW draft contract supersedes this one — terms carried,
   * dates defaulting to the day after the term ends, same length. The editor
   * opens on the new DRAFT so the text can be drafted against the new dates
   * (the signed wording is never copied: it carries the old dates).
   */
  async function renew(c: api.Contract) {
    setRenewing(c.hr_contract_id);
    setError(null);
    try {
      const renewed = await api.renewContract(c.hr_contract_id);
      rows.reload();
      lapsing.reload();
      setEditing(renewed);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRenewing(null);
    }
  }

  const cols: Column<api.Contract>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (c) => {
        const m = meta.get(c.hr_contract_id);
        if (m?.isHistory)
          return (
            <span className="flex items-center gap-2 pl-4 text-muted-foreground">
              <span aria-hidden>↳</span>
              <span>{tr("Earlier term")}</span>
              {c.doc_number && <span className="num text-xs">{c.doc_number}</span>}
            </span>
          );
        const earlier = m?.group.history.length || 0;
        const isOpen = m ? open.has(m.group.key) : false;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <span className="font-medium text-foreground">
              {c.employee_name || "—"}
            </span>
            {earlier > 0 && m && (
              <button
                type="button"
                onClick={() => toggle(m.group.key)}
                aria-expanded={isOpen}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {isOpen ? tr("Hide") : tr("Show")} {earlier}{" "}
                {earlier === 1 ? tr("earlier term") : tr("earlier terms")}
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: "kind",
      label: "Kind",
      render: (c) => (
        <span className="text-muted-foreground">
          {KIND_LABEL[c.kind || ""] || enumLabel(c.kind)}
        </span>
      ),
    },
    {
      key: "eff",
      label: "Effective",
      render: (c) => (
        <span className="num text-muted-foreground">
          {dateFmt(c.effective_on)}
        </span>
      ),
    },
    {
      key: "end",
      label: "Ends",
      render: (c) => (
        <span className="num text-muted-foreground">{dateFmt(c.end_on)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (c) => (
        <Pill tone={STATUS_TONE[c.status] || "mute"}>
          {enumLabel(c.status)}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (c) => (
        <div className="flex items-center justify-end gap-2">
          {c.pdf_vault_id && <Pill tone="ok">Signed on file</Pill>}
          <DocButton
            docType="EMPLOYMENT_CONTRACT"
            id={c.hr_contract_id}
            title={
              c.employee_name || `Contract ${c.hr_contract_id.slice(0, 8)}`
            }
            label={tr("View")}
          />
          <UploadSigned contract={c} onDone={rows.reload} />
          {/* A draft has no agreed term to renew; anything past it does. */}
          {c.status !== "DRAFT" && (
            <Button
              size="sm"
              variant="outline"
              loading={renewing === c.hr_contract_id}
              disabled={!!renewing || !!busy}
              onClick={() => renew(c)}
            >
              Renew
            </Button>
          )}
          <TransitionButtons
            items={(TRANSITIONS[c.status] || []).map((s) => ({
              to: s,
              label: STATUS_LABEL[s] || s,
              variant: s === "ENDED" ? "outline" : "default",
              loading: busy === c.hr_contract_id + s,
            }))}
            onTransition={(s) => toStatus(c, s)}
          />
        </div>
      ),
    },
    {
      key: "_edit",
      label: "",
      /* Two different jobs behind one button.
       *
       * On a DRAFT it opens the TEXT — the thing that decides whether the
       * printed PDF has any clauses in it. Past that the wording is fixed, but
       * the TERMS are not: every contract signed before this existed has no
       * notice period and no probation date on the row, and recording what the
       * signed paper says is what puts it in front of the expiry watcher. */
      render: (c) => (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
            {c.status !== "DRAFT" ? "Record terms" : c.body_md ? "Edit text" : "Draft text"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title={tr("Contracts")}
        description="Issue and progress employee contracts through their lifecycle."
        action={<Button onClick={() => setCreating(true)}>New contract</Button>}
      />
      <HubTabs />{" "}
      <LapsingPanel data={lapsing.data} onOpen={setEditing} rows={rows.data} />
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      <DataList
        columns={cols}
        rows={rows.data === null ? null : visible}
        error={rows.error}
        loading={rows.loading}
        rowKey={(c) => c.hr_contract_id}
        empty={{
          title: "No contracts",
          hint: "Draft a contract to get started.",
        }}
      />
      {creating && (
        <NewContractForm
          onClose={() => setCreating(false)}
          onSaved={rows.reload}
        />
      )}
      {editing && (
        <ContractEditor
          contract={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            rows.reload();
            lapsing.reload();
          }}
        />
      )}
      <ScreenAi path="hr/contracts" />
    </section>
  );
}

export default ContractsPage;
