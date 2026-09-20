# Praxis LS — Frontend Guide

**This is the one frontend document. If you read nothing else, read this.**

_Source of truth: `client/src/index.css` + `client/src/components/*` and `client/tailwind.config.ts`.
This doc summarises them so a new screen looks like the rest without reverse-engineering CSS.
**If this doc and the code ever disagree, the code wins — and the doc is a bug.**_

## What this replaces

F15 counted **six overlapping frontend plans**, and named the compounding problem
precisely: _"a new engineer cannot tell which is current — and the one that reads most
authoritative is the one that's wrong."_ Phase 5 consolidates them here. Each of the
others now carries a banner saying so, and each is kept for the history it holds:

| Superseded                  | What it was                   | Where its content lives now                                                       |
| --------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `FE_DESIGN_RULES.md`        | tokens + on-ramp              | **this file** — it was renamed, not rewritten                                     |
| `FRONTEND_PLAN.md`          | the Phase-0 hand-rolled stack | history; the platform-console proposal is still open                              |
| `LOVABLE_FIDELITY_PLAN.md`  | port the mock's look          | done in session 15, then largely undone by Phase 1's token pass (F17)             |
| `UI_DEPTH_OVERHAUL_PLAN.md` | HR / Fleet / WMS archetypes   | done; the screens are the record                                                  |
| `FE_IA_HANDOFF.md`          | module → navigation mapping   | still useful as a **reference**, not a plan                                       |
| `FE_IA_BUILD_MAP.md`        | which screens were scaffolded | superseded by `features/scaffold/screen-specs.ts`, which the app actually renders |
| `FE_WIRING_PLAN.md`         | wire scaffolds to APIs        | done through Phases 3-4                                                           |

Phase records, which are history rather than instruction, stay where they are:
`DESKTOP_UI_AUDIT.md` (the audit and its addenda), `PHASE4_CHECKLIST.md`,
`PHASE5_CHECKLIST.md`. `FORMS_MIGRATION.md` is a live worklist rather than a
plan: it carries the pattern for moving a module's validation into
`packages/shared` and the count of what is left.

**`npm run check:docs` fails the build if this file names a component that does not
exist.** That is not decoration — it is F5, the audit's root-cause finding, made
impossible to reintroduce. The previous version of this document confidently
documented two components, one deleted and one dead, for months.

> **Why that last sentence is in bold.** The previous version of this file told
> every new engineer that the default list screen was `<ResourceList>` and that
> write-capable lists used `<CrudResource>`. `crud-resource.tsx` never existed.
> `resource-list.tsx` existed with **zero call sites**. That is finding **F5** in
> `doc/DESKTOP_UI_AUDIT.md`, and the audit names it the _root cause_ of most
> other drift in the frontend: with no working paved road, 24 feature areas each
> paved their own.
>
> Everything below is verified against the code as of Phase 2. Every component
> named here exists, is imported by real screens, and has tests. If you follow
> this doc and something does not exist, **that is a defect in this doc** — fix
> it in the same PR.

Two hard rules underpin everything:

1. **Never hardcode colours.** Use the semantic tokens (Tailwind utilities like
   `bg-card`, `text-muted-foreground`, `border`) or the `lux-*` classes. Hex belongs only in
   `index.css`. The audit counted **122** raw palette colours; Phase 2 cleared most of them,
   and every one that remains breaks tenant white-labelling.
2. **Every accent resolves to `--primary`** — but **never use `--primary` for text.**
   The white-label loader (`lib/theme.ts`) overrides `--primary` at runtime, so anything
   tinted with it re-colours per tenant. As _type_ it measures **2.59:1** and fails WCAG AA,
   so text uses **`--primary-ink`** (`text-primary-ink`), which is derived per tenant to clear
   4.5:1 in both themes.

---

## 1. Design tokens

Defined on `:root`, re-tuned under `.dark`. Phase 1 retuned every failing pair; the values
below are current.

**Surfaces / text**

| Token                     | Light                  | Purpose                      |
| ------------------------- | ---------------------- | ---------------------------- |
| `--background`            | `rgb(243 246 251)`     | App backdrop                 |
| `--foreground`            | `rgb(16 30 52)`        | Primary text                 |
| `--card` / `--popover`    | `rgb(255 255 255)`     | Panel / dropdown surface     |
| `--muted` / `--secondary` | `rgb(247 250 253)`     | Subtle fills                 |
| `--muted-foreground`      | `rgb(78 98 128)`       | Secondary text (6.21:1)      |
| `--accent`                | `rgb(239 244 250)`     | Hover / selected fill        |
| `--border`                | `rgb(16 30 52 / 0.09)` | Hairline borders             |
| `--input`                 | `rgb(16 30 52 / 0.12)` | Field borders                |
| `--ink-3`                 | `rgb(90 108 133)`      | `.micro` label text (5.36:1) |

**Accent (tenant-overridable at runtime)**

| Token                  | Value                                           | Purpose                                              |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `--primary`            | `rgb(245 130 31)`                               | Brand accent — **fills only**                        |
| `--primary-ink`        | `rgb(169 77 12)` light / `rgb(250 158 78)` dark | Brand accent **as text** (4.93:1 on the pill ground) |
| `--primary-foreground` | `rgb(255 255 255)`                              | Text _on_ primary                                    |
| `--ring`               | `rgb(245 130 31)`                               | Focus ring                                           |
| `--destructive`        | `rgb(210 68 58)`                                | Danger                                               |

**Status.** Used as _text_ (pills, ledger figures), so tuned to clear 4.5:1 **on the tinted
pill ground they actually sit on**, not on `--card`:
`--ok 25 117 73`, `--warn 133 95 11`, `--bad 181 58 50`, `--brand-blue-ink 20 108 161`.

Phase 5 retuned all four. Phase 1 tuned them against `--card` and the gate measured them
against `--card`, and they passed — but `.st-ok` is that colour over `rgb(var(--ok-fill) / 0.13)`,
and measured on the composite every light-theme pill failed AA (3.27–3.98:1). `check:contrast`
now parses the `.st-*` rules out of `index.css` and composites them, so a pill added tomorrow is
measured without anyone remembering to add it to a list.

**Ink vs fill is a real distinction, not tidiness.** `--ok` / `--warn` / `--bad` /
`--brand-blue-ink` / `--primary-ink` are for **type**. `--ok-fill` / `--warn-fill` / `--bad-fill` /
`--brand-blue` / `--primary` are for **grounds, marks and chart series**. Using a fill token as
type is a build failure (`check:contrast`) — `text-primary` measures 2.59:1 and 38 files were
doing it because `primary.DEFAULT` makes it the short spelling.

**Type, radius, shadow**

- `--font-body` and `--font-display` both resolve to **Inter** (self-hosted, `@fontsource-variable/inter`).
  `--font-display` survives as a token so the existing `font-display` call sites keep working;
  it is no longer a second typeface. Body is `13px / 1.45`.
- `--radius: 0.5rem` (8px). Pills use `999px`.
- Shadows: `--shadow-s` (cards), `--shadow-m` (raised), `--shadow-l` (overlays).
- There is **no** full-page mesh gradient any more (F17) — don't add one.

**Scales (`tailwind.config.ts`).** Use the ramp, never an arbitrary pixel value:
`text-micro` (11) · `text-label` (12) · `text-sm` (13, the body default) · `text-base` (14) ·
`text-lg` (16) · `text-title` (18) · `text-h2` (22) · `text-h1` (28).

**Breakpoints.** `sm` (640) and `md` (768) are phone/tablet boundaries and are **not** where
desktop decisions belong. Desktop layout goes in `lg` (1024), `xl` (1280) and `2xl` (1600).
A grid that goes two-up at `sm:` and never changes again is exactly the bug F2 describes.

---

## 2. Signature classes

| Class                        | Use                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.lux-card`                  | Legacy panel surface. **New code uses `<Card>` / `<Panel>`.**                                                                                                               |
| `.micro`                     | 11px uppercase tracked label (eyebrows, table captions).                                                                                                                    |
| `.num`                       | Tabular figures for money/quantities — aligns columns.                                                                                                                      |
| `.status` + `.st-*`          | Status pill. Use the **`<Pill>` / `<StatusPill>`** primitive rather than the classes. Variants: `st-ok`, `st-warn`, `st-bad`, `st-blue`, `st-orange`, `st-info`, `st-mute`. |
| `.chip` (+ `.on`)            | Filter token. Use the **`<Chips>`** primitive.                                                                                                                              |
| `.lux-navlink` (+ `.active`) | Top-bar nav item. Nav only.                                                                                                                                                 |
| `.lux-mark`                  | Brand glyph tile.                                                                                                                                                           |

**Pre-auth only:** `landing-*` and `login-*` carry their own dark surface and deliberately
keep their entrance motion. Not for in-app screens.

---

## 3. Building a screen — the real on-ramp

### 3.1 Where things live

Screens are components under `client/src/features/<area>/`, exported, and routed in
`client/src/app/app.tsx`. Two more files decide whether anyone can _find_ them:

- **`client/src/app/layout/areas.ts`** — the area's section list. This is what the ribbon's
  second row draws AND what `hubTabs()` gives the hub, so a section added here appears in both
  or in neither. `areas.test.ts` fails if a hub has a page the list does not know about.
- **`client/src/app/screen-registry.json`** — the route's `module_key`. The ribbon filters on
  it, so an unregistered route is shown to _everyone_ regardless of their grants. Register the
  route when you add it; `areas.test.ts` enforces this for every section.

`NAV` (`app/layout/nav-model.ts`) is still the ⌘K palette's and the phone drawer's index — a
complete map of the product's areas, deliberately not permission-filtered. Unbuilt screens route
to `<Planned/>` (`features/scaffold/screen-scaffold.tsx`).

### 3.2 A list screen — `<ListPage>`

**This is the paved road.** `components/list-page.tsx` composes container + header + toolbar +
`DataList` + all four states + pagination. It exists, it is tested, and it is what the previous
version of this doc was describing when it pointed at components that did not exist.

```tsx
import { ListPage } from "@/components/list-page";
import { useList } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/pill";
import { money, dateFmt } from "@/lib/format";
import type { Column } from "@/components/data-list";

