/**
 * Security & Access admin screens — the IAM surface (MOD-67), fully wired.
 *
 * Replaces the previous read-only ResourceList stubs. Every screen here is now a
 * real round-trip against the RBAC-as-data model (migration 0110_rbac.sql):
 * access = Role × Capability × Scope × CRUD-per-module × field visibility.
 *
 *   UsersPage           → /users            (create, edit, roles, status, password)
 *   RolesPage           → /roles            (CRUD; system roles are read-only)
 *   CapabilitiesPage    → /capabilities     (CRUD; code is a fixed 4-value enum)
 *   ScopesPage          → /scopes           (CRUD; entity + parent tree)
 *   FieldVisibilityPage → /field-visibility (CRUD; needs the `approve` action)
 *   SessionsPage        → /sessions         (mine + revoke-all; admin list + kill)
 *
 * The permission matrix lives in its own screen (permission-matrix-page.tsx) and
 * self-service 2FA/PIN in my-security.tsx — both unchanged.
 *
 * NB identity is pinned to the LIVE schema server-side (req.identityDb), so these
 * screens read the same rows under both the LIVE and TEST toggle. That's intended.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";

const shell = "mx-auto max-w-6xl animate-fade-in";

/* ────────────────────────────── shared types ───────────────────────────── */

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

type Capability = { capability_id: string; code: string; name: string };
type Scope = { scope_id: string; entity_id?: string | null; code: string; name: string; parent_scope_id?: string | null };
type FieldVis = { field_visibility_id: string; role_id?: string | null; field_key: string; visibility: string };
type Session = {
  session_id: string;
  user_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
  revoked_at?: string | null;
};
type Entity = { entity_id: string; code?: string | null; legal_name?: string | null };

const statusTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "ACTIVE") return "ok";
  if (u === "SUSPENDED") return "warn";
  if (u === "LOCKED") return "bad";
  return "mute";
};

