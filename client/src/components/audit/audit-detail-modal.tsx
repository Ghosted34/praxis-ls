/**
 * Shared "one ledger row, expanded" modal.
 *
 * EXTRACTED from `features/governance/audit.tsx:95-119`. Both the Governance
 * page (Audit Ledger tab) and the new Control Tower "Recent activity" widget
 * open this — same detail card, same headline sentence, same collapsible
 * before/after. The old copy was inline and used the raw `row.action` as its
 * modal title, which is the same "Auth token refreshed" defect the rebuild
 * exists to fix.
 *
 * Two data shapes reach this component:
 *
 *   1. Governance's Ledger tab already has the WHOLE row in memory (list
 *      query returns before_json/after_json). Pass it as `row` — the modal
 *      renders directly, no extra fetch.
 *   2. The Control Tower widget's list payload is DELIBERATELY THIN — the
 *      /audit/my-feed repo returns ledger_id/action/module_key/…/is_sensitive
 *      only (`before_json`/`after_json`/`ip` stay off the wire). Pass the
 *      partial row and this component fetches the full one from
 *      `GET /tenant/audit/:id` on open.
 *
 * The difference is transparent to the caller. Either way `humanize(row)`
 * writes the headline and `friendlyModule(row.module_key, row.action)` writes
 * the Area row — those come from the initial row and don't need the fetch to
 * resolve.
 */
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { DataView } from "@/components/ui/data-view";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { LoadingRow } from "@/components/ui/states";
import { tenant } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import { dateTimeFmt, friendlyModule } from "@/lib/format";
import { humanize } from "@/lib/audit-humanize";

/**
 * The wire shape of a ledger entry. Both surfaces converge on this: the
 * Governance list returns every field, the my-feed list returns the thin
 * subset (before_json/after_json/ip absent). `Partial<>` on the heavy fields
 * expresses that without forking the type.
 */
export type AuditLedgerEntry = {
  ledger_id: number | string;
  action: string;
  module_key?: string | null;
  entity_ref?: string | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
  actor_name_snapshot?: string | null;
  actor_email_snapshot?: string | null;
  is_sensitive?: boolean;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  ip?: string | null;
  before_json?: unknown;
  after_json?: unknown;
};

/** Compact JSON viewer — labelled field list rather than raw text (audit A4). */
function Json({ value }: { value: unknown }) {
  return <DataView data={value} emptyTitle="—" className="max-h-64 overflow-auto" />;
}

/**
 * Resolve actor id → name for the "Actor" row.
 *
 * Prefers the snapshot columns (0510) which are stamped at write time and so
 * present in both the identity and tenant schemas without a join. Falls back
 * to the pre-0510 `actorName` prop (Governance still passes it, because that
 * page already resolves user ids into a name map via `useActorNames`).
 * Empty → em dash, so the row never leaves the modal blank.
 */
function actorLabel(row: AuditLedgerEntry, actorName?: Record<string, string>): string {
  if (row.actor_name_snapshot) return row.actor_name_snapshot;
  if (row.actor_email_snapshot) return row.actor_email_snapshot;
  if (actorName && row.actor_user_id && actorName[row.actor_user_id]) {
    return actorName[row.actor_user_id];
  }
  return row.actor_user_id ? `…${String(row.actor_user_id).slice(-8)}` : "—";
}

type Props = {
  /** The row to expand. If it has `before_json`/`after_json` the modal renders
   *  directly; if not, they're fetched via `GET /audit/:id`. */
  row: AuditLedgerEntry;
  /** Optional actor id → name map (Governance passes one from useActorNames). */
  actorName?: Record<string, string>;
  onClose: () => void;
};

export function AuditDetailModal({ row, actorName, onClose }: Props) {
  // Fetch the full row only when the list payload didn't include the heavy
  // fields — for the Control Tower widget that's always; for Governance
  // that's never. `useResource` returns null until it resolves, so we render
  // with the partial row and swap in fetched data as it arrives.
  const needsFetch = row.before_json === undefined && row.after_json === undefined;
  const detail = useResource<AuditLedgerEntry | null>(
    () => (needsFetch ? tenant<AuditLedgerEntry>(`/audit/${row.ledger_id}`) : Promise.resolve(row)),
    // Only re-fetch when the id changes, not on every re-render.
    [row.ledger_id, needsFetch],
  );

  const full = detail.data || row;
  const humanised = humanize(full as AuditLedgerEntry & { created_at: string; is_sensitive: boolean; metadata: Record<string, unknown> | null; actor_name_snapshot: string | null; module_key: string | null; entity_ref: string | null });
  const isSensitive = row.is_sensitive === true || full.is_sensitive === true || humanised.sensitive;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={humanised.text}
      description="Ledger entries are append-only — a database trigger forbids update and delete."
    >
      <div className="space-y-4">
        {isSensitive && (
          <div>
            <Pill tone="warn">Sensitive</Pill>
          </div>
        )}

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="micro uppercase tracking-wide">Area</div>
            <span>{friendlyModule(row.module_key, row.action)}</span>
          </div>
          <div>
            <div className="micro uppercase tracking-wide">Entity</div>
            <span className="num">{row.entity_ref || "—"}</span>
          </div>
          <div>
            <div className="micro uppercase tracking-wide">Actor</div>
            <span>{actorLabel(full, actorName)}</span>
            {row.actor_role ? <span className="text-muted-foreground"> · {row.actor_role}</span> : null}
          </div>
          <div>
            <div className="micro uppercase tracking-wide">When</div>
            <span className="num">{dateTimeFmt(row.created_at)}</span>
            {full.ip ? <span className="num text-muted-foreground"> · {full.ip}</span> : null}
          </div>
        </div>

        {detail.error ? (
          <ErrorState message={detail.error} />
        ) : needsFetch && detail.loading ? (
          <LoadingRow label="Loading full entry…" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="micro mb-1 uppercase tracking-wide">Before</div>
              <Json value={full.before_json} />
            </div>
            <div>
              <div className="micro mb-1 uppercase tracking-wide">After</div>
              <Json value={full.after_json} />
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
