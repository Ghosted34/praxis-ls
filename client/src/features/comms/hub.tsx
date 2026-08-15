/**
 * Comms — the single Messaging workstation:
 *   /comms        → unified inbox / team chat (individual + group channels)
 *   /comms/mail   → the mailbox (email_connection): connect + work any mailbox
 *                   (Microsoft 365 / Google / IMAP-SMTP), inbound + outbound
 *   /comms/setup  → system-email senders, shared SMTP + channels
 *
 * The hub draws its own Chat / Mailbox / Setup tab bar: `areas.ts` defines no
 * sections for Comms (so the ribbon's second row carries nothing here), and the
 * mailbox is a product surface that used to be reachable only by URL. The bar
 * is persistent — every page keeps it, so Mailbox is always one click away.
 */
import { useParams, NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { TeamChatPage } from "./team-chat";
import { MailPage } from "./mail";
import { SetupPage } from "./setup";

const TABS = [
  { to: "/comms", label: "Chat", end: true },
  { to: "/comms/mail", label: "Mailbox", end: false },
  { to: "/comms/setup", label: "Setup", end: false },
] as const;

export function CommsHub() {
  const { section } = useParams();
  const page =
    section === "setup" ? (
      <SetupPage />
    ) : section === "mail" ? (
      <MailPage />
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
