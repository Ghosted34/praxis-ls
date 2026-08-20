/**
 * SEARCH BY MEANING (§8.9) — the toggle beside keyword search.
 *
 * Keyword search finds "demurrage" in threads containing the word "demurrage".
 * This is for the other question — "when did we last argue about storage
 * charges at Douala" — where the operator remembers the situation and not the
 * vocabulary.
 *
 * ── IT IS A SECOND ANSWER, NOT A SECOND SCREEN ──────────────────────────────
 *
 * Results render in the same shape as the list and open the same way. An inbox
 * that behaves differently once you switch a toggle is two inboxes to build and
 * two to maintain — which is the reasoning the keyword search already follows,
 * and this has no claim to be the exception.
 *
 * ── `withheld` IS SHOWN ─────────────────────────────────────────────────────
 *
 * Vector hits are CANDIDATES. Every one is re-read server-side through
 * `triage/visibility`'s §9.5 predicate before it comes back, and the ones that
 * fail are counted rather than silently dropped.
 *
 * Saying "3 more matched but you cannot see them" is deliberate. The
 * alternative is an operator concluding the search is bad at its job, asking
 * for it to be improved, and nobody realising the results were being filtered
 * correctly the whole time. It also leaks nothing: a count is not a subject
 * line, and the fact that private threads exist is not a secret.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { LoadingRow, EmptyState } from "@/components/ui/states";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt, humanizeRef } from "@/lib/format";
import * as api from "@/lib/mail-api";

export function SemanticResults({
  query,
  onOpen,
  onClear,
}: {
  query: string;
  onOpen: (threadId: string) => void;
  onClear: () => void;
}) {
  const [data, setData] = React.useState<Awaited<ReturnType<typeof api.assistSearch>> | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!query.trim()) { setData(null); return; }
    let live = true;
    setBusy(true);
    api
      .assistSearch({ query, limit: 20 })
      .then((r) => { if (live) setData(r); })
      .catch((err) => { if (live) reportActionError(err); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [query]);

  if (busy && !data) return <LoadingRow label="Searching by meaning…" />;
  if (!data) return null;

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Conversations that read like “{data.query}”
        </p>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Back to keyword search
        </Button>
      </div>

      {data.hits.length === 0 ? (
        <EmptyState
          title="Nothing came close"
          hint="Search by meaning only finds conversations that have been indexed. If this mailbox was connected recently, give the first sync time."
        />
      ) : (
        <ul className="space-y-1">
          {data.hits.map((h) => (
            <li key={h.email_thread_id}>
              <button
                type="button"
                onClick={() => onOpen(h.email_thread_id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left hover:border-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {h.subject || "(no subject)"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {h.entity_ref ? `${humanizeRef(h.entity_ref)} · ` : ""}
                    {dateTimeFmt(h.last_message_at)}
                  </span>
                </span>
                <Pill tone={h.similarity >= 0.7 ? "ok" : "mute"}>
                  {Math.round(h.similarity * 100)}%
                </Pill>
              </button>
            </li>
          ))}
        </ul>
      )}

      {data.withheld > 0 && (
        // See the header: a count, deliberately. It leaks nothing and it stops
        // correct filtering from looking like a broken feature.
        <p className="text-xs text-muted-foreground">
          {data.withheld} more matched conversations you do not have access to.
        </p>
      )}
    </div>
  );
}
