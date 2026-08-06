/**
 * Recent activity — the Control Tower's self-scoped audit widget.
 *
 * REPLACES the old workspace "Recent activity" panel, whose data source was
 * `event_log` and whose renderer was `humanizeEvent(action) + " · " +
 * humanizeRef(entity_ref)` — so every recent action rendered as e.g.
 * "Auth token refreshed · App user c2d39ee8". The rebuild moves the surface
 * to the tower home page, changes the source to `immutable_ledger`
 * (identity + tenant schemas, merged in the controller), and pipes each row
 * through `humanize()` for a real sentence.
 *
 * Four render states are honoured explicitly — loading, empty, error and
 * populated — because a placeholder empty state (the shipped default) hides
 * a real fetch failure and the widget's whole job is to tell the user what
 * happened.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldIcon,
  SendIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XIcon,
  DownloadIcon,
  EyeIcon,
  RefreshIcon,
  ArrowRightIcon,
} from "@/components/ui/icons";
import { fmtRelative, friendlyModule } from "@/lib/format";
import { humanize, type Kind } from "@/lib/audit-humanize";
import { AuditDetailModal } from "@/components/audit/audit-detail-modal";
import type { AuditFeedRow } from "../use-my-audit-feed";
import { useMyAuditFeed } from "../use-my-audit-feed";

/**
 * Clock — used in the empty state. Not in the shared icon set today, so it
 * lives here rather than growing that file for a single-use glyph.
 */
function ClockIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={p.width ?? 22}
      height={p.height ?? 22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * A minimal "$" glyph for money-flavoured kinds. Shipped-set stops at Send /
 * Download; a dollar sign here keeps the icon shape distinct from the other
 * tints so a payment card is legible at a glance.
 */
function MoneyIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={p.width ?? 18}
      height={p.height ?? 18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12 3v18" />
      <path d="M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7" />
    </svg>
  );
}

/**
 * Kind → icon. Same closed union as `kindToTone`, so tint and glyph never
 * drift. `message` uses the send icon because the SPECIALS map produces
 * "You sent a message …" — a mail icon would suggest inbox, not authoring.
 */
const KIND_ICON: Record<Kind, (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  security: ShieldIcon,
  message: SendIcon,
  send: SendIcon,
  create: PlusIcon,
  update: PencilIcon,
  delete: TrashIcon,
  approve: CheckIcon,
  reject: XIcon,
  money: MoneyIcon,
  export: DownloadIcon,
  view: EyeIcon,
  generic: RefreshIcon,
};

/**
 * The `.st-*` classes come from the design system (see client/src/index.css)
 * and already carry the correct tint per tone. We reuse them here rather
 * than piling raw palette classes on the icon well.
 */
const TONE_WELL: Record<Kind, string> = {
  security: "st-blue",
  message: "st-blue",
  send: "st-blue",
  create: "st-ok",
  approve: "st-ok",
  update: "st-warn",
  export: "st-warn",
  delete: "st-bad",
  reject: "st-bad",
  money: "st-orange",
  view: "st-mute",
  generic: "st-mute",
};

// ── Row ─────────────────────────────────────────────────────────────────────

function ActivityRow({
  row,
  isLast,
  onOpen,
}: {
  row: AuditFeedRow;
  isLast: boolean;
  onOpen: (row: AuditFeedRow) => void;
}) {
  const { text, kind, sensitive } = humanize(row);
  const Icon = KIND_ICON[kind];
  const rowIsSensitive = sensitive || row.is_sensitive === true;

  // Whole row is a button — keyboard-focusable, Enter opens the detail modal,
  // 44px minimum tap target on mobile via py-3 + icon well height.
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40",
          !isLast && "border-b border-border/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "min-h-[44px]",
        )}
        aria-label={`${text}. Opens details.`}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg",
            TONE_WELL[kind],
          )}
        >
          <Icon width={18} height={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">{text}</span>
            <span className="micro shrink-0 whitespace-nowrap text-muted-foreground">
              {fmtRelative(row.created_at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2 truncate text-micro text-muted-foreground">
            <span className="truncate">{friendlyModule(row.module_key)}</span>
            {rowIsSensitive && <Pill tone="warn">Sensitive</Pill>}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── Widget ──────────────────────────────────────────────────────────────────

export function RecentActivity() {
  const [page, setPage] = React.useState(1);
  const [detail, setDetail] = React.useState<AuditFeedRow | null>(null);

  const q = useMyAuditFeed(page);
  const rows = q.data?.rows ?? [];
  const meta = q.data?.meta ?? null;

  // "Last 24 hours" is honest only when we're on page 1 with recent rows;
  // deeper pages read "Latest actions" so the section head never over-claims.
  const sectionMeta = meta?.window === "24h" ? "Last 24 hours" : "Latest actions";

  const total = meta?.total ?? 0;
  const pageSize = meta?.page_size ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPager = total > pageSize;
  const canPrev = page > 1 && !q.isFetching;
  const canNext = (meta?.has_more === true) && !q.isFetching;

  // Loading with NO prior data → skeleton rows. Once a page has rendered,
  // `placeholderData: (prev) => prev` keeps the previous list visible while a
  // pagination change flies, so this branch only ever fires on first paint.
  const isInitialLoading = q.isLoading && !q.data;

  return (
    <section
      aria-label="Recent activity"
      className="mb-5"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold tracking-tight">Recent activity</h2>
        <span className="micro uppercase tracking-wide text-muted-foreground">{sectionMeta}</span>
      </div>

      <Card className="overflow-hidden">
        {isInitialLoading ? (
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-[38px] w-[38px] rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : q.error ? (
          <div className="p-4">
            <ErrorState
              // Type narrowing: `q.error` is Error (TanStack-typed), not the
              // formatted string useList produces — display .message.
              message={q.error instanceof Error ? q.error.message : "Couldn't load recent activity."}
              action={
                <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClockIcon width={22} height={22} />}
            title="No activity yet"
            hint="Actions you take will appear here."
            className="border-0"
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-busy={q.isFetching ? "true" : "false"}>
            {rows.map((row, i) => (
              <ActivityRow
                key={row.ledger_id}
                row={row}
                isLast={i === rows.length - 1}
                onOpen={setDetail}
              />
            ))}
          </ul>
        )}

        {/* Pager only when there is more than one page's worth to show.
            Disabled at boundaries AND while fetching so a double-click cannot
            walk past the last page or land on a stale response. */}
        {hasPager && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ArrowRightIcon width={14} height={14} className="rotate-180" />
              <span className="ml-1">Prev</span>
            </Button>
            <span className="micro uppercase tracking-wide text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <span className="mr-1">Next</span>
              <ArrowRightIcon width={14} height={14} />
            </Button>
          </div>
        )}
      </Card>

      {detail && (
        <AuditDetailModal
          row={{
            ledger_id: detail.ledger_id,
            action: detail.action,
            module_key: detail.module_key,
            entity_ref: detail.entity_ref,
            actor_name_snapshot: detail.actor_name_snapshot,
            is_sensitive: detail.is_sensitive,
            metadata: detail.metadata,
            created_at: detail.created_at,
            // before_json / after_json intentionally omitted — the modal
            // detects the absence and fetches the full row via GET /audit/:id.
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </section>
  );
}

// KIND_ICON and TONE_WELL above are `Record<Kind, …>`, so TS refuses the
// build if a new kind lands in `audit-humanize.ts` without an icon or tone
// here. That is the coverage check; no runtime sentinel needed.
