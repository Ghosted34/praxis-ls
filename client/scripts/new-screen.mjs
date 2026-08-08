#!/usr/bin/env node
/**
 * Scaffold a new screen (Phase 5).
 *
 * WHY THIS EXISTS. The audit's root-cause finding is F5: the documented way to
 * build a screen pointed at a component that had been deleted and one that had
 * zero call sites, so twenty-four feature areas each paved their own road, and
 * that is what produced most of the other findings. Phases 1-4 built the road —
 * `ListPage`, `Form`, the tokens, the gates. This is the on-ramp: the thing that
 * makes the paved road the path of least resistance rather than the path you
 * take after reading a document.
 *
 * Phase 5's scope calls it "a 'new screen' generator that scaffolds the
 * checklist from Phase 4". The eight-item checklist in `doc/PHASE4_CHECKLIST.md`
 * §2 is exactly what comes out of this: a container with a deliberate width, all
 * four states routed to the right primitive, both empty states, semantic tokens
 * only, primitives instead of raw elements, and an entry in the axe register so
 * the screen is gated from its first commit rather than from whenever someone
 * remembers.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch the router, and it does
 * not write the axe-register entry into the file for you — it prints both, to be
 * pasted. Generators that edit existing files are the ones people stop trusting:
 * a bad merge into `app.tsx` or `screens.axe.test.tsx` is a worse outcome than a
 * copy-paste, and the paste is where you notice the fixture paths are wrong,
 * which `PHASE4_CHECKLIST.md` §5 records as the mistake that was made seven
 * times.
 *
 *   node scripts/new-screen.mjs --area finance --name "Bank charges" --path /bank-charges
 *
 * Options
 *   --area   feature directory under src/features (required)
 *   --name   human title, e.g. "Bank charges" (required)
 *   --path   API path the list reads, e.g. /bank-charges (default: derived)
 *   --width  wide | standard | reading | full   (default: wide)
 *   --force  overwrite an existing file
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");

/* ── args ─────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
function opt(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const force = args.includes("--force");

const area = opt("area");
const name = opt("name");
const width = opt("width") ?? "wide";

if (!area || !name) {
  console.error(
    "\nUsage: node scripts/new-screen.mjs --area <dir> --name <Title> [--path /endpoint] [--width wide|standard|reading|full]\n\n" +
      '  e.g. node scripts/new-screen.mjs --area finance --name "Bank charges"\n',
  );
  process.exit(2);
}
if (!["wide", "standard", "reading", "full"].includes(width)) {
  console.error(`\n--width must be one of wide | standard | reading | full (got "${width}")\n`);
  process.exit(2);
}

const kebab = name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const pascal = kebab.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const apiPath = opt("path") ?? `/${kebab}`;
const singular = name.trim().toLowerCase().replace(/s$/, "");

const areaDir = join(clientRoot, "src", "features", area);
const file = join(areaDir, `${kebab}.tsx`);
if (!existsSync(areaDir)) {
  console.error(`\nNo such feature area: src/features/${area}\n`);
  process.exit(2);
}
if (existsSync(file) && !force) {
  console.error(`\n${kebab}.tsx already exists in src/features/${area}. Pass --force to overwrite.\n`);
  process.exit(2);
}

/* ── the screen ───────────────────────────────────────────────────────────── */

/**
 * Every line here is a checklist item, and the comments say which. A scaffold
 * that produces correct code silently teaches nothing; one that says WHY each
 * part is there is the documentation F5 says never existed.
 */
