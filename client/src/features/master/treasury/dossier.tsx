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
import { tr } from "@/lib/i18n";
import { Link, useParams } from "react-router-dom";
import { Pill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SectionTabs } from "@/components/ui/section-tabs";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { useUrlTab } from "@/lib/use-url-tab";
import { money, dateFmt, cell } from "@/lib/format";
import * as api from "@/lib/treasury-api";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { useToast } from "@/components/ui/toast";
import { AccountModal } from "./account-modal";
import { DocumentModal } from "./document-modal";
import { SignatoryModal } from "./signatory-modal";
import { ReconciliationTab } from "./reconciliation-tab";

const TABS = [
  "Overview",
  "Statement",
  "Reconciliation",
  "CoA leaf",
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
const Td = ({
  children,
  r,
  className = "",
  title,
}: {
  children?: React.ReactNode;
  r?: boolean;
  className?: string;
  title?: string;
}) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""} ${className}`} title={title}>
    {children}
  </td>
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
  // `?tab=` (use-url-tab), not local state: this 360 exists on its own route
  // precisely to be deep-linkable, and a reload was dumping the reader back on
  // Overview. "Overview" is the fallback, so the param is omitted there.
  const [tab, setTab] = useUrlTab<Tab>(TABS, "Overview");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [docModalOpen, setDocModalOpen] = React.useState(false);
  const [sigModalOpen, setSigModalOpen] = React.useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [prompt, promptDialog] = usePrompt();
  const toast = useToast();

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
        title={tr("Not found")}
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
            {a.is_primary && <Pill tone="blue">{tr("Primary")}</Pill>}
            {a.is_verified ? (
              <Pill tone="ok">{tr("Verified")}</Pill>
            ) : (
              <Pill tone="warn">{tr("Unverified")}</Pill>
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
          {/* Corrections live here. A treasury account is never deleted — its
              CoA leaf is referenced by journal history — so a typo'd account
              number or a missing zero on the opening balance is fixed in
              place, not by creating a second account. */}
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            {tr("Edit")}
          </Button>
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

      <AccountModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={a}
        custodianName={data.custodian?.full_name ?? null}
        onSaved={() => {
          reload();
          onChanged?.();
        }}
      />

      <DocumentModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        accountId={id}
        onSaved={() => {
          reload();
          onChanged?.();
        }}
      />

      <SignatoryModal
        open={sigModalOpen}
        onClose={() => setSigModalOpen(false)}
        accountId={id}
        currency={a.currency || "XAF"}
        onSaved={() => {
          reload();
          onChanged?.();
        }}
      />

      {confirmDialog}
      {promptDialog}

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <KpiRow stack>
        <KpiTile
          label={tr("Balance")}
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
        <KpiTile
          label={tr("Unreconciled")}
          value={data.kpis.unreconciled_count === null ? "—" : String(data.kpis.unreconciled_count)}
          hint={data.kpis.unreconciled_count ? tr("Items needing reconciliation") : tr("All items reconciled")}
          onClick={() => setTab("Reconciliation")}
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

      {/* ── Tabs ──────────────────────────────────────────────────────────
          Seven sections, and this strip used to be the app's third look for the
          same control (rounded folder tabs). `SectionTabs` is the shared one:
          one row on a phone, the active section centred, fading at whichever
          edge has more. */}
      <SectionTabs
        label="Treasury sections"
        value={tab}
        onChange={setTab}
        sticky
        className="mb-3"
        tabs={TABS.map((t) => ({ value: t, label: t }))}
      />

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {c?.is_bank_identity && (
            <Section title="Bank identity">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label={tr("Bank")}>{cell(a.bank_name)}</Detail>
                <Detail label={tr("Branch")}>{cell(a.branch)}</Detail>
                <Detail label={tr("Account number")}>{cell(a.account_number)}</Detail>
                <Detail label={tr("IBAN")}>{cell(a.iban)}</Detail>
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
                <Detail label={tr("Number")}>{cell(a.momo_number)}</Detail>
                <Detail label="Till">{cell(a.momo_till)}</Detail>
                <Detail label="Merchant / Agent">{cell(a.momo_agent)}</Detail>
                <Detail label="Fee CoA">{cell(a.momo_fee_account)}</Detail>
              </dl>
            </Section>
          )}
          {c?.requires_custodian && (
            <Section
              title={tr("Custodian")}
              description="Responsible for payouts from this account."
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label={tr("Custodian")}>
                  {data.custodian ? data.custodian.full_name : null}
                </Detail>
                <Detail label={tr("Location")}>{cell(a.location)}</Detail>
                <Detail label="Float limit">
                  {amount(a.float_limit, a.currency)}
                </Detail>
                <Detail label={tr("Contact")}>
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
          <Section title={tr("Verification")}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={tr("Status")}>
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
                <Th>{tr("Date")}</Th>
                <Th>Journal · No</Th>
                <Th>{tr("Description")}</Th>
                <Th r>{tr("Debit")}</Th>
                <Th r>{tr("Credit")}</Th>
                <Th>{tr("Status")}</Th>
                <Th r>{tr("Reversal")}</Th>
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
                <Td r>
                  {l.reversed_by_entry_no ? (
                    <Pill tone="mute">{tr("Reversed by #")}{l.reversed_by_entry_no}</Pill>
                  ) : l.reverses_entry_no ? (
                    <Pill tone="blue">{tr("Reversal of #")}{l.reverses_entry_no}</Pill>
                  ) : l.status === "validated" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const reason = await prompt({
                          title: tr("Reverse Journal Entry"),
                          label: tr("Reason for reversing entry #") + l.entry_no,
                          placeholder: tr("e.g. Inadvertent duplicate or wrong account"),
                        });
                        if (!reason) return;
                        try {
                          await api.reverseEntry(id, l.entry_id, reason);
                          reload();
                          onChanged?.();
                          toast.success(tr("Journal entry reversed"));
                        } catch (e) {
                          toast.error(errMsg(e));
                        }
                      }}
                    >
                      {tr("Reverse")}
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </MiniTable>
          <p className="micro text-muted-foreground mt-2">
            {tr("Note: Only validated postings are included in posted balance and monthly KPI totals. Draft and reversed entries are excluded.")}
          </p>
        </Section>
      )}

      {tab === "Reconciliation" && (
        <ReconciliationTab
          accountId={a.treasury_account_id}
          entityId={a.entity_id}
          currency={a.currency}
          categoryCode={a.category_code ?? null}
          requiresCustodian={a.category_requires_custodian === true}
          floatLimit={a.float_limit === null || a.float_limit === undefined ? null : Number(a.float_limit)}
        />
      )}

      {tab === "CoA leaf" && (
        <Section
          title="CoA leaf"
          description="Every treasury account owns exactly one auto-minted CoA leaf under its category's parent."
        >
          {data.coa_leaf ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={tr("Code")}>{cell(data.coa_leaf.code)}</Detail>
              <Detail label="Parent">{cell(data.coa_leaf.parent_code)}</Detail>
              <Detail label={tr("Label")}>
                {cell(data.coa_leaf.label_en || data.coa_leaf.label_fr)}
              </Detail>
              <Detail label={tr("Class")}>{String(data.coa_leaf.class)}</Detail>
              <Detail label={tr("Postable")}>
                {data.coa_leaf.is_postable ? "Yes" : "No"}
              </Detail>
              <Detail label={tr("Active")}>
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
        <Section
          title="Authorized signatories"
          description="Single- and joint-signature limits, effective dates and authority rules"
          action={
            <Button size="sm" onClick={() => setSigModalOpen(true)}>
              Add signatory
            </Button>
          }
        >
          <MiniTable
            head={
              <>
                <Th>{tr("Name")}</Th>
                <Th>Role</Th>
                <Th>Type</Th>
                <Th>Rule</Th>
                <Th r>Limit</Th>
                <Th>Effective</Th>
                <Th r>Actions</Th>
              </>
            }
            empty={!data.signatories || data.signatories.length === 0}
            emptyLabel="No signatories registered yet — add authorized signatories above."
          >
            {(data.signatories || []).map((sig) => (
              <tr key={sig.signatory_id}>
                <Td className="font-medium">
                  <div>{sig.full_name}</div>
                  {(sig.email || sig.phone) && (
                    <div className="micro text-muted-foreground">
                      {[sig.email, sig.phone].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </Td>
                <Td>{cell(sig.role_title)}</Td>
                <Td>
                  <Pill tone={sig.signatory_type === "PRIMARY" ? "blue" : "mute"}>
                    {sig.signatory_type}
                  </Pill>
                </Td>
                <Td>
                  <span className="micro">
                    {sig.rule_type === "SINGLE_SIGNATURE"
                      ? "Single signature"
                      : "Joint required"}
                  </span>
                </Td>
                <Td r>
                  {sig.limit_amount
                    ? amount(sig.limit_amount, sig.currency)
                    : "Unlimited"}
                </Td>
                <Td>
                  <span className="micro">
                    {dateFmt(sig.effective_from)}
                    {sig.effective_to ? ` → ${dateFmt(sig.effective_to)}` : " (indefinite)"}
                  </span>
                </Td>
                <Td r>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Remove signatory",
                        body: `Remove ${sig.full_name} from authorized signatories?`,
                        confirmLabel: "Remove",
                        destructive: true,
                      });
                      if (!ok) return;
                      await api.removeSignatory(id, sig.signatory_id);
                      reload();
                    }}
                  >
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Documents" && (
        <Section
          title="Attached documents"
          description="Bank confirmation, RIB, mandates, KYC and signature cards"
          action={
            <Button size="sm" onClick={() => setDocModalOpen(true)}>
              Attach document
            </Button>
          }
        >
          <MiniTable
            head={
              <>
                <Th>Type</Th>
                <Th>{tr("Title")}</Th>
                <Th>Number</Th>
                <Th>Issue date</Th>
                <Th>Expiry date</Th>
                <Th>{tr("Status")}</Th>
                <Th r>Actions</Th>
              </>
            }
            empty={!data.documents || data.documents.length === 0}
            emptyLabel="No documents attached yet — attach the bank RIB or mandate above."
          >
            {(data.documents || []).map((doc) => (
              <tr key={doc.document_id}>
                <Td>
                  <code className="rounded bg-muted px-1 text-xs">
                    {doc.document_type}
                  </code>
                </Td>
                <Td className="font-medium">{doc.title}</Td>
                <Td>{cell(doc.document_number)}</Td>
                <Td>{dateFmt(doc.issue_date)}</Td>
                <Td>{dateFmt(doc.expiry_date)}</Td>
                <Td>
                  <Pill tone={doc.is_verified ? "ok" : "warn"}>
                    {doc.is_verified ? "Verified" : "Unverified"}
                  </Pill>
                </Td>
                <Td r>
                  <div className="flex items-center justify-end gap-1">
                    {!doc.is_verified && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await api.verifyDocument(id, doc.document_id);
                          reload();
                        }}
                      >
                        Verify
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Remove document",
                          body: `Remove ${doc.title}?`,
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (!ok) return;
                        await api.removeDocument(id, doc.document_id);
                        reload();
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Timeline" && (
        <Section
          title={tr("Timeline")}
          description="Every change to this account, from the audit log."
        >
          <MiniTable
            head={
              <>
                <Th>{tr("When")}</Th>
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
                <Td title={t.actor_user_id || undefined}>
                  {t.actor_name || t.actor_user_id || tr("System")}
                </Td>
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
