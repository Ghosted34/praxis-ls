/**
 * Comms — the single Messaging workstation:
 *   /comms        → unified inbox / team chat (individual + group channels)
 *   /comms/mail   → the mailbox: the PR-1 unified inbox (threads, folders,
 *                   search, the Master Composer). Connecting and managing
 *                   mailboxes (Microsoft 365 / Google / IMAP-SMTP) lives under
 *                   Comms → Setup.
 *   /comms/clients → the Client inbox: every client's portal conversations,
 *                   waiting first (client portal PR 3, MOD-64C).
 *   /comms/calls  → the user's calls, and /comms/calls/:callId one call's
 *                   summary and transcript. Call settings live at
 *                   /settings/calls.
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
import { CallsListPage } from "./call/calls-list";
import { CallRecordPage } from "./call/call-record";
import { useCallCapabilities } from "./call/call-capabilities";
import { ClientInboxPage } from "./client-inbox";
import { useCanUseModule } from "@/lib/route-access";

const TABS = [
  { to: "/comms", label: "Chat", end: true },
  { to: "/comms/mail", label: "Mailbox", end: false },
  // Client portal PR 3: every client's portal conversations (MOD-64C).
  { to: "/comms/clients", label: "Clients", end: false },
  { to: "/comms/signatures", label: "Signatures", end: false },
  { to: "/comms/calls", label: "Calls", end: false },
  { to: "/comms/setup", label: "Setup", end: false },
] as const;

export function CommsHub() {
  const { section: sectionParam, callId } = useParams();
  // `/comms/calls/:callId` has no `:section`; it is the Calls tab all the same.
  const section = callId ? "calls" : sectionParam;
  const isChat = !section || !["setup", "signatures", "mail", "calls", "clients"].includes(section);
  // F10: no Calls tab while the tenant has calls off. A deep link to a call
  // still opens it — its record answers for itself.
  const callsOn = useCallCapabilities()?.calls === true;
  // The Client inbox only for the people who answer clients; a deep link from
  // an alert still opens it, and the API answers for itself.
  const inboxOn = useCanUseModule("MOD-64C");
  const tabs = TABS.filter(
    (t) =>
      (t.to !== "/comms/calls" || callsOn || section === "calls") &&
      (t.to !== "/comms/clients" || inboxOn || section === "clients"),
  );
  const page =
    section === "setup" ? (
      <CommsSetupPage />
    ) : section === "calls" ? (
      callId ? <CallRecordPage /> : <CallsListPage />
    ) : section === "clients" ? (
      <section className={pageShell.wide}>
        <ClientInboxPage />
      </section>
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
    <section className={cn("animate-fade-in", isChat && "flex h-full min-h-0 flex-col")}>
      <nav
        className="mb-4 flex shrink-0 items-end gap-1 border-b border-border"
        aria-label="Comms sections"
      >
        {tabs.map((t) => (
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
