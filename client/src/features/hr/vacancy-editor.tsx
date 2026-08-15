/**
 * The vacancy editor — where a draft is read before anybody sees it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The drafting interview (0526) ends by SAVING a DRAFT vacancy, which means a
 * model has just written an advert under the company's name that nothing in the
 * admin could open. The kanban shows a title, a department and a pipeline; the
 * description — the part a candidate actually reads, and the part the model
 * wrote — had no surface at all. So the wizard lands here, and the same screen
 * is reachable afterwards from the vacancy header, because "review before you
 * publish" is not a one-time step in a funnel.
 *
 * ── WHO WROTE IT IS SHOWN, ALWAYS ──────────────────────────────────────────
 *
 * The drafting path never fails: when no model is reachable it falls back to a
 * deterministic template built from the recruiter's own answers, and the row
 * records `ai_provider: "template"`. That distinction is worth a line at the top
 * of this editor, because the failure it prevents is somebody publishing
 * boilerplate believing an AI wrote it (see the 0526 migration).
 *
 * ── EDIT THE TEXT, NOT A FORM OF IT ────────────────────────────────────────
 *
 * The description is markdown in one large box with a preview, rather than a
 * pile of "responsibilities" / "requirements" fields stitched back together on
 * save. The model writes an advert; the recruiter edits an advert.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Markdown } from "@/components/markdown";
import { DateField } from "@/components/ui/date-field";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/hr-api";

const EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"];

/** Numbers arrive from the API as strings (numeric columns) — an empty box and
 *  a zero are different answers, so blank stays blank rather than becoming 0. */
const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "" : String(v);

export function VacancyEditor({
  vacancy,
  onClose,
  onSaved,
}: {
  vacancy: api.Vacancy;
  onClose: () => void;
  onSaved: (v: api.Vacancy) => void;
}) {
  const [f, setF] = React.useState({
    title: vacancy.title || "",
    employment_type: vacancy.employment_type || "",
    location: vacancy.location || "",
    headcount: num(vacancy.headcount ?? 1),
    experience_years_min: num(vacancy.experience_years_min),
    salary_min: num(vacancy.salary_min),
    salary_max: num(vacancy.salary_max),
    skills: (vacancy.skills_required || []).join(", "),
    closes_on: vacancy.closes_on || "",
    description: vacancy.description || "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: null,
    department: vacancy.department || null,
  });
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const drafted = vacancy.ai_provider;
  // The advert box is a labelled control without a `Field` around it (the label
  // row carries the Preview toggle), so it needs its own association.
  const advertLabelId = React.useId();
  const bandInverted =
    f.salary_min !== "" && f.salary_max !== "" && Number(f.salary_max) < Number(f.salary_min);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.updateVacancy(vacancy.vacancy_id, {
          title: f.title,
          scope_id: dept.scope_id,
          department: dept.department || undefined,
          description: f.description || undefined,
          employment_type: f.employment_type || undefined,
          location: f.location || undefined,
          headcount: f.headcount === "" ? undefined : Number(f.headcount),
          experience_years_min:
            f.experience_years_min === "" ? undefined : Number(f.experience_years_min),
          salary_min: f.salary_min === "" ? undefined : Number(f.salary_min),
          salary_max: f.salary_max === "" ? undefined : Number(f.salary_max),
          skills_required: f.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          closes_on: f.closes_on || undefined,
        }),
      );
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={drafted ? "Review the draft" : "Edit vacancy"}
      description="Nothing is public until you open the role and publish it to the careers page."
      size="xl"
      headerRight={
        drafted ? (
          <Pill tone={drafted === "template" ? "warn" : "ok"}>
            {drafted === "template" ? "Written without AI" : `Drafted by ${drafted}`}
          </Pill>
        ) : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            loading={busy}
            disabled={!f.title.trim() || bandInverted || busy}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* A template draft is real, editable content — but it says less than a
            model would, and the person reading it should know which they have. */}
        {drafted === "template" && (
          <Callout tone="warn" title="No AI wrote this">
            No provider was reachable, so the draft was built from your answers alone.
            It says less than a model would — read it closely before you publish.
          </Callout>
        )}

        <Field label="Title" required>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" hint="From your organigramme — Security › Scopes.">
            <DepartmentSelect value={dept} onChange={setDept} />
          </Field>
          <Field label="Employment type">
            <Input
              list="vacancy-employment-types"
              value={f.employment_type}
              onChange={(e) => set("employment_type", e.target.value)}
            />
          </Field>
        </div>
        {/* A datalist rather than a select: the column is free text, the model
            can return something outside the list, and a select would silently
            drop it. */}
        <datalist id="vacancy-employment-types">
          {EMPLOYMENT.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Location" hint="As a candidate reads it.">
            <Input value={f.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Positions" hint="How many people you're hiring.">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={f.headcount}
              onChange={(e) => set("headcount", e.target.value)}
            />
          </Field>
          <Field label="Minimum experience" hint="Years.">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={f.experience_years_min}
              onChange={(e) => set("experience_years_min", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Salary from${vacancy.salary_currency ? ` (${vacancy.salary_currency}/month)` : ""}`}>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={f.salary_min}
              onChange={(e) => set("salary_min", e.target.value)}
            />
          </Field>
          <Field
            label={`Salary to${vacancy.salary_currency ? ` (${vacancy.salary_currency}/month)` : ""}`}
            error={bandInverted ? "The top of the band must not be below the bottom." : undefined}
          >
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={f.salary_max}
              onChange={(e) => set("salary_max", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Skills" hint="Comma separated. These are what the AI scores applicants against.">
            <Input value={f.skills} onChange={(e) => set("skills", e.target.value)} />
          </Field>
          <Field label="Closing date" hint="Shown on the careers page.">
            <DateField
              value={f.closes_on}
              onChange={(iso) => set("closes_on", iso)}
            />
          </Field>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="block text-sm font-medium text-foreground" id={advertLabelId}>
              The advert
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </Button>
          </div>
          {preview ? (
            <div className="rounded-[10px] border bg-muted/20 p-4">
              {f.description.trim() ? (
                <Markdown text={f.description} />
              ) : (
                <p className="micro">Nothing written yet.</p>
              )}
            </div>
          ) : (
            <Textarea
              aria-labelledby={advertLabelId}
              rows={16}
              className="font-mono text-[12px]"
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Markdown — headings, <code>**bold**</code> and <code>- bullets</code> render on
            the careers page.
          </p>
        </div>

        {error && <ErrorState message={error} />}
      </div>
    </Modal>
  );
}

export default VacancyEditor;
