/**
 * Treasury 360 dossier.
 *
 * `TreasuryDossier` is the reusable body — header card, KPI row, tabbed
 * collections. It's used inline by the master–detail list
 * (features/master/treasury/index.tsx) and by the deep-link route
 * (features/master/treasury/dossier-page.tsx), the same shape as party-360 and
 * entity-360.
 *
 * One /treasury-accounts/:id/360 call feeds every tab. Everything renders for
 * a brand-new account with nothing posted — the KPIs show zero, the tabs show
 * their empty states, the readiness checklist is what "what do I do next" reads
 * from. That was the whole point of the audit.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { Pill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, cell } from "@/lib/format";
import * as api from "@/lib/treasury-api";

const TABS = [
  "Overview",
  "Statement",
  "Reconciliation",
  "Sub-account",
  "Signatories",
  "Documents",
  "Timeline",
] as const;
type Tab = (typeof TABS)[number];

function Detail({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="space-y-0.5">
      <dt className="micro text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm ${empty ? "text-muted-foreground" : "text-foreground"}`}
      >
        {empty ? "—" : children}
      </dd>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="micro text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  );
}

function MiniTable({
  head,
  children,
  empty,
  emptyLabel,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
  emptyLabel?: string;
}) {
  if (empty)
    return (
      <div className="px-3 py-6 text-center micro">
        {emptyLabel || "Nothing here yet."}
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

function amount(
  v: string | number | null | undefined,
  currency: string,
): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? "—" : money(n, currency);
}

/**
 * The reusable dossier body. `id` is the treasury_account_id; `onAction` is a
 * bag of write callbacks the parent list wires up (activate/verify/primary).
 * Both are optional so this stays renderable in isolation.
 */