const screen = `/**
 * ${name} — TODO: one sentence on what this screen is FOR, not what it contains.
 *
 * Scaffolded by scripts/new-screen.mjs. The structure below is the eight-item
 * per-screen checklist in doc/PHASE4_CHECKLIST.md §2; the TODOs are the parts
 * only you can fill in.
 */
import * as React from "react";
import { ListPage } from "@/components/list-page";
import { type Column } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { FormButtons } from "@/components/ui/form-buttons";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { HubCrumb } from "@/components/tabbed-hub";
import { useList, errMsg } from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { dateFmt, enumLabel } from "@/lib/format";

/** TODO: replace with the real row type, from the API types — not from memory. */
type Row = {
  ${kebab.replace(/-/g, "_")}_id: string;
  reference: string;
  status: string;
  created_at: string;
};

export function ${pascal}Page() {
  const { rows, error, loading, reload } = useList<Row>("${apiPath}");
  const [q, setQ] = React.useState("");
  const search = useDebounced(q, 250);
  const [creating, setCreating] = React.useState(false);

  // Derivation lives in the screen, which is why ListPage takes a result rather
  // than a path — half the list screens in this app filter, join or merge.
  const shown = React.useMemo(() => {
    const all = rows ?? [];
    if (!search.trim()) return all;
    const needle = search.trim().toLowerCase();
    return all.filter((r) => r.reference.toLowerCase().includes(needle));
  }, [rows, search]);

  // Checklist 5 + 6: semantic tokens only, primitives instead of raw elements.
  // <Pill> for status, never a hand-written coloured span — check:palette fails
  // the build on a raw Tailwind colour.
  const columns: Column<Row>[] = [
    { key: "reference", label: "Reference", render: (r) => <span className="font-medium text-foreground">{r.reference}</span> },
    { key: "status", label: "Status", render: (r) => <Pill tone="mute">{enumLabel(r.status)}</Pill> },
    { key: "created_at", label: "Created", render: (r) => dateFmt(r.created_at) },
    {
      // The trailing actions cell. \`label: ""\` is the convention; DataList gives
      // it a screen-reader name so it is not an empty <th>.
      key: "_a",
      label: "",
      render: () => (
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => { /* TODO */ }}>Edit</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <ListPage<Row>
      title="${name}"
      // Write this as what the screen is FOR. "Every party you invoice" beats
      // "List of clients".
      description="TODO: what this screen is for."
      eyebrow={<HubCrumb area="${area[0].toUpperCase()}${area.slice(1)}" to="/${area}" />}
      // Checklist 1: a deliberate width. wide = dense data, reading = forms.
      width="${width}"
      action={<Button onClick={() => setCreating(true)}>New ${singular}</Button>}
      toolbar={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ${name.toLowerCase()}…"
          aria-label="Search ${name.toLowerCase()}"
          className="max-w-xs"
        />
      }
      columns={columns}
      rows={shown}
      // Checklist 3: all four states. loading and error are routed to the right
      // primitive by ListPage; the two empties are yours.
      error={error}
      loading={loading}
      rowKey={(r) => r.${kebab.replace(/-/g, "_")}_id}
      empty={{
        title: "No ${name.toLowerCase()} yet",
        hint: "TODO: say what creating the first one gets them.",
        action: <Button onClick={() => setCreating(true)}>New ${singular}</Button>,
      }}
      // A brand-new list and a filtered-to-nothing list are different situations
      // and want different actions. Offering "New ${singular}" to someone who
      // mistyped a search is the single most common thing screens get wrong.
      filtered={!!search}
      emptyFiltered={{
        title: "No ${name.toLowerCase()} match",
        hint: "Try a different search term.",
        action: <Button variant="outline" onClick={() => setQ("")}>Clear search</Button>,
      }}
    >
      {creating && <${pascal}Form onClose={() => setCreating(false)} onSaved={reload} />}
    </ListPage>
  );
}

/**
 * The create form.
 *
 * Checklist 4: build this on \`useZodForm\` + a schema in \`packages/shared\`, so
 * field-level errors come from the SAME definition the API validates with. The
 * audit found 565 \`<Field>\` sites of which 4 received an error, and validation
 * re-implemented as ad-hoc booleans in every screen (F4, F12). \`Field\` already
 * wires \`aria-invalid\` / \`aria-describedby\` from the \`error\` prop — it just
 * needs something to pass it.
 *
 * @example  // once the schema exists
 * const form = useZodForm(schemas.${kebab.replace(/-/g, "_")}.create);
 * <Field label="Reference" required error={form.formState.errors.reference?.message}>
 *   <Input {...form.register("reference")} />
 * </Field>
 */
function ${pascal}Form({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // TODO: call the typed API wrapper, e.g. api.create${pascal}({ reference }).
      await Promise.resolve(reference);
      onSaved();
      onClose();
    } catch (err) {
      // errMsg, never a bare String(err): it turns a 403 into the permission
      // sentence and a 422 into the field list.
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New ${singular}" description="TODO: what saving this does.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Reference" required>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="REF-2026-0001" />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy || !reference.trim()} onCancel={onClose} saveLabel="Create ${singular}" />
      </form>
    </Modal>
  );
}

export default ${pascal}Page;
`;

mkdirSync(areaDir, { recursive: true });
writeFileSync(file, screen, "utf8");

/* ── what the human still has to do ───────────────────────────────────────── */

const route = `      <Route path="${apiPath}" element={<${pascal}Page />} />`;
const registerEntry = `      {
        name: "${name}",
        render: () => <${pascal}Page />,
        routes: {
          "${apiPath}": [
            { ${kebab.replace(/-/g, "_")}_id: "x1", reference: "REF-2026-0001", status: "DRAFT", created_at: "2026-07-01" },
          ],
        },
        populatedProof: /REF-2026-0001/,
      },`;

console.warn(`\n✓ Created src/features/${area}/${kebab}.tsx\n`);
console.warn("Two things this deliberately did NOT edit for you.\n");
console.warn("1. The route, in src/app/app.tsx — lazy, like every other one:\n");
console.warn(route);
console.warn(`\n   import { ${pascal}Page } from "@/features/${area}/${kebab}";  (via the lazy() wrapper)\n`);
console.warn("2. The axe register, in src/features/screens.axe.test.tsx. This is");
console.warn("   what gates the screen on every CI run — four states, axe-clean,");
console.warn("   exactly one <h1>:\n");
console.warn(registerEntry);
console.warn(`
   GET THE FIXTURE'S PATHS AND FIELD NAMES FROM THE API TYPES, NOT FROM MEMORY.
   Building the register, the same mistake was made seven times: a fixture keyed
   on a path or field the screen does not use. Four crashed loudly. The other
   three were SILENT — nothing arrives, the screen renders its empty state, and
   every assertion passes. An axe-clean empty table is worthless as coverage.
   (doc/PHASE4_CHECKLIST.md §5.)

Then, before you commit:

   npm run lint && npx tsc -b && npm test
   npm run check:palette && npm run check:contrast && npm run check:motion
`);