type Invoice = {
  invoice_id: string;
  doc_number: string;
  status: string;
  total_ttc: number;
  due_on: string;
};

export function InvoicesPage() {
  const { rows, error, loading, reload } = useList<Invoice>("/final-invoices");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const shown = React.useMemo(
    () =>
      (rows ?? []).filter((r) =>
        r.doc_number.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [rows, q],
  );

  const columns: Column<Invoice>[] = [
    { key: "doc_number", label: "Invoice", className: "num font-medium" },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "total_ttc",
      label: "Amount · XAF",
      className: "num text-right",
      render: (r) => money(r.total_ttc),
    },
    { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
  ];

  return (
    <ListPage
      title="Invoices"
      description="Every money event posts to the ledger."
      action={<Button onClick={() => setOpen(true)}>New invoice</Button>}
      toolbar={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search invoices…"
          className="max-w-xs"
        />
      }
      columns={columns}
      rows={shown}
      error={error}
      loading={loading}
      rowKey={(r) => r.invoice_id}
      empty={{
        title: "No invoices",
        hint: "Issue a final invoice from an approved costing.",
        action: <Button onClick={() => setOpen(true)}>New invoice</Button>,
      }}
      filtered={!!q}
      emptyFiltered={{
        title: "No invoices match",
        hint: "Try a different reference.",
        action: (
          <Button variant="outline" onClick={() => setQ("")}>
            Clear search
          </Button>
        ),
      }}
    >
      <InvoiceForm
        open={open}
        onClose={() => setOpen(false)}
        onSaved={reload}
      />
    </ListPage>
  );
}
```

**Pass both empties.** A brand-new list and a filtered-to-nothing list are different situations
and want different actions. Offering "New invoice" to someone who mistyped a search is the
single most common thing screens get wrong here.

**`<ListPage>` does not fetch for you, on purpose.** Half the list screens in this app derive
their rows — filtering, joining an id→name map, merging two endpoints. A scaffold that owned
the fetch would be escaped immediately, which is what happened to `ResourceList`.

### 3.3 A write form — `<Form>` + a shared schema

```tsx
import { finalInvoice } from "@shared";            // packages/shared — the API's own schemas
import { useZodForm } from "@/lib/use-zod-form";
import { Form, FormField, FormError } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { FormButtons } from "@/components/ui/form-buttons";
import { useToast } from "@/components/ui/toast";

function SubmitInvoiceForm({ id, open, onClose, onSaved }: { … }) {
  const form = useZodForm(finalInvoice.submit, { defaultValues: { entry_date: todayISO(), source_doc_ref: "" } });
  const toast = useToast();

  return (
    <Dialog open={open} onClose={onClose} title="Submit invoice" description="Posts to the ledger.">
      <Form
        form={form}
        onSubmit={async (values) => {
          await tenant(`/final-invoices/${id}/submit`, { method: "POST", body: values });
          toast.success("Invoice submitted");
          onSaved();
          onClose();
        }}
      >
        <FormField form={form} name="entry_date" label="Entry date" required>
          {(field) => <Input type="date" {...field} />}
        </FormField>
        <FormField form={form} name="source_doc_ref" label="Document reference" required>
          {(field) => <Input {...field} />}
        </FormField>
        <FormError form={form} />
        <FormButtons busy={form.formState.isSubmitting} onCancel={onClose} saveLabel="Submit invoice" />
      </Form>
    </Dialog>
  );
}
```

**Validate with the API's schema, not a copy.** `packages/shared` holds the Zod schemas the
Express validators parse with. Import from `@shared` and the client cannot disagree with the
server about what is valid. Never add a client-side rule the schema does not have — put it in
`packages/shared` so the API enforces it too, or it is not a rule, it is a suggestion.

A 422 from the server is routed back onto the offending **field** automatically.

### 3.4 Data access

`useList(path)` and `useResource(fn, deps)` (`lib/use-resource.ts`) are thin shims over
TanStack Query, so you get caching, deduplication and background revalidation for free. They
return `{ rows | data, error, loading, reload }`.

- **`error` is an already-formatted STRING.** Render it. Do **not** pass it through `errMsg()` —
  that is for a caught exception, and applying it twice replaces the real server message
  (including the 403 permission text) with "Something went wrong." This was a live defect at
  16 sites (F12). There is a test that fails if it comes back.
- After a write, call `useRefresh()` rather than refetching by hand.
- Keep typed helpers in `lib/<area>-api.ts` rather than inline `tenant()` calls in components.
- **Lists are capped at 50 rows server-side** by the API's shared `page()` helper. If a screen
  filters client-side over an unpaginated fetch, its search cannot see past row 50 — pass
  `?limit=&offset=` and use `<Pagination>`, or move the search to the endpoint's `?q=`.

### 3.5 The primitives — don't hand-roll these

| Need                             | Use                                                                                       | Notes                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shell                       | `<PageContainer>`                                                                         | `wide` (2160) · `standard` (1280) · `reading` (768) · `full`. Never write `mx-auto max-w-*`.                                                                    |
| List screen                      | `<ListPage>`                                                                              | §3.2.                                                                                                                                                           |
| Table                            | `Table, THead, TBody, TR, TH, TD`                                                         | `components/ui/table.tsx`                                                                                                                                       |
| Surface                          | `<Card>` / `<Panel>`                                                                      | `Panel` = titled card. Never nest cards.                                                                                                                        |
| Modal                            | `<Dialog>`                                                                                | Has the focus trap + restore the old `Modal` lacked. `Modal` is now an alias of it.                                                                             |
| Confirm                          | `<ConfirmDialog>`                                                                         | Name the object and the action, not "Yes/No".                                                                                                                   |
| Form field                       | `<Field>`                                                                                 | Supplies the label association and `aria-required` / `aria-invalid`.                                                                                            |
| Text input                       | `<Input>` / `<Textarea>`                                                                  |                                                                                                                                                                 |
| Date input                       | `<DateField>`                                                                             | **Never `<Input type="date">`.** Reads and writes dd/mm/yyyy whatever the OS locale is; stores ISO. Takes `min`/`max`/`required` and an RHF `{...field}` spread (§3.12). |
| Date **and time** input           | `<DateTimeField>`                                                                         | **Never `<Input type="datetime-local">`** — it renders its date part in the OS locale too. dd/mm/yyyy HH:mm, 24-hour; stores `YYYY-MM-DDTHH:mm` (§3.12). |
| Choose one                       | `<NativeSelect>` (default) · `<Select>` (rich options) · `<SearchSelect>` (server-backed) · `<EntityPicker>` (server-searched corporate entities, ACTIVE-only) |                                                                                                                            |
| Toggle                           | `<Checkbox>` / `<RadioGroup>`                                                             |                                                                                                                                                                 |
| View switch                      | `<Segmented>` (2–5 fixed) · `<Chips>` (wrapping filters)                                  |                                                                                                                                                                 |
| Tabs                             | `<Tabs>` / `<TabList>`                                                                    | Real `tablist`/`tab` semantics + arrow keys.                                                                                                                    |
| Sections of one record           | `<SectionTabs>`                                                                           | A `<nav>` of buttons bound to `?tab=` — the 360 strip. One scrollable row on a phone; `sticky` to pin it. §3.16.                                                |
| The strip itself                 | `<ScrollStrip>`                                                                           | Layout only. `data-strip-active="true"` marks the tab; the strip centres it and fades the edges it can scroll towards. Any new tab bar goes inside this.        |
| A row's off-screen actions       | `<MoreMenu>`                                                                              | The `⋯`. One or two actions stay visible on the row; the rest live here, destructive last. §8.1.                                                                |
| A collection that is a table on a desktop and cards on a phone | `<ResponsiveList>` + `<RecordCard>`                                      | Only one branch mounts — never `hidden md:block` over both. §3.16.                                                                                              |
| Menu                             | `<DropdownMenu>` (actions) · `<Popover>` (content)                                        | A panel with its own buttons is a Popover, not a menu.                                                                                                          |
| Status                           | `<Pill>` / `<StatusPill>`                                                                 | `StatusPill` picks its tone from the value.                                                                                                                     |
| Figures                          | `<Stat>` (tile) · `<KpiRow>`+`<KpiTile>` (strip)                                          |                                                                                                                                                                 |
| States                           | `<EmptyState>` (with `action`) · `<ErrorState>` · `<LoadingRow>` · `<SkeletonTable>`      |                                                                                                                                                                 |
| A screen's fetch failed          | `<ScreenError message={error} what="Corporate entities" onRetry={reload} />`              | **Prefer this over a bare `<ErrorState>` for a failed fetch.** Shows the server's own message when the server answered, and `<ConnectionLost>` when it did not. |
| Unsaved form rescue              | `useFormDraft()` + `<DraftBanner>`                                                        | Autosaves what was typed; offers it back after a drop or a reload. Never restores silently.                                                                     |
| A write that must survive a drop | `submitQueued()` (`lib/outbox.ts`)                                                        | Queues on network failure and replays on reconnect under an `Idempotency-Key`. Still throws a 422/403 — only "nothing answered" is queued.                      |
| Feedback                         | `useToast()`                                                                              | `success` / `error` / `info`.                                                                                                                                   |
| Paging                           | `<Pagination>`                                                                            |                                                                                                                                                                 |
| Crash safety                     | `<ErrorBoundary>`                                                                         | Already at the app root and per route; add around risky widgets.                                                                                                |
| Unknown payload                  | `<DataView>`                                                                              | Never `<pre>{JSON.stringify(…)}</pre>` in the UI.                                                                                                               |
| Edit one field                   | `<InlineEdit>`                                                                            | Descriptive master data only — **never** a field on a posted document (§7.3).                                                                                   |
| Master-detail                    | `<SplitPane>`                                                                             | Keyboard-resizable. Replaces `lg:grid-cols-[260px_1fr]`.                                                                                                        |
| Row in a master-detail index     | `<IndexRow>`                                                                              | The open record's ground + accent rail + `aria-current`. Pair with `<SplitPane activeKind>` (§3.14).                                                            |
| Bulk actions                     | `<BulkBar>` + `useRowSelection`                                                           | Announces the count; scoped to visible rows (§7.2).                                                                                                             |
| Column control                   | `<ColumnsMenu>` + `useColumnVisibility`                                                   | Persists the HIDDEN set, per screen (§7.2).                                                                                                                     |
| Row actions                      | `<RowActions>`                                                                            | Also what bounds the row-action button to the row height (§7.1).                                                                                                |

**See them all:** `npm run workbench` in `client/` opens the Ladle workbench —
every primitive, every state, light and dark, with an a11y panel.
Stories: `src/components/ui/primitives.stories.tsx`.

### 3.6 Layout

The app shell wraps content in `<main>` with responsive padding, so screens **don't** add outer
padding or page chrome. One `<PageContainer>` per screen, at the top; nesting them is a bug.
Don't add `max-w-*` inside one — if a section must be narrower, constrain the section.

### 3.7 Routes and bundle chunks

**Add your screen to `app/app.tsx` with `lazyNamed(...)`, like every other screen.** Routes are
lazy, so each one becomes its own chunk automatically. That is the whole of the chunking strategy
for app code — there is nothing to configure and nothing to add to `vite.config.ts`.

**Never add a `manualChunks` bucket.** This is not a style preference; it is the rule that keeps
the app from serving a blank page, and it has been broken once already:

> On 2026-08-04 production served an empty `<div id="root">`. `manualChunks` split `vendor-react`
> (react, react-dom, react-router) out of `vendor` (everything else) — but react-dom needs
> `scheduler` and react-router-dom needs `@remix-run/router`, and neither matched the react rule,
> so both stayed in `vendor`. The two chunks imported each other. The browser evaluated one, it
> re-entered the other before React's export binding was assigned, and TanStack Query's top-level
> `createContext` read `undefined`:
> `Uncaught TypeError: Cannot read properties of undefined (reading 'createContext')`.
> That throws during module evaluation, _before_ React renders — so neither ErrorBoundary can
> catch it and there is no fallback UI at all. The `feature-*` buckets were circular too
> (settings → hr → wms → fleet → settings).

A hand-drawn partition over an import graph can cut a cycle into it, and a cyclic chunk graph is a
blank page. So there is exactly **one** manual bucket, `vendor` (all of `node_modules`), which is
acyclic because a single bucket cannot import itself. To keep a heavy library out of the
first-load payload, add it to `ROUTE_LOCAL_VENDOR` in `vite.config.ts` and let Rollup place it
next to the route that imports it — never give it a bucket of its own.

Two gates enforce this and both run in CI: `vite.config.ts` throws on Rollup's `CIRCULAR_CHUNK`
warning (it warned last time, and the build went green anyway), and `npm run check:bundle`
re-derives the graph from what was actually written to `dist/`.

### 3.8 The shell — ribbon, rail, and where a screen's command goes

Desktop chrome is three bands, each with one job:

| Band      | Component                 | Contents                                                                                        |
| --------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Title bar | `.wco` in `app-shell.tsx` | logo, search, LIVE/TEST, theme, alerts, account                                                 |
| Ribbon    | `<Ribbon>`                | row A the workflow families; row B the family's destinations, and the current screen's commands |
| Rail      | `<IconRail>`              | a constant strip of shortcuts — never route-dependent                                           |

**The six families come from the server.** `GET /permissions/mine` returns `groups` (which verbs
this user has modules in, in catalogue order) and `byGroup` (which modules are under each). That
partition is `platform.module_catalogue.group_key` and there is **no second copy of it in the
client** — do not add one. What the client owns is presentation: a label and glyph per verb
(`ribbon-model.ts`) and the route each module gates (`screen-registry.json`).

**A hub does not draw its own tabs on desktop.** `<TabbedHub>` renders the strip below `md` only,
because that is where there is no ribbon. Build the tabs with `hubTabs()` so the two lists cannot
diverge:

```tsx
<TabbedHub eyebrow="Fleet" basePath="/fleet" tabs={hubTabs("/fleet", { vehicles: VehiclesPage, … })} />
```

**A screen publishes its own commands** into the ribbon's right cluster with `useRibbonCommands`.
Use it when the command depends on screen state — a create button whose noun follows the active
view — and keep a `md:hidden` copy in the page header, since a phone has no ribbon:

```tsx
useRibbonCommands(
  React.useMemo(
    () => [{ key: "new", label: `New ${noun}`, primary: true, onSelect: go }],
    [noun, go],
  ),
);
```

Pass a memoised array. The registry re-renders its consumers on publish, so a fresh array literal
each render publishes on every render.

### 3.9 Shared schemas (`@shared`)

`import { finalInvoice } from "@shared"` gives you the **same Zod objects the
Express API validates with** — that is the whole point of `packages/shared`, and
`useZodForm` is built on it (§3.3).

Three things make that work, all of them in `client/config/shared-alias.ts`, and
all three were broken until 2026-08-04 because nothing routed imported the
package and so no build ever compiled it:

- **`build.commonjsOptions.include`** covers `packages/shared`. Vite applies
  CommonJS interop only inside `node_modules` by default, and this is _source_.
- **`optimizeDeps.include`** names the package, so the dev server pre-bundles it.
  Without that, `npm run dev` serves its raw `require()` to the browser —
  `commonjsOptions` is build-only.
- **The `zod` alias pins an entry FILE**, not the package directory. Zod ships
  separate ESM and CJS entries, so a directory alias gives client code one and
  `packages/shared` the other — two instances, and `instanceof z.ZodType` false.

You do not need to think about any of it — but **don't hand-edit those settings
without running `npm run check:shared`**, which builds a probe against the real
config and asserts the schemas resolve, parse, and share one Zod. And when you
add a schema, export it as `exports.name = name` — `module.exports = { name }`
is invisible to every bundler (see `packages/shared/README.md`).

### 3.10 Dialogs — never the browser's

**`window.confirm`, `window.alert` and `window.prompt` are banned.** Not
discouraged — banned, by `praxis/no-native-dialogs`, which is an **error** in
`client/`, `platform-console/` and `public-web/`. Lint fails; the PR does not
merge.

This is not a style preference. A native dialog is the one piece of UI a tenant
sees that is drawn by the **browser** rather than by us:

- It renders in OS chrome, titled "app.praxis-ls.com says". Whatever the
  tenant's white-label settings are, this ignores them — at the exact moment the
  product is asking them to destroy something.
- It has no type scale, spacing, shadow or colour from `index.css`, so a warning
  cannot be red and a destructive action cannot look destructive.
- Its buttons are "OK" and "Cancel". They never name the action, which §6 of
  this guide requires of every confirmation.
- `alert` and `confirm` **block the event loop**. Timers, autosave flushes and
  in-flight fetches stall until a human clicks — that produced a real defect
  here, a draft autosave landing *after* a discard.
- None of them can be translated by `tr()`, and none are reachable by the
  focus-management and live-region work the a11y audit paid for.

#### What to use instead

| Instead of       | Use                                                        |
| ---------------- | ---------------------------------------------------------- |
| `window.confirm` | `useConfirm()` — or `<ConfirmDialog>` directly              |
| `window.prompt`  | `usePrompt()` — or a `<Dialog>` with a `<Field>` + `<Input>` |
| `window.alert`   | `<Callout>` for an outcome they are reading, `useToast()` for one they do not need to read to continue |

`useConfirm()` is the one you will reach for most. It gives you an `await`-able
call and the element to render, so the call site keeps reading top-to-bottom
exactly like the `confirm()` it replaces:

```tsx
const [confirm, confirmDialog] = useConfirm();

async function onDelete(row: Row) {
  const ok = await confirm({
    title: "Delete this conversation for ever?",
    body: "The messages and their attachments go with it. This cannot be undone.",
    confirmLabel: "Delete conversation", // names the ACTION, never "OK"
    cancelLabel: "Keep it",
    destructive: true,
  });
  if (!ok) return;
  await api.remove(row.id);
}

return (
  <>
    {/* … */}
    {confirmDialog}
  </>
);
```

Three rules for the copy, and they are the reason the ban is worth the trouble:

1. **The title names the outcome, as a question.** "Delete this conversation for
   ever?" — not "Are you sure?", which tells the reader nothing they can act on.
2. **The buttons name the action.** `confirmLabel: "Delete conversation"`, not
   "OK". A person who reads only the buttons must still know what happens.
3. **`destructive` for anything irreversible.** It carries the warning colour,
   the warning glyph (so the tone is never colour alone — WCAG §1.4.1) and it
   defaults `dismissible` to `false`, so a click outside cannot half-answer a
   question about deleting something.

#### The escape hatch

There isn't a good one, and that is deliberate. If you are genuinely the
exception, `eslint-disable-next-line praxis/no-native-dialogs` still works and
**must** carry a written reason next to it, the same shape every other exception
in these configs uses. Nothing in the tree needs it today. `window.print()` and
`beforeunload` are not matched by the rule and need no disable.

### 3.12 Dates — day-first, always

**Never `<input type="date">`. Use `<DateField>`.**

This is enforced by `scripts/check-date-format.js`, which runs in CI and in
`npm run ci`, so a native date input does not merge.

```tsx
import { DateField } from "@/components/ui/date-field";

<Field label={tr("Expires on")} required>
  <DateField value={expiresOn} onChange={setExpiresOn} min={todayISO()} required />
</Field>

// Inside a <Form>, the react-hook-form spread works unchanged:
<FormField form={form} name="entry_date" label={tr("Entry date")} required>
  {(field) => <DateField {...field} value={String(field.value ?? "")} />}
</FormField>
```

For a date **and** a time, `<DateTimeField>` is the same thing with `HH:mm` on
the end (24-hour, storing `YYYY-MM-DDTHH:mm`). `<input type="datetime-local">`
is banned for exactly the same reason and was missed on the first pass only
because it carries a different `type`. `type="month"` is fine — it has no day in
it, so there is no order to get wrong.

`value` and `onChange` speak ISO `YYYY-MM-DD` — the same string the API wants —
so nothing downstream changes. What the operator sees and types is dd/mm/yyyy.
`onChange` fires with `""` while the date is incomplete or impossible, so a
half-typed `31/02` never reaches your state as a rolled-over 3rd of March.

**Why it is a hard rule and not a preference.** A native `<input type="date">`
renders in the OPERATING SYSTEM's locale, and no HTML attribute overrides it —
`lang` is ignored for the value display. On a US-configured workstation it shows
and accepts mm/dd/yyyy. Praxis serves a corridor that reads dates day-first, so
the operator types 03/07 meaning the 3rd of July and the control stores the 7th
of March.

Nothing catches that. Both readings are real dates, so the value validates, the
API accepts it, the round-trip is clean and every test stays green. It surfaces
months later — a licence that expired in a month nobody expected, a customs
deadline missed by a quarter, a payroll run dated to the wrong period.

The same applies to **displaying** a date. `toLocaleDateString()` with no locale
means "whatever this machine is set to", which is month-first on a US
workstation and in a container with no `LANG`. Use the formatters in
`lib/format.ts` (§5) — `dateFmt` for "21 Jul 2026", `dateDmy` for a strict
numeric dd/mm/yyyy — or pin `en-GB`. Never pass `undefined`, `[]`, `"en"` or
`"en-US"` to a format that renders a day number.

### What a person reads vs. what the wire carries

**ISO `YYYY-MM-DD` is not the bug** — it is unambiguous, and it is the format
the API contract, the `@shared` validators and every `date` column are built on.
Keep it everywhere it is a *value*: request bodies, query params, `DateField`'s
own `value`, state you post back.

Change it only where a **person** reads it. Those surfaces are:

| Surface | Prints |
| --- | --- |
| Document / PDF templates (`services/documents/templates`) | `27/07/2026` via `k.dateFmt` |
| xlsx and CSV exports (`services/spreadsheet`) | `dd/mm/yyyy` number format |
| Screens | `dateFmt` / `dateDmy` / `dateTimeFmt` (§5) |

`check:dates` enforces exactly that split: it flags ISO in the first two paths
and nowhere else. The one exception inside them is a **filename** — `/` is not
legal in one, and ISO is what makes a folder of exports sort — which carries an
`@date-format:filename` marker.

The gate has three escape hatches, each costing a written reason:
`@date-format:foreign` for an incoming third-party format (a bank statement
genuinely arrives month-first, and refusing to parse it does not make it
day-first), `@date-format:parts` for an `Intl.DateTimeFormat` built only to
call `formatToParts()`, which renders nothing, and `@date-format:filename` for
an ISO day in a filename. Whole files are listed per-rule
in the script's `ALLOW_FILES`. Nothing else in the tree needs one today.

### 3.11 A record's detail view — a page on desktop, a sheet on a phone

A 360 is one body with two shells. Write the body as an ordinary component that
takes an id, and give it two entry points:

- a **route** (`lazyNamed` in `app/app.tsx`, §3.7) for desktop — full width, an
  address that can be pasted into an email, and a step the back arrow can reach;
- a **`<Dialog>`** over the list for phones, opened from a URL parameter so the
  sheet is still a step rather than local state.

**The chrome is a component, not a pattern you copy.** `components/record-360.tsx`
holds `<Record360Page>` (the back link, the width, and the redirect that hands a
shared desktop link to the phone's sheet), `<Record360Header>` (the `<h1>`, the
pills, the meta line and the actions) and `<Record360Rail>` / `<Record360Card>`
(what else the record touches). The list's half — `useRecordOpener()`, which
decides what a row click does and exchanges a desktop `?focus=` for the route —
is a hook, so it lives in `lib/record-360.ts`. Only the BODY is per-record:
what a transit order shows has nothing in common with what a delivery note does.

Three worked examples, all on the same chrome:
`features/operations/file-360.tsx`, `transit-order-360.tsx` and
`delivery-note-360.tsx`. Each exports a body plus a `…360Page` and a `…360Modal`
around it — `<OperationFile360>`, `<OperationFile360Page>` and
`<OperationFile360Modal>` are the naming — and neither shell adds content the
other lacks.

Four rules make it hold together:

1. **Branch in JavaScript, with `useIsDesktop()` — not in CSS.** `hidden lg:block`
   is right when both branches are cheap markup and wrong here: it would mount
   the content twice, put a live focus trap in a phone's accessibility tree and
   give a screen reader two of every heading. `lib/use-media-query.ts` opens with
   this reasoning. It answers `true` before `matchMedia` resolves, so the first
   frame is the desktop branch.

   **A CSS wrapper does not hide a PORTAL, which is how this rule gets broken.**
   `<div className="xl:hidden"><Dialog … /></div>` reads like a media query and
   is not one: Radix renders the dialog into `<body>`, so the wrapper never
   becomes an ancestor of anything the user sees and `display: none` on it hides
   nothing. The Tasks board shipped exactly that — the phone sheet opened over
   the board at every width, on top of the detail pane it was supposed to
   replace, and no test in the tree could have caught it because the two were
   never rendered together on purpose. Anything portalled — every `<Dialog>`,
   every Radix surface — branches on a media query in JavaScript
   (`useIsWide()` / `useIsDesktop()`), never on a class on a wrapper.
2. **The body renders from the RESPONSE, never from a row the caller passed in.**
   A modal opened from a list has the row in hand; a page opened from a pasted
   link has a uuid and nothing else. If the detail endpoint returns ids only, add
   the display fields to it — otherwise the two shells drift and the page is the
   one that breaks.
3. **Put the active tab in `useUrlTab()`.** The point of the route is that a
   colleague can be sent to one tab of one record. A `useState` tab passes every
   click-driven test and fails the only thing the route was for.
4. **The headline KPI band is `<KpiRow stack>`.** Two lines per tile — the
   figure, then what it is. A record's figures are money at full precision
   ("30,000,000.00 XAF"), five or six to a row, and the one-line layout spends
   the tile's width on the number and then truncates the word naming it: the
   reader is left with "30,000,000.0… Credit ava…". Set `stack` on the ROW, not
   on each tile, so a strip cannot end up half-stacked. List screens stay
   inline — there the strip is chrome above a table and the values are short
   counts.

   **Below `md` the band is a two-up grid of cards and every tile is two-line,
   whatever `stack` says** — §3.16. There is no basis on a compact tile at all,
   and that is deliberate: the tile used to carry `basis-[13rem]`, which is a
   main-size property, so in the row's phone-time `flex-col` it became a 208px
   HEIGHT and a five-tile strip measured ~1100px on a 780px screen.

Both entry points must land: whatever already deep-links to the list with
`?focus=<id>` keeps working, so exchange that parameter for the route on desktop
rather than leaving old links pointing at a list that has to find the row again.
`useRecordOpener()` does this for you.

**A record that grows a route usually wants its file split too.** Once the detail
view is a 360, the list needs it and it needs the form — and one file importing
another both ways is a cycle. The operations screens are `<list>.tsx`,
`<record>-form.tsx` and `<record>-360.tsx`, one job each.

---

### 3.16 A 360 on a phone — three rules

A dossier is the densest screen in the product: a headline band, a dozen
sections, and tables of child records under each one. At 1440px that reads
well. At 390px the same markup produced three separate defects, all of them
"correct at desktop, unusable in the hand", and all of them fixed by a shared
primitive rather than by a screen's own CSS.

**1. The KPI band is a two-up grid, not a column of cards.** `<KpiRow>`
switches to `grid-cols-2` below `md`; each tile becomes a small card with a 3px
leading edge, and every tile is two-line whatever `stack` says, because ~150px
of usable width cannot hold a full-precision money figure and the word naming
it side by side. Do not add a `basis-*` to a compact tile — `flex-basis` is a
MAIN-SIZE property, and in a column it is a height (see §3.11 rule 4 for the
208px tile that produced).

**The accent rule, and it is the reason the band reads as data rather than as
five more buttons: on a phone the default `accent` tone is `--brand-blue`, and
orange stays the colour of ACTION.** The app spends orange on the one primary
button, the active tab and links; a band of five orange-marked figures directly
above an orange "Add document" is five things the reader thinks they can press.
The semantic tones are untouched — `ok`/`warn`/`bad` colour the edge and the
chip, because a figure that needs attention has to look like one. A tile that
drills in gets a chevron, which is the whole affordance on a device with no
hover state.

**2. The section strip is one scrollable row.** `<SectionTabs>` — a named
`<nav>`, a real `<button>` per section, `aria-current="page"` on the live one,
its count as a badge INSIDE the button (a badge that is its own control is a
20px mis-tap beside a 44px one). On a phone the strip scrolls horizontally, the
active section is centred on first paint — so `?tab=Renewals` opens with
Renewals visible rather than off the right-hand edge — and a measured fade
appears only on a side that genuinely has more. From `md` up it wraps, exactly
as it always did. Pass `sticky` when the sections under it are long: a document
list runs several screens deep and without a pinned strip the only way to
another section is back to the top.

**Never `flex-wrap` a tab strip on a phone.** Twelve sections wrapped to four
rows of buttons between the record's header and its content, and the wrap points
moved whenever a label changed.

**A section whose name does not fit gets a `shortLabel`, not a smaller font.**
A strip shows two and a half tabs at 390px, so its value is the number of
sections visible, not the completeness of each name: four two-word names joined
by ampersands spend the whole width on signpost. Give `SectionTab.shortLabel` a
shorter wording of the SAME idea — `"Identity & registrations"` → `"Identity"`,
never a different noun and never an abbreviation the reader has to decode. The
full `label` stays the `?tab=` value, the section heading, the accessible name
(`aria-label`, so it is announced as the full name at every width) and every
deep link. Omit it where the real name already fits — a short label is a fix,
not a house style.

**3. A collection of child records is a table on a desktop and cards on a
phone.** `<ResponsiveList>` takes the existing `<table>` as `children` and a
`renderItem` for the phone, and mounts **one** of them. `RecordCard` gives the
card its fixed reading order — title, pills, facts, actions — so two screens
cannot disagree about where the status goes.

**Do not implement this with `hidden md:block` / `md:hidden`.** It renders both
shells, so a screen reader on a phone announces every row action twice and a
test that queries `getByRole("button", { name: "Verify" })` finds two matches.
Same reasoning as §3.11 rule 1.

**Actions on a card: one visible, the rest behind `⋯`.** `<MoreMenu>` opens the
row's less-used actions; `<ScanCardActions>` is the document-row case of it,
where the visible control changes with the record's own state (View when there
is a file, Attach when there is not) and the menu offers Replace. A row that
needs more than two visible controls on a phone is a row whose actions have not
been ordered yet.

**`"Paste a file"` is a keyboard affordance and is hidden under
`@media (pointer: coarse)`** — not under a width breakpoint. A narrow desktop
window still has a Ctrl+V and should keep the button.

---

### 3.13 Uploads — the engine, never a bare input

**Never write `<input type="file">`.** Use the upload engine. This is enforced by
the `praxis/no-raw-upload` ESLint rule as an **error** in all three frontend
apps, so a bare file input does not merge.

Reach for these:

| Situation | Use |
| --- | --- |
| Upload starts as soon as a file is picked | `<ImageUpload profile="…" send={…}>` |
| Upload waits for Save (metadata typed after picking) | `<FilePicker>` + `<UploadList>` + `useUpload({ autoStart: false })` |
| An inline trigger — a table row, a "Replace" beside a file | `<FilePicker variant="inline" trigger={…}>` |
| A `<FileDrop>` in a form | `{...fileDropProps(upload.items[0])}` from one `useUpload()` item |
| Rendering a stored image | `<ResponsiveImage src={…} variant="thumb">` |
| Just the status line | `<UploadProgress>` |
| No upload at all — the image is embedded, not sent | `compressImage()` from `lib/image-compress` |

`public-web/` has its own copy (`components/ui/file-input.tsx`, `lib/image-compress.ts`)
because that app installs only its own dependencies in CI and cannot import from
`client/`. Keep the two in step; `src/services/image-pipeline.service.js` is the
authority for the profile table and the quality numbers.

Every one of these gives the user the same three things, and none of them is a
prop you can turn off:

1. **A preview**, from the moment the picker closes — before compression, before
   the request. You should never upload a scan and be shown only a filename.
2. **A percentage**, 0→100, with the phase named: *Optimising…*, *Uploading…*,
   then **Upload complete** — and that last state appears only once the server
   has answered, not when the last byte was sent.
3. **Compression**, before anything leaves the device.

```tsx
const upload = useUpload<{ doc_id: string }>({
  profile: "document",
  autoStart: false,               // the form's Save button calls upload.start()
  maxBytes: 25 * 1024 * 1024,
  send: (file, ctx) =>
    uploadFile("/tenant/documents", file, {
      fields: { doc_type: docType, original_name: file.name },
      onProgress: ctx.onProgress,
      signal: ctx.signal,
    }),
});

<FilePicker accept=".pdf,.png,.jpg" onPick={(f) => void upload.pick(f)} />
<UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
```

#### `profile` is required, and it is not cosmetic

It decides whether the image is tonally corrected, and the wrong choice is the
kind of bug nobody reports:

| Profile | Enhancement | Use for |
| --- | --- | --- |
| `document` | **None.** Downscale + high-quality re-encode only | Vault scans, KYC, customs declarations, invoices |
| `brand` | **None.** Colours come back byte-faithful | Tenant logos, app icons, letterhead marks |
| `photo` | Auto-level, grey-world white balance, post-resize sharpen | Site heroes, success stories, marketing imagery |
| `avatar` | As `photo`, plus a square attention crop | Profile pictures |

`document` and `brand` never touch tone, and that is a requirement rather than a
default. Auto-levelling a faint carbon-copy customs stamp pushes it to white,
and a scan that no longer matches the paper is discovered during an audit, not
in review. Stretching a logo's histogram gives a tenant back a slightly
different green on every screen — the white-label promise, broken by a
"quality" improvement.

#### Why it is a hard rule and not a preference

`FileDrop` has accepted `uploadProgress` and `uploadSuccess` props since the day
it was written. Of roughly thirty upload sites in `client/`, **two** passed
them. Nobody decided those screens should have no progress bar; the raw input
was simply closer to hand than four pieces of state and a cleanup effect. That
asymmetry is what a lint rule removes.

What the user pays when it is skipped: no preview, so picking the wrong scan is
invisible until someone downloads it months later; no percentage, so a 6 MB
photo on a corridor connection is indistinguishable from a frozen screen and
people re-click and double-upload; no compression, so the original sits in
storage and is served back at full size into a 96px table cell on every page
load, forever.

#### Delivery

The backend writes AVIF and WebP derivatives beside every master at `thumb`
(256px), `preview` (1024px) and `full` (2400px). `<ResponsiveImage>` is what
collects on that — a list of forty documents pointed at `variant="thumb"` pulls
forty files of a few KB instead of forty full-size images. The `<img>` inside
keeps the **master** as its `src`, so "Save image as" still yields the portable
JPEG/PNG rather than an AVIF the recipient's software may not open.

A derivative that does not exist yet is generated by `/media` on first request,
so this is safe to point at images uploaded long before the engine existed.
That matters because `<picture>` does **not** fall back: a `<source>` that 404s
renders a broken image rather than dropping to the `<img>`.

#### `<FileDrop>` must report progress too

`praxis/require-upload-progress` fails a `<FileDrop>` that passes neither
`fileDropProps(…)` nor an explicit `uploadProgress`. The short form is:

```tsx
const upload = useUpload({ profile: "photo", send });

<FileDrop
  {...fileDropProps(upload.items[0])}
  onPick={(f) => (f ? void upload.pick([f]) : upload.reset())}
  accept={IMAGE_ACCEPT}
  label="Cover image"
/>
```

That one spread supplies the file, the percentage, the completion state and the
error, and the site gets compression with them.

**Why this is a second rule and not part of the first.** `no-raw-upload` governs
how a file is *picked*; this one governs whether the user is told anything while
it *uploads*. The first rule passed the whole tree while fourteen `<FileDrop>`s
still showed a filename, a spinner and then a tick — `FileDrop` **is** the
sanctioned primitive, so nothing failed when a site left its progress props out.
That is exactly how the props came to be passed by 2 of 10 call sites in the
first place.

A file that rides inside a **larger request** — a CV in the applicant payload, a
scan in the create-employee call — passes `uploadProgress` explicitly from that
request's progress. That is the honest number: the file is most of the request's
weight, and there is no separate upload to measure.

#### Progress without changing transport

`tenantWithProgress()` and `publicApi`'s XHR path report real upload progress for
a **JSON body**, not just multipart. So a site that posts a base64 data URL still
drives a genuine 0→100% bar — converting an endpoint to multipart is a byte
saving, not a prerequisite for the percentage.

The escape hatch is `eslint-disable-next-line praxis/no-raw-upload` with a
written reason beside it. The engine's own primitives are exempt by path;
nothing else in the tree needs one, and there is no baseline allow-list — every
upload site in all three apps is on the engine.

---

### 3.14 Master-detail — the open record has to be visible

**Rows are `<IndexRow>`; the `<SplitPane>` takes `activeKind` and `active`. Both,
on every list-with-360 screen.**

```tsx
<SplitPane
  storageKey="master.service-types"
  label="Service type list width"
  activeKind={tr("Service type")}   // the KIND, already translated
  active={!!selected}
>
  <div className="space-y-2">
    {rows.map((r) => (
      <IndexRow
        key={r.service_type_id}
        selected={r.service_type_id === selId}
        onClick={() => setSelId(r.service_type_id)}
        className="flex-col gap-0.5"   // LAYOUT only
      >
        <span className="truncate font-medium">{r.name_en}</span>
        <span className="micro">{r.key}</span>
      </IndexRow>
    ))}
  </div>
  {selected ? <ServiceTypeDossier … /> : <EmptyState … />}
</SplitPane>
```

**Why it is a rule and not a preference.** Sixteen screens marked the open record with
one hand-copied string — `bg-primary/10 text-foreground` — and nothing else. **That string
compiles to no CSS at all.** `primary` is declared `DEFAULT: "var(--primary)"` in
`tailwind.config.ts`, and `--primary` is a complete `rgb(245 130 31)` rather than the bare
channels a slash-opacity utility needs, so Tailwind has nowhere to put the alpha and emits
nothing — silently, with the class still in the markup looking like it works. Verified
against the production bundle: `.bg-primary\/10` appears zero times, `.bg-primary` appears.

So the open row and the closed row rendered the **same** ground, and "which record am I
looking at?" — asked once per screen, pre-attentively, before any reading starts — had no
answer on the screen. None of the sixteen carried `aria-current` either, so it was absent
from the accessibility tree too, and a screen reader user had no way to hear which row was
open.

> **This is not local to these rows.** 334 slash-opacity utilities across the tree sit on
> the same opaque tokens and are equally dead — `bg-muted/30` (38), `bg-muted/50` (32),
> `bg-card/40` (27), `bg-accent/60` (16), `border-border/60` (15) and so on. Only the
> status and brand tones (`ok`, `warn`, `bad`, `brand-blue`, `brand-orange`) declare
> `<alpha-value>` and can take a `/NN`. **Do not reach for `/NN` on a core token** — use
> the opacity-free utility, or `color-mix` in a real stylesheet the way `.index-row-open`
> and `.st-orange` do. Repairing the config is its own change: it would alter rendering in
> 334 places at once.

**The treatment is a pair, and the pair is the point.** The row gets a solid `--accent`
ground and a 3px `--primary` rail; the detail pane gets the same rail down its leading edge
and an eyebrow naming the kind. Two rails of one colour and one width read as ONE object, so
"this row opened that pane" is seen rather than deduced. A marked row next to an unmarked
pane leaves the reader knowing which row is highlighted and still not knowing what the right
half of the screen is.

**Ground AND rail, and the rail is the half that carries it.** At 7.50:1 against the dark
ground the rail is a 35% luminance step, where no ground colour subtle enough to still read
as a *surface* can be more than a couple of percent. It is also a SHAPE, which is what the
eye resolves at a glance rather than colour, and what keeps the state legible to a reader
with a colour-vision deficiency. The ground is what makes the whole row feel selected rather
than merely ticked in the margin.

**The ground is two layers, and it has to be.** `.index-row-open` (index.css) is `--accent`
with the tenant's `--primary` at 15% over it, via `color-mix`. No SINGLE token steps clearly
from `--background` in both themes, because `--background` sits between `--card` and
`--accent` in one of them: `--accent` alone measures 1.281:1 dark but **1.021:1 light**,
flatter than the state it replaces. Layered, it is 1.619:1 dark and 1.161:1 light. It is
hand-written CSS rather than a `bg-*` utility precisely because the utility form *cannot*
express it — see the alpha note above — and `color-mix` in a stylesheet lets it track tenant
re-branding the way `.st-orange` does.

**Pass layout in `className`, nothing else.** `flex-col`, `items-center justify-between`,
a tighter `py-1.5` for a dense slot list. Ground, rail, padding and state belong to the
component; a call site that restates them is the sixteen-copy problem starting again.

**A rail that cannot be an `<IndexRow>`** — the inbox thread row carries a checkbox, a star
and an open button, so it is an `<li>` with three controls rather than one — imports
`INDEX_ROW_OPEN` from the same module and positions the rail itself. The geometry is local
(a flush bordered list wants a different rail from a rounded one); the meaning of "this is
the open one" is shared. The task board's card does the same (`task-board.tsx`): it is not a
row in an index rail, but the open card wears the same ground, the same 3px rail and
`aria-current`, so "which task is the pane showing" is answered on both halves.

**A pane that holds nothing is not reserved.** The board used to keep a permanent 22rem
column holding "Select a card to see its steps…" — a fifth of every wide screen spent on a
sentence, paid for out of the four kanban columns it squeezed. That is the `SplitPane`
pattern's one bad bargain: `<SplitPane>` always renders both halves, so an empty detail side
becomes a standing tax on the screen. Where the detail is optional rather than the default
(a board you triage without opening anything), render the second column only while a record
is open, give the body the width the rest of the time, and branch the phone's sheet in
JavaScript so the sheet cannot appear beside the pane — `features/workspace/tasks/tasks-page.tsx`.

### 3.15 The sign-in screen — the device remembers, and lets go

`features/auth/login-modal.tsx` is the front door, and it is **identity-first**: once a
device has signed somebody in, it greets them by name and opens on the fastest route *that
device* can actually complete. Three device-bound stores decide what that is — none of them
is session state, and all three survive sign-out on purpose:

| Store | Answers |
| --- | --- |
| `lastSessionStore` | whose account this device belongs to. Turns the screen into a greeting and removes the email field entirely. |
| `pinStore` | this browser holds a Quick PIN for that account. |
| `passkeyDeviceStore` | this browser holds a passkey for that account. |

Priority is **PIN → passkey → password**. The PIN leads when it exists because it is four
taps and the passkey ceremony needs a tap to start at all; the orb sits above the boxes so
the choice is visible; the password is a fallback link rather than an empty field competing
with both, and it is the whole door when neither exists. A route is offered **only** when the
device can complete it — a PIN that exists for the account on some *other* machine must not
put boxes on this screen. That is exactly why the passkey record is local: the server will
happily list a credential that this browser's authenticator cannot answer.

**WebAuthn cannot auto-prompt.** `navigator.credentials.get()` is refused outside a user
gesture, so "defaults to the passkey" can only ever mean *the ceremony is the most prominent
thing on the card and exactly one tap away*. Never write an effect that calls it on mount.

**The email field is absent, not read-only, while the device knows you.** That is what
retired the old refill defect — a sync effect that could not tell "the user just deleted the
last character" from "the prefill has not happened yet", and so re-filled the address the
user was clearing. Changing account is `Not you? Switch account`, which clears
`lastSessionStore` and hands over an empty, focused field.

**Sign-out asks, because the answer differs by machine.** `<SignOutDialog>` offers a plain
sign-out (keeps the identity; tomorrow's sign-in is fast) and "Sign out and remove this
account" (clears the greeting, the PIN record and the passkey record). The removal is
`forgetDeviceAccount()` in `lib/device-account.ts`, which owns that set so a refactor cannot
drop one — a PIN left behind still opens the account from the sign-in screen's PIN tab, and
nothing on screen would say so. Order matters: call it **after** `logout()`, which restores
its own snapshot of the device keys as it wipes `localStorage`.

`features/auth/login-modal.email.test.tsx` and `login-modal.identity.test.tsx` are the
contracts for all of the above.

## 4. Accessibility — the floor, not the aspiration

WCAG 2.1 AA is the minimum. `eslint-plugin-jsx-a11y` runs on every build and the primitives
are axe-tested. What that leaves to you:

- **Every control needs a name.** Inside a `<Field>` you get it free. Outside one — an
  icon-only button, a bare `<Segmented>` — pass `aria-label` / `label`.
- **Anything clickable must be a `<button>` or `<a>`.** An `onClick` on a `<div>` is not
  keyboard operable. The audit found 23 of these.
- **Four states, always:** loading, empty, error, populated. `<ListPage>` and `<DataList>`
  enforce it; a hand-built block must do it by hand.
- **Announce async results.** `useToast()` for success/failure; `<ErrorState>` carries
  `role="alert"`.
- **Distinguish "offline" from "refused".** A dead connection and a 403 are not the same
  failure and must not read the same. `<ScreenError>` dispatches on the live connection
  state, so passing it the string you already had is the whole migration. Never send a
  user to fix their wifi over our 500 — a server that answered proves the network works.
- **Never offer a reload as the way out of an error.** In this app a reload discards every
  unsaved form on the screen, which is exactly the loss the user is trying to avoid. Offer
  a retry that re-runs the fetch instead.
- **One `<h1>` per screen** — `PageHeader` renders it. Cards/panels default to `<h2>`.
  Don't skip levels.
- **Test both themes.** If you only used tokens, dark mode already works. Check it anyway.

---

## 5. Human-readable data (never surface raw machine values)

Anything a person reads must be formatted for a person. Helpers live in `lib/format.ts`.

- **Dates** — never raw ISO, and never month-first. `dateFmt` → "21 Jul 2026", `dateTimeFmt`
  → "21 Jul 2026, 23:00", `dateDmy` → "21/07/2026" for a strict numeric date. Never call
  `toLocaleDateString()` without a locale: it renders month-first on a US workstation, and
  `check:dates` fails the build on it (§3.12).
- **Money** — `money(v, ccy)` (suffixed) · `amount(v)` (2dp, no suffix, header carries the
  currency) · `money0(v)` (0dp) · `num(v)`. Always with the `.num` tabular class.
- **Foreign-key IDs → names** — never a bare UUID in a column. Build an id→name map
  (`nameMap` in `features/operations/pages.tsx`) and render the label. With Query, the lookup
  list is cached and shared, so this is cheap now.
- **Enums** — `enumLabel`, or a `<StatusPill>`. Never `SCREAMING_SNAKE` on screen.
- **Event & entity refs** — `humanizeEvent`, `humanizeRef`.
- **Unknown / dynamic payloads** — `<DataView>`, which also humanises inferred column headers
  via `fieldLabel` ("total_ttc" → "Total TTC"). Raw JSON in the UI is a defect (A4); it was
  shipping on the **external client portal**.
- **`smartCell`** is the generic cell for dynamic tables; `cell()` delegates to it.

Rule of thumb: if a value is a UUID, an ISO timestamp, a dotted event key or a SCREAMING_ENUM,
it needs a formatter before it reaches the DOM.

### 5.1 Product vocabulary — the English UI does not say "dossier"

The column is `dossier`, the event is `dossier.created`, the id is `dossier_id`,
and none of that moves. But the thing a tenant reads about is an **operations
file**, and two tenants have now said the English word "dossier" reads wrong to
them. So:

| Where | English | French |
| --- | --- | --- |
| Naming the thing | Operations file / Operations files | Dossier d'opérations |
| Running prose, and any column narrow enough to need it | file / File | dossier / Dossier |
| Its reference | File reference | Référence du dossier |

French keeps "dossier" throughout, because it is the correct French word for
exactly this and it is what a Douala ops desk says out loud. The pairing lives in
`lib/i18n-dict.ts` (`"File": "Dossier"`, `"Operations file": "Dossier d'opérations"`),
so `tr()` resolves it and no screen has to know.

This is a rule about **strings a person reads** — labels, descriptions, hints,
empty states, `aria-label`s, toasts, AI action copy, and any message the API
sends back for display. It is not a rule about identifiers: renaming a variable,
a file, an endpoint or a database column buys nothing and breaks things.

The same applies to the other 360s: a lead's or a client's record is a **record**
in English (`"The record": "Le dossier"`), not a dossier.

---

## 6. Conventions checklist (before PR)

- [ ] Screen uses `<PageContainer>` (or `<ListPage>`) with a deliberate width — no `mx-auto max-w-*`.
- [ ] Desktop layout uses `lg:`/`xl:`/`2xl:`, not a frozen `sm:` grid.
- [ ] Only tokens for colour — no raw palette classes (`text-emerald-600`, `bg-sky-500`, …).
- [ ] Accent **text** uses `text-primary-ink`, never `text-primary`.
- [ ] Light **and** dark both check out.
- [ ] All four states present: loading, empty (**with an action**), error, populated.
- [ ] Forms use `<Field>`; validation comes from a `@shared` schema, not a local boolean.
- [ ] `error` from `useList`/`useResource` is rendered directly — **not** re-wrapped in `errMsg()`.
- [ ] `403` renders a permission message, not a blank screen.
- [ ] No raw UUIDs, ISO dates, dotted event keys or SCREAMING_ENUMs on screen (§5).
- [ ] No raw `<table>` / `<input>` / `<textarea>` / `role="menu"` — use the primitives (§3.5).
- [ ] No `window.confirm` / `alert` / `prompt` — `useConfirm()`, `usePrompt()`, `<Callout>` or `useToast()` (§3.10).
- [ ] No `<Input type="date">` or `type="datetime-local"` — `<DateField>` / `<DateTimeField>`; no locale-less `toLocaleDateString()`; no ISO date on a document or export (§3.12).
- [ ] New shared component? Add a story, a usage example, a best-practices note and a test.
- [ ] Row actions go in `<RowActions>` — that is what keeps the row at its density height (§7.1).
- [ ] `npm run lint`, `npm test`, `npm run check:contrast`, `npm run check:motion`, `npm run check:palette`, `npm run check:docs`, `npm run check:schemas`, `npm run build`, `npm run check:bundle`, `npm run check:shared` and `npm run test:e2e` all pass in `client/`, and `npm run check:dates` at the repo root.
- [ ] Screen registered in `app.tsx` via `lazyNamed(...)`; **no** new `manualChunks` bucket (§3.7).
- [ ] RBAC action is **`edit`**, not `update` (matches the backend).
- [ ] Route added in `app.tsx`; **`screen-registry.json` updated in the same commit** — the ribbon
      filters on `module_key`, so an unregistered route is visible to everyone (§3.1, §3.8).
- [ ] A new hub section is added to `areas.ts` and the hub builds its tabs with `hubTabs()` (§3.8).

---

## 7. Density and desktop interaction (Phase 5)

### 7.1 Row density is a user preference

Three levels, chosen by the user in the account menu, stored per browser:

| Level       | Cell padding | Row  |
| ----------- | ------------ | ---- |
| Compact     | 4px          | 28px |
| Default     | 6px          | 32px |
| Comfortable | 10px         | 40px |

It is plumbed as **one CSS variable set by an attribute on `<html>`** (`data-density` →
`--row-py`), which `tailwind.config.ts` maps to the `row` spacing step. So every `py-row` in
the app follows the preference with no code change and no re-render. `<Table density="…">`
pins a level for one table; use it only where the screen genuinely knows better than the user
(a trial balance, the permission matrix), because a screen that overrides the preference has
taken the choice away.

**The thing that actually sets a row's height is its tallest cell, not its padding.** This is
worth stating because it cost two phases: F17 diagnosed 46px rows as a padding problem, Phase 1
changed the padding, and a real list row stayed at 49px — because every list screen ends with
`<Button size="sm">` in the actions column and `size="sm"` is `h-9`, 36px. Two rules follow:

- **Put row actions in `<RowActions>`.** That is where the 20px `--row-control-h` bound is
  applied. A hand-rolled `<div className="flex justify-end">` wrapper skips it and the row
  goes back to 48px.
- **Nothing in a row may exceed 20px.** `.status` sets its own 16px line box for this reason.
  The browser gate asserts it (`e2e/desktop-layout.spec.ts`), because jsdom has no layout
  engine and no unit test can.

### 7.2 Wide tables

Opt-in on `<DataList>` / `<ListPage>`, because each costs something:

- **`sticky`** — headings stay while the body scrolls. Bounds the table's height, which
  removes it from the page's scroll flow. Wrong for a six-row summary.
- **`freezeFirstColumn`** — column 0 stays while you scroll right. Column 0 is the record's
  identity on every list screen here (it is also what `RowActivator` turns into the row's
  keyboard control), so this is what keeps a fifteen-column costing table readable.
- **`useColumnVisibility(key, columns)` + `<ColumnsMenu>`** — persists the **hidden** set, per
  screen. Storing the visible set instead would hide tomorrow's new column from everyone who
  ever opened the menu. Column 0 and the actions column cannot be hidden.
- **`useRowSelection(rows, rowKey)` + `<BulkBar>`** — shift-click ranges, and a selection whose
  scope is **pruned to the rows currently on screen**. Tick eight invoices, filter to three,
  and the bulk action affects three. Read `selectedRows`, never the raw keys; that is what
  makes the property hold.

`chart-of-accounts.tsx` uses all four and is the screen to copy.

### 7.3 Keyboard and pointer parity

- **Rows are keyboard-navigable.** `DataList` runs a roving tabindex when `onRowClick` is set:
  one tab stop for the table, arrow keys between rows, Home/End to the ends. It does **not**
  declare `role="grid"` — that would cost row/column position and header association in a
  screen reader's browse mode, which on a 200-row financial table _is_ the usability.
- **`<InlineEdit>` is for descriptive master data only.** Never a field on a posted document.
  This ledger's rule is reversal-not-edit: a validated journal entry, a locked FINAL invoice
  and a posted payroll run are immutable by design, and a pencil on any of them offers
  something the backend will refuse — or succeeds and breaks the audit chain.
- **`<SplitPane>` for master-detail.** A real `role="separator"` with arrow keys, Home/End and
  Enter-to-collapse. Two drag handles in this app had to be retro-fitted for the keyboard after
  shipping; do not build a third that needs it.
- **A master-detail screen must SAY what is open.** `<IndexRow>` on the rows and
  `activeKind` on the `<SplitPane>`, together — see §3.14. One without the other is half a
  signal: a marked row beside an anonymous pane, or a labelled pane beside a list where every
  row looks the same.
- **The FAB is touch-only.** `<FloatingActions>` is `md:hidden`; on desktop the same list
  renders in `<IconRail>`'s tail. A fixed bottom-right cluster covers the last rows and
  the pager of every list screen, and making it draggable was the workaround, not the fix.
  Both surfaces read `useQuickActions()` so they cannot drift.
- **A drag on a phone is a HOLD, and it may not take the scroll.** A touch screen has one
  thumb, and on a kanban board the board itself is what that thumb scrolls — so a card
  cannot claim the gesture at `touchstart`. `touch-action: none` on the card (the usual way
  to make a drag "reliable") hands the whole column's scrolling to whichever card the thumb
  lands on. The board instead runs THREE sensors side by side (`task-board.tsx`): the mouse
  drags the grip at 8px, the finger picks a card up by holding it for `LONG_PRESS_MS`
  anywhere on the card, the keyboard takes the grip with Space. The dwell is the grace
  period — a finger that moves past `tolerance` before it elapses was scrolling, and the
  pending drag is abandoned rather than fought for — and it is also what keeps a TAP a tap,
  so opening a card and dragging a card are never the same event. Two corollaries: a
  `MouseSensor` and NOT a `PointerSensor` (a finger fires `pointerdown` too, so a
  pointer-driven 8px constraint reads the first eight pixels of a flick as a drag), and the
  drag handle and the click target stay separate elements, because the pointerup that ends a
  mouse drag has to land somewhere whose only listener is dnd-kit's. Covered end to end by
  `features/workspace/tasks/task-board.test.tsx` — real `TouchEvent`s, real sensors, the
  request asserted — including the flick that must scroll and the two-finger touch that
  must do nothing.
- **Nothing quick-action-shaped goes in the title bar.** It held a burst-icon menu once; the
  glyph named nothing in a strip where every other control says what it is, and it put
  Messages in the header while the rail already carried Messages — one destination with two
  chrome homes and an unread count duplicated between them. The count lives on the rail's
  Messages cell now (`badge` on its rail button). The title bar is search, clock,
  environment, language, theme, **`<NotificationBell>`** and account — and the bell renders
  at **every** width, phone included, because below `sm` nothing else reaches notifications.

### 7.4 Motion budget

**250ms for anything in the app**, enforced by `npm run check:motion`. Entrances are 120ms.
The pre-auth `landing-*` / `login-*` surfaces and the Control Tower's lane dashes are exempt by
selector, each with a written reason in the script — add an exemption there if a surface
genuinely is the exception; do not raise the budget.

`prefers-reduced-motion` is honoured globally in `index.css` and the gate asserts that rule is
still present and still covers `animation`, `transition` and pseudo-elements. SMIL is the one
thing that rule cannot reach: use `usePrefersReducedMotion()` for `<animateMotion>`.

### 7.5 Starting a screen

```sh
npm run new:screen -- --area finance --name "Bank charges"
```

Emits a screen on `<ListPage>` with all four states, both empty states, a form stub and the
per-screen checklist as comments, then prints the route and the axe-register entry to paste.
It deliberately does not edit `app.tsx` or `screens.axe.test.tsx` — the paste is where you
notice a fixture path is wrong, which `PHASE4_CHECKLIST.md` §5 records as the mistake that was
made seven times, three of them silently.

The scaffold is itself tested (`src/test/new-screen.test.ts`): it is generated, typechecked and
linted on every run, so a renamed prop breaks it in the same commit rather than in a new
engineer's first hour.

---

## 8. The assistant surfaces (Praxis AI)

Two surfaces, one conversation. Both live under `src/components/ai/` (the shared parts) with the
page in `src/features/ai/`.

| Surface       | Where                                                                              | Entry point                                                                                         |
| ------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Drawer**    | `components/praxis-drawer.tsx` — mounted once in the app shell, rides every screen | `window.dispatchEvent(new CustomEvent("praxis:open-copilot"))`, optionally `{ detail: { prompt } }` |
| **Workspace** | `features/ai/workspace.tsx` at `/ai` — three panes, outer two collapsible          | Overview in the ribbon, or the drawer's middle header button                                        |

**The rules that keep them one product, not two.**

- **Shared state.** `useAiThread(start)` (`components/ai/thread.ts`) owns send, retry, confirm and
  restore for both. Never re-implement a send in a surface.
- **Shared composer and turn.** `<AiComposer>` (`size="hero" | "compact"`) and `<AiTurnView>`. A
  control that belongs to a conversation goes in `components/ai/`, not in a surface.
- **The drawer starts fresh, the page restores.** `useAiThread("fresh")` vs `("restore", id)`. A
  panel flicked open over a screen and a page navigated to on purpose are different intentions —
  which is also why history browsing exists only on the page.
- **Scopes and Spaces are one list.** `useAiScopes()` derives from `buildRibbon`, so the composer's
  scope chip and the workspace's Spaces rail cannot disagree, and neither offers an area the user
  cannot see.
- **Grounding is derived, not awaited.** `components/ai/grounding.ts` turns the internal links a
  grounded answer already writes into source chips, lifts a markdown table into a real `<Table>`,
  and decides when an answer belongs on the canvas. `AskResult.sources` / `.trace` upgrade it in
  place when the backend sends them; nothing regresses while it does not.

### 8.1 A list row that carries actions — the overflow-menu pattern

The workspace's history rail (`features/ai/history-rail.tsx`) is the reference implementation, and
the pattern generalises to any scrolling list whose rows are openable **and** manageable: a
conversation, a saved view, a draft. Four rules, each of which was a real defect somewhere before
it was a rule.

**1. Two sibling buttons in a layout `<div>`, never a menu nested in the row's button.** A `<button>`
inside a `<button>` is invalid markup, and the browsers that tolerate it pick a click target
themselves. The row's open control and the `<DropdownMenu>` trigger are siblings; the wrapping div
carries layout and no handler, so — unlike `<RowActions>` in a clickable table row — it needs no
a11y suppression.

```tsx
<div className="group relative flex items-center rounded-md">
  <button type="button" onClick={() => onOpen(row.id)} className="min-w-0 flex-1 …">
    {row.title}
  </button>
  <DropdownMenu
    align="end"
    trigger={
      <button
        type="button"
        aria-label={`Actions for ${row.title}`}
        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
      >
        <KebabIcon width={14} height={14} />
      </button>
    }
  >
    <DropdownItem onSelect={() => pin(row)}>Pin to top</DropdownItem>
    <DropdownItem onSelect={() => rename(row)}>Rename</DropdownItem>
    <DropdownSeparator />
    <DropdownItem destructive onSelect={() => remove(row)}>Delete</DropdownItem>
  </DropdownMenu>
</div>
```

**2. Quiet, not absent.** The trigger is transparent until the row is hovered, the trigger is
focused, or its menu is open — `group-hover` / `group-focus-within` / `data-[state=open]`. Rendering
it only on hover removes it for the keyboard and the screen reader; this keeps one piece of markup
that is calm for the pointer and reachable without one. Name it per row
(`aria-label={`Actions for ${title}`}`), or a screen-reader user hears thirty identical "Actions".

**3. The destructive item is last, after a `<DropdownSeparator>`, and it opens `useConfirm()`.** Never
`window.confirm` — §3.10. Where a delete has an irreversible tier, the tier is a `<Checkbox>` inside
the confirm's `body`, defaulting to off, and it must be its **own component with its own state**:
`useConfirm` captures `body` as a node when the dialog opens, so a checkbox controlled by the caller's
state never re-renders and reads as permanently unticked.

**4. A row mutation is not optimistic, and a failure says so.** Hold the row while the call is in
flight, patch it from the row the server answers with, and `toast.error()` on rejection. These are
the one class of action where silence looks exactly like success — the menu closes either way — and
the ones that matter (archive, delete) are the ones the user most needs to be true. Rejecting
silently also leaves an unhandled promise, since nothing above the menu awaits it.

**Adding to it.** A new starter set for an area is one entry in `AREA_STARTERS`
(`components/ai/context.tsx`), keyed on the screen registry's `area` — no component changes. A new
right-pane view is a tab in `features/ai/right-pane.tsx`; it must disable rather than hide when
empty, so the strip stays learnable.

**The AI gate still governs everything.** `useAiEnabled()` — with the tenant flag off, neither
surface renders and `/ai` redirects home. See `doc/AI_GATE_BE_HANDOFF.md`.

---

## 9. Related docs

`doc/DESKTOP_UI_AUDIT.md` is the frontend assessment and roadmap (Phases 0–5) and the reference
for every `F<n>` / `A<n>` finding cited here; its addenda are the record of what each phase found
by changing the code rather than by reading it. `doc/PHASE4_CHECKLIST.md` and
`doc/PHASE5_CHECKLIST.md` are the per-phase status.

Every other frontend doc is **superseded** — see the table at the top. Where one disagrees with
this file, this file wins.

---
