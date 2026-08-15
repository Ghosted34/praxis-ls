/**
 * Security — data scopes and their members.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7). A scope is
 * the tree that bounds WHAT a grant applies to, as distinct from a role, which
 * bounds what a user may DO — which is why they are separate screens.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Organigramme } from "@/components/organigramme";
import { RowActions } from "@/components/ui/row-actions";
import {
  fetchScopeTree,
  buildScopeTree,
  fetchScopeEntities,
  listScopeMembers,
  addScopeMember,
  removeScopeMember,
} from "@/lib/scope-api";
import { type Scope, ConfirmDelete, shell } from "./shared";

function ScopeForm({
  scope,
  scopes,
  onClose,
  onSaved,
}: {
  scope: Scope | null;
  scopes: Scope[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!scope;
  // Entities from the IDENTITY schema, not /entities. scope.entity_id is checked
  // against live.corporate_entity, so listing the env-selected schema here meant
  // that in TEST mode every choice failed the foreign key.
  const entitiesQ = useResource(() => fetchScopeEntities(), []);
  const entities = entitiesQ.data || [];
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
      if (editing && scope)
        await tenant(`/scopes/${scope.scope_id}`, { method: "PATCH", body });
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
  const parentOptions = scopes.filter(
    (s) => !scope || s.scope_id !== scope.scope_id,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit scope" : "New scope"}
      description="Scopes confine a user to an entity, branch or department. They nest — that tree is the organigramme."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label="Corporate entity"
          hint="Leave blank for a tenant-wide scope."
        >
          <Select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            <option value="">— none —</option>
            {entities.map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.code
                  ? `${en.code} · ${en.legal_name || ""}`
                  : en.legal_name || en.entity_id}
              </option>
            ))}
          </Select>
          {/* An empty list here is not the same as "no entities exist". Scopes are
              stored in the live schema, so this reads live.corporate_entity — an
              entity created only in TEST shows on the Entities screen and not
              here, which looks like a bug and isn't. Say so, rather than leaving
              a silently empty dropdown. */}
          {entitiesQ.error ? (
            <p className="micro mt-1 text-[rgb(var(--bad))]">
              Couldn&rsquo;t load entities: {entitiesQ.error}
            </p>
          ) : !entitiesQ.loading && !entities.length ? (
            <p className="micro mt-1">
              No entities exist in the live schema. Scopes are stored there, so
              only live entities can be selected — create the entity in LIVE
              mode, or leave this blank for a tenant-wide scope.
            </p>
          ) : null}
        </Field>
        <Field
          label="Code"
          required
          hint="Unique within the entity — e.g. HQ, DLA_BRANCH, CUSTOMS_DESK."
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="HQ"
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Head office"
          />
        </Field>
        <Field
          label="Parent scope"
          hint="Optional — builds the organigramme tree."
        >
          <Select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— top level —</option>
            {parentOptions.map((s) => (
              <option key={s.scope_id} value={s.scope_id}>
                {s.code} · {s.name}
              </option>
            ))}
          </Select>
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
            disabled={busy || !code || !name}
          >
            {editing ? "Save changes" : "Create scope"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Members of one scope node, with add/remove.
 *
 * `user_scope` had no write path at all before 2026-08-02 (audit finding A1):
 * the RBAC cache read it, nothing populated it, so no user was ever in a scope
 * and any approval step routed to a branch was unactionable. This is the
 * assignment surface that closes that.
 */
function ScopeMembers({ scopeId }: { scopeId: string }) {
  const members = useResource(() => listScopeMembers(scopeId), [scopeId]);
  const usersQ = useList<{ user_id: string; full_name: string; email: string }>(
    "/users",
  );
  const [adding, setAdding] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const assigned = members.data || [];
  const assignedIds = new Set(assigned.map((m) => m.user_id));
  const candidates = (usersQ.rows || []).filter(
    (u) => !assignedIds.has(u.user_id),
  );

  async function add() {
    if (!adding) return;
    setBusy("add");
    setError(null);
    try {
      await addScopeMember(scopeId, adding);
      setAdding("");
      members.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function remove(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      await removeScopeMember(scopeId, userId);
      members.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 pb-2">
      {members.loading ? (
        <p className="micro">Loading people…</p>
      ) : assigned.length ? (
        <ul className="space-y-1">
          {assigned.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between gap-2 rounded-md bg-accent/40 px-2 py-1"
            >
              <span className="min-w-0 truncate text-sm">
                {m.full_name} <span className="micro">· {m.email}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === m.user_id}
                onClick={() => remove(m.user_id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="micro">
          Nobody assigned — approvals routed here have no one to action them.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Select
          aria-label="Add a user to this scope"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          className="max-w-xs"
        >
          <option value="">Add someone…</option>
          {candidates.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!adding || busy === "add"}
          loading={busy === "add"}
          onClick={add}
        >
          Assign
        </Button>
      </div>
      {error && <ErrorState message={error} />}
    </div>
  );
}

export function ScopesPage() {
  const { rows, error, loading, reload } = useList<Scope>("/scopes");
  // Identity-schema entities, same source the form and the FK use — under TEST,
  // /entities would resolve these ids to nothing and the column would read "—".
  const entitiesQ = useResource(() => fetchScopeEntities(), []);
  const treeQ = useResource(() => fetchScopeTree(), []);
  const [form, setForm] = React.useState<{ scope: Scope | null } | null>(null);
  const [del, setDel] = React.useState<Scope | null>(null);
  const [view, setView] = React.useState<"chart" | "list">("chart");

  const all = React.useMemo(() => rows || [], [rows]);
  const tree = React.useMemo(
    () => buildScopeTree(treeQ.data || []),
    [treeQ.data],
  );
  const reloadAll = React.useCallback(() => {
    reload();
    treeQ.reload();
  }, [reload, treeQ]);
  const entityName = React.useMemo(() => {
    const m: Record<string, string> = {};
    (entitiesQ.data || []).forEach((e) => {
      m[e.entity_id] = e.code || e.legal_name || e.entity_id;
    });
    return m;
  }, [entitiesQ.data]);
  const scopeName = React.useMemo(() => {
    const m: Record<string, string> = {};
    all.forEach((s) => {
      m[s.scope_id] = s.code;
    });
    return m;
  }, [all]);

  const columns: Column<Scope>[] = [
    {
      key: "code",
      label: "Code",
      render: (r) => (
        <span className="num font-medium text-primary-ink">{r.code}</span>
      ),
    },
    {
      key: "name",
      label: "Name",
      render: (r) => (
        <span className="font-medium text-foreground">{r.name}</span>
      ),
    },
    {
      key: "entity_id",
      label: "Entity",
      render: (r) =>
        r.entity_id ? (
          entityName[r.entity_id] || "—"
        ) : (
          <span className="text-muted-foreground">Tenant-wide</span>
        ),
    },
    {
      key: "parent_scope_id",
      label: "Parent",
      render: (r) =>
        r.parent_scope_id ? scopeName[r.parent_scope_id] || "—" : "—",
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ scope: r })}
          >
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>
            Delete
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="Scopes"
        description="The entity, branch or department a user belongs to. They nest — that tree is the organigramme, and approval steps route through it. Deleting a scope cascades to its assignments."
        action={
          <Button onClick={() => setForm({ scope: null })}>New scope</Button>
        }
      />
      <HubTabs />

      <div className="flex items-center gap-2">
        {(["chart", "list"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              view === v
                ? "bg-accent font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "chart" ? "Organigramme" : "List"}
          </button>
        ))}
      </div>

      {view === "chart" ? (
        <div className="lux-card p-4">
          {treeQ.loading ? (
            <p className="micro">Loading the organigramme…</p>
          ) : treeQ.error ? (
            <ErrorState message={treeQ.error} />
          ) : (
            <Organigramme
              nodes={tree}
              onSelect={(n) =>
                setForm({
                  scope: all.find((s) => s.scope_id === n.scope_id) || null,
                })
              }
              renderNodeExtra={(n) => <ScopeMembers scopeId={n.scope_id} />}
            />
          )}
        </div>
      ) : (
        <DataList
          columns={columns}
          rows={rows}
          error={error}
          loading={loading}
          rowKey={(r) => r.scope_id}
          onRowClick={(r) => setForm({ scope: r })}
          empty={{
            title: "No scopes",
            hint: "Add HQ first, then branches beneath it.",
          }}
        />
      )}

      {form && (
        <ScopeForm
          scope={form.scope}
          scopes={all}
          onClose={() => setForm(null)}
          onSaved={reloadAll}
        />
      )}
      {del && (
        <ConfirmDelete
          title="Delete scope"
          what={`${del.code} · ${del.name}`}
          path={`/scopes/${del.scope_id}`}
          onClose={() => setDel(null)}
          onDone={reloadAll}
        />
      )}
    </section>
  );
}

/* ═════════════════════════ Field visibility ══════════════════════════════ */
