/**
 * Comms — the single Messaging workstation:
 *   /comms        → unified inbox / team chat (individual + group channels)
 *   /comms/mail   → the mailbox (email_connection): connect + work any mailbox
 *                   (Microsoft 365 / Google / IMAP-SMTP), inbound + outbound
 *   /comms/setup  → system-email senders, shared SMTP + channels
 */
import { useParams } from "react-router-dom";
import { TeamChatPage } from "./team-chat";
import { MailPage } from "./mail";
import { SetupPage } from "./setup";

export function CommsHub() {
  const { section } = useParams();
  if (section === "setup") return <SetupPage />;
  if (section === "mail") return <MailPage />;
  return <TeamChatPage />;
}
