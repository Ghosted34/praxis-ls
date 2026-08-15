/**
 * Organigramme — the company hierarchy as the ERP actually models it: the
 * `scope` tree (entity → branch → department) joined by `parent_scope_id`.
 *
 * This is the structure approvals route through. A workflow step names a scope,
 * and an approver qualifies if they sit at that node or above it, so being able
 * to SEE the tree is what makes a chain reviewable — "Finance approves for
 * Douala" means nothing until you can check where Douala sits and who is in it.
 *
 * Scope note: this draws ORG UNITS, not people. `employee` has no reports_to and
 * there is no position table, so a true who-reports-to-whom chart has no data
 * model yet (audit finding B1). Each node carries its assigned users and the
 * component renders them on expand, so when a reporting line does land this can
 * grow into it rather than be replaced — which is why `renderNodeExtra` exists.
 *
 * Deliberately plain CSS/flex rather than a graph library: the tree is small
 * (tens of nodes), it must theme with the app's tokens, and adding a rendering
 * dependency for an indented list would be the wrong trade.
 */
import * as React from "react";
import { Pill } from "@/components/ui/pill";
import { type ScopeTreeNode } from "@/lib/scope-api";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type OrganigrammeProps = {
  nodes: ScopeTreeNode[];
  /** Highlighted node — e.g. the scope a workflow step routes to. */
  selectedId?: string | null;
  onSelect?: (node: ScopeTreeNode) => void;
  /** Extra content under a node when expanded (members, actions). */
  renderNodeExtra?: (node: ScopeTreeNode) => React.ReactNode;
  /** Start with every node open. Off for large trees. */
  defaultExpanded?: boolean;
};

function Node({
  node,
  selectedId,
  onSelect,
  renderNodeExtra,
  defaultExpanded,
}: { node: ScopeTreeNode } & Omit<OrganigrammeProps, "nodes">) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = React.useState(defaultExpanded ?? node.depth < 1);
  const selected = selectedId === node.scope_id;
  const extra = renderNodeExtra ? renderNodeExtra(node) : null;

  return (
    <li className="relative">
      {/* The connector: a vertical rule down the left of every child list, and a
          stub out to each node. Drawn with borders rather than SVG so it follows
          content height without measurement. */}
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
          selected
            ? "border-[rgb(var(--primary))] bg-primary/10"
            : "border-border hover:bg-accent"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`grid h-5 w-5 place-items-center rounded ${hasChildren || extra ? "hover:bg-accent" : "invisible"}`}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
        >
          <Chevron open={open} />
        </button>

        <button
          type="button"
          onClick={() => onSelect?.(node)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-sm font-medium">{node.name}</span>
          <span className="micro shrink-0">{node.code}</span>
          {node.entity_code && <Pill tone="mute">{node.entity_code}</Pill>}
        </button>

        {/* A branch with nobody in it can't approve anything routed to it — the
            single most useful thing to surface on this chart. */}
        {node.member_count === 0 ? (
          <Pill tone="warn">no one assigned</Pill>
        ) : node.member_count != null ? (
          <span className="micro shrink-0">
            {node.member_count} {node.member_count === 1 ? "person" : "people"}
          </span>
        ) : null}
      </div>

      {open && (extra || hasChildren) && (
        <div className="ml-[10px] border-l border-border pl-4 pt-2">
          {extra}
          {hasChildren && (
            <ul className="space-y-2">
              {node.children.map((c) => (
                <Node
                  key={c.scope_id}
                  node={c}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  renderNodeExtra={renderNodeExtra}
                  defaultExpanded={defaultExpanded}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function Organigramme({
  nodes,
  selectedId,
  onSelect,
  renderNodeExtra,
  defaultExpanded,
}: OrganigrammeProps) {
  if (!nodes.length) {
    return (
      <p className="micro">
        No scopes yet. Add your head office first, then branches and departments
        beneath it — that tree is the organigramme approvals route through.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {nodes.map((n) => (
        <Node
          key={n.scope_id}
          node={n}
          selectedId={selectedId}
          onSelect={onSelect}
          renderNodeExtra={renderNodeExtra}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </ul>
  );
}
