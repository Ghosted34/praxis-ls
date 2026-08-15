/**
 * Non-blocking "Possible duplicates" hint (PR3-C §5.1).
 *
 * Debounced (350 ms) call to the server-side dedup detector as an operator types
 * a new client / supplier. It NEVER blocks creation — an amber advisory only,
 * dismissible with "Continue anyway". Shown on both create forms; the same
 * detector powers the 360's duplicate panel.
 */
import * as React from "react";
import { Pill } from "@/components/ui/pill";
import * as api from "@/lib/masterdata-api";

export function DedupeHint({
  kind,
  name,
  legalName,
  email,
  registrations,
  excludeId,
  onOpen,
}: {
  kind: api.PartyKind;
  name?: string;
  legalName?: string;
  email?: string;
  registrations?: { kind: string; number?: string }[];
  excludeId?: string;
  onOpen?: (id: string) => void;
}) {
  const [candidates, setCandidates] = React.useState<api.DedupeCandidate[]>([]);
  const [dismissed, setDismissed] = React.useState(false);
  const regKey = JSON.stringify(registrations || []);

  React.useEffect(() => {
    const nm = (legalName || name || "").trim();
    const hasSignal =
      nm.length >= 3 ||
      (email || "").trim().length > 3 ||
      (registrations || []).some((r) => r.number);
    if (!hasSignal) {
      setCandidates([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.dedupeCheck(kind, {
          name,
          legal_name: legalName,
          email,
          registrations,
          exclude_id: excludeId,
        });
        setCandidates(r.candidates || []);
      } catch {
        setCandidates([]);
      }
    }, 350);
    return () => clearTimeout(t);
    // regKey stringifies registrations so the effect re-runs on content change.
  }, [kind, name, legalName, email, regKey, excludeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dismissed || candidates.length === 0) return null;
  return (
    <div className="sm:col-span-2 rounded-lg border border-warn/40 bg-warn-fill/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Pill tone="orange">Possible duplicates</Pill>
          <span className="micro">
            {candidates.length} similar {kind}
            {candidates.length === 1 ? "" : "s"} already exist — check before
            creating.
          </span>
        </span>
        <button
          type="button"
          className="micro underline"
          onClick={() => setDismissed(true)}
        >
          Continue anyway
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {candidates.map((c) => (
          <li key={c.id} className="text-sm">
            {onOpen ? (
              <button
                type="button"
                className="text-primary-ink underline"
                onClick={() => onOpen(c.id)}
              >
                {c.name || c.ref || c.id.slice(0, 8)}
              </button>
            ) : (
              <span className="font-medium text-foreground">
                {c.name || c.ref || c.id.slice(0, 8)}
              </span>
            )}
            <span className="ml-2 micro">
              {[c.ref, c.reasons.join(", "), `score ${c.score}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
