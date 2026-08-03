/**
 * Department picker — one control for the three forms that used to take
 * "department" as free text (purchase request, employee, vacancy).
 *
 * Departments ARE scopes. `scope` has always been described in the schema as
 * "the entity / branch / department a user belongs to", it nests via
 * parent_scope_id, and it's the tree approvals route through — so picking a
 * department here and routing an approval step to a branch now refer to the same
 * thing (0490; audit findings B1/B4).
 *
 * Emits BOTH values: `scope_id` is the reference, `name` is the display snapshot
 * the API stores alongside it so documents that print a department keep working
 * and existing rows stay readable.
 *
 * Falls back to a free-text input when the tenant has no scopes yet. That is
 * deliberate: an ERP that refuses to accept a purchase request because nobody
 * has drawn the org chart yet is worse than one that takes a string.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { useResource } from "@/lib/use-resource";
import { fetchScopeOptions, buildScopeTree, type ScopeTreeNode } from "@/lib/scope-api";

export type DepartmentValue = { scope_id: string | null; department: string | null };

export function DepartmentSelect({
  value,
  onChange,
  placeholder = "— none —",
}: {
  value: DepartmentValue;
  onChange: (v: DepartmentValue) => void;
  placeholder?: string;
}) {
  // Options, not the admin tree — this control appears on forms ordinary staff
  // fill in, and the tree endpoint requires the IAM grant.
  const scopeQ = useResource(() => fetchScopeOptions(), []);

  // Flattened depth-first so the dropdown reads as a tree.
  const nodes = React.useMemo(() => {
    const out: ScopeTreeNode[] = [];
    const walk = (ns: ScopeTreeNode[]) => ns.forEach((n) => { out.push(n); walk(n.children); });
    walk(buildScopeTree(scopeQ.data || []));
    return out;
  }, [scopeQ.data]);

  // "Empty" and "the request failed" are different problems and must not read
  // the same. Both still fall back to free text so the form stays usable.
  if (!scopeQ.loading && !nodes.length) {
    return (
      <>
        <Input
          value={value.department || ""}
          onChange={(e) => onChange({ scope_id: null, department: e.target.value })}
        />
        {scopeQ.error ? (
          <p className="micro mt-1 text-[rgb(var(--bad))]">
            Couldn&rsquo;t load departments: {scopeQ.error}
          </p>
        ) : (
          <p className="micro mt-1">
            No departments defined yet — add them under Security &rsaquo; Scopes and they&rsquo;ll appear here.
          </p>
        )}
      </>
    );
  }

  return (
    <Select
      value={value.scope_id || ""}
      onChange={(e) => {
        const id = e.target.value;
        const node = nodes.find((n) => n.scope_id === id);
        // Send the snapshot with the id. The API re-derives it from the scope
        // anyway, so the two can't disagree even if this list is stale.
        onChange(id ? { scope_id: id, department: node ? node.name : null } : { scope_id: null, department: null });
      }}
    >
      <option value="">{placeholder}</option>
      {nodes.map((n) => (
        <option key={n.scope_id} value={n.scope_id}>
          {`${"  ".repeat(n.depth)}${n.name}`}
        </option>
      ))}
    </Select>
  );
}
