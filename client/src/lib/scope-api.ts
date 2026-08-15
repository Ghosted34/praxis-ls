/**
 * Scope API — the organigramme: the entity / branch / department tree
 * (`parent_scope_id`) plus the people assigned to each node (`user_scope`).
 *
 * Membership had no endpoints at all until 2026-08-02: the table was read by the
 * RBAC identity cache and written by nothing, so nobody could be placed in the
 * tree and approval steps bound to a scope were unactionable.
 */
import { tenant } from "./api-client";

// NB every endpoint here resolves against the identity (live) schema, because
// `scope` and `user_scope` are identity data — a person's place in the company
// must not change with the LIVE/TEST toggle.

export type Scope = {
  scope_id: string;
  code: string;
  name: string;
  entity_id?: string | null;
  parent_scope_id?: string | null;
};

/** A tree node as returned by GET /scopes/tree — flat, with a member count. */
export type ScopeNode = Scope & {
  entity_code?: string | null;
  member_count?: number | null;
};

export type ScopeMember = {
  user_id: string;
  full_name: string;
  email: string;
  status?: string | null;
};

export type ScopeEntity = {
  entity_id: string;
  code: string;
  legal_name: string;
};

export const listScopes = () => tenant<Scope[]>("/scopes");

/** Admin view — includes member counts, so it needs the IAM (MOD-67) grant. */
export const fetchScopeTree = () => tenant<ScopeNode[]>("/scopes/tree");

/**
 * Department picker — names only, readable by any signed-in user.
 *
 * Since 0490 a department IS a scope, so ordinary staff filling in a purchase
 * request or an employee record need this list. `fetchScopeTree` requires the
 * IAM permission (it exposes who sits where), which made a form field 403 for
 * everyone who isn't an administrator.
 */
export const fetchScopeOptions = () => tenant<ScopeNode[]>("/scopes/options");

/**
 * Entities for the scope form — deliberately NOT `/entities`.
 *
 * Scopes are stored in the identity (live) schema, so `scope.entity_id` is
 * checked against `live.corporate_entity`. `/entities` reads the env-selected
 * schema, so in TEST mode it lists sandbox rows whose UUIDs don't exist in live
 * and saving fails on the foreign key. This endpoint reads the same schema the
 * constraint does.
 */
export const fetchScopeEntities = () =>
  tenant<ScopeEntity[]>("/scopes/entities");

export const listScopeMembers = (scopeId: string) =>
  tenant<ScopeMember[]>(`/scopes/${scopeId}/members`);
export const addScopeMember = (scopeId: string, userId: string) =>
  tenant<{ assigned: boolean; already: boolean }>(
    `/scopes/${scopeId}/members`,
    {
      method: "POST",
      body: { user_id: userId },
    },
  );
export const removeScopeMember = (scopeId: string, userId: string) =>
  tenant<{ removed: boolean }>(`/scopes/${scopeId}/members/${userId}`, {
    method: "DELETE",
  });

/* ── tree shaping ─────────────────────────────────────────────────────────── */

export type ScopeTreeNode = ScopeNode & {
  children: ScopeTreeNode[];
  depth: number;
};

/**
 * Flat rows → a forest, ordered by name at every level.
 *
 * Defensive about two shapes the backend permits but the diagram cannot draw:
 * a node whose parent_scope_id points at a row that isn't in the list (orphan)
 * is promoted to a root so it stays visible rather than vanishing, and a cycle
 * is broken by refusing to visit a node twice. The write path now rejects cycles
 * (scope.service.assertNoCycle) but data created before that guard can still be
 * out there, and a diagram that silently drops nodes is worse than one that
 * shows an odd root.
 */
export function buildScopeTree(rows: ScopeNode[]): ScopeTreeNode[] {
  const byId = new Map<string, ScopeTreeNode>();
  for (const r of rows) byId.set(r.scope_id, { ...r, children: [], depth: 0 });

  const roots: ScopeTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_scope_id ? byId.get(node.parent_scope_id) : null;
    if (parent && parent.scope_id !== node.scope_id) parent.children.push(node);
    else roots.push(node);
  }

  const seen = new Set<string>();
  const depthOf = (nodes: ScopeTreeNode[], depth: number): ScopeTreeNode[] =>
    nodes
      .filter((n) => {
        if (seen.has(n.scope_id)) return false;
        seen.add(n.scope_id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => {
        n.depth = depth;
        n.children = depthOf(n.children, depth + 1);
        return n;
      });

  return depthOf(roots, 0);
}
