/**
 * Party 360° command centre (spec §8.2) — shared by the client and supplier
 * masters. One rich view over the `/:id/360` aggregation: header with compliance
 * and lifecycle state, a GL-derived KPI strip, and tabs for the child
 * collections (documents/KYC, contacts, addresses, banks, registrations,
 * beneficial owners) plus the financial rollup.
 *
 * Lifecycle actions live here too — verify (the digital-scan gate, Hard Rule 9),
 * the manual hard block/unblock (Hard Rule 3), and the Smart Copy conversion
 * bridge (Hard Rule 2). Bank numbers arrive already masked from the API for a
 * caller without finance visibility (gate 14); this view never unmasks them.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, enumLabel } from "@/lib/format";
import { SmartCountryPicker } from "@/components/smart-country-picker";
import * as api from "@/lib/masterdata-api";

// Deep-link targets (§3.1) — the real hub-section routes confirmed in
// src/app/app.tsx. A `focus` query hints the record to the destination list.
const MODULE_ROUTE = {
  dossier: "/operations/files",
  invoice: "/finance/invoices",
  receipt: "/finance/receivables",
  po: "/procurement/purchase-orders",
  supplier_invoice: "/procurement/supplier-invoices",
} as const;
const focusHref = (route: string, id?: string | null) => (id ? `${route}?focus=${encodeURIComponent(id)}` : route);

const STATE_TONE: Record<string, Tone> = { OK: "ok", ONBOARDING: "blue", WARN: "warn", ESCALATED: "bad", SOFT_BLOCK_RECOMMENDATION: "orange", HARD_BLOCK: "bad" };
const SEVERITY_TONE: Record<string, Tone> = { INFO: "mute", WARN: "warn", ESCALATED: "bad", SOFT_BLOCK_RECOMMENDATION: "orange", RED: "bad", HARD_BLOCK: "bad" };
const REG_TONE: Record<string, Tone> = { DRAFT: "mute", PENDING_REVIEW: "blue", ACTIVE: "ok", SUSPENDED: "orange", DEACTIVATED: "mute", ARCHIVED: "mute" };
const AVL_TONE: Record<string, Tone> = { PROSPECT: "mute", PENDING_KYC: "warn", APPROVED: "ok", CONDITIONAL: "orange", SUSPENDED: "orange", BLOCKED: "bad", ARCHIVED: "mute" };
const SCAN_TONE: Record<string, Tone> = { PENDING: "warn", SCANNED: "blue", VERIFIED: "ok", REJECTED: "bad", EXPIRED: "bad" };
const ADDRESS_TYPES = ["REGISTERED", "BILLING", "DELIVERY", "PICKUP", "WAREHOUSE", "REMITTANCE", "NOTIFY"];

/* ── Small building blocks ─────────────────────────────────────────────────── */

