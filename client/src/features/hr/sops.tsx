/**
 * HR — standard operating procedures, and the onboarding checklists that run
 * against them.
 *
 * Split out of `features/hr/pages.tsx` (423 lines) in Phase 4, audit F7.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { ActivePill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { HouseRulesView } from "./house-rules";
import { OnboardingView } from "./onboarding";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num } from "@/lib/format";
import { shell } from "./shared";

export const READINESS: { value: string; label: string; tone: Tone }[] = [
  { value: "ready_now", label: "Ready now", tone: "ok" },
  { value: "1_2_years", label: "1–2 years", tone: "warn" },
  { value: "3_plus_years", label: "3+ years", tone: "mute" },
];
export const readinessMeta = (v?: string | null) =>
  READINESS.find((r) => r.value === v);

export const eyebrow = <HubCrumb area="Human capital" to="/hr" />;

// Employees is now a profile 360 (record + HR history + suspend/activate).
// HR discipline (MOD-71) — manager screens for queries + sanctions.
// Payroll is now a run workstation (compute → approve → post → disburse).
// Vacancies is now a recruitment kanban (applicant pipeline across stages).
// Contracts is now a lifecycle workstation (DRAFT → ISSUED → SIGNED → ENDED).
// Appraisals surface performance rewards that feed payroll.
// Attendance is a geofenced Time Clock manager view.
// Leave is an approve/reject request queue.
// Trainings is a session + attendance roster workstation.

/* ── SOPs — versioned reference list ── */
type Sop = {
  sop_document_id: string;
  title?: string | null;
  category?: string | null;
  version_no?: number | null;
  is_active?: boolean;
};

function SopForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    title: "",
    category: "",
    version_no: "1",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/sops", {
        method: "POST",
        body: {
          title: f.title,
          category: f.category || undefined,
          version_no: f.version_no === "" ? undefined : Number(f.version_no),
        },
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
      title="New SOP"
      description="Add a standard operating procedure document."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Title" required>
          <Input
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Input
              value={f.category}
              onChange={(e) => set("category", e.target.value)}
            />
          </Field>
          <Field label="Version">
            <Input
              type="number"
              className="num text-right"
              value={f.version_no}
              onChange={(e) => set("version_no", e.target.value)}
            />
          </Field>
        </div>
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
            Add SOP
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* Procedures — the versioned SOP document register (with category filter). */
function ProceduresView() {
  const { rows, error, loading, reload } = useList<Sop>("/sops");
  const [creating, setCreating] = React.useState(false);
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
  const cols: Column<Sop>[] = [
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
      key: "is_active",
      label: "Status",
      render: (r) => <ActivePill active={r.is_active !== false} />,
    },
  ];
  return (
    <>
      <KpiRow>
        <KpiTile label="Procedures" value={num(list.length)} />
        <KpiTile
          label="Active"
          value={num(activeCount)}
          hint={`${list.length - activeCount} archived`}
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
        empty={{ title: "No SOPs", hint: "Add your first procedure document." }}
      />
      {creating && (
        <SopForm onClose={() => setCreating(false)} onSaved={reload} />
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
