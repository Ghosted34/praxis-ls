/**
 * Security — users: create, edit, roles, and the separate password reset.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { useSearchParams } from "react-router-dom";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { num, dateFmt } from "@/lib/format";
import { tenant, ApiError } from "@/lib/api-client";
import { RowActions } from "@/components/ui/row-actions";
import {
  type User,
  type Role,
  type Capability,
  statusTone,
  shell,
} from "./shared";

/** What "Provision account" on an employee record hands over: the person to
 *  create the login for, resolved server-side from their employee row. Passed as
 *  props rather than read from the URL inside the form, so the form has one way
 *  of being told who it is for. */
export type ProvisionSeed = {
  employee_id: string;
  full_name: string;
  email: string;
};

function UserForm({
  user,
  roles,
  seed,
  onClose,
  onSaved,
}: {
  user: User | null;
  roles: Role[];
  /** Pre-fill for a login being provisioned from an employee record. */
  seed?: ProvisionSeed | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!user;
  const [email, setEmail] = React.useState(user?.email || seed?.email || "");
  const [fullName, setFullName] = React.useState(
    user?.full_name || seed?.full_name || "",
  );
  const [username, setUsername] = React.useState(user?.username || "");
  const [password, setPassword] = React.useState("");
  /*
   * INVITING IS THE DEFAULT, and it is the default for a security reason
   * rather than a convenience one. Typing a password for somebody means the
   * credential is known to two people from the moment it exists, travels over
   * WhatsApp or a sticky note to reach them, and is usually never changed by
   * the person it belongs to. An invitation mails a single-use activation link
   * to the address on the record and the administrator never learns the
   * password at all.
   */
  const [invite, setInvite] = React.useState(true);
  const [status, setStatus] = React.useState(user?.status || "ACTIVE");
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  // Authority overlay (ISSUER/VALIDATOR/APPROVER/LINE_MANAGER) — layered on top of
  // roles and read by requireCapability() on high-authority routes (e.g. disburse).
  const allCaps = useList<Capability>("/capabilities");
  const [capIds, setCapIds] = React.useState<string[]>([]);
  const [employeeId, setEmployeeId] = React.useState(
    user?.employee_id || seed?.employee_id || "",
  );
  // Live-schema employees only — app_user + its employee FK live in the live
  // schema, so linking must never offer sandbox employees (would 409/EMPLOYEE_NOT_FOUND).
  const employees = useList<{ employee_id: string; full_name?: string }>(
    "/users/employees",
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrating, setHydrating] = React.useState(editing);

  // The list endpoint omits role_ids; the detail endpoint carries them. Current
  // capabilities come from a separate endpoint (identity data, own writer).
  React.useEffect(() => {
    if (!user) return;
    let live = true;
    tenant<User>(`/users/${user.user_id}`)
      .then((u) => {
        if (live) setRoleIds(u.role_ids || []);
      })
      .catch(() => {
        /* leave roles untouched if the read is denied */
      })
      .finally(() => {
        if (live) setHydrating(false);
      });
    tenant<Capability[]>(`/capabilities/users/${user.user_id}`)
      .then((cs) => {
        if (live) setCapIds((cs || []).map((c) => c.capability_id));
      })
      .catch(() => {
        /* leave caps untouched if the read is denied */
      });
    return () => {
      live = false;
    };
  }, [user]);

  const toggleRole = (id: string) =>
    setRoleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleCap = (id: string) =>
    setCapIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && user) {
        await tenant(`/users/${user.user_id}`, {
          method: "PATCH",
          body: {
            full_name: fullName,
            email,
            username: username || null,
            employee_id: employeeId || null,
            role_ids: roleIds,
          },
        });
        // Status is a separate endpoint (audited transition, not a field patch).
        if (status !== user.status) {
          await tenant(`/users/${user.user_id}/status`, {
            method: "POST",
            body: { status },
          });
        }
        // Capabilities are identity data with their own writer (replace-all).
        await tenant(`/capabilities/users/${user.user_id}`, {
          method: "PUT",
          body: { capability_ids: capIds },
        });
      } else {
        const created = await tenant<User & { invitation?: { sent?: boolean; error?: string } }>(
          "/users",
          {
            method: "POST",
            body: {
              email,
              full_name: fullName,
              // Exactly one of the two reaches the API. Sending both would let
              // a typed password ride along with an invitation and quietly
              // become a second, unknown way in.
              ...(invite ? { invite: true } : { password }),
              username: username || null,
              employee_id: employeeId || null,
              status,
              role_ids: roleIds,
            },
          },
        );
        // The account is created either way; only the email may have failed.
        // Saying so here is the difference between "they never got it" being
        // discovered now and being discovered on their first day.
        if (invite && created?.invitation && created.invitation.sent === false) {
          setError(
            created.invitation.error ||
              "The account was created, but the invitation email could not be sent. Use Resend invitation.",
          );
          // The account EXISTS, so the list has to refresh — but the dialog
          // stays open, because closing it would take the only notice that the
          // invitation never went out off the screen with it.
          onSaved();
          return;
        }
        // Assign capabilities only after the login exists (needs its user_id).
        if (created?.user_id && capIds.length) {
          await tenant(`/capabilities/users/${created.user_id}`, {
            method: "PUT",
            body: { capability_ids: capIds },
          });
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      // The maker-checker self-grant block returns a specific 403 message worth
      // showing verbatim (errMsg would otherwise flatten every 403 to a generic line).
      setError(
        err instanceof ApiError && err.code === "SELF_GRANT_FORBIDDEN"
          ? err.message
          : errMsg(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? "Edit user" : "New user"}
      description={
        editing
          ? "Changing roles re-resolves this user's grants on their next request."
          : "The user signs in with this email and password. Roles decide what they can reach."
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Full name")} required>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Amina Ndoumbe"
            />
          </Field>
          <Field label={tr("Email")} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="amina@tenant.cm"
            />
          </Field>
          <Field
            label="Username"
            hint="Optional — email is the sign-in identifier."
          >
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="andoumbe"
            />
          </Field>
          <Field label={tr("Status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">{tr("Active")}</option>
              <option value="SUSPENDED">{tr("Suspended")}</option>
              <option value="LOCKED">{tr("Locked")}</option>
            </Select>
          </Field>
          <Field
            label={tr("Employee")}
            hint="Link this login to a staff record — picks up their name."
            className="sm:col-span-2"
          >
            <Select
              value={employeeId}
              onChange={(e) => {
                const id = e.target.value;
                setEmployeeId(id);
                const emp = (employees.rows || []).find(
                  (x) => x.employee_id === id,
                );
                if (emp && !fullName.trim()) setFullName(emp.full_name || "");
              }}
            >
              <option value="">{tr("— No linked employee —")}</option>
              {(employees.rows || []).map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.full_name || emp.employee_id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </Field>
          {!editing && (
            <div className="space-y-3 sm:col-span-2">
              <Checkbox
                checked={invite}
                onCheckedChange={setInvite}
                label={tr("Email them an invitation to set their own password")}
                hint={tr(
                  "A single-use activation link, valid for 72 hours. Nobody but them ever knows the password.",
                )}
              />
              {!invite && (
                <Field
                  label={tr("Password")}
                  required
                  hint="Minimum 8 characters. The user should change it after first sign-in."
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
              )}
            </div>
          )}
        </div>

        <Field
          label={tr("Roles")}
          hint={
            hydrating
              ? "Loading current roles…"
              : "Access is the union of every assigned role's grants."
          }
        >
          <div className="flex flex-wrap gap-1.5 rounded-lg border p-2">
            {roles.length === 0 && (
              <span className="micro">
                No roles defined yet — create one on the Roles tab.
              </span>
            )}
            {roles.map((r) => {
              const on = roleIds.includes(r.role_id);
              return (
                <button
                  key={r.role_id}
                  type="button"
                  onClick={() => toggleRole(r.role_id)}
                  className={`chip ${on ? "on" : ""}`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label={tr("Capabilities")}
          hint="Authority overlay (segregation of duties) — required on high-authority actions like disbursing cash, on top of the role grant. CEO always has all."
        >
          <div className="flex flex-wrap gap-1.5 rounded-lg border p-2">
            {(allCaps.rows || []).length === 0 && (
              <span className="micro">
                No capabilities defined — normally the four standard ones are
                seeded.
              </span>
            )}
            {(allCaps.rows || []).map((c) => {
              const on = capIds.includes(c.capability_id);
              return (
                <button
                  key={c.capability_id}
                  type="button"
                  onClick={() => toggleCap(c.capability_id)}
                  className={`chip ${on ? "on" : ""}`}
                >
                  {c.code}
                </button>
              );
            })}
          </div>
        </Field>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={
              busy || !email || !fullName || (!editing && password.length < 8)
            }
          >
            {editing ? "Save changes" : "Create user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordForm({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant(`/users/${user.user_id}/password`, {
        method: "POST",
        body: { new_password: pw },
      });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Set password"
      description={`Replaces the password for ${user.email}. Their existing sessions stay valid — revoke them separately if this is a compromise.`}
    >
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">
            Password updated.
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>{tr("Close")}</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label="New password" required hint="Minimum 8 characters.">
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={pw.length < 8 || busy}
            >
              Set password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function UsersPage() {
  const { rows, error, loading, reload } = useList<User>("/users");
  const rolesQ = useList<Role>("/roles");
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<string>("ALL");
  const [form, setForm] = React.useState<{
    user: User | null;
    seed?: ProvisionSeed | null;
  } | null>(null);
  const [pwTarget, setPwTarget] = React.useState<User | null>(null);
  const [inviting, setInviting] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  /*
   * ── THE DEEP LINK FROM AN EMPLOYEE RECORD ────────────────────────────────
   *
   * "Provision account" on somebody's HR dossier arrives here as
   * `/security/users?provision=<employee_id>`, and this resolves it: it asks
   * the employees API who that is and opens the New-user dialog with their name,
   * email and employee link already filled in.
   *
   * Only the ID travels in the URL. Carrying the name and address as query
   * parameters would mean the form trusts whatever the link says a person is
   * called — the record is the source, and reading it here is one request.
   *
   * The parameter is then cleared with `replace`, so Back returns to the
   * employee rather than re-opening this dialog, and a refresh does not
   * resurrect a form the operator has already dealt with.
   */
  const [params, setParams] = useSearchParams();
  const provisionFor = params.get("provision");
  React.useEffect(() => {
    if (!provisionFor) return;
    let live = true;
    tenant<{
      provisioned: boolean;
      accounts: { user_id: string }[];
      suggested: ProvisionSeed | null;
    }>(`/employees/${provisionFor}/account`)
      .then((acc) => {
        if (!live) return;
        if (acc.suggested) setForm({ user: null, seed: acc.suggested });
        else
          setNotice(
            "That employee already has a login — it is in the list below.",
          );
      })
      .catch((err) => {
        if (live) setNotice(errMsg(err));
      })
      .finally(() => {
        if (!live) return;
        setParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.delete("provision");
            return p;
          },
          { replace: true },
        );
      });
    return () => {
      live = false;
    };
  }, [provisionFor, setParams]);

  /** Re-send an activation link — the first one expired, or it bounced. */
  async function resendInvite(u: User) {
    setInviting(u.user_id);
    setNotice(null);
    try {
      await tenant(`/users/${u.user_id}/invite`, { method: "POST", body: {} });
      setNotice(`Invitation sent to ${u.email}.`);
    } catch (err) {
      setNotice(errMsg(err));
    } finally {
      setInviting(null);
    }
  }

  const all = React.useMemo(() => rows || [], [rows]);
  const list = all.filter((u) => {
    if (filter !== "ALL" && String(u.status || "").toUpperCase() !== filter)
      return false;
    const hay = `${u.full_name} ${u.email} ${u.username || ""}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  const columns: Column<User>[] = [
    {
      key: "full_name",
      label: "Name",
      render: (r) => (
        <span className="font-medium text-foreground">{r.full_name}</span>
      ),
    },
    {
      key: "email",
      label: "Email",
      render: (r) => (
        <span className="num text-muted-foreground">{r.email}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={statusTone(r.status)}>{r.status || "—"}</Pill>,
    },
    {
      key: "is_2fa_enabled",
      label: "2FA",
      render: (r) =>
        r.is_2fa_enabled ? (
          <Pill tone="ok">On</Pill>
        ) : (
          <Pill tone="mute">{tr("Off")}</Pill>
        ),
    },
    {
      key: "last_login_at",
      label: "Last sign-in",
      render: (r) => dateFmt(r.last_login_at),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          {/* Safer than handing out a password: they set their own, and the
              administrator never sees it. Shown for everybody, because an
              expired invitation and a forgotten password are the same errand. */}
          <Button
            size="sm"
            variant="outline"
            loading={inviting === r.user_id}
            disabled={Boolean(inviting)}
            onClick={() => resendInvite(r)}
          >
            Invite
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPwTarget(r)}>
            Password
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ user: r })}
          >
            Edit
          </Button>
        </RowActions>
      ),
    },
  ];

  const active = all.filter(
    (u) => String(u.status || "").toUpperCase() === "ACTIVE",
  ).length;
  const twofa = all.filter((u) => u.is_2fa_enabled).length;

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title={tr("Users")}
        description="Tenant user accounts. Roles decide reach; status decides whether they can sign in at all."
        action={
          <Button onClick={() => setForm({ user: null })}>New user</Button>
        }
      />
      <HubTabs />
      {notice && (
        <Callout
          tone="info"
          action={
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Callout>
      )}
      <KpiRow>
        <KpiTile label={tr("Users")} value={num(all.length)} />
        <KpiTile label={tr("Active")} value={num(active)} />
        <KpiTile label="Suspended / locked" value={num(all.length - active)} />
        <KpiTile
          label="2FA enrolled"
          value={
            all.length ? `${Math.round((twofa / all.length) * 100)}%` : "—"
          }
          hint={`${twofa} of ${all.length}`}
        />
      </KpiRow>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {["ALL", "ACTIVE", "SUSPENDED", "LOCKED"].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={
                filter === k
                  ? "rounded-full border border-transparent bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
                  : "rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {k === "ALL" ? "All" : k.charAt(0) + k.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="w-full max-w-xs"
        />
      </div>
      <DataList
        columns={columns}
        rows={loading ? null : list}
        error={error}
        loading={loading}
        rowKey={(r) => r.user_id}
        onRowClick={(r) => setForm({ user: r })}
        empty={{
          title: "No users",
          hint: "Create the first user, or widen the filter.",
        }}
      />
      {form && (
        <UserForm
          user={form.user}
          seed={form.seed}
          roles={rolesQ.rows || []}
          onClose={() => setForm(null)}
          onSaved={reload}
        />
      )}
      {pwTarget && (
        <PasswordForm user={pwTarget} onClose={() => setPwTarget(null)} />
      )}
    </section>
  );
}

/* ═══════════════════════════════ Roles ═══════════════════════════════════ */
