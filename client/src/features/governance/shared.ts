/**
 * Governance — helpers shared by the audit, notification, workflow and
 * approval screens.
 *
 * Split out of `features/governance/pages.tsx` (928 lines) in Phase 4, audit F7.
 */
import { pageShell } from "@/lib/layout";

export const shell = pageShell.wide;

/** Short display for a user id when the /users list isn't readable. */
export const shortId = (id?: string | null) =>
  id ? `…${String(id).slice(-8)}` : "—";
