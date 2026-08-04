# Praxis LS — Frontend Design & Layout Rules

_Source of truth: `client/src/index.css` + `client/src/components/*` and `client/tailwind.config.ts`.
This doc summarises them so a new screen looks like the rest without reverse-engineering CSS.
**If this doc and the code ever disagree, the code wins — and the doc is a bug.**_

> **Why that last sentence is in bold.** The previous version of this file told
> every new engineer that the default list screen was `<ResourceList>` and that
> write-capable lists used `<CrudResource>`. `crud-resource.tsx` never existed.
> `resource-list.tsx` existed with **zero call sites**. That is finding **F5** in
> `doc/DESKTOP_UI_AUDIT.md`, and the audit names it the *root cause* of most
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
   tinted with it re-colours per tenant. As *type* it measures **2.59:1** and fails WCAG AA,
   so text uses **`--primary-ink`** (`text-primary-ink`), which is derived per tenant to clear
   4.5:1 in both themes.

---

## 1. Design tokens

Defined on `:root`, re-tuned under `.dark`. Phase 1 retuned every failing pair; the values
below are current.

**Surfaces / text**

| Token | Light | Purpose |
|---|---|---|
| `--background` | `rgb(243 246 251)` | App backdrop |
| `--foreground` | `rgb(16 30 52)` | Primary text |
| `--card` / `--popover` | `rgb(255 255 255)` | Panel / dropdown surface |
| `--muted` / `--secondary` | `rgb(247 250 253)` | Subtle fills |
| `--muted-foreground` | `rgb(78 98 128)` | Secondary text (6.21:1) |
| `--accent` | `rgb(239 244 250)` | Hover / selected fill |
| `--border` | `rgb(16 30 52 / 0.09)` | Hairline borders |
| `--input` | `rgb(16 30 52 / 0.12)` | Field borders |
| `--ink-3` | `rgb(90 108 133)` | `.micro` label text (5.36:1) |

**Accent (tenant-overridable at runtime)**

| Token | Value | Purpose |
|---|---|---|
| `--primary` | `rgb(245 130 31)` | Brand accent — **fills only** |
| `--primary-ink` | `rgb(190 86 14)` light / `rgb(250 158 78)` dark | Brand accent **as text** (4.64:1) |
| `--primary-foreground` | `rgb(255 255 255)` | Text *on* primary |
| `--ring` | `rgb(245 130 31)` | Focus ring |
| `--destructive` | `rgb(210 68 58)` | Danger |

**Status.** Used as *text* (pills, ledger figures), so tuned to clear 4.5:1 on `--card`
rather than to look vivid on a swatch:
`--ok 28 132 82` (4.70:1), `--warn 146 104 12` (4.99:1), `--bad 210 68 58` (4.54:1).
The `--ok-fill` / `--warn-fill` / `--bad-fill` variants keep the original saturation for
**backgrounds and chart marks** — use those for grounds, never for type.

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

| Class | Use |
|---|---|
| `.lux-card` | Legacy panel surface. **New code uses `<Card>` / `<Panel>`.** |
| `.micro` | 11px uppercase tracked label (eyebrows, table captions). |
| `.num` | Tabular figures for money/quantities — aligns columns. |
| `.status` + `.st-*` | Status pill. Use the **`<Pill>` / `<StatusPill>`** primitive rather than the classes. Variants: `st-ok`, `st-warn`, `st-bad`, `st-blue`, `st-orange`, `st-info`, `st-mute`. |
| `.chip` (+ `.on`) | Filter token. Use the **`<Chips>`** primitive. |
| `.lux-navlink` (+ `.active`) | Top-bar nav item. Nav only. |
| `.lux-mark` | Brand glyph tile. |

**Pre-auth only:** `landing-*` and `login-*` carry their own dark surface and deliberately
keep their entrance motion. Not for in-app screens.

---

## 3. Building a screen — the real on-ramp

### 3.1 Where things live

Screens are components under `client/src/features/<area>/`, exported, routed in
`client/src/app/app.tsx`, and listed in the `NAV` array in `client/src/app/layout/app-shell.tsx`.
Register in `client/src/app/screen-registry.json` only once the page and its actions are real.
Unbuilt screens route to `<Planned/>` (`features/scaffold/screen-scaffold.tsx`).

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

type Invoice = { invoice_id: string; doc_number: string; status: string; total_ttc: number; due_on: string };

