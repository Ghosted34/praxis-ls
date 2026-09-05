/**
 * Vacancies — recruitment kanban (replaces the CRUD table). Pick a vacancy to
 * work its applicant pipeline across stages (Applied → Shortlisted → Interviewed
 * → Hired), with Reject / Talent-pool outcomes. The vacancy head has its own
 * DRAFT → OPEN → CLOSED lifecycle.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileDrop } from "@/components/ui/file-drop";
import { Callout } from "@/components/ui/callout";
import { Modal, Field } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { useResource, errMsg } from "@/lib/use-resource";
import { tokenStore } from "@/lib/token-store";
import { enumLabel, withScheme } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { LoadingRow } from "@/components/ui/states";
import { ApplicantDrawer, CriteriaEditor } from "./applicant-drawer";
import { VacancyWizard } from "./vacancy-wizard";
import { VacancyEditor } from "./vacancy-editor";
import { useConfirm } from "@/components/ui/use-confirm";

const shell = pageShell.wide;
const VAC_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  OPEN: "ok",
  PAUSED: "warn",
  CLOSED: "mute",
};
// Mirrors the server's map (vacancy.service). PAUSED is a round trip out of
// OPEN and back; CLOSED is an ending, so nothing leads out of it.
const VAC_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["PAUSED", "CLOSED"],
  PAUSED: ["OPEN", "CLOSED"],
  CLOSED: [],
};
/** The verb on the button, which is not the state's name: you "pause" a role
 *  to reach PAUSED, and from there the same OPEN target reads "Resume". */
const VAC_LABEL: Record<string, string> = {
  OPEN: "Open",
  PAUSED: "Pause",
  CLOSED: "Close",
};

/**
 * The list filters.
 *
 * "Published" is not a status — it is `public_token != null` on an OPEN role —
 * but it is the question people actually ask ("what is live on the careers page
 * right now?"), so it earns a tab of its own rather than making somebody open
 * each open role to find out.
 */
const FILTERS: {
  key: string;
  label: string;
  match: (v: api.Vacancy) => boolean;
}[] = [
  { key: "", label: "All", match: () => true },
  { key: "DRAFT", label: "Drafts", match: (v) => v.status === "DRAFT" },
  { key: "OPEN", label: "Open", match: (v) => v.status === "OPEN" },
  {
    key: "PUBLISHED",
    label: "Published",
    match: (v) => v.status === "OPEN" && Boolean(v.public_token),
  },
  { key: "PAUSED", label: "Paused", match: (v) => v.status === "PAUSED" },
  { key: "CLOSED", label: "Closed", match: (v) => v.status === "CLOSED" },
];

/** Mirrors careers.service + vacancy.service — the same document either way. */
const CV_MAX_BYTES = 8 * 1024 * 1024;

const ORDER = ["APPLIED", "SHORTLISTED", "INTERVIEWED", "HIRED"];
const COLUMNS = [...ORDER, "REJECTED", "TALENT_POOL"];
const COL_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  SHORTLISTED: "Shortlisted",
  INTERVIEWED: "Interviewed",
  HIRED: "Hired",
  REJECTED: "Rejected",
  TALENT_POOL: "Talent pool",
};

