/**
 * Journals — post a manual journal entry, and reverse a posted one.
 *
 * Split out of the 2,581-line `features/finance/pages.tsx` in Phase 3 (audit F7:
 * that file held 34 components behind 4 exports, so nothing inside it was
 * reachable, testable or reusable — a sibling screen needing the same
 * journal-line editor had to copy it).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { dateFmt, amount, smartCell } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { cn } from "@/lib/cn";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Form, FormField, FormError } from "@/components/ui/form";
import { useZodForm } from "@/lib/use-zod-form";
import { useFieldArray } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { XIcon } from "@/components/ui/icons";
import { journalEntry, ledger } from "@shared";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";

/**
 * Post a journal entry — the first form on `<Form>` + a shared schema.
 *
 * WHY THIS ONE FIRST. F12 names it: *"the client re-implements validation as
 * ad-hoc booleans (e.g. `finance/pages.tsx:141`'s `canSubmit`)"*. The version
 * this replaces was that, and it was not merely duplicated — it was WRONG, in
 * three ways an operator felt:
 *
 *     const linesValid = lines.every((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0));
 *
 *   1. `||` accepts a line with BOTH sides filled. The ledger requires exactly
 *      one (KB §23.2). The form said "Balanced", Post was enabled, and the
 *      server returned LINE_ONE_SIDE.
 *   2. Nothing checked the two-decimal limit, so `33.333` sailed through the
 *      form and came back INVALID_AMOUNT.
 *   3. Nothing checked §23.6 — an account debited AND credited in one entry —
 *      which comes back COMPENSATION.
 *
 * A form that asserts an entry is postable and is then refused is worse than one
 * that says nothing: it teaches the operator not to trust it.
 *
 * WHAT IT USES NOW. `journalEntry.post` from `@praxis/shared` is the SAME object
 * the Express validator parses with, so shape cannot drift. The posting
 * INVARIANTS come from `ledger.checkPostable` — the same functions
 * `journal_entry.rules.js` calls — because they carry their own API error codes
 * and belong in a rules module rather than a `.refine()`. See
 * packages/shared/rules/ledger.js for that distinction.
 */
type LineRow = { account_code: string; debit: string; credit: string };
const blankLine = (): LineRow => ({ account_code: "", debit: "", credit: "" });

