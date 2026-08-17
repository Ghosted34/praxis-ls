/**
 * HR — the talent pool and succession plans.
 *
 * Split out of `features/hr/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubTabs } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { READINESS, eyebrow, readinessMeta } from "./sops";
import { shell } from "./shared";
import { EmployeePicker } from "@/components/employee-picker";
import { ConsiderDialog, type ConsiderSource } from "./consider-dialog";

type Talent = {
  talent_pool_id: string;
  full_name?: string | null;
  skills?: string | null;
  notes?: string | null;
  created_at?: string | null;
  /** When somebody last put them in front of a role (0703). */
  last_considered_at?: string | null;
};

function TalentForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({ full_name: "", skills: "", notes: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/talent-pool", {
        method: "POST",
        body: {
          full_name: f.full_name,
          skills: f.skills || undefined,
          notes: f.notes || undefined,
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
      title="Add to talent pool"
      description="Keep a candidate on file for future roles."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Full name" required>
          <Input
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>
        <Field label="Skills">
          <Input
            value={f.skills}
            onChange={(e) => set("skills", e.target.value)}
            placeholder="Customs, French, forklift…"
          />
        </Field>
        <Field label="Notes">
          <Input
            value={f.notes}
            onChange={(e) => set("notes", e.target.value)}
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

/* ── Succession plans — role → incumbent/successor with a readiness horizon ── */
type Succession = {
  succession_plan_id: string;
  role_title?: string | null;
  incumbent_id?: string | null;
  successor_id?: string | null;
  incumbent_name?: string | null;
  successor_name?: string | null;
  readiness?: string | null;
  notes?: string | null;
};

function SuccessionForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    role_title: "",
    incumbent_id: "",
    successor_id: "",
    readiness: "1_2_years",
    notes: "",
  });
  // The names behind the two ids, so the form can show who is chosen without
  // holding a roster of the whole company to look them up.
  const [names, setNames] = React.useState({ incumbent: "", successor: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/succession", {
        method: "POST",
        body: {
          role_title: f.role_title,
          incumbent_id: f.incumbent_id || undefined,
          successor_id: f.successor_id || undefined,
          readiness: f.readiness || undefined,
          notes: f.notes || undefined,
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
      title="New succession plan"
      description="Name a role's successor and how ready they are."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Role" required>
          <Input
            value={f.role_title}
            onChange={(e) => set("role_title", e.target.value)}
            placeholder="Head of Operations"
          />
        </Field>
        {/* Was a pair of <Select>s built from an unpaginated `/employees` call,
            which the API caps at 50 rows: on any tenant with more than fifty
            staff the fifty-first person onwards could not be named as a
            successor AT ALL, and nothing on screen said so. Same defect, same
            fix as the training roster. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <EmployeePicker
              id="succession-incumbent"
              label={names.incumbent ? `Incumbent — ${names.incumbent}` : "Incumbent"}
              placeholder="Search for the current holder…"
              onPick={(e) => {
                set("incumbent_id", e.employee_id);
                setNames((n) => ({ ...n, incumbent: e.full_name || e.employee_id }));
              }}
            />
          </div>
          <div>
            <EmployeePicker
              id="succession-successor"
              label={names.successor ? `Successor — ${names.successor}` : "Successor"}
              placeholder="Search for the successor…"
              onPick={(e) => {
                set("successor_id", e.employee_id);
                setNames((n) => ({ ...n, successor: e.full_name || e.employee_id }));
              }}
            />
          </div>
        </div>
        <Field label="Readiness">
          <Select
            value={f.readiness}
            onChange={(e) => set("readiness", e.target.value)}
          >
            {READINESS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Input
            value={f.notes}
            onChange={(e) => set("notes", e.target.value)}
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
          <Button type="submit" loading={busy} disabled={!f.role_title || busy}>
            Add plan
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Past applicants (0525) ──────────────────────────────────────────────────
 *
 * The bench above is HAND-ENTERED contacts — people somebody met and typed in.
 * This is everyone who actually applied and was not hired, across every vacancy,
 * and it is the more valuable of the two by a distance: their CV is on file,
 * they have been scored, and the vacancy they came through is recorded. A
 * candidate who was right but late is the cheapest hire available next quarter,
 * and until this panel there was no way to find them again.
 *
 * Deliberately NOT copied into `talent_pool`: doing so would have flattened all
 * of that into a name and a comma-separated skills string, which is precisely
 * the information that makes going back to somebody worthwhile.
 */
function PastApplicants() {
  const [term, setTerm] = React.useState("");
  const [q, setQ] = React.useState("");
  const [considering, setConsidering] = React.useState<ConsiderSource | null>(null);
  // Committed on submit rather than per keystroke — this query scans applicants
  // across every vacancy and does not belong on a typing path.
  const pool = useResource(
    () => api.searchTalentPool({ q: q || undefined, limit: 100 }),
    [q],
  );

  const cols: Column<api.Applicant>[] = [
    {
      key: "name",
      label: "Name",
      render: (r) => (
        <span className="font-medium text-foreground">{r.full_name}</span>
      ),
    },
    {
      key: "skills",
      label: "Skills",
      render: (r) =>
        (r.skills || []).length ? (
          <span className="flex flex-wrap gap-1">
            {(r.skills || []).slice(0, 6).map((s) => (
              <Pill key={s} tone="mute">
                {s}
              </Pill>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "from",
      label: "Applied for",
      render: (r) => (
        <span className="text-muted-foreground">{r.vacancy_title || "—"}</span>
      ),
    },
    {
      key: "score",
      label: "AI match",
      // The provisional marker survives into this table for the same reason it
      // survives onto the pipeline card: the number means two different things
      // and this is a list somebody skims.
      render: (r) =>
        typeof r.ai_score === "number" ? (
          <Pill tone={r.ai_provisional === false ? "ok" : "mute"}>
            {r.ai_provisional === false ? "" : "~"}
            {r.ai_score}
          </Pill>
        ) : (
          <span className="micro">—</span>
        ),
    },
    {
      key: "when",
      label: "Applied",
      render: (r) => (
        <span className="num text-muted-foreground">
          {dateFmt(r.applied_at)}
        </span>
      ),
    },
    {
      // THE action this table has been missing since 0525. Finding somebody was
      // never the hard part; going back to them was.
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConsidering({
                kind: "applicant",
                id: r.applicant_id,
                name: r.full_name,
                from: r.vacancy_title,
              })
            }
          >
            Consider
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="sec">
        <h2>Past applicants</h2>
        <span className="ln" />
      </div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(term.trim());
        }}
      >
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name, skill or assessment…"
          aria-label="Search past applicants"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <DataList
        columns={cols}
        rows={pool.data}
        error={pool.error}
        loading={pool.loading}
        rowKey={(r) => r.applicant_id}
        empty={{
          title: q ? "Nobody matched" : "No past applicants yet",
          hint: q
            ? "Try a different skill or spelling."
            : "Candidates you reject or move to the pool appear here for future roles.",
        }}
      />
      {considering && (
        <ConsiderDialog
          source={considering}
          onClose={() => setConsidering(null)}
          onDone={() => pool.reload()}
        />
      )}
    </>
  );
}

export function TalentPoolPage() {
  const { rows, error, loading, reload } = useList<Talent>("/talent-pool");
  const plans = useResource(
    () => tenant<Succession[]>("/succession").then((r) => r),
    [],
  );
  const [creating, setCreating] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const [considering, setConsidering] = React.useState<ConsiderSource | null>(null);
  const list = rows || [];
  const planList = plans.data || [];
  const readyNow = planList.filter((p) => p.readiness === "ready_now").length;
  const cols: Column<Talent>[] = [
    {
      key: "full_name",
      label: "Name",
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.full_name || "—"}
        </span>
      ),
    },
    {
      key: "skills",
      label: "Skills",
      render: (r) =>
        (r.skills || "").trim() ? (
          <span className="flex flex-wrap gap-1">
            {r
              .skills!.split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-[rgb(var(--ink)/0.06)] px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {s}
                </span>
              ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "created_at",
      label: "Added",
      render: (r) => (
        <span className="num text-muted-foreground">
          {dateFmt(r.created_at)}
        </span>
      ),
    },
    {
      key: "last",
      label: "Last approached",
      // Stops two recruiters ringing the same person about two roles in the
      // same week — the thing that makes a company look disorganised to exactly
      // the people it wants to hire.
      render: (r) =>
        r.last_considered_at ? (
          <span className="num text-muted-foreground">
            {dateFmt(r.last_considered_at)}
          </span>
        ) : (
          <span className="micro">—</span>
        ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConsidering({
                kind: "bench",
                id: r.talent_pool_id,
                name: r.full_name || "this candidate",
              })
            }
          >
            Consider
          </Button>
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={eyebrow}
        title="Talent & succession"
        description="Successors for key roles, plus the candidate bench for future hiring."
        action={<Button onClick={() => setPlanning(true)}>New plan</Button>}
      />
      <HubTabs />{" "}
      <KpiRow>
        <KpiTile label="Succession plans" value={num(planList.length)} />
        <KpiTile label="Ready-now successors" value={num(readyNow)} />
        <KpiTile label="Bench candidates" value={num(list.length)} />
      </KpiRow>
      <div className="sec">
        <h2>Succession plans</h2>
        <span className="ln" />
      </div>
      {plans.error ? (
        <ErrorState message={plans.error} />
      ) : planList.length === 0 ? (
        <EmptyState
          title="No succession plans"
          hint="Name a successor for a key role to get started."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {planList.map((p) => {
            const rm = readinessMeta(p.readiness);
            return (
              <div key={p.succession_plan_id} className="lux-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground">
                    {p.role_title || "—"}
                  </div>
                  {rm && <Pill tone={rm.tone}>{rm.label}</Pill>}
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="micro">Incumbent</span>
                    <span className="text-muted-foreground">
                      {p.incumbent_name || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="micro">Successor</span>
                    <span className="font-medium text-foreground">
                      {p.successor_name || "—"}
                    </span>
                  </div>
                </div>
                {p.notes && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <PastApplicants />
      <div className="sec">
        <h2>Talent pool</h2>
        <span className="ln" />
        <button className="text-primary-ink" onClick={() => setCreating(true)}>
          Add candidate
        </button>
      </div>
      <DataList
        columns={cols}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.talent_pool_id}
        empty={{
          title: "Talent pool is empty",
          hint: "Add promising candidates you met outside a vacancy.",
        }}
      />
      {creating && (
        <TalentForm onClose={() => setCreating(false)} onSaved={reload} />
      )}
      {planning && (
        <SuccessionForm
          onClose={() => setPlanning(false)}
          onSaved={plans.reload}
        />
      )}
      {considering && (
        <ConsiderDialog
          source={considering}
          onClose={() => setConsidering(null)}
          onDone={reload}
        />
      )}
    </section>
  );
}