function AddApplicantForm({
  vacancyId,
  vacancyCurrency,
  onClose,
  onSaved,
}: {
  vacancyId: string;
  /** The role's own currency, so "desired salary" is not a bare number. */
  vacancyCurrency?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    skills: "",
    experience_years: "",
    expected_salary: "",
    portfolio_url: "",
    cover_note: "",
    source: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  // The CV takes the same road as one uploaded to the careers page: read to a
  // base64 data URL here, sniffed and size-capped by the vault server-side.
  // Without it a referral can never be scored on more than the typed fields,
  // while an online applicant is read in full.
  const [cv, setCv] = React.useState<File | null>(null);
  const [cvError, setCvError] = React.useState<string | null>(null);
  const readDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Couldn't read that file."));
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cvDataUrl = cv ? await readDataUrl(cv) : undefined;
      await api.addApplicant(vacancyId, {
        cv_data_url: cvDataUrl,
        cv_filename: cv?.name,
        full_name: f.full_name,
        email: f.email || undefined,
        phone: f.phone || undefined,
        address: f.address || undefined,
        // The scorer matches these by substring, so blanks would be scored as a
        // required skill nobody can meet.
        skills: f.skills
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        experience_years: num(f.experience_years),
        expected_salary: num(f.expected_salary),
        portfolio_url: withScheme(f.portfolio_url) || undefined,
        cover_note: f.cover_note || undefined,
        source: f.source || undefined,
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
      title="Add applicant"
      size="lg"
      description="Add a candidate to this vacancy's pipeline. The more you fill in, the more the AI score has to read."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Full name")} required>
          <Input
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Email")}>
            <Input
              type="email"
              value={f.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label={tr("Phone")}>
            <Input
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Address")}>
            <Input
              value={f.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field
            label={tr("Source")}
            hint="Where they came from — referral, walk-in, LinkedIn."
          >
            <Input
              list="applicant-sources"
              value={f.source}
              onChange={(e) => set("source", e.target.value)}
            />
          </Field>
        </div>
        {/* Suggestions, not a fixed list: `source` is free text and the public
            form stamps its own value ("careers"), so a select would either drop
            what somebody typed or quietly disagree with the careers page. */}
        <datalist id="applicant-sources">
          {[
            "Referral",
            "Walk-in",
            "LinkedIn",
            "Agency",
            "Jobberman",
            "Instagram",
          ].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Years of experience">
            <Input
              type="number"
              min={0}
              step="0.5"
              inputMode="decimal"
              value={f.experience_years}
              onChange={(e) => set("experience_years", e.target.value)}
            />
          </Field>
          <Field
            label={`Desired salary${vacancyCurrency ? ` (${vacancyCurrency})` : ""}`}
          >
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={f.expected_salary}
              onChange={(e) => set("expected_salary", e.target.value)}
            />
          </Field>
          <Field label="Portfolio link">
            <Input
              type="url"
              placeholder="linkedin.com/in/them"
              value={f.portfolio_url}
              onChange={(e) => set("portfolio_url", e.target.value)}
              // Same repair as the public form: a pasted LinkedIn address has
              // no scheme, and both `type="url"` and the server's validator
              // refuse it without one.
              onBlur={(e) => set("portfolio_url", withScheme(e.target.value))}
            />
          </Field>
        </div>
        <Field
          label={tr("Skills")}
          hint="Comma separated. The AI score matches these against the role's required skills."
        >
          <Input
            value={f.skills}
            onChange={(e) => set("skills", e.target.value)}
          />
        </Field>
        <FileDrop
          file={cv}
          onPick={(picked) => {
            // Refused here as well as server-side, because the alternative is
            // reading an 80 MB file into memory to be told no afterwards.
            if (picked && picked.size > CV_MAX_BYTES) {
              setCvError(
                "That file is over 8 MB. Send a smaller PDF or photo.",
              );
              return;
            }
            setCvError(null);
            setCv(picked);
          }}
          accept="application/pdf,image/png,image/jpeg"
          label="CV"
          hint="PDF or a photo, up to 8 MB. Without one the AI score stays an estimate."
          error={cvError}
          disabled={busy}
        />
        <Field
          label="Cover note"
          hint="Anything they sent or said — the AI reads it alongside the CV."
        >
          <Textarea
            rows={4}
            value={f.cover_note}
            onChange={(e) => set("cover_note", e.target.value)}
          />
        </Field>
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
          <Button type="submit" loading={busy} disabled={!f.full_name || busy}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewVacancyForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (v: api.Vacancy) => void;
}) {
  const [f, setF] = React.useState({ title: "", description: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Department is a scope (0490). It carries onto the employee record at hire,
  // so picking a real node here is what puts the new starter in the right part
  // of the organigramme instead of copying a typed string.
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: null,
    department: null,
  });
  // Who is hiring. Asked here for the same reason the interview asks it: the
  // vacancy is what carries `entity_id` to the employee record at hire, and a
  // vacancy attached to no company is the link in that chain that breaks. Only
  // shown when there is a choice — one company is not a question.
  const entities = useResource(() => api.hiringEntities(), []);
  const choices = entities.data || [];
  const [entityId, setEntityId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = await api.createVacancy({
        title: f.title,
        scope_id: dept.scope_id || undefined,
        department: dept.department || undefined,
        description: f.description || undefined,
        entity_id: entityId || undefined,
      });
      onSaved(v);
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
      title={tr("New vacancy")}
      description="Open a role and start collecting applicants."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Title")} required>
          <Input
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Driver — heavy goods"
          />
        </Field>
        {choices.length > 1 && (
          <Field
            label={tr("Company")}
            hint="Which corporate entity is hiring. It sets the vacancy's currency."
          >
            <Select
              value={entityId}
              onValueChange={setEntityId}
              placeholder="Choose the hiring company…"
              options={choices.map((c) => ({
                value: c.entity_id,
                label: c.name,
                hint: c.currency ? `Salaries in ${c.currency}` : undefined,
              }))}
            />
          </Field>
        )}
        <Field
          label={tr("Department")}
          hint={tr("From your organigramme — Security › Scopes.")}
          htmlFor="vacancy-filter-department"
        >
          <DepartmentSelect id="vacancy-filter-department" value={dept} onChange={setDept} />
        </Field>
        <Field label={tr("Description")}>
          <Input
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
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
          <Button type="submit" loading={busy} disabled={!f.title || busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Pipeline({
  vacancy: initial,
  onChanged,
  onEdit,
}: {
  vacancy: api.Vacancy;
  onChanged: () => void;
  /** Opens the advert itself. The kanban shows a title and a pipeline; the
   *  description a candidate reads is only reachable through here. */
  onEdit: () => void;
}) {
  const [vacancy, setVacancy] = React.useState(initial);
  React.useEffect(() => setVacancy(initial), [initial]);
  const applicants = useResource(
    () => api.listApplicants(vacancy.vacancy_id),
    [vacancy.vacancy_id],
  );
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openApplicant, setOpenApplicant] =
    React.useState<api.Applicant | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [rescored, setRescored] = React.useState<string | null>(null);
  const [criteriaOpen, setCriteriaOpen] = React.useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const paused = vacancy.status === "PAUSED";
  /**
   * A careers link minted in Test is not on the internet.
   *
   * The public page is unauthenticated, so a candidate's browser sends no
   * `X-Praxis-Env` header — and the server reads that absence as LIVE. A role
   * published from a Test session therefore lives in the sandbox schema, and its
   * link answers "This role is no longer accepting applications" to everyone,
   * including whoever just published it. The action still works — rehearsing a
   * posting in Test is what Test is for — but nothing said the link was not
   * public, which is a discovery best not made through a candidate.
   */
  const inSandbox = tokenStore.getEnv() === "sandbox";
  const publicUrl = vacancy.public_token
    ? // Same origin: the tenant is resolved from the HOST, so the careers page for
      // this workspace is on this workspace's own domain. Building it from
      // window.location rather than a configured base means a tenant on a custom
      // domain gets their own domain in the link.
      `${window.location.origin}/careers/${vacancy.public_token}`
    : null;

  async function togglePublish() {
    const next = !vacancy.public_token;
    if (!next) {
      const ok = await confirm({
        title: "Unpublish this role?",
        body: "The careers link stops working immediately, and re-publishing creates a DIFFERENT link — anyone holding the old one will not be able to apply again.",
        confirmLabel: "Unpublish the role",
        cancelLabel: "Keep it published",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy("publish");
    setError(null);
    try {
      setVacancy(await api.setVacancyPublished(vacancy.vacancy_id, next));
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  async function rescoreAll() {
    setBusy("score-all");
    setError(null);
    setRescored(null);
    try {
      const r = await api.scoreAllApplicants(vacancy.vacancy_id);
      applicants.reload();
      // Said out loud, including the failures: "12 scored" with three silently
      // missing is how a shortlist gets trusted more than it should be.
      setRescored(
        `${r.scored} scored${r.failed ? `, ${r.failed} failed` : ""}${
          r.skipped ? `, ${r.skipped} not reached` : ""
        }.`,
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function vacStatus(status: string) {
    setBusy("vac:" + status);
    setError(null);
    try {
      setVacancy(await api.setVacancyStatus(vacancy.vacancy_id, status));
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function move(a: api.Applicant, status: string) {
    setBusy(a.applicant_id);
    setError(null);
    try {
      await api.setApplicantStatus(vacancy.vacancy_id, a.applicant_id, status);
      applicants.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const byStatus = React.useMemo(() => {
    const m: Record<string, api.Applicant[]> = {};
    COLUMNS.forEach((c) => {
      m[c] = [];
    });
    (applicants.data || []).forEach((a) => {
      (m[a.status] || (m[a.status] = [])).push(a);
    });
    return m;
  }, [applicants.data]);

  function cardActions(a: api.Applicant) {
    const i = ORDER.indexOf(a.status);
    if (i === -1)
      return (
        <Button
          size="sm"
          variant="outline"
          loading={busy === a.applicant_id}
          onClick={() => move(a, "APPLIED")}
        >
          Reopen
        </Button>
      );
    const next = ORDER[i + 1];
    return (
      <div className="flex flex-wrap gap-1">
        {next && (
          <Button
            size="sm"
            loading={busy === a.applicant_id}
            onClick={() => move(a, next)}
          >
            → {COL_LABEL[next]}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy === a.applicant_id}
          onClick={() => move(a, "REJECTED")}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy === a.applicant_id}
          onClick={() => move(a, "TALENT_POOL")}
        >
          Pool
        </Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {confirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">
              {vacancy.title || "Vacancy"}
            </h3>
            <Pill tone={VAC_TONE[vacancy.status] || "mute"}>
              {enumLabel(vacancy.status)}
            </Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {vacancy.department || "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* On a DRAFT this is the job: a model wrote an advert and nobody has
              read it yet, so it leads rather than sitting among the outline
              buttons. */}
          <Button
            size="sm"
            variant={vacancy.status === "DRAFT" ? "default" : "outline"}
            onClick={onEdit}
          >
            {vacancy.status === "DRAFT" ? "Review the draft" : "Edit advert"}
          </Button>
          {(VAC_TRANSITIONS[vacancy.status] || []).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === "CLOSED" ? "outline" : "default"}
              loading={busy === "vac:" + s}
              onClick={() => vacStatus(s)}
            >
              {VAC_LABEL[s] || s}
            </Button>
          ))}
          {/* Publishing is only offered on an OPEN role — the server refuses
              otherwise, and an enabled button that always fails is worse than
              no button. */}
          {vacancy.status === "OPEN" && (
            <Button
              size="sm"
              variant="outline"
              loading={busy === "publish"}
              onClick={togglePublish}
            >
              {vacancy.public_token
                ? "Unpublish"
                : inSandbox
                  ? "Publish to careers (Test)"
                  : "Publish to careers"}
            </Button>
          )}
          {/* After the criteria or the advert change, the scores on this board
              were taken against a different version of the role. This is the
              only way to make them comparable again without opening every
              candidate. */}
          <Button
            size="sm"
            variant="outline"
            loading={busy === "score-all"}
            disabled={Boolean(busy)}
            onClick={rescoreAll}
          >
            Re-score all with AI
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCriteriaOpen(true)}
          >
            Scoring criteria
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            Add applicant
          </Button>
        </div>
      </div>

      {publicUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {/* A paused role keeps its token but its page 404s, so the banner must
              not keep saying "Live" — that is how somebody carries on sharing a
              link that turns candidates away. */}
          <Pill tone={paused || inSandbox ? "warn" : "ok"}>
            {inSandbox ? "Test only" : paused ? "Paused" : "Live"}
          </Pill>
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {publicUrl}
          </code>
          <Button size="sm" variant="outline" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
      {paused && (
        <p className="micro">
          Not accepting applications. The link above is kept — reopening the
          role makes it work again, unchanged.
        </p>
      )}
      {inSandbox && publicUrl && (
        <Callout tone="warn" title="This link isn't public">
          You&rsquo;re in Test. The careers page always serves LIVE data, so
          this role and its link exist only inside Test — a candidate opening it
          is told the role isn&rsquo;t accepting applications. Publish from Live
          to put it on the internet.
        </Callout>
      )}

      {error && <ErrorState message={error} />}
      {rescored && (
        <Callout tone="info" title="Re-scored">
          {rescored}
        </Callout>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <div key={col} className="w-56 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-medium text-foreground">
                {COL_LABEL[col]}
              </span>
              <span className="micro">{byStatus[col]?.length || 0}</span>
            </div>
            <div className="max-h-[62vh] space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-2 min-h-24">
              {applicants.loading ? (
                <LoadingRow />
              ) : (
                (byStatus[col] || []).map((a) => (
                  <div
                    key={a.applicant_id}
                    className="rounded-md border bg-card p-3"
                  >
                    {/* The name opens the panel. The card stays a div rather than
                      becoming a button, because it also contains the stage
                      buttons — nesting those inside a button is invalid markup
                      and makes the whole card one confused tab stop. */}
                    <button
                      type="button"
                      onClick={() => setOpenApplicant(a)}
                      className="block w-full truncate text-left text-sm font-medium text-foreground hover:underline"
                    >
                      {a.full_name}
                    </button>
                    {(a.email || a.phone) && (
                      <div className="mt-0.5 micro truncate">
                        {a.email || a.phone}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {typeof a.ai_score === "number" && (
                        // Provisional scores are muted and marked with a tilde.
                        // The same number means two different things in this
                        // column and the card is where a recruiter skims fastest,
                        // so the distinction has to survive at this size.
                        <Pill tone={a.ai_provisional === false ? "ok" : "mute"}>
                          {a.ai_provisional === false ? "" : "~"}
                          {a.ai_score}
                        </Pill>
                      )}
                      {a.rating != null && (
                        <span className="micro">
                          ★ {Number(a.rating).toFixed(1)}
                        </span>
                      )}
                      {a.cv_vault_id && <span className="micro">CV</span>}
                    </div>
                    <div className="mt-2">{cardActions(a)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Behind a click, not under the board. It is a setup step somebody
          performs once per role and then reads never — sitting open under the
          pipeline it was permanent furniture between a recruiter and the
          candidates they came to look at. */}
      {criteriaOpen && (
        <Modal
          open
          size="lg"
          onClose={() => setCriteriaOpen(false)}
          title="Scoring criteria"
          description="What the AI weighs beyond the job description, for every candidate on this role."
          footer={
            <Button variant="outline" onClick={() => setCriteriaOpen(false)}>
              Done
            </Button>
          }
        >
          <CriteriaEditor vacancyId={vacancy.vacancy_id} />
        </Modal>
      )}

      {adding && (
        <AddApplicantForm
          vacancyId={vacancy.vacancy_id}
          vacancyCurrency={vacancy.salary_currency}
          onClose={() => setAdding(false)}
          onSaved={applicants.reload}
        />
      )}
      {openApplicant && (
        <ApplicantDrawer
          applicant={openApplicant}
          onClose={() => setOpenApplicant(null)}
          onChanged={applicants.reload}
        />
      )}
    </div>
  );
}

export function VacanciesPage() {
  const vacancies = useResource(() => api.listVacancies(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  // Three ways in, deliberately: the interview (default), the plain form it can
  // be escaped to, and the editor — which the interview lands in, and which is
  // reachable again from the vacancy header afterwards.
  const [creating, setCreating] = React.useState(false);
  const [blankForm, setBlankForm] = React.useState(false);
  const [editing, setEditing] = React.useState<api.Vacancy | null>(null);

  const [filter, setFilter] = React.useState("");
  const all = React.useMemo(() => vacancies.data || [], [vacancies.data]);
  const rows = React.useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    return all.filter(f.match);
  }, [all, filter]);
  const selected = rows.find((v) => v.vacancy_id === selId) || null;
  React.useEffect(() => {
    // Also re-selects when a filter change hides the current row, so the pane
    // beside the list never sits on a vacancy the list no longer shows.
    if (!selected && rows.length) setSelId(rows[0].vacancy_id);
  }, [rows, selected]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title={tr("Vacancies")}
        description="Recruitment pipeline — move applicants through the hiring stages."
        action={<Button onClick={() => setCreating(true)}>{tr("New vacancy")}</Button>}
      />
      <HubTabs />{" "}
      {vacancies.error ? (
        <ErrorState message={vacancies.error} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="space-y-2">
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label={tr("Filter by status")}
            >
              {FILTERS.map((f) => {
                const on = filter === f.key;
                const n = all.filter(f.match).length;
                return (
                  <button
                    key={f.key || "all"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      on
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f.label}
                    {/* The count is the point of a filter row: it says where the
                        work is before anything is clicked. */}
                    <span className="ml-1 opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {vacancies.loading ? (
                <LoadingRow />
              ) : rows.length === 0 ? (
                <div className="px-3 py-4 micro">
                  {all.length ? "Nothing in this state." : "No vacancies."}
                </div>
              ) : (
                rows.map((v) => (
                  <button
                    key={v.vacancy_id}
                    onClick={() => setSelId(v.vacancy_id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${v.vacancy_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="truncate font-medium">
                      {v.title || v.vacancy_id.slice(0, 8)}
                    </span>
                    <Pill tone={VAC_TONE[v.status] || "mute"}>
                      {enumLabel(v.status)}
                    </Pill>
                  </button>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <Pipeline
              vacancy={selected}
              onChanged={vacancies.reload}
              onEdit={() => setEditing(selected)}
            />
          ) : (
            <EmptyState
              title="No vacancy selected"
              hint="Choose a role from the list."
            />
          )}
        </div>
      )}
      {creating && (
        <VacancyWizard
          onClose={() => setCreating(false)}
          onBlankForm={() => {
            setCreating(false);
            setBlankForm(true);
          }}
          // The draft is already saved by the time it gets here, so the editor
          // opens on a real row: closing it loses nothing.
          onDrafted={(v) => {
            setCreating(false);
            vacancies.reload();
            setSelId(v.vacancy_id);
            setEditing(v);
          }}
        />
      )}
      {blankForm && (
        <NewVacancyForm
          onClose={() => setBlankForm(false)}
          onSaved={(v) => {
            vacancies.reload();
            setSelId(v.vacancy_id);
          }}
        />
      )}
      {editing && (
        <VacancyEditor
          vacancy={editing}
          onClose={() => setEditing(null)}
          onSaved={() => vacancies.reload()}
        />
      )}
      <ScreenAi path="hr/vacancies" />
    </section>
  );
}

export default VacanciesPage;
