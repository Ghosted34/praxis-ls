/**
 * My HR — the employee's self-service view of everything HR concerning them:
 * disciplinary queries they can respond to, sanctions on record, and their KPI
 * appraisals. Reads the self-scoped /mine endpoints (no admin grant needed).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { useResource, errMsg } from "@/lib/use-resource";
import { Pill, type Tone } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { money, dateFmt } from "@/lib/format";

type Query = {
  hr_query_id: string;
  subject: string;
  body: string;
  severity: string;
  status: string;
  response?: string | null;
  responded_at?: string | null;
  due_at?: string | null;
  created_at?: string | null;
};
type Sanction = {
  hr_sanction_id: string;
  type: string;
  reason: string;
  amount_xaf?: number | null;
  effective_date?: string | null;
  end_date?: string | null;
  status: string;
};
type Appraisal = {
  appraisal_id: string;
  period_code?: string | null;
  rating?: number | null;
  metric?: string | null;
  comments?: string | null;
};
type Leave = {
  leave_request_id: string;
  kind?: string | null;
  leave_type_name?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  days?: number | string | null;
  amount?: number | null;
  status: string;
};
/** One row per leave type — what this employee has earned, taken and has left
 *  (0696). Their own figure, so it takes no MOD-15 grant to read. */
type Balance = {
  leave_type_id: string;
  name: string;
  is_paid: boolean;
  period_year: number;
  accrued: number;
  carried: number;
  taken: number;
  balance: number;
};
type Payslip = {
  payroll_run_item_id: string;
  period_code?: string | null;
  gross?: number | null;
  net_pay?: number | null;
  status?: string | null;
};
type Contract = {
  hr_contract_id: string;
  kind?: string | null;
  status: string;
  effective_on?: string | null;
  end_on?: string | null;
};

const leaveTone = (s: string): Tone =>
  s === "APPROVED" ? "ok" : s === "REJECTED" ? "bad" : "warn";
const contractTone = (s: string): Tone =>
  s === "SIGNED" ? "ok" : s === "ISSUED" ? "blue" : "mute";

const severityTone = (s: string): Tone =>
  s === "SERIOUS" ? "bad" : s === "WARNING" ? "warn" : "blue";
const queryStatusTone = (s: string): Tone =>
  s === "OPEN" ? "warn" : s === "RESPONDED" ? "blue" : "mute";
const sanctionTone = (t: string): Tone =>
  t === "FINE" ? "orange" : t === "WARNING" ? "warn" : "bad";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="micro mb-3">
        {title}
        {typeof count === "number" && count > 0 ? ` · ${count}` : ""}
      </p>
      {children}
    </div>
  );
}

function RespondModal({
  query,
  onClose,
  onDone,
}: {
  query: Query;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant(`/hr/queries/${query.hr_query_id}/respond`, {
        method: "POST",
        body: { response: text },
      });
      onDone();
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
      title="Respond to query"
      description={query.subject}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={busy || !text.trim()}
          >
            Submit response
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          {query.body}
        </div>
        <Field label="Your response" required>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}

            placeholder="Explain your side…"
          />
        </Field>
        {error && <ErrorState message={error} />}
      </form>
    </Modal>
  );
}

