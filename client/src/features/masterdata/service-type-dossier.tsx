/**
 * Service type 360° — the right pane of the master-data service-types screen.
 *
 * One rich view over the `/service-types/:id/360` aggregation. Header carries
 * the service's identity and lifecycle actions, a slim KPI strip summarises
 * every collection below, and tabs unpack them:
 *
 *   Overview        — readiness checklist + inline-edit for the display name.
 *   Milestones      — every template version with stages inlined; publish new
 *                     version reuses the same form used by the create screen.
 *   Dictionary      — the TIER MATRIX. Every dictionary line scoped to this
 *                     service with an inline Basic/Advanced/Full control, a
 *                     search to add another, and a cumulative count of what
 *                     each bundle loads. Plus a collapsible "also applicable to
 *                     any service" section. Rows deep-link to the dictionary.
 *   Dossiers        — 25 most-recent files of this type with client / status /
 *                     milestone progress. Row → /operations/files?focus=<id>.
 *   Commercial      — margin sims, FINAL invoices, planned/actual money.
 *                     Money keys mask for callers without MOD-09 read.
 *   Automation & AI — the two AI reads + a note on the auto-instantiation
 *                     handler; a deep link to the RBAC matrix filtered by MOD-29.
 *
 * DEEP-LINKS. Rows send the user to the module that owns them, not into a
 * modal stacked over this one; the target modules already know how to focus a
 * row from `?focus=<id>` (party-360.tsx:41 documents the convention). Money
 * rendering trusts `money.masked` from the server — never re-computed here.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { InlineEdit } from "@/components/ui/inline-edit";
import { useResource } from "@/lib/use-resource";
import { useRowAction } from "@/lib/use-action";
import { DictionaryFinder } from "@/components/dictionary-finder";
import { cn } from "@/lib/cn";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { ServiceTypeAssumptions } from "./service-type-assumptions";
// The shipment/service-detail form (0660) — which fields a file of this
// service type captures, and therefore what every document about it prints.
import { ServiceTypeFieldsTab } from "./service-type-fields-tab";
import { reportActionError } from "@/lib/action-error";

/* ── Local building blocks (mirroring party-360's MiniTable / Th / Td) ───── */

function MiniTable({
  head,
  children,
  empty,
  emptyLabel = "Nothing here yet.",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
  emptyLabel?: string;
}) {
  if (empty) return <div className="px-3 py-6 text-center micro">{emptyLabel}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) =>
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) =>
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>;

/** A plain link cell — deep-links keep the target module authoritative rather
 *  than pop the row's detail over this dossier. */