function MiniTable({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  if (empty) return <div className="px-3 py-6 text-center micro">Nothing here yet.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>;

type FieldSpec = { key: string; label: string; type?: "text" | "number" | "date" | "email" | "country" | "checkbox" | "select"; options?: { value: string; label: string }[]; placeholder?: string };

/** Generic "add a nested item" modal — one implementation for every collection. */
function AddModal({ title, fields, onClose, onSubmit }: { title: string; fields: FieldSpec[]; onClose: () => void; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true); setError(null);
    try { await onSubmit(values); onClose(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={title} description="Fields marked on the master form as required are enforced by the API.">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className={`space-y-1 text-sm ${f.type === "checkbox" ? "flex items-center gap-2" : ""}`}>
            <span className="font-medium text-foreground">{f.label}</span>
            {f.type === "country" ? (
              <SmartCountryPicker value={(values[f.key] as string) || ""} onChange={(c) => set(f.key, c)} label={f.label} />
            ) : f.type === "checkbox" ? (
              <Checkbox checked={!!values[f.key]} onCheckedChange={(v) => set(f.key, v)} label={<span className="sr-only">{f.label}</span>} />
            ) : f.type === "select" ? (
              <Select value={(values[f.key] as string) || ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                value={(values[f.key] as string) ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorState message={error} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={save}>Add</Button>
      </div>
    </Modal>
  );
}

/* ── The dossier ───────────────────────────────────────────────────────────── */

const CLIENT_TABS = ["Overview", "Documents", "Contacts", "Addresses", "Banks", "Registrations", "Owners", "Financial"] as const;
type Tab = (typeof CLIENT_TABS)[number];

/* ── PR3-C: duplicates, governed merge, scorecard, pending changes ─────────── */

/** A cell that deep-links a financial/dossier row into its module (§3.1). */
function DeepLink({ route, id, children }: { route: string; id?: string | null; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="text-primary-ink underline underline-offset-2 hover:opacity-80" onClick={() => navigate(focusHref(route, id))}>
      {children}
    </button>
  );
}

/** Amber "Possible duplicates" panel (§5.1) — shown on the 360 for score ≥ 80. */
function DuplicatesPanel({ candidates, kind, onOpen, onMerge, canMerge }: {
  candidates: api.DedupeCandidate[]; kind: api.PartyKind;
  onOpen: (id: string) => void; onMerge: (c: api.DedupeCandidate) => void; canMerge: boolean;
}) {
  const strong = candidates.filter((c) => c.score >= 80);
  if (strong.length === 0) return null;
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-fill/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="orange">Possible duplicates</Pill>
        <span className="micro">This {kind} looks like {strong.length} existing record{strong.length === 1 ? "" : "s"} — review before trading.</span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {strong.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <button className="font-medium text-primary-ink underline" onClick={() => onOpen(c.id)}>{c.name || c.ref || c.id.slice(0, 8)}</button>
              <span className="ml-2 micro">{[c.ref, c.reasons.join(", "), `score ${c.score}`].filter(Boolean).join(" · ")}</span>
            </div>
            {canMerge && <Button size="sm" variant="outline" onClick={() => onMerge(c)}>Merge…</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Governed-merge confirm modal (§5.2): survivor pre-selected (this record), the
 *  loser is the chosen duplicate, counts previewed, survivor ref typed to confirm. */
function MergeModal({ kind, survivorId, survivorRef, loser, onClose, onDone }: {
  kind: api.PartyKind; survivorId: string; survivorRef: string; loser: api.DedupeCandidate;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [preview, setPreview] = React.useState<api.MergePreviewResult | null>(null);
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.mergePreview(kind, survivorId, survivorId, loser.id).then(setPreview).catch((e) => setError(errMsg(e)));
  }, [kind, survivorId, loser.id]);

  const refOk = confirm.trim() !== "" && confirm.trim() === (survivorRef || "").trim();
  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.mergeParty(kind, survivorId, survivorId, loser.id);
      onDone(r && r.pending ? "Merge submitted for approval" : "Records merged");
      onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Merge duplicate" description="Everything on the losing record is reattached to the survivor, its aliases are preserved, and it is archived (never deleted). This cannot be undone from the UI.">
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border p-3">
          <div><span className="micro">Survivor (kept)</span><div className="font-medium text-foreground">{preview?.survivor.name || survivorRef}</div></div>
          <div className="mt-2"><span className="micro">Loser (archived)</span><div className="font-medium text-foreground">{loser.name || loser.ref || loser.id.slice(0, 8)}</div></div>
        </div>
        {preview && (
          preview.moves.length === 0
            ? <p className="micro">No linked records to move.</p>
            : <div>
                <p className="mb-1 micro font-medium text-foreground">{preview.total} record{preview.total === 1 ? "" : "s"} will move to the survivor:</p>
                <ul className="space-y-0.5">
                  {preview.moves.map((m) => <li key={`${m.table}.${m.column}`} className="micro">{m.count} × {m.table.replace(/_/g, " ")}</li>)}
                </ul>
              </div>
        )}
        <label className="block space-y-1">
          <span className="font-medium text-foreground">Type the survivor ref <code className="micro">{survivorRef || "—"}</code> to confirm</span>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={survivorRef || ""} />
        </label>
        {error && <ErrorState message={error} />}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="default" loading={busy} disabled={!refOk} onClick={run}>Merge</Button>
      </div>
    </Modal>
  );
}

const CONVERT_CARRIED_OVER = [
  "Legal name, trading name, and registrations (NIU, RCCM…)",
  "Email, address, city, country",
  "Industry, website, notes, tax residency, default currency, risk tier",
];
const CONVERT_TODO = ["Bank accounts", "Contacts", "Addresses", "KYC / compliance documents", "Verification"];

/** Smart Copy conversion confirm modal (Hard Rule 2): shows what carries over to
 *  the new draft automatically and what does not, requires an explicit
 *  acknowledgement, then creates the draft — never a bare click-to-create. */
function ConvertModal({ kind, partyId, partyName, onClose, onDone }: {
  kind: api.PartyKind; partyId: string; partyName: string; onClose: () => void; onDone: (msg: string) => void;
}) {
  const targetLabel = kind === "client" ? "supplier" : "client";
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      await (kind === "client" ? api.convertFromClient(partyId) : api.convertFromSupplier(partyId));
      onDone(`Draft ${targetLabel} created`);
      onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Convert to ${targetLabel}`}
      description={`Creates a new draft ${targetLabel} linked to "${partyName}" (Smart Copy).`}>
      <div className="space-y-3 text-sm">
        <div>
          <p className="mb-1 font-medium text-foreground">Carried over automatically</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {CONVERT_CARRIED_OVER.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <div className="rounded-lg border border-warn/40 bg-warn-fill/30 p-3">
          <p className="mb-1 font-medium text-foreground">You&apos;ll need to complete before the draft can trade</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {CONVERT_TODO.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p className="mt-2 micro">
            Nothing here copies automatically (Hard Rule 2) — once created, use &quot;Copy from origin&quot; on each
            section of the new record if you want to reuse the same details.
          </p>
        </div>
        <Checkbox checked={ack} onCheckedChange={setAck}
          label={`I understand a new draft ${targetLabel} will be created and confirm this conversion.`} />
        {error && <ErrorState message={error} />}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="default" loading={busy} disabled={!ack} onClick={run}>Create draft {targetLabel}</Button>
      </div>
    </Modal>
  );
}

/** Lightweight inline-SVG horizontal bar chart (§3.2) — no chart library, so the
 *  single `vendor` bundle chunk stays acyclic. Colours come from ink tokens via
 *  currentColor (never a fill token used as type — the F13 contrast rule). */
function SvgBars({ data, ariaLabel, fmt }: { data: { label: string; value: number }[]; ariaLabel: string; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 20; const W = 260; const barX = 96; const barMax = W - barX - 4;
  return (
    <svg viewBox={`0 0 ${W} ${data.length * H}`} className="w-full" role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMin meet">
      {data.map((d, i) => (
        <g key={d.label} transform={`translate(0 ${i * H})`}>
          <text x="0" y={H / 2 + 3} className="fill-current text-muted-foreground" style={{ fontSize: 9 }}>{d.label}</text>
          <rect x={barX} y={H / 2 - 5} width={barMax} height="10" rx="2" className="fill-current text-muted-foreground" style={{ opacity: 0.2 }} />
          <rect x={barX} y={H / 2 - 5} width={Math.max(0, Math.round((d.value / max) * barMax))} height="10" rx="2" className="fill-current text-primary-ink" />
          <text x={W} y={H / 2 + 3} textAnchor="end" className="fill-current text-foreground" style={{ fontSize: 9 }}>{fmt(d.value)}</text>
        </g>
      ))}
    </svg>
  );
}

const AGING_COLUMNS: { key: api.AgingBucket; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
];

/** Aging card (§3.2) — receivables for a client, payables for a supplier. Same
 *  shape both sides now that the API buckets supplier payables too. Each bucket
 *  is a button: click it to drill into the invoices behind that figure. */
function AgingCard({ title, aging, onOpen }: { title: string; aging: api.Aging; onOpen: (bucket: api.AgingBucket, label: string) => void }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">{title}</h4>
      <div className="grid grid-cols-5 gap-2 text-center">
        {AGING_COLUMNS.map(({ key, label }) => (
          <button key={key} type="button" onClick={() => onOpen(key, label)}
            className="rounded-lg border p-2 transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <div className="num text-sm font-semibold text-foreground">{money(aging[key])}</div>
            <div className="micro">{label}</div>
          </button>
        ))}
      </div>
      {/* Inline-SVG aging chart (§3.2) — no chart library (bundle stays acyclic). */}
      <div className="mt-3">
        <SvgBars ariaLabel={title} fmt={money} data={AGING_COLUMNS.map(({ key, label }) => ({ label, value: aging[key] }))} />
      </div>
    </div>
  );
}

/** Aging drill-down (spec follow-up): the invoice list behind one Aging bucket,
 *  with days overdue for a past-due bucket or days remaining for Current. */
function AgingDetailModal({ kind, partyId, bucket, label, onClose }: { kind: api.PartyKind; partyId: string; bucket: api.AgingBucket; label: string; onClose: () => void }) {
  const detail = useResource(() => api.agingDetail(kind, partyId, bucket), [kind, partyId, bucket]);
  const isCurrent = bucket === "current";
  return (
    <Modal open onClose={onClose} title={`Aging — ${label}`}
      description={kind === "client" ? "Open receivables in this bucket." : "Open payables in this bucket."} size="lg">
      {detail.loading ? <LoadingRow label="Loading…" /> : detail.error ? <ErrorState message={detail.error} /> : !detail.data || detail.data.invoices.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-3">
          <p className="micro">
            {detail.data.count} invoice{detail.data.count === 1 ? "" : "s"} · {money(detail.data.total)} as of {dateFmt(detail.data.as_of)}
          </p>
          <MiniTable empty={false} head={<><Th>Invoice</Th><Th>Due date</Th><Th>{isCurrent ? "Due in" : "Overdue by"}</Th><Th r>Amount</Th></>}>
            {detail.data.invoices.map((i) => (
              <tr key={i.id}>
                <Td>{i.doc_number || i.id.slice(0, 8)}</Td>
                <Td>{dateFmt(i.due_on)}</Td>
                <Td>
                  {i.days_overdue > 0
                    ? `${i.days_overdue} day${i.days_overdue === 1 ? "" : "s"} overdue`
                    : i.days_until_due
                      ? `Due in ${i.days_until_due} day${i.days_until_due === 1 ? "" : "s"}`
                      : i.due_on ? "Due today" : "No due date"}
                </Td>
                <Td r>{money(i.amount)}</Td>
              </tr>
            ))}
          </MiniTable>
        </div>
      )}
    </Modal>
  );
}

const SCORE_TONE = (v: number): Tone => (v >= 80 ? "ok" : v >= 60 ? "warn" : "bad");

/** Supplier AVL scorecard (§3.3): six sub-scores + overall. Static class names
 *  only (Tailwind cannot purge-detect dynamically built ones). */
function ScorecardCard({ s }: { s: api.Scorecard }) {
  const rows: [string, number][] = [
    ["On-time", s.score_on_time], ["Claims", s.score_claims], ["Disputes", s.score_disputes],
    ["Responsiveness", s.score_responsiveness], ["Safety", s.score_safety], ["Compliance", s.score_compliance],
  ];
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">AVL scorecard</h4>
        <div className="flex items-center gap-2"><span className="micro">Overall</span><Pill tone={SCORE_TONE(s.score_overall)}>{num(s.score_overall)}</Pill></div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map(([label, v]) => (
          <div key={label} className="rounded-lg border p-2">
            <div className="flex items-center justify-between">
              <span className="micro">{label}</span><Pill tone={SCORE_TONE(v)}>{num(v)}</Pill>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
            </div>
          </div>
        ))}
      </div>
      {s.last_evaluated_at && <p className="mt-2 micro">Evaluated {dateFmt(s.last_evaluated_at)}</p>}
    </div>
  );
}

/** Pending sensitive-field / merge change requests awaiting a second approver (§8). */
function PendingChangesCard({ items, kind, partyId, onAct }: {
  items: api.PendingChange[]; kind: api.PartyKind; partyId: string; onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-fill/40 p-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><Pill tone="orange">Pending approval</Pill> Sensitive changes</h4>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.change_request_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{enumLabel(c.change_type)}{c.reason ? ` — ${c.reason}` : ""}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onAct(() => api.approveChange(kind, partyId, c.change_request_id), "Change approved")}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => onAct(() => api.rejectChange(kind, partyId, c.change_request_id), "Change rejected")}>Reject</Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 micro">Maker-checker: the person who raised a change cannot approve it.</p>
    </div>
  );
}

export function PartyDossier({ kind, partyId, onEdit, onChanged }: { kind: api.PartyKind; partyId: string; onEdit: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const dossier = useResource<api.Client360 | api.Supplier360>(
    () => (kind === "client" ? api.clientDossier(partyId) : api.supplierDossier(partyId)),
    [kind, partyId],
  );
  const docTypes = useResource(() => api.listDocumentTypes(kind === "client" ? "CLIENT" : "SUPPLIER"), [kind]);
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [adding, setAdding] = React.useState<null | "contact" | "address" | "bank" | "document" | "registration" | "owner">(null);
  const [blocking, setBlocking] = React.useState(false);
  const [converting, setConverting] = React.useState(false);
  const [merging, setMerging] = React.useState<api.DedupeCandidate | null>(null);
  const [revealed, setRevealed] = React.useState<Record<string, string>>({});
  const [aging, setAging] = React.useState<{ bucket: api.AgingBucket; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = () => { dossier.reload(); onChanged?.(); };
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null);
    try { await fn(); toast.success(ok); reload(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (dossier.loading) return <LoadingRow label="Loading 360…" />;
  if (dossier.error) return <ErrorState message={dossier.error} />;
  if (!dossier.data) return <EmptyState title="Not found" hint="This record could not be loaded." />;

  // One local shape covers both party kinds; the per-branch narrowing below is
  // by `kind`, and the response is typed at the API boundary.
  const d = dossier.data as api.Client360 & api.Supplier360;
  const p = d.party;
  const comp = d.compliance as api.Compliance;
  const isClient = kind === "client";
  const blocked = p.compliance_state === "HARD_BLOCK" || !!p.hard_blocked_at;
  const docTypeOptions = (docTypes.data || []).map((t) => ({ value: t.document_type_id, label: t.name }));
  // Conversion bridge (§6): the linked opposite-kind counterpart, if any.
  const linkedId = isClient ? p.linked_supplier_id : p.linked_client_id;
  const openParty = (targetKind: api.PartyKind, id?: string | null) =>
    navigate(`/master/${targetKind === "client" ? "clients" : "suppliers"}${id ? `?focus=${encodeURIComponent(id)}` : ""}`);
  // Explicit copy-from-origin (§6) — only offered on a converted party.
  const copySection = (section: api.CloneSection) =>
    act(async () => { const r = await api.cloneFromOrigin(kind, partyId, [section]); return r; }, "Copied from origin");
  async function revealBankNumber(bankId: string) {
    setError(null);
    try { const r = await api.revealBank(kind, partyId, bankId); setRevealed((s) => ({ ...s, [bankId]: r.account_number || r.iban || r.swift_bic || "—" })); }
    catch (e) { setError(errMsg(e)); }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">{p.legal_name || p.name}</h3>
              {p.compliance_state && <Pill tone={STATE_TONE[p.compliance_state] || "mute"}>{enumLabel(p.compliance_state)}</Pill>}
              {p.registration_status && <Pill tone={REG_TONE[p.registration_status] || "mute"}>{enumLabel(p.registration_status)}</Pill>}
              {p.verification_status === "VERIFIED" && <Pill tone="ok">Verified</Pill>}
              {!isClient && p.avl_status && <Pill tone={AVL_TONE[p.avl_status] || "mute"}>AVL {enumLabel(p.avl_status)}</Pill>}
            </div>
            <p className="mt-1 micro">
              {[p.ref, p.category_name, p.coa_aux_account && `Aux ${p.coa_aux_account}`, p.niu && `NIU ${p.niu}`].filter(Boolean).join(" · ") || "—"}
            </p>
            {/* Aliases preserved from merges / former names (§5.2). */}
            {(d.aliases || []).length > 0 && (
              <p className="mt-1 micro">Also known as: {(d.aliases || []).map((a) => a.alias).join(", ")}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
            {comp.can_verify && p.verification_status !== "VERIFIED" && (
              <Button size="sm" variant="outline" loading={busy} onClick={() => act(() => api.verifyParty(kind, partyId), "Verified")}>Verify</Button>
            )}
            {/* Lifecycle on/off (registration_status), independent of the hard block below. */}
            {p.registration_status === "ACTIVE"
              ? <Button size="sm" variant="outline" loading={busy}
                  onClick={() => act(() => api.setRegistrationStatus(kind, partyId, "DEACTIVATED"), isClient ? "Client deactivated" : "Supplier deactivated")}>
                  Deactivate
                </Button>
              : <Button size="sm" variant="outline" loading={busy}
                  onClick={() => act(() => api.setRegistrationStatus(kind, partyId, "ACTIVE"), isClient ? "Client activated" : "Supplier activated")}>
                  Activate
                </Button>}
            {blocked
              ? <Button size="sm" variant="outline" loading={busy} onClick={() => act(() => api.unblockParty(kind, partyId), "Unblocked")}>Unblock</Button>
              : <Button size="sm" variant="outline" onClick={() => setBlocking(true)}>Block</Button>}
            {/* Conversion bridge (§6): once linked, View the counterpart instead of re-converting. */}
            {linkedId
              ? <Button size="sm" variant="ghost" onClick={() => openParty(isClient ? "supplier" : "client", linkedId)}>
                  {isClient ? "View supplier" : "View client"}
                </Button>
              : <Button size="sm" variant="ghost" onClick={() => setConverting(true)}>
                  {isClient ? "→ Supplier" : "→ Client"}
                </Button>}
          </div>
        </div>
        {blocked && p.hard_block_reason && (
          <div className="mt-3 rounded-lg border border-bad/40 bg-bad-fill/40 px-3 py-2 text-sm text-foreground">
            <span className="font-medium">Hard-blocked</span> — {p.hard_block_reason}
          </div>
        )}
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </div>

      {/* Possible duplicates (§5.1) + pending sensitive changes (§8) */}
      <DuplicatesPanel
        candidates={d.duplicate_candidates || []} kind={kind}
        onOpen={(id) => openParty(kind, id)} onMerge={(c) => setMerging(c)} canMerge />
      <PendingChangesCard items={d.pending_changes || []} kind={kind} partyId={partyId} onAct={act} />

      {/* KPI strip */}
      {isClient ? (
        <KpiRow>
          <KpiTile label="Outstanding" value={money(d.kpis.outstanding)} />
          <KpiTile label="Overdue" value={money(d.kpis.overdue)} hint={d.kpis.oldest_due_date ? `oldest ${dateFmt(d.kpis.oldest_due_date)}` : undefined} />
          <KpiTile label="Credit available" value={d.kpis.credit_available != null ? money(d.kpis.credit_available) : "—"} />
          <KpiTile label="YTD revenue" value={money(d.kpis.ytd_revenue)} />
          <KpiTile label="Dossiers in progress" value={num(d.kpis.dossiers_in_progress)} />
        </KpiRow>
      ) : (
        <KpiRow>
          <KpiTile label="Payables" value={money(d.kpis.payables)} />
          <KpiTile label="Overdue" value={money(d.kpis.overdue_payables)} hint={d.kpis.oldest_due_date ? `oldest ${dateFmt(d.kpis.oldest_due_date)}` : undefined} />
          <KpiTile label="YTD spend" value={money(d.kpis.ytd_spend)} />
          <KpiTile label="Open POs" value={num(d.kpis.open_purchase_orders)} />
        </KpiRow>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {CLIENT_TABS.map((t) => {
          const counts: Partial<Record<Tab, number>> = {
            Documents: d.documents.length, Contacts: d.contacts.length, Addresses: d.addresses.length,
            Banks: d.banks.length, Registrations: d.registrations.length, Owners: d.beneficial_owners.length,
          };
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t}{counts[t] != null && <span className="ml-1.5 micro">{counts[t]}</span>}
            </button>
          );
        })}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Compliance</h4>
            {(() => {
              // Onboarding gaps (missing required docs, pending scans) are the
              // checklist to activate a party, not a compliance failure — show
              // them apart from real issues so a fresh draft does not read red
              // (§3.3). The engine sets `onboarding` on each flag.
              const onboarding = comp.flags.filter((f) => f.onboarding);
              const issues = comp.flags.filter((f) => !f.onboarding);
              if (comp.flags.length === 0) return <p className="micro">No open flags.</p>;
              return (
                <div className="space-y-3">
                  {onboarding.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-2 micro font-medium text-foreground">
                        <Pill tone="blue">Required to activate</Pill>
                      </p>
                      <ul className="space-y-1.5">
                        {onboarding.map((f) => (
                          <li key={f.flag_id} className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">{f.message || f.rule_key}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {issues.length > 0 && (
                    <div>
                      {onboarding.length > 0 && <p className="mb-1.5 micro font-medium text-foreground">Compliance issues</p>}
                      <ul className="space-y-1.5">
                        {issues.map((f) => (
                          <li key={f.flag_id} className="flex items-center gap-2 text-sm">
                            <Pill tone={SEVERITY_TONE[f.severity] || "mute"}>{f.severity}</Pill>
                            <span className="text-muted-foreground">{f.message || f.rule_key}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
            <p className="mt-3 micro">
              GL parity: {d.gl_parity.flagged ? <span className="text-bad">mismatch {money(d.gl_parity.mismatch)}</span> : "clean"} · docs {money(d.gl_parity.docTotal)} vs GL {money(d.gl_parity.gl)}
            </p>
          </div>
          <AgingCard title={isClient ? "Aging" : "Aging (payables)"} aging={d.kpis.aging} onOpen={(bucket, label) => setAging({ bucket, label })} />
          {!isClient && d.scorecard && <ScorecardCard s={d.scorecard} />}
          {!isClient && (
            <div className="rounded-xl border bg-card p-4">
              <h4 className="mb-3 text-sm font-semibold text-foreground">Payables</h4>
              <SvgBars ariaLabel="Supplier payables" fmt={money} data={[
                { label: "Payables", value: d.kpis.payables },
                { label: "Overdue", value: d.kpis.overdue_payables },
                { label: "YTD spend", value: d.kpis.ytd_spend },
              ]} />
            </div>
          )}
        </div>
      )}

      {tab === "Documents" && (
        <Section title="KYC / compliance documents" onAdd={() => setAdding("document")}>
          <MiniTable empty={d.documents.length === 0} head={<><Th>Type</Th><Th>Number</Th><Th>Expires</Th><Th>Scan</Th><Th>Verification</Th></>}>
            {d.documents.map((doc: api.PartyDocument) => (
              <tr key={doc.document_id}>
                <Td>{doc.document_type_name || "—"}</Td>
                <Td>{doc.document_number || (doc.physical_ref ? `📄 ${doc.physical_ref}` : "—")}</Td>
                <Td>{dateFmt(doc.expires_on)}</Td>
                <Td><Pill tone={SCAN_TONE[doc.scan_status || "PENDING"] || "mute"}>{enumLabel(doc.scan_status)}</Pill></Td>
                <Td>{enumLabel(doc.verification_status)}</Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Contacts" && (
        <Section title="Contacts" onAdd={() => setAdding("contact")} onCopy={linkedId ? () => copySection("contacts") : undefined}>
          {d.contacts.length === 0 ? <Empty /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {d.contacts.map((c: api.Contact) => (
                <div key={c.contact_id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{c.name}</span>
                    {c.is_primary && <Pill tone="blue">Primary</Pill>}
                    {(c.role_tags || []).map((t) => <Pill key={t} tone="mute">{enumLabel(t)}</Pill>)}
                  </div>
                  <p className="mt-1 micro">{[c.title, c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Client "Message" opens the Smart Comms CLIENT channel (§3.4); mailto is the fallback. */}
                    {isClient && <button className="text-sm text-primary-ink underline" onClick={() => navigate(`/comms?client=${encodeURIComponent(partyId)}`)}>Message</button>}
                    {c.email && <a className="text-sm text-primary-ink underline" href={`mailto:${c.email}`}>Email</a>}
                    {c.phone && <a className="text-sm text-primary-ink underline" href={`tel:${c.phone}`}>Call</a>}
                    {c.phone && <a className="text-sm text-primary-ink underline" href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "Addresses" && (
        <Section title="Addresses" onAdd={() => setAdding("address")} onCopy={linkedId ? () => copySection("addresses") : undefined}>
          {d.addresses.length === 0 ? <Empty /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {d.addresses.map((a: api.Address) => (
                <div key={a.address_id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2">
                    {a.type && <Pill tone="mute">{enumLabel(a.type)}</Pill>}
                    {a.is_primary && <Pill tone="blue">Primary</Pill>}
                  </div>
                  <p className="mt-1 text-sm text-foreground">{[a.line1, a.line2, a.city, a.region, a.postal_code, a.country_code].filter(Boolean).join(", ") || "—"}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "Banks" && (
        <Section title="Bank accounts" onAdd={() => setAdding("bank")} onCopy={linkedId ? () => copySection("banks") : undefined}>
          <MiniTable empty={d.banks.length === 0} head={<><Th>Beneficiary</Th><Th>Bank</Th><Th>Account</Th><Th>Verified</Th></>}>
            {d.banks.map((b: api.BankAccount) => (
              <tr key={b.bank_account_id}>
                <Td>{b.beneficiary_name || "—"}</Td>
                <Td>{b.bank_name || "—"}</Td>
                <Td>
                  {revealed[b.bank_account_id] || b.account_number || b.iban || b.momo_number || "—"}
                  {/* Masked reveal (§3.5): a dedicated, audited endpoint — never the whole number in the list payload. */}
                  {b.masked && !revealed[b.bank_account_id] && (
                    <button className="ml-2 text-primary-ink underline micro" onClick={() => revealBankNumber(b.bank_account_id)}>Reveal</button>
                  )}
                </Td>
                <Td>{b.is_verified ? <Pill tone="ok">Verified</Pill> : <Pill tone="warn">Unverified</Pill>}</Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Registrations" && (
        <Section title="Registrations / tax IDs" onAdd={() => setAdding("registration")}>
          <MiniTable empty={d.registrations.length === 0} head={<><Th>Kind</Th><Th>Number</Th><Th>Country</Th><Th>Expires</Th></>}>
            {d.registrations.map((r: api.Registration) => (
              <tr key={r.registration_id}><Td>{r.kind}</Td><Td>{r.number || "—"}</Td><Td>{r.country_code || "—"}</Td><Td>{dateFmt(r.expires_on)}</Td></tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Owners" && (
        <Section title="Beneficial owners" onAdd={() => setAdding("owner")}>
          <MiniTable empty={d.beneficial_owners.length === 0} head={<><Th>Name</Th><Th>Nationality</Th><Th r>Ownership</Th><Th>PEP</Th></>}>
            {d.beneficial_owners.map((o: api.BeneficialOwner) => (
              <tr key={o.owner_id}><Td>{o.full_name}</Td><Td>{o.nationality || "—"}</Td><Td r>{o.ownership_percent != null ? `${o.ownership_percent}%` : "—"}</Td><Td>{o.is_pep ? <Pill tone="orange">PEP</Pill> : "—"}</Td></tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Financial" && (
        isClient ? (
          <div className="space-y-4">
            <MiniTable empty={d.invoices.length === 0} head={<><Th>Invoice</Th><Th>Type</Th><Th>Status</Th><Th>Due</Th><Th r>Total</Th></>}>
              {d.invoices.map((i: Client360Invoice) => (
                <tr key={i.invoice_id}><Td><DeepLink route={MODULE_ROUTE.invoice} id={i.invoice_id}>{i.doc_number || i.invoice_id.slice(0, 8)}</DeepLink></Td><Td>{enumLabel(i.type)}</Td><Td>{enumLabel(i.status)}</Td><Td>{dateFmt(i.payment_due_on)}</Td><Td r>{money(i.total_ttc)}</Td></tr>
              ))}
            </MiniTable>
          </div>
        ) : (
          <MiniTable empty={d.supplier_invoices.length === 0} head={<><Th>Bill</Th><Th>Status</Th><Th>Due</Th><Th r>WHT</Th><Th r>Total</Th></>}>
            {d.supplier_invoices.map((i: SupplierBill) => (
              <tr key={i.supplier_invoice_id}><Td><DeepLink route={MODULE_ROUTE.supplier_invoice} id={i.supplier_invoice_id}>{i.doc_number || i.supplier_invoice_id.slice(0, 8)}</DeepLink></Td><Td>{enumLabel(i.status)}</Td><Td>{dateFmt(i.due_on)}</Td><Td r>{money(i.wht_total)}</Td><Td r>{money(i.amount_ttc)}</Td></tr>
            ))}
          </MiniTable>
        )
      )}

      {/* Add modals */}
      {adding === "contact" && <AddModal title="Add contact" onClose={() => setAdding(null)}
        fields={[{ key: "name", label: "Name" }, { key: "title", label: "Title" }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone (E.164)", placeholder: "+237690000000" }, { key: "is_primary", label: "Primary", type: "checkbox" }]}
        onSubmit={async (v) => { await api.contacts.create(kind, partyId, v as Partial<api.Contact>); toast.success("Contact added"); reload(); }} />}
      {adding === "address" && <AddModal title="Add address" onClose={() => setAdding(null)}
        fields={[{ key: "line1", label: "Line 1" }, { key: "city", label: "City" }, { key: "region", label: "Region" }, { key: "postal_code", label: "Postal code" }, { key: "country_code", label: "Country", type: "country" }, { key: "type", label: "Type", type: "select", options: ADDRESS_TYPES.map((t) => ({ value: t, label: enumLabel(t) })) }]}
        onSubmit={async (v) => { await api.addresses.create(kind, partyId, v as Partial<api.Address>); toast.success("Address added"); reload(); }} />}
      {adding === "bank" && <AddModal title="Add bank account" onClose={() => setAdding(null)}
        fields={[{ key: "beneficiary_name", label: "Beneficiary" }, { key: "bank_name", label: "Bank" }, { key: "account_number", label: "Account number" }, { key: "iban", label: "IBAN" }, { key: "swift_bic", label: "SWIFT/BIC" }, { key: "currency", label: "Currency", placeholder: "XAF" }]}
        onSubmit={async (v) => { await api.banks.create(kind, partyId, v as Partial<api.BankAccount>); toast.success("Bank account added"); reload(); }} />}
      {adding === "document" && <AddModal title="Add document" onClose={() => setAdding(null)}
        fields={[{ key: "document_type_id", label: "Type", type: "select", options: docTypeOptions }, { key: "document_number", label: "Number" }, { key: "issued_on", label: "Issued", type: "date" }, { key: "expires_on", label: "Expires", type: "date" }, { key: "physical_ref", label: "Physical archive ref", placeholder: "Box A-12 (if paper only)" }, { key: "scan_due_on", label: "Scan due", type: "date" }]}
        onSubmit={async (v) => { await api.documents.create(kind, partyId, v as Partial<api.PartyDocument>); toast.success("Document added"); reload(); }} />}
      {adding === "registration" && <AddModal title="Add registration" onClose={() => setAdding(null)}
        fields={[{ key: "kind", label: "Kind", placeholder: "NIU, RCCM, VAT, EORI…" }, { key: "number", label: "Number" }, { key: "country_code", label: "Country", type: "country" }, { key: "issuing_authority", label: "Issuing authority" }, { key: "expires_on", label: "Expires", type: "date" }]}
        onSubmit={async (v) => { await api.registrations.create(kind, partyId, v as Partial<api.Registration>); toast.success("Registration added"); reload(); }} />}
      {adding === "owner" && <AddModal title="Add beneficial owner" onClose={() => setAdding(null)}
        fields={[{ key: "full_name", label: "Full legal name" }, { key: "nationality", label: "Nationality", type: "country" }, { key: "ownership_percent", label: "Ownership %", type: "number" }, { key: "id_number", label: "ID number" }, { key: "is_pep", label: "Politically exposed", type: "checkbox" }]}
        onSubmit={async (v) => { await api.beneficialOwners.create(kind, partyId, v as Partial<api.BeneficialOwner>); toast.success("Owner added"); reload(); }} />}

      {blocking && <BlockModal onClose={() => setBlocking(false)} onSubmit={async (reason) => { await act(() => api.blockParty(kind, partyId, reason), "Party blocked"); }} />}
      {merging && <MergeModal kind={kind} survivorId={partyId} survivorRef={p.ref || ""} loser={merging} onClose={() => setMerging(null)} onDone={(msg) => { toast.success(msg); reload(); }} />}
      {converting && <ConvertModal kind={kind} partyId={partyId} partyName={p.legal_name || p.name}
        onClose={() => setConverting(false)} onDone={(msg) => { toast.success(msg); reload(); }} />}
      {aging && <AgingDetailModal kind={kind} partyId={partyId} bucket={aging.bucket} label={aging.label} onClose={() => setAging(null)} />}
    </div>
  );
}

type Client360Invoice = api.Client360["invoices"][number];
type SupplierBill = api.Supplier360["supplier_invoices"][number];

function Empty() { return <div className="px-3 py-6 text-center micro">Nothing here yet.</div>; }

function Section({ title, onAdd, onCopy, children }: { title: string; onAdd: () => void; onCopy?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <div className="flex gap-2">
          {/* Copy-from-origin (§6) — explicit, never automatic (Hard Rule 2). */}
          {onCopy && <Button size="sm" variant="ghost" onClick={onCopy}>Copy from origin</Button>}
          <Button size="sm" variant="outline" onClick={onAdd}>+ Add</Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function BlockModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Modal open onClose={onClose} title="Hard block" description="A manual HARD_BLOCK stops this party at transactional gates. A reason is required and recorded on the immutable ledger.">
      <label className="space-y-1 text-sm">
        <span className="font-medium text-foreground">Reason</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sanctions match pending review" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="default" loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); try { await onSubmit(reason.trim()); onClose(); } finally { setBusy(false); } }}>Block</Button>
      </div>
    </Modal>
  );
}
