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
 * ── WHEN THE TENANT HAS NO ORG CHART YET ──────────────────────────────────
 *
 * This used to render a bare `<Input>` in that case, which is how "Department"
 * came to be reported as a free-text field: a tenant who has not opened
 * Security › Scopes never saw the dropdown at all, only a box — and typed
 * "Operations", then "operations", then " Operations " into three records the
 * roster filter then treated as three departments.
 *
 * The picker is now the control in every case. Empty means an empty dropdown
 * that says where departments come from. Typing one is still possible and still
 * necessary — an ERP that refuses a purchase request because nobody has drawn
 * the org chart is worse than one that takes a string — but it is now a
 * deliberate second choice behind a link, rather than the default everybody
 * lands in and never leaves.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { useResource } from "@/lib/use-resource";
import {
  fetchScopeOptions,
  buildScopeTree,
  type ScopeTreeNode,
} from "@/lib/scope-api";

export type DepartmentValue = {
  scope_id: string | null;
  department: string | null;
};

export function DepartmentSelect({
  value,
  onChange,
  placeholder = "— none —",
  id,
}: {
  value: DepartmentValue;
  onChange: (v: DepartmentValue) => void;
  placeholder?: string;
  /** The control's id, so a `Field` can point its label at it — this renders a
   *  control AND a line of guidance, which `Field` cannot label by cloning. */
  id?: string;
}) {
  // Options, not the admin tree — this control appears on forms ordinary staff
  // fill in, and the tree endpoint requires the IAM grant.
  const scopeQ = useResource(() => fetchScopeOptions(), []);

  /* Typing one instead of picking one. Opens by itself for a record that
     already holds text with no scope behind it (imported before 0490, or typed
     while this control fell back to an input) — otherwise the field would render
     as "— none —" over a value the record does hold, and the next save would
     quietly clear it. */
  const [typing, setTyping] = React.useState(
    Boolean(value.department && !value.scope_id),
  );

  // Flattened depth-first so the dropdown reads as a tree.
  const nodes = React.useMemo(() => {
    const out: ScopeTreeNode[] = [];
    const walk = (ns: ScopeTreeNode[]) =>
      ns.forEach((n) => {
        out.push(n);
        walk(n.children);
      });
    walk(buildScopeTree(scopeQ.data || []));
    return out;
  }, [scopeQ.data]);

  // The escape hatch, entered on purpose. Whatever is typed carries no
  // scope_id, so the roster's case-insensitive text matching still finds it.
  if (typing) {
    return (
      <>
        <Input
          id={id}
          value={value.department || ""}
          aria-label="Department"
          onChange={(e) =>
            onChange({ scope_id: null, department: e.target.value })
          }
        />
        <p className="micro mt-1">
          A typed department is a label, not a node in the organigramme —
          approvals cannot route to it.{" "}
          <button
            type="button"
            onClick={() => {
              setTyping(false);
              onChange({ scope_id: null, department: null });
            }}
            className="text-primary-ink underline underline-offset-2"
          >
            Pick from the list instead
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <Select
        id={id}
        value={value.scope_id || ""}
        aria-label="Department"
        onChange={(e) => {
          const id = e.target.value;
          const node = nodes.find((n) => n.scope_id === id);
          // Send the snapshot with the id. The API re-derives it from the scope
          // anyway, so the two can't disagree even if this list is stale.
          onChange(
            id
              ? { scope_id: id, department: node ? node.name : null }
              : { scope_id: null, department: null },
          );
        }}
      >
        <option value="">
          {scopeQ.loading
            ? "Loading departments…"
            : nodes.length
              ? placeholder
              : "— no departments defined —"}
        </option>
        {nodes.map((n) => (
          <option key={n.scope_id} value={n.scope_id}>
            {`${"  ".repeat(n.depth)}${n.name}`}
          </option>
        ))}
      </Select>
      {/* "Empty" and "the request failed" are different problems and must not
          read the same — one is a setup step, the other is a fault. */}
      {scopeQ.error ? (
        <p className="micro mt-1 text-[rgb(var(--bad))]">
          Couldn&rsquo;t load departments: {scopeQ.error}
        </p>
      ) : (
        !scopeQ.loading &&
        !nodes.length && (
          <p className="micro mt-1">
            Departments are your scopes — add them under Security &rsaquo;
            Scopes and they appear here on every form that asks.
          </p>
        )
      )}
      <p className="micro mt-1">
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="text-primary-ink underline underline-offset-2"
        >
          Type one instead
        </button>
      </p>
    </>
  );
}