/** Small local segmented control (sales/ui.tsx's is scoped to that feature). */
function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={
            value === o.key
              ? "whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
              : "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Right-aligned row-action cell that doesn't trigger the row's onClick. */
function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** Confirm-then-delete modal shared by the four registry screens. */
function ConfirmDelete({
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

function UserForm({ user, roles, onClose, onSaved }: { user: User | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!user;
  const [email, setEmail] = React.useState(user?.email || "");
  const [fullName, setFullName] = React.useState(user?.full_name || "");
  const [username, setUsername] = React.useState(user?.username || "");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState(user?.status || "ACTIVE");
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrating, setHydrating] = React.useState(editing);

  // The list endpoint omits role_ids; the detail endpoint carries them.
  React.useEffect(() => {
    if (!user) return;
    let live = true;
    tenant<User>(`/users/${user.user_id}`)
      .then((u) => { if (live) setRoleIds(u.role_ids || []); })
      .catch(() => { /* leave roles untouched if the read is denied */ })
      .finally(() => { if (live) setHydrating(false); });
    return () => { live = false; };
  }, [user]);

  const toggleRole = (id: string) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && user) {
        await tenant(`/users/${user.user_id}`, {
          method: "PATCH",
          body: { full_name: fullName, email, username: username || null, role_ids: roleIds },
        });
        // Status is a separate endpoint (audited transition, not a field patch).
        if (status !== user.status) {
          await tenant(`/users/${user.user_id}/status`, { method: "POST", body: { status } });
        }
      } else {
        await tenant("/users", {
          method: "POST",
          body: { email, full_name: fullName, password, username: username || null, status, role_ids: roleIds },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={editing ? "Edit user" : "New user"} description={editing ? "Changing roles re-resolves this user's grants on their next request." : "The user signs in with this email and password. Roles decide what they can reach."}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Amina Ndoumbe" autoFocus />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="amina@tenant.cm" />
          </Field>
          <Field label="Username" hint="Optional — email is the sign-in identifier.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="andoumbe" />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="LOCKED">Locked</option>
            </Select>
          </Field>
          {!editing && (
            <Field label="Password" required hint="Minimum 8 characters. The user should change it after first sign-in." className="sm:col-span-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
          )}
        </div>

        <Field label="Roles" hint={hydrating ? "Loading current roles…" : "Access is the union of every assigned role's grants."}>
          <div className="flex flex-wrap gap-1.5 rounded-lg border p-2">
            {roles.length === 0 && <span className="micro">No roles defined yet — create one on the Roles tab.</span>}
            {roles.map((r) => {
              const on = roleIds.includes(r.role_id);
              return (
                <button
                  key={r.role_id}
                  type="button"
                  onClick={() => toggleRole(r.role_id)}
                  className={
                    on
                      ? "rounded-full border border-transparent bg-primary px-3 py-1 text-[13px] font-semibold text-primary-foreground"
                      : "rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  }
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </Field>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !email || !fullName || (!editing && password.length < 8)}>
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
      await tenant(`/users/${user.user_id}/password`, { method: "POST", body: { new_password: pw } });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Set password" description={`Replaces the password for ${user.email}. Their existing sessions stay valid — revoke them separately if this is a compromise.`}>
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">Password updated.</div>
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label="New password" required hint="Minimum 8 characters.">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="••••••••" />
          </Field>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={pw.length < 8 || busy}>Set password</Button>
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
  const [form, setForm] = React.useState<{ user: User | null } | null>(null);
  const [pwTarget, setPwTarget] = React.useState<User | null>(null);

  const all = rows || [];
  const list = all.filter((u) => {
    if (filter !== "ALL" && String(u.status || "").toUpperCase() !== filter) return false;
    const hay = `${u.full_name} ${u.email} ${u.username || ""}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  const columns: Column<User>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.full_name}</span> },
    { key: "email", label: "Email", render: (r) => <span className="num text-muted-foreground">{r.email}</span> },
    { key: "status", label: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{r.status || "—"}</Pill> },
    { key: "is_2fa_enabled", label: "2FA", render: (r) => (r.is_2fa_enabled ? <Pill tone="ok">On</Pill> : <Pill tone="mute">Off</Pill>) },
    { key: "last_login_at", label: "Last sign-in", render: (r) => dateFmt(r.last_login_at) },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Actions>
          <Button size="sm" variant="outline" onClick={() => setPwTarget(r)}>Password</Button>
          <Button size="sm" variant="outline" onClick={() => setForm({ user: r })}>Edit</Button>
        </Actions>
      ),
    },
  ];

  const active = all.filter((u) => String(u.status || "").toUpperCase() === "ACTIVE").length;
  const twofa = all.filter((u) => u.is_2fa_enabled).length;

  return (
    <section className={shell}>
      <PageHeader
        title="Users"
        description="Tenant user accounts. Roles decide reach; status decides whether they can sign in at all."
        action={<Button onClick={() => setForm({ user: null })}>New user</Button>}
      />
      <KpiRow>
        <KpiTile label="Users" value={num(all.length)} />
        <KpiTile label="Active" value={num(active)} />
        <KpiTile label="Suspended / locked" value={num(all.length - active)} />
        <KpiTile label="2FA enrolled" value={all.length ? `${Math.round((twofa / all.length) * 100)}%` : "—"} hint={`${twofa} of ${all.length}`} />
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="w-full max-w-xs" />
      </div>
      <DataList
        columns={columns}
        rows={loading ? null : list}
        error={error}
        loading={loading}
        rowKey={(r) => r.user_id}
        onRowClick={(r) => setForm({ user: r })}
        empty={{ title: "No users", hint: "Create the first user, or widen the filter." }}
      />
      {form && <UserForm user={form.user} roles={rolesQ.rows || []} onClose={() => setForm(null)} onSaved={reload} />}
      {pwTarget && <PasswordForm user={pwTarget} onClose={() => setPwTarget(null)} />}
    </section>
  );
}

/* ═══════════════════════════════ Roles ═══════════════════════════════════ */

function RoleForm({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!role;
  const [code, setCode] = React.useState(role?.code || "");
  const [name, setName] = React.useState(role?.name || "");
  const [description, setDescription] = React.useState(role?.description || "");
  const [isLineManager, setIsLineManager] = React.useState(!!role?.is_line_manager);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { code, name, description: description || null, is_line_manager: isLineManager };
    try {
      if (editing && role) await tenant(`/roles/${role.role_id}`, { method: "PATCH", body });
      else await tenant("/roles", { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit role" : "New role"} description="A role is a job area. Grants are attached to it on the Permission matrix tab.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Code" required hint="Short uppercase key, unique per tenant — e.g. FINANCE, CUSTOMS_DESK.">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={editing} placeholder="FINANCE" autoFocus />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Finance & treasury" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is responsible for" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isLineManager} onChange={(e) => setIsLineManager(e.target.checked)} className="h-4 w-4 rounded border-input" />
          <span>Line manager — layers approval authority over this role</span>
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !code || !name}>{editing ? "Save changes" : "Create role"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function RolesPage() {
  const { rows, error, loading, reload } = useList<Role>("/roles");
  const [form, setForm] = React.useState<{ role: Role | null } | null>(null);
  const [del, setDel] = React.useState<Role | null>(null);
  const all = rows || [];

  const columns: Column<Role>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-[rgb(var(--primary))]">{r.code}</span> },
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "description", label: "Description", render: (r) => <span className="text-muted-foreground">{r.description || "—"}</span> },
    { key: "is_line_manager", label: "Authority", render: (r) => (r.is_line_manager ? <Pill tone="blue">Line manager</Pill> : "—") },
    { key: "is_system", label: "Origin", render: (r) => (r.is_system ? <Pill tone="mute">System</Pill> : <Pill tone="ok">Tenant</Pill>) },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Actions>
          <Button size="sm" variant="outline" onClick={() => setForm({ role: r })}>Edit</Button>
          <Button size="sm" variant="outline" disabled={!!r.is_system} onClick={() => setDel(r)}>Delete</Button>
        </Actions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Roles"
        description="Job areas, stored as rows rather than code. Seeded system roles can't be deleted."
        action={<Button onClick={() => setForm({ role: null })}>New role</Button>}
      />
      <KpiRow>
        <KpiTile label="Roles" value={num(all.length)} />
        <KpiTile label="Tenant-defined" value={num(all.filter((r) => !r.is_system).length)} />
        <KpiTile label="Line-manager roles" value={num(all.filter((r) => r.is_line_manager).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.role_id} onRowClick={(r) => setForm({ role: r })} empty={{ title: "No roles", hint: "Seeded defaults should appear here; add tenant-specific ones as needed." }} />
      {form && <RoleForm role={form.role} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete role" what={`${del.code} · ${del.name}`} path={`/roles/${del.role_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ════════════════════════════ Capabilities ═══════════════════════════════ */

const CAPABILITY_CODES = ["ISSUER", "VALIDATOR", "APPROVER", "LINE_MANAGER"] as const;

function CapabilityForm({ cap, onClose, onSaved }: { cap: Capability | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!cap;
  const [code, setCode] = React.useState(cap?.code || "ISSUER");
  const [name, setName] = React.useState(cap?.name || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && cap) await tenant(`/capabilities/${cap.capability_id}`, { method: "PATCH", body: { name } });
      else await tenant("/capabilities", { method: "POST", body: { code, name } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit capability" : "New capability"} description="The authority overlay that enforces segregation of duties on documents.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Code" required hint="Fixed set — the database rejects anything outside these four.">
          <Select value={code} onChange={(e) => setCode(e.target.value)} disabled={editing}>
            {CAPABILITY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Issues documents" autoFocus />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !name}>{editing ? "Save changes" : "Create capability"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CapabilitiesPage() {
  const { rows, error, loading, reload } = useList<Capability>("/capabilities");
  const [form, setForm] = React.useState<{ cap: Capability | null } | null>(null);
  const [del, setDel] = React.useState<Capability | null>(null);

  const columns: Column<Capability>[] = [
    { key: "code", label: "Code", render: (r) => <Pill tone="blue">{r.code}</Pill> },
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Actions>
          <Button size="sm" variant="outline" onClick={() => setForm({ cap: r })}>Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>Delete</Button>
        </Actions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Capabilities"
        description="ISSUER / VALIDATOR / APPROVER / LINE_MANAGER — who may act on a document, independent of which module they can see."
        action={<Button onClick={() => setForm({ cap: null })}>New capability</Button>}
      />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.capability_id} onRowClick={(r) => setForm({ cap: r })} empty={{ title: "No capabilities", hint: "The four standard capabilities are normally seeded." }} />
      {form && <CapabilityForm cap={form.cap} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete capability" what={`${del.code} · ${del.name}`} path={`/capabilities/${del.capability_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ═══════════════════════════════ Scopes ══════════════════════════════════ */

function ScopeForm({ scope, scopes, entities, onClose, onSaved }: { scope: Scope | null; scopes: Scope[]; entities: Entity[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!scope;
  const [entityId, setEntityId] = React.useState(scope?.entity_id || "");
  const [code, setCode] = React.useState(scope?.code || "");
  const [name, setName] = React.useState(scope?.name || "");
  const [parentId, setParentId] = React.useState(scope?.parent_scope_id || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      entity_id: entityId || null,
      code,
      name,
      parent_scope_id: parentId || null,
    };
    try {
      if (editing && scope) await tenant(`/scopes/${scope.scope_id}`, { method: "PATCH", body });
      else await tenant("/scopes", { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  // A scope can't be its own parent.
  const parentOptions = scopes.filter((s) => !scope || s.scope_id !== scope.scope_id);

  return (
    <Modal open onClose={onClose} title={editing ? "Edit scope" : "New scope"} description="Scopes confine a user to an entity, branch or department. They nest — that tree is the organigramme.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Corporate entity" hint="Leave blank for a tenant-wide scope.">
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">— none —</option>
            {entities.map((en) => (
              <option key={en.entity_id} value={en.entity_id}>{en.code ? `${en.code} · ${en.legal_name || ""}` : en.legal_name || en.entity_id}</option>
            ))}
          </Select>
        </Field>
        <Field label="Code" required hint="Unique within the entity — e.g. HQ, DLA_BRANCH, CUSTOMS_DESK.">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HQ" autoFocus />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Head office" />
        </Field>
        <Field label="Parent scope" hint="Optional — builds the organigramme tree.">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— top level —</option>
            {parentOptions.map((s) => <option key={s.scope_id} value={s.scope_id}>{s.code} · {s.name}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !code || !name}>{editing ? "Save changes" : "Create scope"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ScopesPage() {
  const { rows, error, loading, reload } = useList<Scope>("/scopes");
  const entitiesQ = useList<Entity>("/entities");
  const [form, setForm] = React.useState<{ scope: Scope | null } | null>(null);
  const [del, setDel] = React.useState<Scope | null>(null);

  const all = rows || [];
  const entityName = React.useMemo(() => {
    const m: Record<string, string> = {};
    (entitiesQ.rows || []).forEach((e) => { m[e.entity_id] = e.code || e.legal_name || e.entity_id; });
    return m;
  }, [entitiesQ.rows]);
  const scopeName = React.useMemo(() => {
    const m: Record<string, string> = {};
    all.forEach((s) => { m[s.scope_id] = s.code; });
    return m;
  }, [all]);

  const columns: Column<Scope>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-[rgb(var(--primary))]">{r.code}</span> },
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "entity_id", label: "Entity", render: (r) => (r.entity_id ? entityName[r.entity_id] || "—" : <span className="text-muted-foreground">Tenant-wide</span>) },
    { key: "parent_scope_id", label: "Parent", render: (r) => (r.parent_scope_id ? scopeName[r.parent_scope_id] || "—" : "—") },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Actions>
          <Button size="sm" variant="outline" onClick={() => setForm({ scope: r })}>Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>Delete</Button>
        </Actions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Scopes"
        description="The entity, branch or department a user is confined to. Deleting a scope cascades to its assignments."
        action={<Button onClick={() => setForm({ scope: null })}>New scope</Button>}
      />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.scope_id} onRowClick={(r) => setForm({ scope: r })} empty={{ title: "No scopes", hint: "Add HQ first, then branches beneath it." }} />
      {form && <ScopeForm scope={form.scope} scopes={all} entities={entitiesQ.rows || []} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete scope" what={`${del.code} · ${del.name}`} path={`/scopes/${del.scope_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ═════════════════════════ Field visibility ══════════════════════════════ */

const VISIBILITY = ["visible", "masked", "hidden"] as const;
const visTone = (v: string): Tone => (v === "visible" ? "ok" : v === "masked" ? "warn" : "bad");

/** Field keys the backend masks today — offered as suggestions, free text allowed. */
const KNOWN_FIELDS = ["dossier.margin", "employee.salary", "supplier.cost_rate", "invoice.cost_price", "quotation.margin"];

function FieldVisForm({ fv, roles, onClose, onSaved }: { fv: FieldVis | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!fv;
  const [roleId, setRoleId] = React.useState(fv?.role_id || "");
  const [fieldKey, setFieldKey] = React.useState(fv?.field_key || "");
  const [visibility, setVisibility] = React.useState(fv?.visibility || "masked");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { role_id: roleId || null, field_key: fieldKey, visibility };
    try {
      if (editing && fv) await tenant(`/field-visibility/${fv.field_visibility_id}`, { method: "PATCH", body });
      else await tenant("/field-visibility", { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit field rule" : "New field rule"} description="Masks a confidential field for one role. Enforced server-side on read, so it holds even under the TEST toggle.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Role" required>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— select a role —</option>
            {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.code} · {r.name}</option>)}
          </Select>
        </Field>
        <Field label="Field key" required hint="Dotted path, e.g. dossier.margin. Must match the key the backend masks on.">
          <Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} list="known-field-keys" placeholder="dossier.margin" autoFocus />
          <datalist id="known-field-keys">
            {KNOWN_FIELDS.map((f) => <option key={f} value={f} />)}
          </datalist>
        </Field>
        <Field label="Visibility" required hint="Masked shows a placeholder; hidden removes the key entirely.">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            {VISIBILITY.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !roleId || !fieldKey}>{editing ? "Save changes" : "Create rule"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function FieldVisibilityPage() {
  const { rows, error, loading, reload } = useList<FieldVis>("/field-visibility");
  const rolesQ = useList<Role>("/roles");
  const [form, setForm] = React.useState<{ fv: FieldVis | null } | null>(null);
  const [del, setDel] = React.useState<FieldVis | null>(null);

  const roleLabel = React.useMemo(() => {
    const m: Record<string, string> = {};
    (rolesQ.rows || []).forEach((r) => { m[r.role_id] = r.code; });
    return m;
  }, [rolesQ.rows]);

  const columns: Column<FieldVis>[] = [
    { key: "role_id", label: "Role", render: (r) => (r.role_id ? <Pill tone="mute">{roleLabel[r.role_id] || "—"}</Pill> : <span className="text-muted-foreground">All roles</span>) },
    { key: "field_key", label: "Field", render: (r) => <span className="num font-medium text-foreground">{r.field_key}</span> },
    { key: "visibility", label: "Visibility", render: (r) => <Pill tone={visTone(r.visibility)}>{r.visibility}</Pill> },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Actions>
          <Button size="sm" variant="outline" onClick={() => setForm({ fv: r })}>Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>Delete</Button>
        </Actions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Field visibility"
        description="Per-role masking of confidential fields — margins, salaries, cost rates. Editing these needs the approve action, not just edit."
        action={<Button onClick={() => setForm({ fv: null })}>New rule</Button>}
      />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.field_visibility_id} onRowClick={(r) => setForm({ fv: r })} empty={{ title: "No masking rules", hint: "Without a rule every field is visible to anyone who can read the record." }} />
      {form && <FieldVisForm fv={form.fv} roles={rolesQ.rows || []} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete field rule" what={`${del.field_key} · ${del.visibility}`} path={`/field-visibility/${del.field_visibility_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ══════════════════════════════ Sessions ═════════════════════════════════ */

export function SessionsPage() {
  const [tab, setTab] = React.useState<"mine" | "all">("mine");
  const mine = useList<Session>("/sessions/mine");
  const all = useList<Session>(tab === "all" ? "/sessions" : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function killAllMine() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/sessions/mine/revoke-all", { method: "POST" });
      mine.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function kill(id: string) {
    setError(null);
    try {
      await tenant(`/sessions/${id}/kill`, { method: "POST" });
      mine.reload();
      all.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const baseCols: Column<Session>[] = [
    { key: "created_at", label: "Started", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
    { key: "last_seen_at", label: "Last seen", render: (r) => <span className="num">{dateFmt(r.last_seen_at)}</span> },
    { key: "ip", label: "IP", render: (r) => <span className="num text-muted-foreground">{r.ip || "—"}</span> },
    { key: "user_agent", label: "Device", render: (r) => <span className="text-muted-foreground">{(r.user_agent || "—").slice(0, 48)}</span> },
    { key: "state", label: "State", render: (r) => (r.revoked_at ? <Pill tone="bad">Revoked</Pill> : <Pill tone="ok">Active</Pill>) },
  ];

  const withKill: Column<Session>[] = [
    ...baseCols,
    { key: "_a", label: "", render: (r) => <Actions><Button size="sm" variant="outline" disabled={!!r.revoked_at} onClick={() => kill(r.session_id)}>Revoke</Button></Actions> },
  ];

  const adminCols: Column<Session>[] = [
    { key: "user_id", label: "User", render: (r) => <span className="num text-muted-foreground">{r.user_id ? `…${r.user_id.slice(-8)}` : "—"}</span> },
    ...withKill,
  ];

  return (
    <section className={shell}>
      <PageHeader
        title="Sessions"
        description="Active sign-ins. Revoking a session invalidates its refresh token immediately — the next refresh is rejected as reuse."
        action={tab === "mine" ? <Button variant="outline" onClick={killAllMine} loading={busy}>Revoke all mine</Button> : undefined}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[{ key: "mine", label: "My sessions" }, { key: "all", label: "All sessions" }]}
      />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      {tab === "mine" ? (
        <DataList columns={withKill} rows={mine.rows} error={mine.error} loading={mine.loading} rowKey={(r) => r.session_id} empty={{ title: "No active sessions", hint: "You're signed in on this device only." }} />
      ) : (
        <DataList columns={adminCols} rows={all.rows} error={all.error} loading={all.loading} rowKey={(r) => r.session_id} empty={{ title: "No sessions", hint: "Listing every tenant session needs the session view grant." }} />
      )}
    </section>
  );
}
