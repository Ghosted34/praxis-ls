/**
 * Comms — a single Messaging workstation (pixie parity): no hub tab-row, and no
 * standalone Mail screen. `/comms` is the unified inbox where email lives as an
 * Email conversation (send + reply). Setup (keys/channels) is reached from the
 * inbox gear.
 */
import { useParams } from "react-router-dom";
import { TeamChatPage } from "./team-chat";
import { SetupPage } from "./setup";

export function CommsHub() {
  const { section } = useParams();
  if (section === "setup") return <SetupPage />;
  return <TeamChatPage />;
}