export function InvoicesPage() {
  const { rows, error, loading, reload } = useList<Invoice>("/final-invoices");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const shown = React.useMemo(
    () => (rows ?? []).filter((r) => r.doc_number.toLowerCase().includes(q.trim().toLowerCase())),
    [rows, q],
  );

  const columns: Column<Invoice>[] = [
    { key: "doc_number", label: "Invoice", className: "num font-medium" },
    { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "total_ttc", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.total_ttc) },
    { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
  ];

  return (
    <ListPage
      title="Invoices"
      description="Every money event posts to the ledger."
      action={<Button onClick={() => setOpen(true)}>New invoice</Button>}
      toolbar={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices…" className="max-w-xs" />}
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
        action: <Button variant="outline" onClick={() => setQ("")}>Clear search</Button>,
      }}
    >
      <InvoiceForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
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

| Need | Use | Notes |
|---|---|---|
| Page shell | `<PageContainer>` | `wide` (1664) · `standard` (1280) · `reading` (768) · `full`. Never write `mx-auto max-w-*`. |
| List screen | `<ListPage>` | §3.2. |
| Table | `Table, THead, TBody, TR, TH, TD` | `components/ui/table.tsx` |
| Surface | `<Card>` / `<Panel>` | `Panel` = titled card. Never nest cards. |
| Modal | `<Dialog>` | Has the focus trap + restore the old `Modal` lacked. `Modal` is now an alias of it. |
| Confirm | `<ConfirmDialog>` | Name the object and the action, not "Yes/No". |
| Form field | `<Field>` | Supplies the label association and `aria-required` / `aria-invalid`. |
| Text input | `<Input>` / `<Textarea>` | |
| Choose one | `<NativeSelect>` (default) · `<Select>` (rich options) · `<SearchSelect>` (server-backed) | |
| Toggle | `<Checkbox>` / `<RadioGroup>` | |
| View switch | `<Segmented>` (2–5 fixed) · `<Chips>` (wrapping filters) | |
| Tabs | `<Tabs>` / `<TabList>` | Real `tablist`/`tab` semantics + arrow keys. |
| Menu | `<DropdownMenu>` (actions) · `<Popover>` (content) | A panel with its own buttons is a Popover, not a menu. |
| Status | `<Pill>` / `<StatusPill>` | `StatusPill` picks its tone from the value. |
| Figures | `<Stat>` (tile) · `<KpiRow>`+`<KpiTile>` (strip) | |
| States | `<EmptyState>` (with `action`) · `<ErrorState>` · `<LoadingRow>` · `<SkeletonTable>` | |
| Feedback | `useToast()` | `success` / `error` / `info`. |
| Paging | `<Pagination>` | |
| Crash safety | `<ErrorBoundary>` | Already at the app root and per route; add around risky widgets. |
| Unknown payload | `<DataView>` | Never `<pre>{JSON.stringify(…)}</pre>` in the UI. |

**See them all:** `npm run workbench` in `client/` opens the Ladle workbench —
every primitive, every state, light and dark, with an a11y panel.
Stories: `src/components/ui/primitives.stories.tsx`.

### 3.6 Layout

The app shell wraps content in `<main>` with responsive padding, so screens **don't** add outer
padding or page chrome. One `<PageContainer>` per screen, at the top; nesting them is a bug.
Don't add `max-w-*` inside one — if a section must be narrower, constrain the section.

---

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
- **One `<h1>` per screen** — `PageHeader` renders it. Cards/panels default to `<h2>`.
  Don't skip levels.
- **Test both themes.** If you only used tokens, dark mode already works. Check it anyway.

---

## 5. Human-readable data (never surface raw machine values)

Anything a person reads must be formatted for a person. Helpers live in `lib/format.ts`.

- **Dates** — never raw ISO. `dateFmt` → "21 Jul 2026", `dateTimeFmt` → "21 Jul 2026, 23:00".
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
- [ ] New shared component? Add a story, a usage example, a best-practices note and a test.
- [ ] `npm run lint`, `npm test`, `npm run check:contrast` and `npm run build` all pass in `client/`.
- [ ] RBAC action is **`edit`**, not `update` (matches the backend).
- [ ] Route added in `app.tsx` + `NAV`; `screen-registry.json` updated only when the page is real.

---

## 7. Related docs

`doc/DESKTOP_UI_AUDIT.md` is the current frontend assessment and roadmap (Phases 0–5) and the
reference for every `F<n>` / `A<n>` finding cited above. Where an older frontend doc
(`FE_IA_HANDOFF`, `FE_IA_BUILD_MAP`, `FE_WIRING_PLAN`, `FRONTEND_PLAN`, `LOVABLE_FIDELITY_PLAN`,
`UI_DEPTH_OVERHAUL_PLAN`) disagrees with this file, **this file wins** — those predate the audit
and are kept for history. Consolidating them into one guide is a Phase 5 item.