function DeepLink({ href, children }: { href: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="text-primary-ink underline underline-offset-2 hover:opacity-80 focus-visible:outline-none"
      onClick={() => navigate(href)}
    >
      {children}
    </button>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

// "Details" sits directly after Milestones: the two are the same kind of
// per-service-type definition (a versioned template with one live version),
// and a manager setting up a service works through them together.
const TABS = ["Overview", "Milestones", "Details", "Assumptions", "Dictionary", "Dossiers", "Commercial", "Automation"] as const;
type Tab = (typeof TABS)[number];

const DOSSIER_TONE: Record<string, "ok" | "warn" | "mute" | "blue"> = {
  OPEN: "blue",
  IN_PROGRESS: "warn",
  COMPLETED: "ok",
  CANCELLED: "mute",
};
const CATEGORY_TONE: Record<string, "ok" | "warn" | "mute" | "blue" | "bad"> = {
  service: "ok",
  disbursement: "blue",
  overhead: "mute",
  asset: "warn",
  other: "mute",
};

function humanTerritory(t?: string | null): string {
  return t ? t.replace(/_/g, " ").toLowerCase() : "—";
}

/* ── Readiness banner ─────────────────────────────────────────────────────── */

function ReadinessBanner({
  readiness,
  onPublishTemplate,
}: {
  readiness: api.ServiceTypeDossier["readiness"];
  onPublishTemplate: () => void;
}) {
  // The trap the list screen was built to make visible (0310_operations.sql:7):
  // a service type without an active template silently ships dossiers with no
  // milestone chain. If that's the case, this is the loudest thing on the page.
  if (!readiness.has_active_template) {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn-fill/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <Pill tone="warn">No milestone template</Pill>
            <span className="text-muted-foreground">
              New dossiers of this service type ship with no milestone chain until a template is published.
            </span>
          </div>
          <Button size="sm" onClick={onPublishTemplate}>Publish first template</Button>
        </div>
      </div>
    );
  }
  // Once the template exists, downgrade to a light checklist so the page reads
  // green rather than screaming — the sub-items still show what's still to do.
  const items: { ok: boolean; label: string }[] = [
    { ok: readiness.has_active_template, label: `Active milestone template v${readiness.active_template_version}` },
    { ok: readiness.has_dictionary_line, label: "At least one financial dictionary line scoped to this service" },
    { ok: readiness.ever_used, label: "Ever used on a dossier" },
    // `ever_billed` is null when the caller can't see finance — omit it then
    // rather than imply "no revenue" from a masked view.
    ...(readiness.ever_billed === null
      ? []
      : [{ ok: readiness.ever_billed === true, label: "Ever billed on a FINAL invoice" }]),
  ];
  return (
    <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.06)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Pill tone="ok">Ready</Pill>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-1.5">
              <span aria-hidden className={it.ok ? "text-[rgb(var(--ok))]" : "text-muted-foreground"}>
                {it.ok ? "✓" : "○"}
              </span>
              <span>{it.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function Header({
  st,
  onEdit,
  onArchive,
  archiving,
}: {
  st: api.ServiceType;
  onEdit: () => void;
  onArchive: () => void;
  archiving: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* h2 (not h3) because PageHeader is the page's only h1 — jumping
                from h1 straight to h3 fails axe's heading-order rule. */}
            <h2 className="truncate text-lg font-semibold text-foreground">{st.name_en || st.name_fr}</h2>
            <Pill tone={st.is_active ? "ok" : "mute"}>{st.is_active ? "Active" : "Archived"}</Pill>
            {st.is_system && <Pill tone="blue">System</Pill>}
            {st.territory && <Pill tone="mute">{humanTerritory(st.territory)}</Pill>}
          </div>
          <p className="mt-1 micro">
            {[st.key, st.name_en && st.name_fr && st.name_en !== st.name_fr ? st.name_fr : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          {st.is_active && !st.is_system && (
            <Button size="sm" variant="outline" loading={archiving} onClick={onArchive}>Archive</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Milestones tab ─────────────────────────────────────────────────────── */

function MilestonesTab({
  templates,
  onPublish,
  onEditPolicy,
}: {
  templates: api.ServiceTypeDossier["templates"];
  onPublish: () => void;
  onEditPolicy: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">
          Every dossier of this service type is stamped with the stages of the ACTIVE version at the moment
          it is opened. Publishing a new version supersedes older ones for future dossiers only — anything
          already in progress keeps the stages it was given.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/operations/milestones")}>Open in Milestones</Button>
          {/* The stages say WHAT happens; the policy says how the schedule
              behaves when reality does not cooperate. They belong together. */}
          <Button size="sm" variant="outline" onClick={onEditPolicy}>Scheduling policy</Button>
          <Button size="sm" onClick={onPublish}>
            {templates.some((t) => t.is_active) ? "Publish new version" : "Publish first template"}
          </Button>
        </div>
      </div>
      {templates.length === 0 ? (
        <div className="rounded-lg border px-3 py-6 text-center micro">
          No template versions yet — publish one to give this service a milestone chain.
        </div>
      ) : (
        templates.map((t) => (
          <div key={t.milestone_template_id} className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">Version {t.version}</span>
                {t.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="mute">Superseded</Pill>}
                <span className="micro">{t.stages.length} stage{t.stages.length === 1 ? "" : "s"}</span>
              </div>
              <span className="micro">Published {dateFmt(t.created_at)}</span>
            </div>
            {t.stages.length === 0 ? (
              <div className="px-3 py-4 micro">No stages on this version.</div>
            ) : (
              <MiniTable
                empty={false}
                head={
                  <>
                    <Th>Seq</Th><Th>Code</Th><Th>Label (FR)</Th><Th>Label (EN)</Th><Th r>Offset (days)</Th>
                  </>
                }
              >
                {t.stages.map((s) => (
                  <tr key={s.stage_id}>
                    <Td>{s.stage_seq}</Td>
                    <Td><span className="font-mono text-xs">{s.code}</span></Td>
                    <Td>{s.label_fr}</Td>
                    <Td>{s.label_en || "—"}</Td>
                    <Td r>{s.default_offset_days}</Td>
                  </tr>
                ))}
              </MiniTable>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ── Dictionary tab — the tier matrix ───────────────────────────────────── */

const TIER_ORDER = ["BASIC", "ADVANCED", "FULL"] as const;
const TIER_LABEL: Record<api.Tier, string> = { BASIC: "Basic", ADVANCED: "Advanced", FULL: "Full" };

/**
 * The tier control. One segmented choice per line, not three checkboxes,
 * because the bundles NEST: `tier` is the LOWEST bundle a line appears in, so
 * BASIC ⊆ ADVANCED ⊆ FULL. Three checkboxes would let someone express "Advanced
 * but not Full", which the model cannot represent and the costing engine would
 * silently reinterpret.
 *
 * Set inline, no modal: configuring a service means sweeping thirty lines, and a
 * dialog per line turns a two-minute job into a twenty-minute one.
 */
function TierSegmented({
  value,
  busy,
  onChange,
}: {
  value: api.Tier;
  busy: boolean;
  onChange: (t: api.Tier) => void;
}) {
  return (
    <div role="group" aria-label="Tier" className="inline-flex overflow-hidden rounded-md border">
      {TIER_ORDER.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            disabled={busy}
            aria-pressed={active}
            onClick={() => { if (!active) onChange(t); }}
            className={cn(
              "px-2 py-1 text-xs transition-colors disabled:opacity-50",
              active ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {TIER_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

function DictionaryTab({
  scoped,
  generic,
  serviceKey,
  serviceTypeId,
  reload,
}: {
  scoped: api.ServiceTypeDictionaryItem[];
  generic: api.ServiceTypeDictionaryItem[];
  serviceKey: string;
  serviceTypeId: string;
  reload: () => void;
}) {
  const [showGeneric, setShowGeneric] = React.useState(false);
  const act = useRowAction();
  const dictHref = (code: string) => `/master/financial-dictionary?focus=${encodeURIComponent(code)}`;

  /**
   * CUMULATIVE, not per-tier. "How many lines does a Basic job pull?" is the
   * question someone configuring this is actually asking, and because the sets
   * nest, an Advanced quote loads Basic + Advanced. Showing three independent
   * counts would answer a question nobody has and invite the wrong mental model.
   */
  const counts = React.useMemo(() => {
    const basic = scoped.filter((d) => (d.tier || "BASIC") === "BASIC").length;
    const advanced = scoped.filter((d) => d.tier === "ADVANCED").length;
    const full = scoped.filter((d) => d.tier === "FULL").length;
    return { basic, advanced: basic + advanced, full: basic + advanced + full };
  }, [scoped]);

  // No client-side permission gate: `nav-access` only carries read-level module
  // keys, so the honest thing is to render the control and let the server's
  // `requirePermission(MOD-29, edit)` answer. `useAction` puts the 403 next to
  // the control rather than swallowing it (lib/use-action.ts).
  const setTier = (d: api.ServiceTypeDictionaryItem, tier: api.Tier) =>
    act.run(d.dictionary_item_id, () =>
      api.setServiceTypeDictionaryTier(serviceTypeId, d.dictionary_item_id, tier).then(reload));

  const unlink = (d: api.ServiceTypeDictionaryItem) =>
    act.run(d.dictionary_item_id, () =>
      api.removeServiceTypeDictionaryTier(serviceTypeId, d.dictionary_item_id).then(reload));

  /**
   * A line picked here is added at ADVANCED, not BASIC. Adding to BASIC changes
   * what EVERY future costing of this type loads, which is not what "add this
   * line to the service" has to mean — promoting it is one click away, and the
   * reverse mistake is invisible until someone reads a quote.
   */
  const addLine = (dictionaryItemId: string) => {
    if (!dictionaryItemId) return;
    act.run(dictionaryItemId, () =>
      api.setServiceTypeDictionaryTier(serviceTypeId, dictionaryItemId, "ADVANCED").then(reload));
  };

  const renderRow = (showTier: boolean) => (d: api.ServiceTypeDictionaryItem) => (
    <tr key={d.dictionary_item_id}>
      <Td><DeepLink href={dictHref(d.code)}>{d.code}</DeepLink></Td>
      <Td>{d.label_en || d.label_fr}</Td>
      {showTier && (
        <Td>
          <TierSegmented
            value={(d.tier || "BASIC") as api.Tier}
            busy={act.busyId === d.dictionary_item_id}
            onChange={(t) => setTier(d, t)}
          />
        </Td>
      )}
      <Td><Pill tone={CATEGORY_TONE[d.category] || "mute"}>{d.category}</Pill></Td>
      <Td>{d.shipping_line || "—"}</Td>
      <Td r>{d.default_price != null && d.default_price !== "" ? money(d.default_price) : "—"}</Td>
      <Td>{d.currency || "—"}</Td>
      <Td>
        {d.is_active === false ? <Pill tone="mute">Off</Pill> : d.is_disbursement ? <Pill tone="blue">Disbursement</Pill> : <Pill tone="ok">On</Pill>}
      </Td>
      {showTier && (
        <Td>
          <button
            type="button"
            disabled={act.busyId === d.dictionary_item_id}
            onClick={() => unlink(d)}
            aria-label={`Remove ${d.code} from ${serviceKey}`}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Remove
          </button>
        </Td>
      )}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">
          Financial dictionary lines applicable to <span className="font-mono">{serviceKey}</span>. Costing sheets,
          margin sims and invoices for dossiers of this type surface these first when picking a line.
        </p>
        <DeepLink href="/master/financial-dictionary">Open dictionary →</DeepLink>
      </div>

      {/* What each bundle actually loads. Cumulative, because the sets nest. */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="A Basic job pulls" value={num(counts.basic)} />
        <Stat label="Advanced pulls" value={num(counts.advanced)} />
        <Stat label="Full pulls" value={num(counts.full)} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-[18rem] flex-1">
          <div className="micro mb-1">Add a line to this service</div>
          <DictionaryFinder
            label={`Add a dictionary line to ${serviceKey}`}
            placeholder="Search a charge to add…"
            allowEmpty={false}
            onPick={(id) => addLine(id)}
          />
        </div>
        <p className="micro max-w-sm">
          Added at <strong>Advanced</strong> — promote to Basic once it belongs on every file of this type.
          Tiers nest, so Basic lines load on Advanced and Full quotes too.
        </p>
      </div>

      {act.error && <ErrorState message={act.error} />}

      <MiniTable
        empty={scoped.length === 0}
        emptyLabel={`No dictionary line is scoped to ${serviceKey} yet. Use the search above to add one.`}
        head={
          <>
            <Th>Code</Th><Th>Label</Th><Th>Tier</Th><Th>Category</Th><Th>Shipping line</Th>
            <Th r>Default price</Th><Th>Currency</Th><Th>State</Th><Th></Th>
          </>
        }
      >
        {scoped.map(renderRow(true))}
      </MiniTable>

      {/* Generic bucket — collapsed by default so the tab reads about THIS
          service, but discoverable because a dossier of this type will surface
          these lines too (dictionary_item.service_type_key IS NULL = "any"). */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
          onClick={() => setShowGeneric((v) => !v)}
        >
          <span>
            <span className="font-medium text-foreground">Also applicable — any service</span>
            <span className="ml-2 micro">{generic.length} line{generic.length === 1 ? "" : "s"} not scoped to a specific service</span>
          </span>
          <span aria-hidden className="micro">{showGeneric ? "▾" : "▸"}</span>
        </button>
        {showGeneric && (
          <div className="border-t p-3">
            <MiniTable
              empty={generic.length === 0}
              head={
                <>
                  <Th>Code</Th><Th>Label</Th><Th>Category</Th><Th>Shipping line</Th>
                  <Th r>Default price</Th><Th>Currency</Th><Th>State</Th>
                </>
              }
            >
              {generic.map(renderRow(false))}
            </MiniTable>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Dossiers tab ───────────────────────────────────────────────────────── */

function DossiersTab({
  dossiers,
  more,
  stats,
}: {
  dossiers: api.ServiceTypeDossierRow[];
  more: number;
  stats: api.ServiceTypeDossier["stats"];
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Open" value={num(stats.dossiers_open)} />
        <Stat label="In progress" value={num(stats.dossiers_in_progress)} />
        <Stat label="Completed" value={num(stats.dossiers_completed)} />
        <Stat label="Cancelled" value={num(stats.dossiers_cancelled)} tone="warn" />
      </div>
      <MiniTable
        empty={dossiers.length === 0}
        emptyLabel="No dossiers have ever been opened for this service type."
        head={
          <>
            <Th>Reference</Th><Th>Client</Th><Th>Status</Th>
            <Th>Milestones</Th><Th>Current stage</Th><Th r>Billed TTC</Th><Th>Opened</Th>
          </>
        }
      >
        {dossiers.map((d) => (
          <tr key={d.dossier_id}>
            <Td>
              <DeepLink href={`/operations/files?ref=${encodeURIComponent(d.ref)}`}>{d.ref}</DeepLink>
            </Td>
            <Td>{d.client_name || "—"}</Td>
            <Td><Pill tone={DOSSIER_TONE[d.status] || "mute"}>{d.status}</Pill></Td>
            <Td>{d.milestone_total > 0 ? `${d.milestone_done}/${d.milestone_total}` : "—"}</Td>
            <Td>{d.current_milestone || (d.status === "COMPLETED" ? "—" : d.milestone_total === 0 ? <span className="text-warn">no chain</span> : "—")}</Td>
            <Td r>{Number(d.billed_ttc) > 0 ? money(d.billed_ttc) : "—"}</Td>
            <Td>{dateFmt(d.created_at)}</Td>
          </tr>
        ))}
      </MiniTable>
      {more > 0 && (
        <p className="micro">
          Showing 25 most recent — {more} older dossier{more === 1 ? "" : "s"} not listed here.{" "}
          <DeepLink href="/operations/files">See all in Operations →</DeepLink>
        </p>
      )}
    </div>
  );
}

/* ── Commercial tab (margin sims + invoices + money rollup) ─────────────── */

function CommercialTab({
  d,
}: {
  d: api.ServiceTypeDossier;
}) {
  const money_ = d.money;
  const masked = money_.masked;
  return (
    <div className="space-y-5">
      {/* Money rollup — masked message rather than silent zeros for callers
          without MOD-09 read, per the party-360 convention. */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Money</h3>
        {masked ? (
          <p className="micro">
            Money figures are restricted — needs finance visibility (Treasury read, MOD-09).
          </p>
        ) : money_.planned.length === 0 && money_.billed.length === 0 && !money_.actual_total ? (
          <p className="micro">No planned costings or FINAL invoices booked to this service type yet.</p>
        ) : (
          <div className="space-y-4">
            {money_.billed.length > 0 && (
              <div>
                <p className="mb-1.5 micro font-medium text-foreground">Billed (locked FINAL invoices)</p>
                <MiniTable
                  empty={false}
                  head={<><Th>Currency</Th><Th r>Invoices</Th><Th r>Revenue HT</Th><Th r>Total TTC</Th></>}
                >
                  {money_.billed.map((b) => (
                    <tr key={b.currency}>
                      <Td>{b.currency}</Td>
                      <Td r>{num(b.invoice_count)}</Td>
                      <Td r>{money(b.revenue_ht)}</Td>
                      <Td r>{money(b.billed_ttc)}</Td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            )}
            {money_.planned.length > 0 && (
              <div>
                <p className="mb-1.5 micro font-medium text-foreground">Planned (from costing sheets)</p>
                <MiniTable
                  empty={false}
                  head={<><Th>Currency</Th><Th r>Planned total</Th><Th r>Of which débours</Th></>}
                >
                  {money_.planned.map((p) => (
                    <tr key={p.currency}>
                      <Td>{p.currency}</Td>
                      <Td r>{money(p.planned_total)}</Td>
                      <Td r>{money(p.planned_disbursement)}</Td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Stat label="Actuals (GL, XAF)" value={money(money_.actual_total)} />
              <Stat
                label="Ratio (actual / planned XAF)"
                value={(() => {
                  const plannedXaf = money_.planned.find((p) => p.currency === "XAF");
                  if (!plannedXaf || Number(plannedXaf.planned_total) === 0) return "—";
                  const pct = (money_.actual_total * 100) / Number(plannedXaf.planned_total);
                  return `${pct.toFixed(1)}%`;
                })()}
                hint="XAF only — a cross-currency ratio hides the currency it was booked in."
              />
            </div>
            <p className="micro">
              Planned figures come from <DeepLink href="/costing/costing">Costing</DeepLink>; actuals come from journal
              entries tagged with a dossier of this service. Open{" "}
              <DeepLink href="/costing/cost-tracking">Cost tracking</DeepLink> for the per-dossier breakdown.
            </p>
          </div>
        )}
      </div>

      {/* Margin simulations. */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Margin simulations</h3>
          <DeepLink href="/commercial/margin-simulation">Open Margin simulation →</DeepLink>
        </div>
        <MiniTable
          empty={d.margin_simulations.length === 0}
          emptyLabel="No margin simulation has ever been filed under this service type."
          head={
            <>
              <Th>Dossier</Th><Th>Currency</Th>
              <Th r>Total cost</Th><Th r>Total price</Th><Th r>Margin %</Th><Th>Created</Th>
            </>
          }
        >
          {d.margin_simulations.map((m) => (
            <tr key={m.margin_simulation_id}>
              <Td>
                {m.dossier_ref
                  ? <DeepLink href={`/operations/files?ref=${encodeURIComponent(m.dossier_ref)}`}>{m.dossier_ref}</DeepLink>
                  : "—"}
              </Td>
              <Td>{m.currency}</Td>
              <Td r>{money(m.total_cost)}</Td>
              <Td r>{money(m.total_price)}</Td>
              <Td r>{m.margin_percent != null ? `${Number(m.margin_percent).toFixed(2)}%` : "—"}</Td>
              <Td>{dateFmt(m.created_at)}</Td>
            </tr>
          ))}
        </MiniTable>
        {d.margin_simulations_more > 0 && (
          <p className="mt-2 micro">
            Showing 25 most recent — {d.margin_simulations_more} older not listed here.
          </p>
        )}
      </div>

      {/* Invoices — only rendered if finance visibility is granted (the server
          returns [] otherwise, so a masked user does not see even the doc
          numbers, which are cross-referenced to counterparties). */}
      {!masked && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">FINAL invoices</h3>
            <DeepLink href="/finance/invoices">Open Finance → Invoices →</DeepLink>
          </div>
          <MiniTable
            empty={d.invoices.length === 0}
            emptyLabel="No FINAL invoice has been raised on a dossier of this service type."
            head={
              <>
                <Th>Number</Th><Th>Dossier</Th><Th>Client</Th><Th>Status</Th>
                <Th>Due</Th><Th r>Total TTC</Th>
              </>
            }
          >
            {d.invoices.map((i) => (
              <tr key={i.invoice_id}>
                <Td>
                  <DeepLink href={`/finance/invoices?focus=${encodeURIComponent(i.invoice_id)}`}>
                    {i.doc_number || i.invoice_id.slice(0, 8)}
                  </DeepLink>
                </Td>
                <Td>
                  {i.dossier_ref
                    ? <DeepLink href={`/operations/files?ref=${encodeURIComponent(i.dossier_ref)}`}>{i.dossier_ref}</DeepLink>
                    : "—"}
                </Td>
                <Td>{i.client_name || "—"}</Td>
                <Td>{i.status}</Td>
                <Td>{dateFmt(i.payment_due_on)}</Td>
                <Td r>{money(i.total_ttc)} {i.currency}</Td>
              </tr>
            ))}
          </MiniTable>
        </div>
      )}
    </div>
  );
}

/* ── Overview tab ───────────────────────────────────────────────────────── */

function OverviewTab({
  d,
  onEditName,
}: {
  d: api.ServiceTypeDossier;
  onEditName: (nextName: string) => Promise<void>;
}) {
  const st = d.service_type;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Identity</h3>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="micro">Display name</dt>
            <dd className="mt-0.5">
              {/* Same inline-edit affordance the list used to carry — descriptive
                  master data, no reversal-not-edit rule to break (nothing posts
                  against the display name). `key` stays modal-only. */}
              <InlineEdit
                className="font-medium text-foreground"
                label="Service name"
                required
                value={st.name_en || st.name_fr}
                onSave={onEditName}
              />
            </dd>
          </div>
          <div>
            <dt className="micro">Key</dt>
            <dd className="mt-0.5 font-mono text-xs">{st.key}</dd>
          </div>
          <div>
            <dt className="micro">Territory</dt>
            <dd className="mt-0.5">{humanTerritory(st.territory)}</dd>
          </div>
          <div>
            <dt className="micro">System row</dt>
            <dd className="mt-0.5">{st.is_system ? "Yes — cannot be archived, but can be renamed." : "No"}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">At a glance</h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Dossiers total" value={num(d.stats.dossiers_total)} />
          <Stat label="Template versions" value={num(d.stats.template_versions)} />
          <Stat label="Dictionary lines" value={num(d.stats.dictionary_items)} />
          <Stat label="Margin sims" value={num(d.stats.margin_simulations)} />
        </div>
      </div>
    </div>
  );
}

/* ── Automation tab ─────────────────────────────────────────────────────── */

function AutomationTab({ st }: { st: api.ServiceType }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Auto-instantiation</h3>
        <p className="text-sm text-muted-foreground">
          When a dossier is opened with this service type, the ACTIVE milestone template is stamped onto it
          automatically. Dossiers opened without a service type (e.g. from the CRM auto-open when an opportunity
          is won) are skipped until a service type is chosen and can be back-filled from the Milestones page.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">AI actions</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li><span className="font-mono text-xs">list_service_types</span> — the assistant lists the taxonomy with milestone-template coverage.</li>
          <li><span className="font-mono text-xs">get_service_type</span> — one row by id.</li>
          <li><span className="font-mono text-xs">get_service_type_360</span> — everything on this page, minus money for callers without finance visibility.</li>
        </ul>
        <p className="mt-2 micro">
          Writes are intentionally not exposed to the assistant: <span className="font-mono">key</span> is
          immutable after creation because a rename orphans <span className="font-mono">dictionary_item.service_type_key</span> silently.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Permissions</h3>
        <p className="text-sm text-muted-foreground">
          Service types ride MOD-29 (Operations file). Anyone who can manage operation files can manage
          the service types those files use.
        </p>
        <p className="mt-2">
          <DeepLink href="/security/permissions">Open permission matrix →</DeepLink>
        </p>
      </div>
      <p className="micro">
        Service type <span className="font-mono">{st.key}</span>
        {st.created_at && <> · created {dateFmt(st.created_at)}</>}
      </p>
    </div>
  );
}

/* ── Root ───────────────────────────────────────────────────────────────── */

export function ServiceTypeDossier({
  serviceTypeId,
  onEdit,
  onPublishTemplate,
  onEditPolicy,
  onChanged,
}: {
  serviceTypeId: string;
  onEdit: () => void;
  onPublishTemplate: () => void;
  /** Opens the scheduling / SLA policy for THIS service type (⚙ on the tab). */
  onEditPolicy: () => void;
  onChanged?: () => void;
}) {
  const dossier = useResource(() => api.getServiceTypeDossier(serviceTypeId), [serviceTypeId]);
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [archiving, setArchiving] = React.useState(false);

  // Reset the active tab back to Overview when the selection changes so a
  // switch from a service with milestones to one without does not land on an
  // empty tab (matches party-360's behaviour).
  React.useEffect(() => { setTab("Overview"); }, [serviceTypeId]);

  const reload = () => { dossier.reload(); onChanged?.(); };

  if (dossier.loading) return <LoadingRow label="Loading service type 360…" />;
  if (dossier.error) return <ErrorState message={dossier.error} />;
  if (!dossier.data) return <EmptyState title="Not found" hint="This service type could not be loaded." />;

  const d = dossier.data;
  const st = d.service_type;

  async function archive() {
    setArchiving(true);
    try {
      await api.archiveServiceType(serviceTypeId);
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setArchiving(false);
    }
  }

  async function saveName(next: string) {
    // The list surfaces `name_en` first when present, otherwise `name_fr`. When
    // the row has no EN yet we edit FR instead, so the inline edit renames the
    // thing the user is actually looking at.
    const usingEn = !!st.name_en;
    try {
      await api.updateServiceType(serviceTypeId, usingEn ? { name_en: next } : { name_fr: next });
      reload();
    } catch (e) {
      reportActionError(e);
      throw e;
    }
  }

  const templateHint = d.readiness.has_active_template
    ? `v${d.readiness.active_template_version}`
    : undefined;

  return (
    <div className="space-y-4">
      <Header st={st} onEdit={onEdit} onArchive={archive} archiving={archiving} />

      <ReadinessBanner readiness={d.readiness} onPublishTemplate={onPublishTemplate} />

      {/* KPI strip — same slim divided-row pattern as party-360. */}
      <KpiRow>
        <KpiTile label="Dossiers" value={num(d.stats.dossiers_total)}
          hint={d.stats.dossiers_open + d.stats.dossiers_in_progress > 0
            ? `${d.stats.dossiers_open + d.stats.dossiers_in_progress} live`
            : undefined}
          onClick={() => setTab("Dossiers")} />
        <KpiTile label="Template" value={d.readiness.has_active_template ? "Active" : "None"}
          hint={templateHint} tone={d.readiness.has_active_template ? "ok" : "warn"}
          onClick={() => setTab("Milestones")} />
        <KpiTile label="Dictionary" value={num(d.stats.dictionary_items)}
          onClick={() => setTab("Dictionary")} />
        <KpiTile label="Margin sims" value={num(d.stats.margin_simulations)}
          onClick={() => setTab("Commercial")} />
        <KpiTile label={d.money.masked ? "Billed" : "Billed (XAF)"}
          value={d.money.masked ? "—" : (() => {
            const xaf = d.money.billed.find((b) => b.currency === "XAF");
            return xaf ? money(xaf.billed_ttc) : "—";
          })()}
          hint={d.money.masked ? "restricted" : undefined}
          onClick={() => setTab("Commercial")} />
      </KpiRow>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab d={d} onEditName={saveName} />}
      {tab === "Milestones" && <MilestonesTab templates={d.templates} onPublish={onPublishTemplate} onEditPolicy={onEditPolicy} />}
      {/* The chain says WHEN; the register says what those dates depend on.
          Adjacent tabs because a client reads them together. */}
      {tab === "Details" && (
        <ServiceTypeFieldsTab
          serviceTypeId={serviceTypeId}
          containers={d.containers || { captures_containers: false, container_detail_mode: "GROUPED" }}
          onChanged={reload}
        />
      )}
      {tab === "Assumptions" && <ServiceTypeAssumptions serviceTypeId={serviceTypeId} />}
      {tab === "Dictionary" && (
        <DictionaryTab
          scoped={d.dictionary_items}
          generic={d.dictionary_items_generic}
          serviceKey={st.key}
          serviceTypeId={st.service_type_id}
          reload={reload}
        />
      )}
      {tab === "Dossiers" && <DossiersTab dossiers={d.dossiers} more={d.dossiers_more} stats={d.stats} />}
      {tab === "Commercial" && <CommercialTab d={d} />}
      {tab === "Automation" && <AutomationTab st={st} />}
    </div>
  );
}
