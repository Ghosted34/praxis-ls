/**
 * A client looking at one of their own shipments.
 *
 * WHAT A CLIENT SEES, and what they deliberately do not. The stages their
 * forwarder chose to show them (`is_client_visible`, set per stage in the
 * template editor — our invoicing and internal handling stages are not their
 * business), each with the date they were COMMITTED to. Not our internal
 * forecast, unless the tenant has turned that on: a forecast that moves twice a
 * week reads as a schedule nobody is in control of.
 *
 * AND THE CONDITIONS, IN THE SAME VIEW. The published assumptions sit directly
 * under the chain, because that is the entire point of publishing them. Customs
 * keeps its own hours, the terminal shuts on Sundays, a red-channel declaration
 * costs a day, and a port strike is nobody's fault. A client who reads the
 * dates and the conditions together has a conversation when something slips; a
 * client who was shown only dates has an argument.
 */
import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { dateFmt } from "@/lib/format";
import { portalClientChain, portalRaiseTicket, type PortalChain } from "@/lib/portal-api";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const STATUS_LABEL: Record<string, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  BLOCKED: "On hold",
};

const statusTone = (s: string): "ok" | "warn" | "mute" | "blue" => {
  switch (String(s || "").toUpperCase()) {
    case "DONE": return "ok";
    case "IN_PROGRESS": return "blue";
    case "BLOCKED": return "warn";
    default: return "mute";
  }
};

export function PortalShipment({ dossierId, onBack }: { dossierId: string; onBack?: () => void }) {
  const [chain, setChain] = React.useState<PortalChain | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [subject, setSubject] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setChain(null);
    setError(null);
    portalClientChain(dossierId)
      .then((c) => alive && setChain(c))
      .catch((e) => alive && setError(msg(e)));
    return () => { alive = false; };
  }, [dossierId]);

  if (error) return <ErrorState message={error} />;
  if (!chain) return <SkeletonTable />;

  const service = chain.dossier.service_en || chain.dossier.service_fr;
  const done = chain.milestones.filter((m) => m.status === "DONE").length;

  return (
    <div className="space-y-6">
      <div>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
            ← All shipments
          </button>
        )}
        <h1 className="font-display text-2xl text-foreground">{chain.dossier.ref}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {service ? `${service} · ` : ""}
          {done} of {chain.milestones.length} steps complete
        </p>
      </div>

      <Panel title="Progress">
        {chain.milestones.length === 0 ? (
          <EmptyState title="Nothing to show yet" hint="Steps appear here as your file is set up." />
        ) : (
          <ol className="divide-y divide-border">
            {chain.milestones.map((m) => (
              <li key={m.code + String(m.stage_seq)} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.label_en || m.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.status === "DONE" && m.completed_at
                      ? `Completed ${dateFmt(m.completed_at)}`
                      : m.planned_due
                        ? `Expected ${dateFmt(m.planned_due)}`
                        : "Scheduled once the shipment is under way"}
                    {/* Only present at all when the forwarder has chosen to share it. */}
                    {m.forecast_due && m.planned_due && m.forecast_due !== m.planned_due
                      ? ` · now tracking ${dateFmt(m.forecast_due)}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Raising the query HERE rather than by email is the whole
                      reason Q tickets exist — it stays on the file, visible to
                      everyone working it. */}
                  <button
                    type="button"
                    onClick={() => setAsking(m.code)}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Ask about this
                  </button>
                  <Pill tone={statusTone(m.status)}>{STATUS_LABEL[m.status] || m.status}</Pill>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {asking && (
        <Panel title="Ask about this step">
          <p className="mb-2 text-xs text-muted-foreground">
            Your query goes to the team handling this shipment and stays attached to the file.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's holding this up?"
              aria-label="Your question"
              className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!subject.trim() || sending}
              onClick={async () => {
                setSending(true);
                try {
                  const stage = chain.milestones.find((x) => x.code === asking);
                  await portalRaiseTicket({
                    dossier_id: chain.dossier.dossier_id,
                    subject: subject.trim(),
                    body: stage ? `About: ${stage.label_en || stage.label}` : undefined,
                  });
                  setSent(true);
                  setSubject("");
                  setAsking(null);
                } catch (e) {
                  setError(msg(e));
                } finally {
                  setSending(false);
                }
              }}
              className="rounded-md border border-border px-3 py-2 text-sm hover:opacity-80 disabled:opacity-40"
            >
              Send
            </button>
            <button type="button" onClick={() => setAsking(null)} className="px-2 text-sm text-muted-foreground">
              Cancel
            </button>
          </div>
        </Panel>
      )}

      {sent && (
        <Panel title="Query sent">
          <p className="text-sm text-muted-foreground">
            Thank you — the team handling this shipment has it, and you will see the reply here.
          </p>
        </Panel>
      )}

      {chain.assumptions.length > 0 && (
        <Panel title="What these dates assume">
          <p className="mb-3 text-xs text-muted-foreground">
            Your schedule depends on parties whose hours we do not control. These are the conditions it
            was built on.
          </p>
          <ul className="space-y-2">
            {chain.assumptions.map((a) => (
              <li key={a.code} className="text-sm text-muted-foreground">
                {a.text_en || a.text_fr}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
