/**
 * A client looking at one of their own shipments.
 *
 * WHAT A CLIENT SEES, and what they deliberately do not. The stages their
 * forwarder chose to show them (`is_client_visible`, set per stage in the template
 * editor — our invoicing and internal handling stages are not their business), each
 * with the date they were COMMITTED to. Not our internal forecast, unless the
 * tenant has turned that on: a forecast that moves twice a week reads as a schedule
 * nobody is in control of.
 *
 * AND THE CONDITIONS, IN THE SAME VIEW. The published assumptions sit directly
 * under the chain, because that is the entire point of publishing them. Customs
 * keeps its own hours, the terminal shuts on Sundays, a red-channel declaration
 * costs a day, and a port strike is nobody's fault. A client who reads the dates
 * and the conditions together has a conversation when something slips; a client who
 * was shown only dates has an argument.
 *
 * ── WHAT CHANGED IN THE MOVE HERE ──────────────────────────────────────────
 *
 * Every sentence is a dictionary key, including the two that are easy to leave
 * behind because they are built out of pieces: `{{done}} of {{total}} steps
 * complete` and `Completed {{date}}`. In `client` they are string concatenation in
 * JSX, which is why the French portal reads "3 of 8 steps complete" under a French
 * heading. Interpolation is the translator's unit, not the word — a sentence split
 * across three expressions cannot be reordered, and French puts the number
 * somewhere else in exactly these two cases.
 *
 * The `msg` here is also the portal's shared one rather than a local
 * `e.message` passthrough: a stage-chain read can fail with a driver error, and
 * the client should read a sentence, not our stack.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { dateFmt } from "@/lib/format";
import {
  portalClientChain,
  portalRaiseTicket,
  type PortalChain,
} from "@/lib/portal-api";
import { msg } from "./portal-chrome";

/** Stage status → dictionary key. Keys, not labels, so a language switch
 *  re-titles a pill that is already on screen. */
const STATUS_KEY: Record<string, string> = {
  PENDING: "portal.statusTodo",
  IN_PROGRESS: "portal.statusInProgress",
  DONE: "portal.statusDone",
  BLOCKED: "portal.statusBlocked",
};

const statusTone = (s: string): "ok" | "warn" | "mute" | "blue" => {
  switch (String(s || "").toUpperCase()) {
    case "DONE":
      return "ok";
    case "IN_PROGRESS":
      return "blue";
    case "BLOCKED":
      return "warn";
    default:
      return "mute";
  }
};

export function PortalShipment({
  dossierId,
  onBack,
}: {
  dossierId: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
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
    return () => {
      alive = false;
    };
  }, [dossierId]);

  if (error) return <ErrorState message={error} />;
  if (!chain) return <SkeletonTable />;

  const service = chain.dossier.service_en || chain.dossier.service_fr;
  const done = chain.milestones.filter((m) => m.status === "DONE").length;

  async function raiseTicket() {
    setSending(true);
    try {
      const stage = chain!.milestones.find((x) => x.code === asking);
      await portalRaiseTicket({
        dossier_id: chain!.dossier.dossier_id,
        subject: subject.trim(),
        body: stage
          ? t("portal.aboutStage", { label: stage.label_en || stage.label })
          : undefined,
      });
      setSent(true);
      setSubject("");
      setAsking(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("portal.backToShipments")}
          </button>
        )}
        <h1 className="num font-display text-h2 font-semibold tracking-tight">
          {chain.dossier.ref}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {service ? `${service} · ` : ""}
          {t("portal.stepsDone", { done, total: chain.milestones.length })}
        </p>
      </div>

      <Panel title={t("portal.progress")}>
        {chain.milestones.length === 0 ? (
          <EmptyState
            title={t("portal.noStages")}
            hint={t("portal.noStagesHint")}
          />
        ) : (
          <ol className="divide-y divide-[var(--border)]">
            {chain.milestones.map((m) => (
              <li
                key={m.code + String(m.stage_seq)}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.label_en || m.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.status === "DONE" && m.completed_at
                      ? t("portal.completedOn", {
                          date: dateFmt(m.completed_at),
                        })
                      : m.planned_due
                        ? t("portal.expectedOn", {
                            date: dateFmt(m.planned_due),
                          })
                        : t("portal.scheduledLater")}
                    {/* Only present at all when the forwarder has chosen to share it. */}
                    {m.forecast_due &&
                    m.planned_due &&
                    m.forecast_due !== m.planned_due
                      ? ` · ${t("portal.trackingNow", { date: dateFmt(m.forecast_due) })}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Raising the query HERE rather than by email is the whole
                      reason Q tickets exist — it stays on the file, visible to
                      everyone working it. */}
                  <button
                    type="button"
                    onClick={() => setAsking(m.code)}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {t("portal.askAboutThis")}
                  </button>
                  <Pill tone={statusTone(m.status)}>
                    {STATUS_KEY[m.status] ? t(STATUS_KEY[m.status]) : m.status}
                  </Pill>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {asking && (
        <Panel title={t("portal.askTitle")}>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("portal.askIntro")}
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-56 flex-1">
              <Input
                // No visible label: the placeholder and the panel heading already
                // say what this is, and a repeated label above a one-line reply box
                // is noise. The accessible name is supplied explicitly instead.
                label=""
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("portal.askPlaceholder")}
                aria-label={t("portal.askLabel")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (subject.trim()) void raiseTicket();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              disabled={!subject.trim() || sending}
              loading={sending}
              onClick={raiseTicket}
            >
              {t("common.send")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAsking(null)}
            >
              {t("common.close")}
            </Button>
          </div>
        </Panel>
      )}

      {sent && (
        <Panel title={t("portal.querySentTitle")}>
          <p className="text-sm text-muted-foreground">
            {t("portal.querySentBody")}
          </p>
        </Panel>
      )}

      {chain.assumptions.length > 0 && (
        <Panel title={t("portal.assumptionsTitle")}>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("portal.assumptionsIntro")}
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