function JournalEntryForm({
  open,
  onClose,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const { opts: accounts } = useOptions(fin.loadPostableAccounts, open);
  const toast = useToast();

  const form = useZodForm(journalEntry.post, {
    defaultValues: {
      entity_id: "",
      journal_code: "",
      entry_date: fin.today(),
      description: "",
      source_doc_ref: "",
      validate: false,
      lines: [blankLine(), blankLine()],
    },
  });
  const lineFields = useFieldArray({ control: form.control, name: "lines" });

  // Re-arm on each open. `reset()` rather than a pile of setters — one call, and
  // it clears the touched/dirty/error state the setters used to leave behind.
  const { reset } = form;
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  /**
   * The ledger's answer, live. Watching `lines` re-runs this as the operator
   * types, so the disabled Post button and the message under the totals always
   * agree with what the server will actually do.
   */
  const lines = form.watch("lines");
  const proposed = (lines ?? []) as ledger.ProposedLine[];
  const postable = ledger.checkPostable(proposed);
  const { debitMinor, creditMinor } = ledger.totals(proposed);
  const validate = form.watch("validate");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post journal entry"
      description="Balanced-or-rejected. Validating locks the entry (reversal-not-edit)."
      size="xl"
    >
      <Form
        form={form}
        className="space-y-4"
        onSubmit={async (values) => {
          // `values` is the SCHEMA'S OUTPUT: debit/credit are already numbers,
          // the date is round-trip validated, and an empty side is `undefined` —
          // which is why the hand-rolled payload builder is gone.
          await fin.postJournalEntry(
            values as Parameters<typeof fin.postJournalEntry>[0],
          );
          toast.success(
            values.validate ? "Entry validated and posted" : "Draft saved",
          );
          onPosted();
          onClose();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField form={form} name="entity_id" label="Entity" required>
            {(field) => (
              <Select {...field} value={String(field.value ?? "")}>
                <option value="">Select entity…</option>
                {entities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {optionLabel(o)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField
            form={form}
            name="journal_code"
            label="Journal"
            required
            hint="OHADA journal code (e.g. VT, AC, BQ, PAIE, OD)."
          >
            {(field) => (
              <>
                <Input
                  list="journal-codes"
                  {...field}
                  value={String(field.value ?? "")}
                  placeholder="VT"
                />
                <datalist id="journal-codes">
                  <option value="VT">Ventes</option>
                  <option value="AC">Achats</option>
                  <option value="BQ">Banque</option>
                  <option value="PAIE">Paie</option>
                  <option value="OD">Opérations diverses</option>
                </datalist>
              </>
            )}
          </FormField>
          <FormField form={form} name="entry_date" label="Entry date" required>
            {(field) => (
              <Input type="date" {...field} value={String(field.value ?? "")} />
            )}
          </FormField>
          <FormField
            form={form}
            name="source_doc_ref"
            label="Source document ref"
            required
            hint="Mandatory — the ledger rejects entries without a source ref."
          >
            {(field) => (
              <Input
                {...field}
                value={String(field.value ?? "")}
                placeholder="INV-2026-0001"
              />
            )}
          </FormField>
        </div>
        <FormField form={form} name="description" label="Description">
          {(field) => (
            <Input
              {...field}
              value={String(field.value ?? "")}
              placeholder="Narrative (optional)"
            />
          )}
        </FormField>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Lines</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => lineFields.append(blankLine())}
            >
              Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lineFields.fields.map((f, i) => (
              <div
                key={f.id}
                className={cn(
                  "grid grid-cols-[1fr_7rem_7rem_auto] items-start gap-2 rounded-md",
                  // The offending line, marked. `checkPostable` reports the FIRST
                  // problem and which line it is on, so the operator is pointed
                  // at one thing rather than handed a list.
                  !postable.ok &&
                    postable.line === i &&
                    "ring-1 ring-[rgb(var(--bad))]",
                )}
              >
                <FormField
                  form={form}
                  name={`lines.${i}.account_code`}
                  label={`Account, line ${i + 1}`}
                  className="[&>label]:sr-only"
                >
                  {(field) => (
                    <Select {...field} value={String(field.value ?? "")}>
                      <option value="">Account…</option>
                      {accounts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  form={form}
                  name={`lines.${i}.debit`}
                  label={`Debit, line ${i + 1}`}
                  className="[&>label]:sr-only"
                >
                  {(field) => (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num text-right"
                      placeholder="Debit"
                      {...field}
                      value={String(field.value ?? "")}
                    />
                  )}
                </FormField>
                <FormField
                  form={form}
                  name={`lines.${i}.credit`}
                  label={`Credit, line ${i + 1}`}
                  className="[&>label]:sr-only"
                >
                  {(field) => (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num text-right"
                      placeholder="Credit"
                      {...field}
                      value={String(field.value ?? "")}
                    />
                  )}
                </FormField>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={lineFields.fields.length <= 2}
                  onClick={() => lineFields.remove(i)}
                  aria-label={`Remove line ${i + 1}`}
                >
                  <XIcon width={16} height={16} />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-sm">
            {/*
              The ledger's own words, live. This used to say "Balanced" or "Out
              of balance by X" and knew about nothing else; it now reports
              whichever invariant is actually unmet, in the same sentence the API
              would have returned.
            */}
            <span
              role="status"
              className={
                postable.ok
                  ? "text-muted-foreground"
                  : "font-medium text-[rgb(var(--bad))]"
              }
            >
              {postable.ok ? "Balanced" : postable.message}
            </span>
            <span className="num tabular-nums text-muted-foreground">
              Dr {amount(debitMinor / 100)} &nbsp;·&nbsp; Cr{" "}
              {amount(creditMinor / 100)}
            </span>
          </div>
        </div>

        <FormField
          form={form}
          name="validate"
          label="Validate immediately (locks the entry; otherwise saved as a draft)"
        >
          {(field) => (
            <Checkbox
              checked={!!field.value}
              onCheckedChange={field.onChange}
              label={<span className="sr-only">Validate immediately</span>}
            />
          )}
        </FormField>

        <FormError form={form} />

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
          {/*
            Disabled on the LEDGER's answer, not on a local approximation. The
            schema's own errors are raised by <Form> on submit; this gate is the
            domain invariant, which Zod deliberately does not carry.
          */}
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            disabled={!postable.ok || form.formState.isSubmitting}
          >
            {validate ? "Validate & post" : "Save draft"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

function JournalReverseForm({
  entry,
  onClose,
  onReversed,
}: {
  entry: Record<string, unknown> | null;
  onClose: () => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(fin.today());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!entry) return;
    setReason("");
    setEntryDate(fin.today());
    setError(null);
  }, [entry]);

  const id = entry ? String(entry.entry_id ?? entry.id ?? "") : "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.reverseJournalEntry(id, {
        reason: reason || undefined,
        entry_date: entryDate || undefined,
      });
      onReversed();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const label = entry
    ? String(entry.description ?? entry.source_doc_ref ?? id)
    : "";

  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title="Reverse entry"
      description="Posts a linked contra entry (reversal-not-edit); the original stays immutable."
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reversing <span className="font-medium text-foreground">{label}</span>
          .
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Reversal date"
            required
            hint="Date the contra entry posts on."
          >
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </Field>
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why it's being reversed"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            loading={busy}
            disabled={!id || !entryDate || busy}
          >
            Reverse entry
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const JOURNAL_COLS = [
  { key: "entry_no", label: "No." },
  { key: "entry_date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "source_doc_ref", label: "Source ref" },
  { key: "status", label: "Status" },
];

export function JournalsPage() {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [postOpen, setPostOpen] = React.useState(false);
  const [reverseTarget, setReverseTarget] = React.useState<Record<
    string,
    unknown
  > | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>("/journal-entries")
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403)
          setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const isValidated = (r: Record<string, unknown>) =>
    String(r.status ?? "").toLowerCase() === "validated";
  const isReversal = (r: Record<string, unknown>) => !!r.corrects_entry_id;

  const list = rows ?? [];
  const columns: Column<Record<string, unknown>>[] = [
    ...JOURNAL_COLS.map((c): Column<Record<string, unknown>> => ({
      key: c.key,
      label: c.label,
      render: (r) => (
        <span className="text-sm">
          {c.key === "entry_date"
            ? dateFmt(r[c.key] as string)
            : smartCell(r[c.key])}
          {c.key === "description" && isReversal(r) && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              reversal
            </span>
          )}
        </span>
      ),
    })),
    {
      key: "_a",
      label: "",
      render: (r) =>
        isValidated(r) && !isReversal(r) ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReverseTarget(r)}
            >
              Reverse
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title="Journals"
        description="General ledger journal entries — balanced-or-rejected, reversal-not-edit."
        action={<Button onClick={() => setPostOpen(true)}>Post entry</Button>}
      />
      <KpiRow>
        <KpiTile label="Entries" value={String(list.length)} />
        <KpiTile
          label="Validated"
          value={String(list.filter(isValidated).length)}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r, i) => String(r.entry_id ?? r.entry_no ?? i)}
        empty={{
          title: "No entries yet",
          hint: "Post a journal entry to get started.",
        }}
      />

      <JournalEntryForm
        open={postOpen}
        onClose={() => setPostOpen(false)}
        onPosted={reload}
      />
      <JournalReverseForm
        entry={reverseTarget}
        onClose={() => setReverseTarget(null)}
        onReversed={reload}
      />
    </section>
  );
}