export function TreasuryDossier({
  id,
  onChanged,
}: {
  id: string;
  onChanged?: () => void;
}) {
  const { data, error, loading, reload } = useResource(
    () => api.getDossier(id),
    [id],
  );
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  async function doAction(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await run();
      reload();
      onChanged?.();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingRow />;
  if (error) return <ErrorState message={error} />;
  if (!data)
    return (
      <EmptyState
        title="Not found"
        hint="This treasury account does not exist or you don't have access."
      />
    );

  const a = data.account;
  const c = data.category;
  const activeTone: Tone = a.is_active ? "ok" : "mute";

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{cell(a.label)}</h2>
            {a.is_primary && <Pill tone="blue">Primary</Pill>}
            {a.is_verified ? (
              <Pill tone="ok">Verified</Pill>
            ) : (
              <Pill tone="warn">Unverified</Pill>
            )}
            <Pill tone={activeTone}>{a.is_active ? "Active" : "Inactive"}</Pill>
          </div>
          <p className="micro text-muted-foreground">
            {c ? <>{c.label} · </> : null}
            CoA leaf{" "}
            <code className="rounded bg-muted px-1">{cell(a.coa_code)}</code>
            {c ? (
              <>
                {" "}
                under{" "}
                <code className="rounded bg-muted px-1">
                  {cell(c.coa_parent_code)}
                </code>
              </>
            ) : null}
            {" · "}
            {cell(a.currency)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!a.is_primary && (
            <Button
              size="sm"
              variant="outline"
              loading={busy === "primary"}
              onClick={() =>
                doAction("primary", () => api.setAccountPrimary(id))
              }
            >
              Set primary
            </Button>
          )}
          {a.is_verified ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === "verify"}
              onClick={() => doAction("verify", () => api.unverifyAccount(id))}
            >
              Un-verify
            </Button>
          ) : (
            <Button
              size="sm"
              loading={busy === "verify"}
              onClick={() => doAction("verify", () => api.verifyAccount(id))}
            >
              Verify
            </Button>
          )}
          <Button
            size="sm"
            variant={a.is_active ? "outline" : "default"}
            loading={busy === "active"}
            onClick={() =>
              doAction("active", () => api.setAccountActive(id, !a.is_active))
            }
          >
            {a.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
      {actionError && <ErrorState message={actionError} />}

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <KpiRow>
        <KpiTile
          label="Balance"
          value={amount(data.kpis.balance, data.kpis.currency)}
        />
        <KpiTile
          label="Opening"
          value={amount(data.kpis.opening_balance, data.kpis.currency)}
        />
        <KpiTile
          label="Debits (posted)"
          value={amount(data.kpis.debit_total, data.kpis.currency)}
        />
        <KpiTile
          label="Credits (posted)"
          value={amount(data.kpis.credit_total, data.kpis.currency)}
        />
        <KpiTile
          label="This month (net)"
          value={amount(data.kpis.mtd.net, data.kpis.currency)}
        />
        <KpiTile
          label="This year (net)"
          value={amount(data.kpis.ytd.net, data.kpis.currency)}
        />
      </KpiRow>

      {/* Readiness — the empty-state that explains itself. */}
      {data.readiness.percent < 100 && (
        <Section
          title={`Readiness · ${data.readiness.done}/${data.readiness.total}`}
          description="What is missing for this account to be fully configured."
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {data.readiness.items
              .filter((i) => !i.ok)
              .map((i) => (
                <div key={i.key} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-warn/40 text-warn">
                    !
                  </span>
                  <div>
                    <div className="text-foreground">{i.label}</div>
                    {i.hint && (
                      <div className="micro text-muted-foreground">
                        {i.hint}
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            className={`rounded-t-md px-3 py-1.5 text-sm ${tab === t ? "bg-card border border-b-transparent border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {c?.is_bank_identity && (
            <Section title="Bank identity">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Bank">{cell(a.bank_name)}</Detail>
                <Detail label="Branch">{cell(a.branch)}</Detail>
                <Detail label="Account number">{cell(a.account_number)}</Detail>
                <Detail label="IBAN">{cell(a.iban)}</Detail>
                <Detail label="SWIFT / BIC">{cell(a.swift_bic)}</Detail>
                <Detail label="Routing">{cell(a.routing_code)}</Detail>
                <Detail label="Holder">{cell(a.holder_name)}</Detail>
                <Detail label="Statement day">
                  {a.statement_day ? String(a.statement_day) : null}
                </Detail>
              </dl>
            </Section>
          )}
          {c?.is_momo_identity && (
            <Section title="Mobile-money identity">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Number">{cell(a.momo_number)}</Detail>
                <Detail label="Till">{cell(a.momo_till)}</Detail>
                <Detail label="Merchant / Agent">{cell(a.momo_agent)}</Detail>
                <Detail label="Fee CoA">{cell(a.momo_fee_account)}</Detail>
              </dl>
            </Section>
          )}
          {c?.requires_custodian && (
            <Section
              title="Custodian"
              description="Responsible for payouts from this account."
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Custodian">
                  {data.custodian ? data.custodian.full_name : null}
                </Detail>
                <Detail label="Location">{cell(a.location)}</Detail>
                <Detail label="Float limit">
                  {amount(a.float_limit, a.currency)}
                </Detail>
                <Detail label="Contact">
                  {data.custodian
                    ? [data.custodian.email, data.custodian.phone]
                        .filter(Boolean)
                        .join(" · ")
                    : null}
                </Detail>
              </dl>
            </Section>
          )}
          <Section title="Last movements">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Last debit">
                {data.last_debit ? (
                  <div>
                    <div className="font-medium">
                      {amount(data.last_debit.amount, a.currency)}
                    </div>
                    <div className="micro text-muted-foreground">
                      {dateFmt(data.last_debit.entry_date)} ·{" "}
                      {cell(data.last_debit.description)}
                    </div>
                  </div>
                ) : null}
              </Detail>
              <Detail label="Last credit">
                {data.last_credit ? (
                  <div>
                    <div className="font-medium">
                      {amount(data.last_credit.amount, a.currency)}
                    </div>
                    <div className="micro text-muted-foreground">
                      {dateFmt(data.last_credit.entry_date)} ·{" "}
                      {cell(data.last_credit.description)}
                    </div>
                  </div>
                ) : null}
              </Detail>
            </dl>
          </Section>
          <Section title="Verification">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Status">
                {a.is_verified ? "Verified" : "Unverified"}
              </Detail>
              <Detail label="Verified by">
                {data.verifier ? data.verifier.full_name : null}
              </Detail>
              <Detail label="Verified at">{dateFmt(a.verified_at)}</Detail>
              <Detail label="Opening date">{dateFmt(a.opening_date)}</Detail>
            </dl>
          </Section>
        </div>
      )}

      {tab === "Statement" && (
        <Section
          title="Recent journal lines"
          description="Every posting that hit this account's CoA leaf. Newest first."
        >
          <MiniTable
            head={
              <>
                <Th>Date</Th>
                <Th>Journal · No</Th>
                <Th>Description</Th>
                <Th r>Debit</Th>
                <Th r>Credit</Th>
                <Th>Status</Th>
              </>
            }
            empty={data.recent_lines.length === 0}
            emptyLabel="No postings on this account yet — journals will populate this once you invoice or record a receipt."
          >
            {data.recent_lines.map((l) => (
              <tr key={l.line_id}>
                <Td>{dateFmt(l.entry_date)}</Td>
                <Td>
                  {l.journal_code} · {l.entry_no}
                </Td>
                <Td>{cell(l.description)}</Td>
                <Td r>
                  {Number(l.debit) > 0 ? amount(l.debit, l.currency) : ""}
                </Td>
                <Td r>
                  {Number(l.credit) > 0 ? amount(l.credit, l.currency) : ""}
                </Td>
                <Td>
                  <Pill tone={l.status === "validated" ? "ok" : "warn"}>
                    {l.status}
                  </Pill>
                </Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Reconciliation" && (
        <EmptyState
          title="Reconciliation is coming next"
          hint="Upload a bank statement (CSV/OFX) and match its lines to the postings. Follow-up to this refactor."
        />
      )}

      {tab === "Sub-account" && (
        <Section
          title="CoA leaf"
          description="Every treasury account owns exactly one auto-minted CoA leaf under its category's parent."
        >
          {data.coa_leaf ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Code">{cell(data.coa_leaf.code)}</Detail>
              <Detail label="Parent">{cell(data.coa_leaf.parent_code)}</Detail>
              <Detail label="Label">
                {cell(data.coa_leaf.label_en || data.coa_leaf.label_fr)}
              </Detail>
              <Detail label="Class">{String(data.coa_leaf.class)}</Detail>
              <Detail label="Postable">
                {data.coa_leaf.is_postable ? "Yes" : "No"}
              </Detail>
              <Detail label="Active">
                {data.coa_leaf.is_active ? "Yes" : "No"}
              </Detail>
            </dl>
          ) : (
            <EmptyState
              title="No leaf"
              hint="This account has no CoA leaf yet — reach out to support."
            />
          )}
        </Section>
      )}

      {tab === "Signatories" && (
        <EmptyState
          title="Signatories module is coming"
          hint="Add signatories with single- and joint-signature limits. Follow-up to this refactor."
        />
      )}

      {tab === "Documents" && (
        <EmptyState
          title="No documents attached yet"
          hint="Attach the bank mandate, KYC letter and signature card here. Follow-up to this refactor."
        />
      )}

      {tab === "Timeline" && (
        <Section
          title="Timeline"
          description="Every change to this account, from the audit log."
        >
          <MiniTable
            head={
              <>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
              </>
            }
            empty={data.timeline.length === 0}
          >
            {data.timeline.map((t) => (
              <tr key={t.audit_id}>
                <Td>{dateFmt(t.occurred_at)}</Td>
                <Td>
                  <code className="rounded bg-muted px-1 text-xs">
                    {t.action}
                  </code>
                </Td>
                <Td>{cell(t.actor_user_id)}</Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}
    </div>
  );
}

/**
 * The route-level page — wraps the dossier with a breadcrumb link back.
 *
 * Reads the id from `useParams`, not `window.location.pathname`. React Router
 * already parsed the URL for us; going back to `window.location` treats the
 * path as untrusted user-controlled data (CodeQL flags it as a taint source)
 * and would misbehave on any nested route (`/master/treasury-accounts/:id/edit`
 * would give us `edit`, not the id). Same pattern entity-360 uses.
 */
export function TreasuryDossierPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <div className="space-y-4">
      <div>
        <Link
          to="/master/treasury-accounts"
          className="micro text-muted-foreground hover:text-foreground"
        >
          ← Back to Treasury
        </Link>
      </div>
      <TreasuryDossier id={id} />
    </div>
  );
}
