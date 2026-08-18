/**
 * HR — standard operating procedures, and the onboarding checklists that run
 * against them.
 *
 * ── WHAT AN SOP IS NOW (0704 / 10708) ─────────────────────────────────────
 *
 * A procedure is a DOCUMENT, not a title row. The "New SOP" form collects the
 * facts the company knows — scope, owning role, effective date, the purpose in
 * the company's own words, and the steps they already have — and the AI writes
 * the prose AROUND those facts: standard sections (Purpose, Scope,
 * Responsibilities, Procedure, Records, Compliance), plain professional
 * English, never a clause the company didn't state. This is what a lateness
 * deduction is justified against, so a rule a model invented is one the
 * company never agreed and the system would then charge people for.
 *
 * Clicking any procedure in the list opens the generated document itself.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { ActivePill, Pill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { DocButton } from "@/components/doc-button";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { HouseRulesView } from "./house-rules";
import { OnboardingView } from "./onboarding";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { Markdown } from "@/components/markdown";
import { dateFmt } from "@/lib/format";
import { num } from "@/lib/format";
import { shell } from "./shared";
import * as api from "@/lib/hr-api";

export const READINESS: { value: string; label: string; tone: Tone }[] = [
  { value: "ready_now", label: "Ready now", tone: "ok" },
  { value: "1_2_years", label: "1–2 years", tone: "warn" },
  { value: "3_plus_years", label: "3+ years", tone: "mute" },
];
export const readinessMeta = (v?: string | null) =>
  READINESS.find((r) => r.value === v);

export const eyebrow = <HubCrumb area="Human capital" to="/hr" />;

const SCOPE_LABEL: Record<string, string> = {
  COMPANY: "All staff",
  DEPARTMENT: "One department",
  OPERATIONS: "Whoever performs the task",
};

/* ── The drafting input, shared by the new-SOP form and the redraft ─────── */

/** The facts the model is ALLOWED to use. One line per step; the model
 *  orders and expands them rather than inventing a process it has never
 *  seen. */
function DraftFactsFields({
  f,
  set,
}: {
  f: {
    purpose: string;
    steps: string;
  };
  set: (k: "purpose" | "steps", v: string) => void;
}) {
  return (
    <>
      <Field
        label={tr("Purpose")}
        hint="What this procedure is for, in the company's own words. This is the substance the document is written from."
      >
        <textarea
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
          rows={3}
          value={f.purpose}
          onChange={(e) => set("purpose", e.target.value)}
          placeholder="e.g. Every container arriving at the Douala depot must be photographed, weighed and checked against the manifest before it is cleared for delivery."
        />
      </Field>
      <Field
        label="Steps you already know"
        hint="One per line. The AI orders and expands them — it does not invent a process it has never seen."
      >
        <textarea
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm font-mono"
          rows={5}
          value={f.steps}
          onChange={(e) => set("steps", e.target.value)}
          placeholder={"1. Receive the manifest from the shipping line\n2. Photograph all six faces of each container\n3. Weigh at the gate and compare with the manifest"}
        />
      </Field>
    </>
  );
}

/* ── New SOP: the facts, then the AI writes the document ────────────────── */

function SopForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (sop: api.SopDocument) => void;
}) {
  const [f, setF] = React.useState({
    title: "",
    category: "",
    version_no: "1",
    scope: "COMPANY",
    department: "",
    owner_role: "",
    effective_on: "",
    purpose: "",
    steps: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /** Create, then — when the company's own words were given — draft the
   *  document with AI. Two calls, one button press: the record exists either
   *  way, so a model outage never loses the procedure. */
  async function submit(e: React.FormEvent, withDraft: boolean) {
    e.preventDefault();
    setBusy(withDraft ? "draft" : "save");
    setError(null);
    try {
      const created = await api.createSop({
        title: f.title,
        category: f.category || undefined,
        version_no: f.version_no === "" ? undefined : Number(f.version_no),
        scope: f.scope as "COMPANY" | "DEPARTMENT" | "OPERATIONS",
        department: f.department || undefined,
        owner_role: f.owner_role || undefined,
        effective_on: f.effective_on || undefined,
        summary: f.purpose || undefined,
      });
      if (withDraft && (f.purpose.trim() || f.steps.trim())) {
        const drafted = await api.draftSop(created.sop_document_id, {
          purpose: f.purpose,
          steps: f.steps
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        onSaved(drafted);
      } else {
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const haveWords = f.purpose.trim().length > 0 || f.steps.trim().length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New SOP"
      description="State the facts the company knows — the AI writes the professional document around them, never inventing policy."
    >
      <form className="space-y-4" onSubmit={(e) => submit(e, true)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Title")} required>
            <Input
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Container receiving procedure"
            />
          </Field>
          <Field label={tr("Category")} hint="Keeps the register filterable.">
            <Input
              value={f.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="Warehouse operations"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Applies to")}
            hint="Who the document speaks to. Getting this wrong is how a procedure ends up addressed to nobody."
          >
            <Select value={f.scope} onChange={(e) => set("scope", e.target.value)}>
              <option value="COMPANY">All staff</option>
              <option value="DEPARTMENT">One department</option>
              <option value="OPERATIONS">Whoever performs the task</option>
            </Select>
          </Field>
          {f.scope === "DEPARTMENT" ? (
            <Field label={tr("Department")}>
              <Input
                value={f.department}
                onChange={(e) => set("department", e.target.value)}
                placeholder="Warehouse"
              />
            </Field>
          ) : (
            <Field label="Owned by" hint="A ROLE, never a name.">
              <Input
                value={f.owner_role}
                onChange={(e) => set("owner_role", e.target.value)}
                placeholder="Warehouse Supervisor"
              />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Effective from")}>
            <Input
              type="date"
              value={f.effective_on}
              onChange={(e) => set("effective_on", e.target.value)}
            />
          </Field>
          <Field label={tr("Version")}>
            <Input
              type="number"
              className="num text-right"
              value={f.version_no}
              onChange={(e) => set("version_no", e.target.value)}
            />
          </Field>
        </div>

        <DraftFactsFields
          f={f}
          set={(k, v) => set(k, v)}
        />

        <p className="text-xs text-muted-foreground">
          {haveWords
            ? "The draft will state ONLY what you wrote above. Where the material is thin it says so under “To be completed:” instead of inventing a clause nobody agreed."
            : "Save without a draft and the register keeps a skeleton you can draft later — the document never invents policy you did not state."}
        </p>

        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={busy === "save"}
            disabled={!f.title || !!busy}
            onClick={(e) => submit(e, false)}
          >
            Save skeleton
          </Button>
          <Button
            type="submit"
            loading={busy === "draft"}
            disabled={!f.title || !!busy}
          >
            {haveWords ? "Save & draft with AI" : "Save & open"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── The document itself ────────────────────────────────────────────────── */

function SopDocumentModal({
  sopId,
  onClose,
}: {
  sopId: string;
  onClose: () => void;
}) {
  const q = useResource(() => api.getSop(sopId), [sopId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [facts, setFacts] = React.useState({ purpose: "", steps: "" });
  const [factsOpen, setFactsOpen] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const sop = q.data;

  // Seed the edit box and the drafting facts once the row has loaded, without
  // clobbering anything typed since.
  React.useEffect(() => {
    if (!sop) return;
    setBody((b) => b || sop.body_md || "");
    setFacts((prev) => ({
      purpose: prev.purpose || sop.summary || "",
      steps: prev.steps,
    }));
  }, [sop]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      await q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (q.loading) return (
    <Modal open onClose={onClose} title="Procedure">
      <p className="py-8 text-center micro">{tr("Loading…")}</p>
    </Modal>
  );
  if (q.error || !sop) return (
    <Modal open onClose={onClose} title="Procedure">
      <ErrorState message={q.error || "Not found"} />
    </Modal>
  );

  const hasBody = !!(sop.body_md && sop.body_md.trim());

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={sop.title || "Procedure"}
      description={[
        sop.category,
        `v${num(sop.version_no)}`,
        sop.scope && SCOPE_LABEL[sop.scope],
        sop.owner_role,
        sop.effective_on && `effective ${dateFmt(sop.effective_on)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      headerRight={
        <div className="flex items-center gap-2">
          {sop.is_active === false && <Pill tone="mute">Archived</Pill>}
          {hasBody && (
            <Pill tone={sop.ai_generated ? "blue" : "mute"}>
              {sop.ai_generated ? `Drafted by ${sop.ai_model || "AI"}` : "Skeleton — drafted by hand/template"}
            </Pill>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {note && (
          <p className="rounded-lg border border-[rgb(var(--ok))/40] bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">
            {note}
          </p>
        )}

        {editing ? (
          <div className="space-y-2">
            <label className="micro" htmlFor="sop-body">
              Document text (markdown)
            </label>
            <textarea
              id="sop-body"
              className="h-[52vh] w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-sm leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                loading={busy === "save"}
                onClick={() =>
                  run("save", async () => {
                    await api.updateSop(sopId, { body_md: body });
                    setEditing(false);
                  })
                }
              >
                Save text
              </Button>
            </div>
          </div>
        ) : hasBody ? (
          <div className="max-h-[56vh] overflow-y-auto rounded-lg border bg-muted/20 p-5">
            {/* The professional document, rendered. This IS the SOP. */}
            <Markdown text={sop.body_md || ""} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="text-sm text-foreground">No document yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              State the purpose and the steps the company already knows, and the
              AI writes the professional document around them — or paste the
              text you have with “Write text”.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Write text
              </Button>
              <Button size="sm" onClick={() => setFactsOpen(true)}>
                Draft with AI
              </Button>
            </div>
          </div>
        )}

        {/* The drafting input — the company's own words, only ever its own. */}
        {factsOpen && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="micro">What the AI is allowed to use</p>
              <Button size="sm" variant="ghost" onClick={() => setFactsOpen(false)}>
                Close
              </Button>
            </div>
            <DraftFactsFields f={facts} set={(k, v) => setFacts((s) => ({ ...s, [k]: v }))} />
            <p className="text-xs text-muted-foreground">
              The document states ONLY what is written here. Thin material gets a
              “To be completed:” line, never a clause the company didn't agree.
            </p>
            <div className="flex justify-end">
              <Button
                loading={busy === "draft"}
                onClick={() =>
                  run("draft", async () => {
                    await api.draftSop(sopId, {
                      purpose: facts.purpose,
                      steps: facts.steps
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                    setFactsOpen(false);
                  })
                }
              >
                {hasBody ? "Re-draft with AI" : "Draft with AI"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {hasBody && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit text
            </Button>
          )}
          {hasBody && !editing && (
            <Button
              variant="outline"
              loading={busy === "facts"}
              onClick={() => setFactsOpen((v) => !v)}
            >
              Drafting input
            </Button>
          )}
          {hasBody && !sop.pdf_vault_id && (
            <Button
              variant="outline"
              loading={busy === "render"}
              onClick={() =>
                run("render", async () => {
                  await api.renderSopPdf(sopId);
                  setNote("PDF rendered and filed. Use “View PDF” to print it.");
                })
              }
            >
              Render PDF
            </Button>
          )}
          {sop.pdf_vault_id && (
            <DocButton
              docType="SOP_DOCUMENT"
              id={sopId}
              title={sop.title || "Procedure"}
              label="View PDF"
            />
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* Procedures — the versioned SOP document register (with category filter). */
function ProceduresView() {
  const { rows, error, loading, reload } = useList<api.SopDocument>("/sops");
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [cat, setCat] = React.useState("ALL");
  const list = rows || [];
  const activeCount = list.filter((r) => r.is_active !== false).length;
  const categories = Array.from(
    new Set(list.map((r) => r.category || "Uncategorised")),
  ).sort();
  const filtered =
    cat === "ALL"
      ? list
      : list.filter((r) => (r.category || "Uncategorised") === cat);
  const cols: Column<api.SopDocument>[] = [
    {
      key: "title",
      label: "Title",
      render: (r) => (
        <span className="font-medium text-foreground">{r.title || "—"}</span>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (r) => (
        <span className="text-muted-foreground">{r.category || "—"}</span>
      ),
    },
    {
      key: "version_no",
      label: "Version",
      className: "num text-right",
      render: (r) => num(r.version_no),
    },
    {
      key: "document",
      label: "Document",
      // The row says whether the professional document exists yet — the one
      // thing a title row could never tell you (10708).
      render: (r) =>
        r.body_md ? (
          <Pill tone={r.ai_generated ? "blue" : "mute"}>
            {r.ai_generated ? `AI · ${r.ai_model || ""}` : "Written"}
          </Pill>
        ) : (
          <span className="text-xs text-muted-foreground">Skeleton — not drafted yet</span>
        ),
    },
    {
      key: "is_active",
      label: "Status",
      render: (r) => <ActivePill active={r.is_active !== false} />,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          {/* Opening the list row reads the AI-generated document itself. */}
          <Button size="sm" variant="ghost" onClick={() => setOpenId(r.sop_document_id)}>
            Read
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <KpiRow>
        <KpiTile label="Procedures" value={num(list.length)} />
        <KpiTile
          label={tr("Active")}
          value={num(activeCount)}
          hint={`${list.length - activeCount} archived`}
        />
        <KpiTile
          label="Drafted"
          value={num(list.filter((r) => r.body_md).length)}
          hint="Have a document in them"
        />
        <KpiTile label="Categories" value={num(categories.length)} />
      </KpiRow>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {categories.length > 1 ? (
          <div className="chips">
            {["ALL", ...categories].map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`chip ${cat === c ? "on" : ""}`}
              >
                {c === "ALL" ? "All" : c}
                <span className="ct num">
                  {c === "ALL"
                    ? list.length
                    : list.filter((r) => (r.category || "Uncategorised") === c)
                        .length}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button onClick={() => setCreating(true)}>New SOP</Button>
      </div>
      <DataList
        columns={cols}
        rows={loading ? null : filtered}
        error={error}
        loading={loading}
        rowKey={(r) => r.sop_document_id}
        // The whole row opens the document — the register's reason to exist.
        onRowClick={(r) => setOpenId(r.sop_document_id)}
        empty={{ title: "No SOPs", hint: "Add your first procedure document." }}
      />
      {creating && (
        <SopForm
          onClose={() => setCreating(false)}
          onSaved={(sop) => {
            reload();
            // Straight from the form into the document the AI just wrote.
            setOpenId(sop.sop_document_id);
          }}
        />
      )}
      {openId && (
        <SopDocumentModal
          sopId={openId}
          onClose={() => {
            setOpenId(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/* Onboarding lives in ./onboarding (0703) — checklists gained templates,
 * due dates, owners and a completion guard, which is more than fits beside the
 * SOP documents it used to share a file with. */

export function SopsPage() {
  const [view, setView] = React.useState<"procedures" | "onboarding" | "rules">(
    "procedures",
  );
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={eyebrow}
        title="SOPs & onboarding"
        description="Standard operating procedures, plus per-new-hire onboarding checklists."
      />
      <HubTabs />{" "}
      <div className="chips mb-4">
        <button
          className={`chip ${view === "procedures" ? "on" : ""}`}
          onClick={() => setView("procedures")}
        >
          Procedures
        </button>
        <button
          className={`chip ${view === "onboarding" ? "on" : ""}`}
          onClick={() => setView("onboarding")}
        >
          Onboarding
        </button>
        {/* The clauses the system enforces. Beside the documents rather than in
            attendance settings, because a lateness deduction IS a clause — see
            house-rules.tsx. */}
        <button
          className={`chip ${view === "rules" ? "on" : ""}`}
          onClick={() => setView("rules")}
        >
          House rules
        </button>
      </div>
      {view === "procedures" ? (
        <ProceduresView />
      ) : view === "onboarding" ? (
        <OnboardingView />
      ) : (
        <HouseRulesView />
      )}
    </section>
  );
}

/* ── Talent pool — candidate reference list ── */
