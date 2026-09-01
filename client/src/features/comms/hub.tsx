/**
 * Comms — the single Messaging workstation:
 *   /comms        → unified inbox / team chat (individual + group channels)
 *   /comms/mail   → the mailbox: the PR-1 unified inbox (threads, folders,
 *                   search, the Master Composer). Connecting and managing
 *                   mailboxes (Microsoft 365 / Google / IMAP-SMTP) lives under
 *                   Comms → Setup.
 *   /comms/setup  → everything about how email is configured, in sub-tabs:
 *                   My mailbox (everyone) · Mailboxes, Send points and
 *                   Senders & channels (administrators). PR-0 moved tenant mail
 *                   configuration here rather than into Settings: it used to be
 *                   spread across three surfaces and nobody could find it.
 *
 * The hub draws its own Chat / Mailbox / Setup tab bar: `areas.ts` defines no
 * sections for Comms (so the ribbon's second row carries nothing here), and the
 * mailbox is a product surface that used to be reachable only by URL. The bar
 * is persistent — every page keeps it, so Mailbox is always one click away.
 */
import { useParams, NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { pageShell } from "@/lib/layout";
import { HubTabs } from "@/components/tabbed-hub";
import { TeamChatPage } from "./team-chat";
import { InboxPage } from "./inbox";
import { CommsSetupPage } from "./setup/index";
import { SignaturesPage } from "./signatures";

const TABS = [
  { to: "/comms", label: "Chat", end: true },
  { to: "/comms/mail", label: "Mailbox", end: false },
  { to: "/comms/signatures", label: "Signatures", end: false },
  { to: "/comms/setup", label: "Setup", end: false },
] as const;

export function CommsHub() {
  const { section } = useParams();
  const page =
    section === "setup" ? (
      <CommsSetupPage />
    ) : section === "signatures" ? (
      <SignaturesPage />
    ) : section === "mail" ? (
      /* The legacy Mail page's mode switcher (inbox / message log / mailboxes)
         was deleted with the legacy composer: the inbox IS the mailbox now.
         Mailbox connection management moved to Comms → Setup. */
      <section className={pageShell.wide}>
        <HubTabs />
        <InboxPage />
      </section>
    ) : (
      <TeamChatPage />
    );
  return (
    <section className="animate-fade-in">
      <nav
        className="mb-4 flex items-end gap-1 border-b border-border"
        aria-label="Comms sections"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {page}
    </section>
  );
}
