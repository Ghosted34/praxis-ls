/**
 * Comms → Setup — everything about how this company's email is configured, in
 * one place, split by WHO is doing it.
 *
 * ── WHY THIS LIVES IN COMMS AND NOT IN SETTINGS ─────────────────────────────
 *
 * Email configuration used to be spread across three surfaces: section senders
 * and the shared SMTP login under Comms → Setup, mailbox connections inside the
 * Mailbox tab, and a signature blob under Settings. Nobody could hold that map
 * in their head, and "where do I change the address invoices come from?" had no
 * findable answer. It is all here now, and Comms is where people already are
 * when they think about mail.
 *
 * ── THE SUB-TABS, AND WHO SEES THEM ─────────────────────────────────────────
 *
 *   My mailbox        everyone. Connect and look after your own one address.
 *   Mailboxes         administrators. The whole inventory: personal and shared,
 *                     health, members, limits, handover.
 *   Send points       administrators. Which sender each part of the product
 *                     mails from — and, next to every row, WHY.
 *   Senders & channels administrators. The existing per-purpose identities, the
 *                     shared SMTP login, WhatsApp and the DNS setup guide.
 *
 * A non-administrator sees ONE tab and therefore no tab strip at all — a strip
 * with a single item is noise. What they may do is answered by the server
 * (`GET /mail/me`) rather than guessed from the modules they can read: read
 * visibility is not the same right as edit, and a tab that always 403s teaches
 * people to distrust the tabs that work. The API remains the authority; this
 * only decides what is offered.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/mail-api";
import { MyMailboxTab } from "./my-mailbox";
import { MailboxesTab } from "./mailboxes";
import { SendPointsTab } from "./send-points";
import { SetupPage as SendersAndChannelsTab } from "../setup";

type TabKey = "mine" | "mailboxes" | "send-points" | "senders";

const TABS: { key: TabKey; label: string; adminOnly: boolean; hint: string }[] = [
  { key: "mine", label: "My mailbox", adminOnly: false, hint: "Your own professional address" },
  { key: "mailboxes", label: "Mailboxes", adminOnly: true, hint: "Every mailbox in the company" },
  { key: "send-points", label: "Send points", adminOnly: true, hint: "Which address each part of the product sends from" },
  { key: "senders", label: "Senders & channels", adminOnly: true, hint: "System senders, shared SMTP, WhatsApp, DNS" },
];

export function CommsSetupPage() {
  const caps = useResource(() => api.mailCapabilities(), []);
  // Until the answer arrives, offer only the tab everyone has. Over-offering for
  // a frame and then retracting is worse than a tab appearing a moment later.
  const isAdmin = caps.data?.can_administer === true;
  const visible = TABS.filter((t) => !t.adminOnly || isAdmin);

  const [tab, setTab] = React.useState<TabKey>("mine");
  React.useEffect(() => {
    if (!visible.some((t) => t.key === tab)) setTab("mine");
  }, [visible, tab]);

  return (
    <div className="space-y-4">
      {visible.length > 1 && (
        <nav
          className="flex flex-wrap items-end gap-1 border-b border-border"
          aria-label="Email setup sections"
        >
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              title={t.hint}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {tab === "mine" && <MyMailboxTab />}
      {tab === "mailboxes" && isAdmin && <MailboxesTab />}
      {tab === "send-points" && isAdmin && <SendPointsTab />}
      {tab === "senders" && isAdmin && <SendersAndChannelsTab />}
    </div>
  );
}