export function MyHrPage() {
  const queries = useResource<Query[]>(() => tenant("/hr/queries/mine"), []);
  const sanctions = useResource<Sanction[]>(
    () => tenant("/hr/sanctions/mine"),
    [],
  );
  const appraisals = useResource<Appraisal[]>(
    () => tenant("/appraisals/mine"),
    [],
  );
  const leave = useResource<Leave[]>(() => tenant("/leave/mine"), []);
  const balances = useResource<Balance[]>(() => tenant("/leave/mine/balances"), []);
  const payslips = useResource<Payslip[]>(() => tenant("/payroll/mine"), []);
  const contracts = useResource<Contract[]>(
    () => tenant("/contracts/mine"),
    [],
  );
  const [respondTo, setRespondTo] = React.useState<Query | null>(null);

  const qs = queries.data || [];
  const ss = sanctions.data || [];
  const as = appraisals.data || [];
  const lv = leave.data || [];
  // Types nobody has any standing in are noise on an employee's own page — a
  // row of zeroes for compassionate leave says nothing. Anything with movement
  // in either direction is shown.
  const bl = (balances.data || []).filter(
    (b) => b.balance !== 0 || b.accrued !== 0 || b.taken !== 0,
  );
  const ps = payslips.data || [];
  const cs = contracts.data || [];
  const openQueries = qs.filter((q) => q.status === "OPEN").length;

  return (
    <section className={pageShell.standard}>
      <PageHeader
        eyebrow="My HR"
        title="My HR"
        description="Everything HR concerning you — queries to respond to, sanctions on record, and your appraisals."
      />

      <div className="flex flex-col gap-8">
        <Section title="Queries" count={qs.length}>
          {queries.error ? (
            <ErrorState message={queries.error} />
          ) : qs.length === 0 && !queries.loading ? (
            <EmptyState
              title="No queries"
              hint="Disciplinary queries addressed to you will appear here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {openQueries > 0 && (
                <p className="text-xs text-[rgb(var(--warn))]">
                  You have {openQueries} query{openQueries > 1 ? "ies" : ""}{" "}
                  awaiting your response.
                </p>
              )}
              {qs.map((q) => (
                <div key={q.hr_query_id} className="lux-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {q.subject}
                        </span>
                        <Pill tone={severityTone(q.severity)}>
                          {q.severity}
                        </Pill>
                        <Pill tone={queryStatusTone(q.status)}>{q.status}</Pill>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {q.body}
                      </p>
                      {q.response && (
                        <p className="mt-2 rounded-md border-l-2 border-[rgb(var(--primary))] bg-muted/40 px-3 py-1.5 text-sm">
                          <span className="micro mb-0.5 block">
                            Your response
                          </span>
                          {q.response}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {dateFmt(q.created_at)}
                      </p>
                    </div>
                    {q.status === "OPEN" && (
                      <Button size="sm" onClick={() => setRespondTo(q)}>
                        Respond
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Sanctions" count={ss.length}>
          {sanctions.error ? (
            <ErrorState message={sanctions.error} />
          ) : ss.length === 0 && !sanctions.loading ? (
            <EmptyState
              title="No sanctions"
              hint="Nothing on your disciplinary record."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {ss.map((s) => (
                <div
                  key={s.hr_sanction_id}
                  className="lux-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={sanctionTone(s.type)}>{s.type}</Pill>
                      <Pill tone={s.status === "ACTIVE" ? "bad" : "ok"}>
                        {s.status}
                      </Pill>
                      {s.amount_xaf ? (
                        <span className="num text-sm font-semibold">
                          {money(s.amount_xaf)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {s.reason}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <div>From {dateFmt(s.effective_date)}</div>
                    {s.end_date && <div>To {dateFmt(s.end_date)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Appraisals" count={as.length}>
          {appraisals.error ? (
            <ErrorState message={appraisals.error} />
          ) : as.length === 0 && !appraisals.loading ? (
            <EmptyState
              title="No appraisals"
              hint="Your performance appraisals will show here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {as.map((a) => (
                <div
                  key={a.appraisal_id}
                  className="lux-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {a.period_code || "—"}
                      </span>
                      {a.metric && (
                        <span className="text-sm text-muted-foreground">
                          {a.metric}
                        </span>
                      )}
                    </div>
                    {a.comments && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {a.comments}
                      </p>
                    )}
                  </div>
                  {a.rating != null && (
                    <span className="num text-lg font-semibold">
                      {a.rating}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Leave balance" count={bl.length}>
          {balances.error ? (
            <ErrorState message={balances.error} />
          ) : bl.length === 0 && !balances.loading ? (
            <EmptyState
              title="No entitlement yet"
              hint="Leave accrues monthly. Your balance appears here once the first month of service is complete."
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {bl.map((b) => (
                <div key={b.leave_type_id} className="lux-card flex items-baseline justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{b.name}</p>
                    {/* Where the number came from, so "you have 4 days" never
                        has to be taken on trust. */}
                    <p className="text-[11px] text-muted-foreground">
                      {b.accrued + b.carried} earned · {b.taken} taken · {b.period_year}
                    </p>
                  </div>
                  <span
                    className={`num text-lg font-semibold ${b.balance <= 0 ? "text-[rgb(var(--bad))]" : "text-foreground"}`}
                  >
                    {b.balance}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Leave & allowances" count={lv.length}>
          {leave.error ? (
            <ErrorState message={leave.error} />
          ) : lv.length === 0 && !leave.loading ? (
            <EmptyState
              title="No requests"
              hint="Your leave and allowance requests will show here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {lv.map((l) => (
                <div
                  key={l.leave_request_id}
                  className="lux-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold capitalize text-foreground">
                      {l.leave_type_name || (l.kind || "leave").replace(/_/g, " ")}
                    </span>
                    <Pill tone={leaveTone(l.status)}>{l.status}</Pill>
                    {l.amount ? (
                      <span className="num text-sm">{money(l.amount)}</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {dateFmt(l.starts_on)}{" "}
                    {l.ends_on ? `→ ${dateFmt(l.ends_on)}` : ""}
                    {/* What it cost them, which is the first thing anyone
                        checks against their own balance above. */}
                    {Number(l.days) > 0 ? ` · ${Number(l.days)} d` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Payslips" count={ps.length}>
          {payslips.error ? (
            <ErrorState message={payslips.error} />
          ) : ps.length === 0 && !payslips.loading ? (
            <EmptyState
              title="No payslips"
              hint="Your pay history appears here once payroll runs are approved."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {ps.map((p) => (
                <div
                  key={p.payroll_run_item_id}
                  className="lux-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {p.period_code || "—"}
                    </span>
                    {p.status && (
                      <Pill tone={p.status === "DISBURSED" ? "ok" : "blue"}>
                        {p.status}
                      </Pill>
                    )}
                  </div>
                  <div className="flex items-center gap-5 text-right">
                    <div>
                      <div className="micro">Gross</div>
                      <div className="num text-sm">{money(p.gross)}</div>
                    </div>
                    <div>
                      <div className="micro">Net</div>
                      <div className="num text-sm font-semibold">
                        {money(p.net_pay)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Contracts" count={cs.length}>
          {contracts.error ? (
            <ErrorState message={contracts.error} />
          ) : cs.length === 0 && !contracts.loading ? (
            <EmptyState
              title="No contracts"
              hint="Your employment contracts will show here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {cs.map((c) => (
                <div
                  key={c.hr_contract_id}
                  className="lux-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold capitalize text-foreground">
                      {(c.kind || "contract").replace(/_/g, " ").toLowerCase()}
                    </span>
                    <Pill tone={contractTone(c.status)}>{c.status}</Pill>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {dateFmt(c.effective_on)}{" "}
                    {c.end_on ? `→ ${dateFmt(c.end_on)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {respondTo && (
        <RespondModal
          query={respondTo}
          onClose={() => setRespondTo(null)}
          onDone={() => queries.reload()}
        />
      )}
    </section>
  );
}

export default MyHrPage;
