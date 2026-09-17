/**
 * Corporate-entity KPI drill-ins (MOD-01) — one tile, one list of the records
 * behind it.
 *
 * The client and supplier 360s each make four of their five tiles the entry
 * point to a browsable list (`party-360.tsx`); the entity dossier's tiles said
 * "12 employees" and stopped there, which left the reader to go and find those
 * twelve somewhere else. This is the same drill-in over the same dialog
 * (`./kpi-details-modal`), pointed at the entity's own facts:
 *
 *   Shareholders  the people rows already on the 360 payload — the union of
 *                 `role` and `role_tags` (13850), so an owner who is also the
 *                 director is counted once, as the tile counts them.
 *   Employees     GET /employees?entity_id=… (MOD-02). Matricule, job title and
 *                 photo come from the HR master — the drill never re-derives a
 *                 roster from anything else.
 *   Subsidiaries  `structure.children`, the same rows as the Structure tab:
 *                 direct children only, which is what `usage.subsidiaries`
 *                 counts.
 *   Journal       GET /journal-entries?entity_id=… (MOD-55), the set the tile's
 *                 count was computed from.
 *
 * WHY TWO OF THEM FETCH. The tiles are counts computed in SQL by the 360
 * aggregation; the rows live in modules that own them (HR, the ledger). The
 * drill therefore reads them from those modules rather than from a denormalised
 * copy on the entity — an employee's job title shown here is the one HR holds,
 * not one cached at some earlier moment.
 *
 * WHAT IT DOES NOT DO. The Ownership tile has no drill: 82% is a figure, not a
 * list (the party 360s treat "Credit available" the same way). The Shareholders
 * and Subsidiaries rows link to what exists — a holding company's own dossier,
 * an employee's row in the HR master, the Journals screen — and a person with no
 * page of their own renders as plain text rather than a link to nowhere.
 */
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { useResource } from "@/lib/use-resource";
import { dateDmy, enumLabel, num } from "@/lib/format";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";
import * as hr from "@/lib/hr-api";
import * as fin from "@/lib/finance-api";
import {
  KpiDetailsModal,
  type KpiDetailHeader,
  type KpiDetailRow,
} from "./kpi-details-modal";

/** The four tiles that open something. "Ownership recorded" is deliberately
 *  absent — see the file header. */
export type EntityKpiKind = "shareholders" | "employees" | "subsidiaries" | "journal";

const ENTITY_ROUTE = "/master/corporate-entities";
const EMPLOYEES_ROUTE = "/hr/employees";
const JOURNALS_ROUTE = "/finance/journals";

/** The roster is read in one page; the module's own list takes it from there. */
const DRILL_LIMIT = 200;
const TRUNCATED_HINT = `Showing the first ${DRILL_LIMIT} — open the module for the rest.`;

const ROLE_LABEL = (r: string) =>
  r === "LEGAL_REPRESENTATIVE" ? "Legal rep." : enumLabel(r);

/** The person's whole role set (13850) as one readable cell. */
const rolesText = (p: api.EntityPerson) =>
  entityCommon.personRoles(p).map(ROLE_LABEL).join(", ");

const ENTITY_STATE_TONE = (row: { registration_status?: string | null; is_active?: boolean | null }) => {
  const s = row.registration_status || (row.is_active === false ? "DEACTIVATED" : "ACTIVE");
  if (s === "ACTIVE") return "ok" as const;
  if (s === "SUSPENDED" || s === "PENDING_REVIEW") return "warn" as const;
  return "mute" as const;
};

/**
 * Rows derived on the client from the 360 payload. Kept as one function so the
 * tile's number and the list cannot disagree about what they are counting.
 */
function localRows(
  kind: Extract<EntityKpiKind, "shareholders" | "subsidiaries">,
  data: api.Entity360,
): { headers: KpiDetailHeader[]; rows: KpiDetailRow[] } {
  if (kind === "shareholders") {
    const holders = data.people.filter((p) =>
      entityCommon.personRoles(p).includes("SHAREHOLDER"),
    );
    return {
      headers: [
        { label: "Holder" },
        { label: "All roles" },
        { label: "Shares", right: true },
        { label: "Ownership", right: true },
      ],
      rows: holders.map((p) => ({
        id: p.person_id,
        // A corporate holder has a dossier of its own; a natural person does
        // not, so that row is text. (Redaction already removed the share figures
        // for a caller without the governance grant — the cells show "—".)
        href: p.holder_entity_id ? `${ENTITY_ROUTE}/${p.holder_entity_id}` : undefined,
        cells: [
          p.full_name || "—",
          rolesText(p) || "—",
          p.share_count == null ? "—" : num(p.share_count),
          p.ownership_percent == null ? "—" : `${num(p.ownership_percent)}%`,
        ],
      })),
    };
  }
  const children = data.structure.children || [];
  return {
    headers: [
      { label: "Code" },
      { label: "Legal name" },
      { label: "Relationship" },
      { label: "Ownership", right: true },
      { label: "State" },
    ],
    rows: children.map((c) => ({
      id: c.entity_id,
      href: `${ENTITY_ROUTE}/${c.entity_id}`,
      cells: [
        c.code || "—",
        c.legal_name || "—",
        c.relationship_type ? enumLabel(c.relationship_type) : "—",
        c.ownership_percent == null ? "—" : `${num(c.ownership_percent)}%`,
        <Pill key="state" tone={ENTITY_STATE_TONE(c)}>
          {enumLabel(c.registration_status || (c.is_active === false ? "DEACTIVATED" : "ACTIVE"))}
        </Pill>,
      ],
    })),
  };
}

