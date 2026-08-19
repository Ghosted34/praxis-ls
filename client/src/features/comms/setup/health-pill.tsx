/**
 * One mailbox's health, as a badge with the reason on hover.
 *
 * The reason matters as much as the colour. "Not connected since Tuesday" is
 * something a person can act on; a red dot is something they learn to ignore.
 * The server computes both (limits.health) so the workspace list, the admin
 * inventory and this badge can never disagree about what OK means.
 */
import { Pill, type Tone } from "@/components/ui/pill";
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

export function HealthPill({ health }: { health?: MailboxHealth | null }) {
  if (!health) return null;
  return (
    <span title={health.reason}>
      <Pill tone={TONE[health.level] || "mute"}>{LABEL[health.level] || health.level}</Pill>
    </span>
  );
}
