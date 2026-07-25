import { useState } from "react";
import { platform, can } from "@/lib/api";
import type { PlatformRole } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { Button, ConfirmModal, Empty, Field, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";

const ROOT = "PLATFORM_ROOT_ADMIN";

export function Roles() {
  const roles = useAsync<PlatformRole[]>(() => platform.roles() as Promise<PlatformRole[]>);
  const caps = useAsync<string[]>(() => platform.capabilities() as Promise<string[]>);
  const { toast, fail } = useToast();
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<PlatformRole | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const writable = can("roles.write");

  const roleRows = roles.data || [];
  const capList = caps.data || [];

  const toggle = async (role: PlatformRole, cap: string, on: boolean) => {
    const next = on ? [...new Set([...role.capabilities, cap])] : role.capabilities.filter((c) => c !== cap);
    setBusyCell(role.role_id + cap);
    try {
      await platform.setRolePermissions(role.role_id, next);
      roles.reload();
    } catch (e) { fail(e); } finally { setBusyCell(null); }
  };

  if (roles.loading || caps.loading) return <Loading />;
  if (roles.error) return <Empty>Couldn’t load roles — {roles.error.message}</Empty>;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        desc="What each console role can do. Root Admin always has full access. Add custom roles as needed."
        actions={writable ? <Button variant="primary" onClick={() => setCreating(true)}>+ New role</Button> : undefined}
      />
      <div className="tbl-wrap" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0 }}>Role</th>
              {capList.map((c) => <th key={c} style={{ whiteSpace: "nowrap", fontSize: 11 }}>{c}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roleRows.map((r) => {
              const isRoot = r.code === ROOT;
              return (
                <tr key={r.role_id}>
                  <td style={{ position: "sticky", left: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="mono muted">{r.code}</div>
                    <div style={{ marginTop: 2 }}>
                      {r.is_system ? <Pill tone="info">System</Pill> : <Pill tone="mute">{r.user_count} user(s)</Pill>}
                    </div>
                  </td>
                  {capList.map((cap) => {
                    const on = isRoot || r.capabilities.includes(cap);
                    return (
                      <td key={cap} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={isRoot || !writable || busyCell === r.role_id + cap}
                          onChange={(e) => toggle(r, cap, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right" }}>
                    {writable && !r.is_system && <Button size="sm" variant="danger" onClick={() => setDel(r)}>Delete</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Toggling a cell saves immediately. Root Admin bypasses checks, so its row is locked on.</p>

      {creating && <RoleForm caps={capList} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); roles.reload(); }} />}
      {del && (
        <ConfirmModal
          title={`Delete role '${del.code}'?`}
          danger
          confirmLabel="Delete"
          body={del.user_count > 0 ? <>This role has {del.user_count} user(s) — reassign them first.</> : <>The role and its permissions will be removed.</>}
          onClose={() => setDel(null)}
          onConfirm={() => platform.deleteRole(del.role_id).then(() => { toast("Role deleted"); setDel(null); roles.reload(); }).catch(fail)}
        />
      )}
    </>
  );
}

function RoleForm({ caps, onClose, onSaved }: { caps: string[]; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const capabilities = caps.filter((c) => picked[c]);
      await platform.createRole({ code: code.trim(), name: name.trim(), capabilities });
      toast("Role created");
      onSaved();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <Modal
      title="New role"
      onClose={onClose}
      maxWidth={520}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={!code || !name}>Create</Button></>}
    >
      <div className="stack" style={{ gap: 13 }}>
        <Field label="Code" hint="e.g. SUPPORT_LEAD — uppercased automatically"><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div>
          <div className="f" style={{ marginBottom: 6 }}>Capabilities</div>
          <div className="stack" style={{ gap: 6, maxHeight: 260, overflow: "auto" }}>
            {caps.map((c) => (
              <label key={c} className="row" style={{ gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={!!picked[c]} onChange={(e) => setPicked((p) => ({ ...p, [c]: e.target.checked }))} />
                <span className="mono" style={{ fontSize: 12 }}>{c}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