/**
 * The Employees drill. Reads the roster from MOD-02 with the entity filter the
 * module already honoured, at the largest page `page()` allows.
 */
function EmployeesDrill({
  entityId,
  entityName,
  onClose,
}: {
  entityId: string;
  entityName: string;
  onClose: () => void;
}) {
  const { data, error, loading } = useResource(
    () => hr.listEmployees({ entity_id: entityId, limit: DRILL_LIMIT }),
    [entityId],
  );
  const employees = data || [];
  const rows: KpiDetailRow[] = employees.map((e) => ({
    id: e.employee_id,
    // The HR master opens on the focused row (`useRecordParam`), so this lands
    // on the person rather than on the roster.
    href: `${EMPLOYEES_ROUTE}?focus=${encodeURIComponent(e.employee_id)}`,
    cells: [
      // Photo when HR has one uploaded, initials otherwise — the image column
      // the drill was asked for, without inventing a person that has no photo.
      <span key="who" className="flex items-center gap-2">
        <Avatar name={e.full_name || "—"} src={e.avatar_ref} size="sm" />
        <span>{e.full_name || "—"}</span>
      </span>,
      e.staff_no || "—",
      e.job_title || "—",
    ],
  }));
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`Employees · ${entityName}`}
      description="This entity's roster, in the HR master — including former staff. Click a row to open the person."
      headers={[{ label: "Name" }, { label: "Matricule" }, { label: "Job title" }]}
      rows={rows}
      emptyLabel="No employees are attached to this entity yet."
      moreHint={rows.length >= DRILL_LIMIT ? TRUNCATED_HINT : undefined}
      loading={loading}
      error={error}
    />
  );
}

/** The Journal drill. Reads MOD-55 with the entity filter added for this tile. */
function JournalDrill({
  entityId,
  entityName,
  onClose,
}: {
  entityId: string;
  entityName: string;
  onClose: () => void;
}) {
  const { data, error, loading } = useResource(
    () => fin.listJournals({ entity_id: entityId, limit: DRILL_LIMIT }),
    [entityId],
  );
  const entries = data || [];
  const rows: KpiDetailRow[] = entries.map((j) => ({
    id: j.entry_id,
    // The Journals screen is one list; there is no per-entry route to focus, so
    // the row opens the screen and the reference is in the cell above.
    href: JOURNALS_ROUTE,
    cells: [
      j.source_doc_ref ||
        (j.entry_no != null ? `#${j.entry_no}` : j.entry_id.slice(0, 8)),
      j.entry_date ? dateDmy(j.entry_date) : "—",
      j.description || "—",
      <Pill key="status" tone={String(j.status).toUpperCase() === "VALIDATED" ? "ok" : "mute"}>
        {enumLabel(j.status)}
      </Pill>,
    ],
  }));
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`Journal entries · ${entityName}`}
      description="Ledger entries posted against this entity. Click a row to open the Journals screen."
      headers={[
        { label: "Reference" },
        { label: "Date" },
        { label: "Description" },
        { label: "Status" },
      ]}
      rows={rows}
      emptyLabel="Nothing has been posted against this entity yet."
      moreHint={entries.length >= DRILL_LIMIT ? TRUNCATED_HINT : undefined}
      loading={loading}
      error={error}
    />
  );
}

/** The drill-in for whichever tile was clicked. Mounted only while open, so the
 *  fetching kinds do not fire a request for a dialog nobody opened. */
export function EntityKpiDrill({
  kind,
  data,
  onClose,
}: {
  kind: EntityKpiKind;
  data: api.Entity360;
  onClose: () => void;
}) {
  const entityId = data.entity.entity_id;
  const entityName = data.entity.legal_name || data.entity.code || "Entity";

  if (kind === "employees") {
    return <EmployeesDrill entityId={entityId} entityName={entityName} onClose={onClose} />;
  }
  if (kind === "journal") {
    return <JournalDrill entityId={entityId} entityName={entityName} onClose={onClose} />;
  }

  const { headers, rows } = localRows(kind, data);
  const isHolders = kind === "shareholders";
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`${isHolders ? "Shareholders" : "Subsidiaries"} · ${entityName}`}
      description={
        isHolders
          ? "Everyone recorded on the cap table, with every role they hold. Click a holding company to open its dossier."
          : "Companies whose parent is this entity. Click a row to open its dossier."
      }
      headers={headers}
      rows={rows}
      emptyLabel={
        isHolders
          ? "No shareholders recorded yet — the Shareholding section on the People & shareholding tab is where they are added."
          : "This entity has no subsidiaries recorded. Set a parent on another entity's Structure tab to add one."
      }
    />
  );
}
