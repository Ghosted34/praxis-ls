import { useState } from "react";
import { platform, can, session } from "@/lib/api";
import type { PlatformRole, PlatformUser } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, ConfirmModal, Empty, Field, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function Users() {
  const { data, loading, error, reload } = useAsync<PlatformUser[]>(() => platform.users() as Promise<PlatformUser[]>);
  const roles = useAsync<PlatformRole[]>(() => platform.roles() as Promise<PlatformRole[]>, []);
  const { toast, fail } = useToast();
  const [form, setForm] = useState<PlatformUser | "new" | null>(null);
  const [pwd, setPwd] = useState<PlatformUser | null>(null);
  const [del, setDel] = useState<PlatformUser | null>(null);
  const writable = can("users.write");
  const rows = data || [];
  const roleCodes = (roles.data || []).map((r) => r.code);

  return (
    <>
      <PageHeader
        title="Platform users"
        desc="Operators with access to this console. Roles come from the permission matrix."
        actions={writable ? <Button variant="primary" onClick={() => setForm("new")}>+ New user</Button> : undefined}
      />
      {loading ? <Loading /> : error ? <Empty>Couldn’t load users — {error.message}</Empty> : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.platform_user_id}>
                  <td style={{ fontWeight: 600 }}>{u.full_name}{u.platform_user_id === session.user?.platform_user_id && <span className="muted" style={{ fontWeight: 400 }}> · you</span>}</td>
                  <td className="mono dim">{u.email}</td>
                  <td><Pill tone="mute">{u.role}</Pill></td>
                  <td>{u.is_active === false ? <Pill tone="bad">Inactive</Pill> : <Pill tone="ok">Active</Pill>}</td>
                  <td className="dim">{u.last_login_at ? fmtDateTime(u.last_login_at) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {writable && <Button size="sm" onClick={() => setForm(u)}>Edit</Button>}
                    {writable && <Button size="sm" variant="ghost" style={{ marginLeft: 6 }} onClick={() => setPwd(u)}>Password</Button>}
                    {writable && u.platform_user_id !== session.user?.platform_user_id && <Button size="sm" variant="danger" style={{ marginLeft: 6 }} onClick={() => setDel(u)}>Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <UserForm user={form === "new" ? null : form} roleCodes={roleCodes} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {pwd && <PasswordForm user={pwd} onClose={() => setPwd(null)} onSaved={() => setPwd(null)} />}
      {del && (
        <ConfirmModal
          title={`Delete '${del.email}'?`}
          danger
          confirmLabel="Delete"
          body={<>Removes this operator’s console access.</>}
          onClose={() => setDel(null)}
          onConfirm={() => platform.deleteUser(del.platform_user_id).then(() => { toast("User deleted"); setDel(null); reload(); }).catch(fail)}
        />
      )}
    </>
  );
}

function UserForm({ user, roleCodes, onClose, onSaved }: { user: PlatformUser | null; roleCodes: string[]; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const editing = !!user;
  const [email, setEmail] = useState(user?.email || "");
  const [name, setName] = useState(user?.full_name || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role || roleCodes[0] || "PLATFORM_SUPPORT");
  const [active, setActive] = useState(user?.is_active !== false);
  const [busy, setBusy] = useState(false);
  const roleOptions = roleCodes.length ? roleCodes : [role];

  async function submit() {
    setBusy(true);
    try {
      if (editing) {
        await platform.updateUser(user!.platform_user_id, { full_name: name.trim(), role, is_active: active });
        toast("User updated");
      } else {
        await platform.createUser({ email: email.trim(), full_name: name.trim() || undefined, password, role });
        toast("User created");
      }
      onSaved();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <Modal
      title={editing ? `Edit ${user!.email}` : "New platform user"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={editing ? !name : (!email || password.length < 8)}>{editing ? "Save" : "Create"}</Button></>}
    >
      <div className="stack" style={{ gap: 13 }}>
        {!editing && <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!editing && <Field label="Password" hint="at least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        {editing && (
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        )}
      </div>
    </Modal>
  );
}

function PasswordForm({ user, onClose, onSaved }: { user: PlatformUser; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    setBusy(true);
    platform.setUserPassword(user.platform_user_id, password).then(() => { toast("Password updated"); onSaved(); }).catch((e) => { fail(e); setBusy(false); });
  };
  return (
    <Modal
      title={`Set password · ${user.email}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={password.length < 8}>Set password</Button></>}
    >
      <Field label="New password" hint="at least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
    </Modal>
  );
}
