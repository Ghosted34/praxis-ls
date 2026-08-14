/**
 * Security & IAM — the record shapes and the one dialog every screen here needs.
 *
 * Split out of `features/security/pages.tsx` (1,039 lines) in Phase 4, audit F7.
 * These types are shared because IAM is genuinely cross-cutting: a role appears
 * on the users screen, the roles screen and the field-visibility screen, and
 * three private copies of `Role` is how they drift apart.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { type Tone } from "@/components/ui/pill";
import { errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { pageShell } from "@/lib/layout";

/** The page shell every Security screen uses. Was a file-local const. */
export const shell = pageShell.wide;

export type User = {
  user_id: string;
  email: string;
  full_name: string;
  username?: string | null;
  status?: string | null;
  is_2fa_enabled?: boolean | null;
  employee_id?: string | null;
  failed_logins?: number | null;
  last_login_at?: string | null;
  created_at?: string | null;
  role_ids?: string[];
};

export type Role = {
  role_id: string;
  code: string;
  name: string;
  description?: string | null;
  is_system?: boolean | null;
  is_line_manager?: boolean | null;
};

export type Capability = { capability_id: string; code: string; name: string };
export type Scope = { scope_id: string; entity_id?: string | null; code: string; name: string; parent_scope_id?: string | null };
export type FieldVis = { field_visibility_id: string; role_id?: string | null; field_key: string; visibility: string };
export type Session = {
  session_id: string;
  user_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  // Server column is user_session.killed_at (0100_identity.sql:63) —
  // renamed here 2026-08 after the "Revoke" button always stayed enabled
  // because revoked_at was declared but never emitted.
  killed_at?: string | null;
};
// (Corporate entities for the scope form now come from `/scopes/entities` and
// carry their own type — `ScopeEntity` in lib/scope-api. The local shape here
// described the env-schema `/entities` list this screen no longer reads.)

export const statusTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "ACTIVE") return "ok";
  if (u === "SUSPENDED") return "warn";
  if (u === "LOCKED") return "bad";
  return "mute";
};



/** Confirm-then-delete modal shared by the four registry screens. */
export function ConfirmDelete({
  title,
  what,
  path,
  onClose,
  onDone,
}: {
  title: string;
  what: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await tenant(path, { method: "DELETE" });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={title} description="This archives the record. Existing assignments referencing it are removed by the database.">
      <div className="space-y-4">
        <div className="rounded-lg border border-[rgb(var(--bad))]/40 bg-[rgb(var(--bad)/0.08)] px-3 py-2 text-sm">
          <span className="num font-medium">{what}</span>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={go} loading={busy}>Delete</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════ Users ═══════════════════════════════════ */
