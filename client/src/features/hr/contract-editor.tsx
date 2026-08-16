/**
 * The contract editor (0700) — where a contract stops being a filing reference.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Nothing, and that is the point. A contract row was a kind, two dates and a
 * status; the generated PDF drew a letterhead, both parties and a signature
 * block with NO CLAUSES between them, because the renderer's `articles` list
 * was hard-coded empty. Every contract this product has issued was a blank
 * form. This is the screen that gives it a body.
 *
 * ── THE TERMS ARE FACTS, THE TEXT IS PROSE ────────────────────────────────
 *
 * The left column is what the parties agreed — salary, dates, probation,
 * notice. Those are sent to the drafter as facts it must reproduce exactly and
 * are written to their own columns; the model never decides one. The right
 * column is the text it wrote, editable, and it is the source of truth for what
 * gets printed.
 *
 * Two columns on a laptop and stacked on a phone, with the text pane taking the
 * available height rather than growing the page — a contract is long, and
 * scrolling the whole window to reach the terms you are checking against is the
 * thing that makes editing one unpleasant.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Markdown } from "@/components/markdown";
import { errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const numOrUndef = (v: string) => (v === "" ? undefined : Number(v));

export function ContractEditor({
  contract,
  onClose,
  onSaved,
}: {
  contract: api.Contract;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    title: contract.title || "",
    job_title: contract.job_title || "",
    effective_on: contract.effective_on || "",
    end_on: contract.end_on || "",
    gross_salary: contract.gross_salary == null ? "" : String(contract.gross_salary),
    salary_currency: contract.salary_currency || "XAF",
    probation_months: contract.probation_months == null ? "" : String(contract.probation_months),
    notice_days: contract.notice_days == null ? "" : String(contract.notice_days),
    working_hours: contract.working_hours || "",
    place_of_work: contract.place_of_work || "",
  });
  const [body, setBody] = React.useState(contract.body_md || "");
  const [meta, setMeta] = React.useState({
    ai_generated: !!contract.ai_generated,
    ai_model: contract.ai_model || null,
    probation_ends_on: contract.probation_ends_on || null,
  });
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const terms = () => ({
    title: f.title || undefined,
    job_title: f.job_title || undefined,
    effective_on: f.effective_on || undefined,
    end_on: f.end_on || undefined,
    gross_salary: numOrUndef(f.gross_salary),
    salary_currency: f.salary_currency || undefined,
    probation_months: numOrUndef(f.probation_months),
    notice_days: numOrUndef(f.notice_days),
    working_hours: f.working_hours || undefined,
    place_of_work: f.place_of_work || undefined,
  });

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const row = await api.draftContract(contract.hr_contract_id, terms());
      setBody(row.body_md || "");
      setMeta({
        ai_generated: !!row.ai_generated,
        ai_model: row.ai_model || null,
        probation_ends_on: row.probation_ends_on || null,
      });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await api.updateContract(contract.hr_contract_id, { ...terms(), body_md: body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const locked = contract.status !== "DRAFT";

  return (
    <Modal
      open
      onClose={onClose}
      title={contract.title || "Contract"}
      description={`${contract.employee_name || "—"} · ${(contract.kind || "").replace(/_/g, " ").toLowerCase()}`}
    >
      <div className="flex flex-col gap-4">
        {locked && (
          // Redrafting text somebody has been given — or signed — is not an
          // edit. The server refuses it; saying so here is cheaper than a 422.
          <Callout tone="warn" title={`This contract is ${contract.status.toLowerCase()}`}>
            The text can no longer be redrafted. Supersede it with a renewal
            instead, so the terms this person has been working under stay on
            record.
          </Callout>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {/* THE TERMS — facts, echoed verbatim into the text. */}
          <div className="flex flex-col gap-3">
            <p className="micro">Agreed terms</p>
            <Field label="Title">
              <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Employment contract" />
            </Field>
            <Field label="Job title">
              <Input value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts">
                <Input type="date" value={f.effective_on} onChange={(e) => set("effective_on", e.target.value)} />
              </Field>
              <Field label="Ends" hint="Leave blank for an indefinite term.">
                <Input type="date" value={f.end_on} onChange={(e) => set("end_on", e.target.value)} />
              </Field>
              <Field label="Gross monthly">
                <Input
                  type="number"
                  min="0"
                  className="num text-right"
                  value={f.gross_salary}
                  onChange={(e) => set("gross_salary", e.target.value)}
                />
              </Field>
              <Field label="Currency">
                <Select value={f.salary_currency} onChange={(e) => set("salary_currency", e.target.value)}>
                  <option value="XAF">XAF</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
              <Field label="Probation (months)">
                <Input
                  type="number"
                  min="0"
                  max="24"
                  className="num text-right"
                  value={f.probation_months}
                  onChange={(e) => set("probation_months", e.target.value)}
                />
              </Field>
              <Field label="Notice (days)">
                <Input
                  type="number"
                  min="0"
                  max="365"
                  className="num text-right"
                  value={f.notice_days}
                  onChange={(e) => set("notice_days", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Working hours">
              <Input
                value={f.working_hours}
                onChange={(e) => set("working_hours", e.target.value)}
                placeholder="08:00–17:00, Monday to Friday"
              />
            </Field>
            <Field label="Place of work">
              <Input value={f.place_of_work} onChange={(e) => set("place_of_work", e.target.value)} />
            </Field>
            {meta.probation_ends_on && (
              <p className="text-xs text-muted-foreground">
                Probation ends <span className="num text-foreground">{dateFmt(meta.probation_ends_on)}</span> — you will
                be warned before it does.
              </p>
            )}
            {f.gross_salary && (
              <p className="text-xs text-muted-foreground">
                {money(Number(f.gross_salary))} appears in the text exactly as typed.
              </p>
            )}
          </div>

          {/* THE TEXT — what actually gets printed. */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="micro">Contract text</p>
                {body ? (
                  // Who wrote it. The failure worth preventing is somebody
                  // issuing a template draft believing a model reviewed it.
                  <Pill tone={meta.ai_generated ? "blue" : "mute"}>
                    {meta.ai_generated ? `Drafted by ${meta.ai_model}` : "Template draft"}
                  </Pill>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className={cn("chip", preview && "on")} onClick={() => setPreview((v) => !v)}>
                  {preview ? "Edit" : "Preview"}
                </button>
                <Button size="sm" variant="outline" loading={busy === "draft"} disabled={locked} onClick={draft}>
                  {body ? "Redraft with AI" : "Draft with AI"}
                </Button>
              </div>
            </div>

            {preview ? (
              <div className="lux-card max-h-[52vh] overflow-y-auto p-4">
                {body ? (
                  <Markdown text={body} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing drafted yet.</p>
                )}
              </div>
            ) : (
              <>
                <label className="sr-only" htmlFor="contract-body">
                  Contract text
                </label>
                <textarea
                  id="contract-body"
                  className="h-[52vh] w-full resize-none rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                  value={body}
                  disabled={locked}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Draft with AI, or write the clauses here. Use ## for each article heading — that is what the printed contract splits on."
                />
              </>
            )}
            {!body && (
              <p className="text-xs text-[rgb(var(--warn))]">
                Until this has text, the generated PDF prints a letterhead and two
                names with no clauses between them.
              </p>
            )}
          </div>
        </div>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
            Close
          </Button>
          <Button loading={busy === "save"} disabled={locked || !!busy} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ContractEditor;
