/**
 * Office expenses (MOD-77) — review 16 Sep 2026 #37.
 *
 * The office's own running costs: rent, electricity, internet, stationery,
 * cleaning. Recorded as DRAFT rows by whoever holds the bill, then POSTED to
 * the GL as a separate act (Dr the row's expense account / Cr treasury or
 * cash) by someone with the approve grant — the same maker-checker split cash
 * requests carry. A draft is editable and deletable; a posted row is history
 * and is corrected by reversing its journal entry.
 *
 * The expense ACCOUNT is picked per row from the tenant's postable chart
 * rather than derived from the category — the category is an analytics label,
 * and no hardcoded category→account map survives a tenant renumbering its
 * chart (the '521' lesson, documented in finance-accounts.js).
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { RowActions } from "@/components/ui/row-actions";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useConfirm } from "@/components/ui/use-confirm";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, num, todayISO } from "@/lib/format";
import { enumLabel } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";

const shell = pageShell.wide;
const tone = (s?: string | null): Tone =>
  String(s).toUpperCase() === "POSTED" ? "ok" : "mute";

/* ── create / edit (drafts only — the service refuses edits after posting) ── */
function ExpenseForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.OfficeExpense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { opts: accounts } = useOptions(api.loadPostableAccounts, true);
  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "",
    category: row?.category ?? "RENT",
    label: row?.label ?? "",
    expense_date: row?.expense_date?.slice(0, 10) ?? todayISO(),
    amount: row?.amount != null ? String(row.amount) : "",
    expense_coa: row?.expense_coa ?? "",
    notes: row?.notes ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        category: f.category as api.OfficeExpenseCategory,
        label: f.label.trim(),
        expense_date: f.expense_date || undefined,
        amount: Number(f.amount),
        expense_coa: f.expense_coa,
        notes: f.notes.trim() || undefined,
      };
      if (isNew) {
        await api.createOfficeExpense({ ...body, entity_id: f.entity_id });
      } else {
        await api.updateOfficeExpense(row!.office_expense_id, body);
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
      title={isNew ? "New office expense" : "Edit office expense"}
      description="A running cost of the office itself — never attached to a client file."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Entity")} required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
              disabled={!isNew}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Category")} required>
            <Select
              value={f.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {api.OFFICE_EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Label")} required className="sm:col-span-2">
            <Input
              value={f.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Electricity — August, Akwa office"
            />
          </Field>
          <Field label={tr("Amount")} required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field label={tr("Expense date")}>
            <DateField
              value={f.expense_date}
              onChange={(iso) => set("expense_date", iso)}
            />
          </Field>
          <Field
            label={tr("Expense account")}
            required
            className="sm:col-span-2"
            hint={tr("The postable account this cost debits when posted — from your own chart, because categories are labels, not accounting decisions.")}
          >
            <Select
              value={f.expense_coa}
              onChange={(e) => set("expense_coa", e.target.value)}
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {optionLabel(a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Notes")} className="sm:col-span-2">
            <Input
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Invoice ref, meter number…"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={
            busy ||
            !(
              (isNew ? f.entity_id : true) &&
              f.label.trim() &&
              Number(f.amount) > 0 &&
              f.expense_coa
            )
          }
          onCancel={onClose}
          saveLabel={isNew ? "Record expense" : "Save changes"}
        />
      </form>
    </Modal>
  );
}

/* ── post to the GL ── */
function PostForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.OfficeExpense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    entry_date: row.expense_date?.slice(0, 10) || todayISO(),
    paid_via: "BANK" as "BANK" | "CASH",
    source_doc_ref: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.postOfficeExpense(row.office_expense_id, {
        entry_date: f.entry_date,
        paid_via: f.paid_via,
        source_doc_ref: f.source_doc_ref || undefined,
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
      title="Post to the ledger"
      description={`Dr ${row.expense_coa} / Cr treasury or cash — ${money(row.amount)}.`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Entry date")} required>
            <DateField
              value={f.entry_date}
              onChange={(iso) => setF((s) => ({ ...s, entry_date: iso }))}
            />
          </Field>
          <Field
            label={tr("Paid via")}
            hint={tr("Picks the credit side: the bank account or the cash box.")}
          >
            <Select
              value={f.paid_via}
              onChange={(e) =>
                setF((s) => ({
                  ...s,
                  paid_via: e.target.value as "BANK" | "CASH",
                }))
              }
            >
              <option value="BANK">{tr("Bank")}</option>
              <option value="CASH">{tr("Cash")}</option>
            </Select>
          </Field>
          <Field label={tr("Source doc ref")} className="sm:col-span-2">
            <Input
              value={f.source_doc_ref}
              onChange={(e) =>
                setF((s) => ({ ...s, source_doc_ref: e.target.value }))
              }
              placeholder="Supplier invoice / receipt number"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || !f.entry_date}
          onCancel={onClose}
          saveLabel="Post entry"
        />
      </form>
    </Modal>
  );
}

export function OfficeExpensesPage() {
  const { rows, error, loading, reload } =
    useList<api.OfficeExpense>("/office-expenses");
  const totals = useResource(() => api.officeExpenseTotals(), []);
  const [editing, setEditing] = React.useState<
    api.OfficeExpense | "new" | null
  >(null);
  const [posting, setPosting] = React.useState<api.OfficeExpense | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  async function removeDraft(r: api.OfficeExpense) {
    const ok = await confirm({
      title: tr("Delete this draft expense?"),
      body: `“${r.label}” — ${money(r.amount)}. Nothing has been posted, so deleting leaves no trace in the ledger.`,
      confirmLabel: tr("Delete draft"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteOfficeExpense(r.office_expense_id);
      reload();
      totals.reload();
    } catch {
      // A 409 here means it was posted since the list loaded — reload shows why.
      reload();
    }
  }

  const afterChange = () => {
    reload();
    totals.reload();
  };

  const columns: Column<api.OfficeExpense>[] = [
    {
      key: "label",
      label: "Expense",
      render: (r) => (
        <div>
          <span className="font-medium text-foreground">{r.label}</span>
          <span className="micro block">{enumLabel(r.category)}</span>
        </div>
      ),
    },
    {
      key: "expense_date",
      label: "Date",
      render: (r) => dateFmt(r.expense_date),
    },
    {
      key: "amount",
      label: "Amount",
      className: "num text-right",
      render: (r) => money(r.amount),
    },
    {
      key: "expense_coa",
      label: "Account",
      render: (r) => <span className="num">{r.expense_coa}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={tone(r.status)}>
          {r.status === "POSTED" ? tr("Posted") : tr("Draft")}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) =>
        r.status === "DRAFT" ? (
          <RowActions>
            <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPosting(r)}>
              Post
            </Button>
            <Button size="sm" variant="ghost" onClick={() => removeDraft(r)}>
              Delete
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <section className={shell}>
      {confirmDialog}
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title="Office expenses"
        description="Rent, utilities, supplies and the other costs of running the office itself — recorded here, never hung off a client file."
        action={
          <Button onClick={() => setEditing("new")}>New expense</Button>
        }
      />
      <KpiRow>
        <KpiTile
          label={tr("This month")}
          value={money(totals.data?.mtd ?? 0)}
        />
        <KpiTile label={tr("This year")} value={money(totals.data?.ytd ?? 0)} />
        <KpiTile
          label={tr("Awaiting posting")}
          value={num(totals.data?.draft_count ?? 0)}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.office_expense_id}
        empty={{
          title: "No office expenses yet",
          hint: "Record the rent, a utility bill or a supplies run — posting to the ledger is a separate step.",
        }}
      />
      {editing !== null && (
        <ExpenseForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={afterChange}
        />
      )}
      {posting && (
        <PostForm
          row={posting}
          onClose={() => setPosting(null)}
          onSaved={afterChange}
        />
      )}
    </section>
  );
}
