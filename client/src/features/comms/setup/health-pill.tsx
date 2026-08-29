/**
 * One mailbox's health, as a badge with the reason on hover.
 *
 * The reason matters as much as the colour. "Not connected since Tuesday" is
 * something a person can act on; a red dot is something they learn to ignore.
 * The server computes both (limits.health) so the workspace list, the admin
 * inventory and this badge can never disagree about what OK means.
 */
import { Pill, type Tone } from "@/components/ui/pill";
import { tr } from "@/lib/i18n";
import type { MailboxHealth } from "@/lib/mail-api";

const TONE: Record<string, Tone> = {
  OK: "ok",
  WARN: "warn",
  DOWN: "bad",
  PENDING: "warn",
  OFF: "mute",
  ARCHIVED: "mute",
};

const LABEL: Record<string, string> = {
  OK: "Healthy",
  WARN: "Needs a look",
  DOWN: "Not working",
  PENDING: "Not verified",
  OFF: "Paused",
  ARCHIVED: "Retired",
};

export function HealthPill({
  health,
  showReason,
}: {
  health?: MailboxHealth | null;
  /**
   * Put the reason on screen, not only in the tooltip.
   *
   * `title` is the right amount for a healthy mailbox in a dense list. It is
   * the wrong amount for a broken one: a red "Not working" with the WHY behind
   * a hover is unreachable on a phone or a tablet, and unfindable on a desktop
   * by anyone who does not already suspect there is something to hover over.
   * The one place a person goes to ask "why is my mail not arriving?" has to
   * answer without them guessing at the interaction.
   */
  showReason?: boolean;
}) {
  if (!health) return null;
  const pill = (
    <Pill tone={TONE[health.level] || "mute"}>
      {LABEL[health.level] ? tr(LABEL[health.level]) : health.level}
    </Pill>
  );
  if (!showReason || !health.reason || health.level === "OK") {
    return <span title={health.reason}>{pill}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      {pill}
      <span className="micro text-muted-foreground">{health.reason}</span>
    </span>
  );
}
