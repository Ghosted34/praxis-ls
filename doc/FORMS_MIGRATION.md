# Forms → `<Form>` + shared Zod schemas: the pattern, and the count

**The item Phases 3, 4 and 5 each deferred.** `PHASE5_CHECKLIST.md` §5.1 states why: *"moving the rest is per-module work with a backend counterpart."* This file is that work's pattern and its tracked count, so partial completion is visible rather than assumed.

**Status: pattern established and gated. 3 of 99 validators migrated.**

---

## 1. Why this is not a mechanical sweep

F12 says the client "re-implements validation as ad-hoc booleans". That is true, and it undersells the problem. The booleans were not merely duplicates — **they were wrong**, and the first module through proved it three times:

| The form said | The server said | Because |
|---|---|---|
| "Balanced", Post enabled | `LINE_ONE_SIDE` | `debit > 0 \|\| credit > 0` accepts a line with **both** sides filled; the ledger requires exactly one (KB §23.2) |
| valid | `INVALID_AMOUNT` | nothing checked the two-decimal limit, so `33.333` went to the server |
| valid | `COMPENSATION` | nothing checked §23.6 — an account debited *and* credited in one entry |

A form that asserts an entry is postable and is then refused is worse than one that says nothing: it teaches the operator not to trust it. That is the payoff of each migration, and it is why they cannot be batched blindly.

---

## 2. The pattern

### 2.1 Decide what is SHAPE and what is a RULE

This is the judgement call, and getting it wrong is expensive.

**Shape → `packages/shared/schemas/<domain>.js`.** Types, formats, required-ness, enums, cross-field requirements the API expresses as a `.refine()`. The Express validator becomes a thin adapter.

**Domain invariants → `packages/shared/rules/<domain>.js`, as pure functions.** The test: *does the API give this its own error code?* Journal balancing has six — `ENTRY_UNBALANCED`, `LINE_ONE_SIDE`, `LINE_NO_ACCOUNT`, `ENTRY_TOO_FEW_LINES`, `INVALID_AMOUNT`, `COMPENSATION`. Four test files assert them and the AI tool surface branches on them. A `.refine()` would collapse all six into one `VALIDATION_ERROR`.

Rules return `{ ok: false, code, message, line? }` rather than throwing, so the API can map them to `AppError` and a form can render them on every keystroke without a try/catch.

### 2.2 Move the schema, keep the messages honest

Lift the rules verbatim in meaning. **Change the messages** — Zod's defaults ("Invalid uuid") were acceptable when they were flattened into one banner; they now render under a field where an operator reads them.

Prefer the `common` primitives (`uuid`, `isoDate`, `requiredText`, `amount`, `currency`). `isoDate` round-trips the parse, which is why `2026-02-31` is now rejected instead of rolling over to 3 March and posting to the wrong period.

### 2.3 Make the validator an adapter

```js
const { AppError } = require("../../../utils/errors");
const { journalEntry: schemas } = require("@praxis/shared");

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
```

`check:schemas` fails the build if a migrated validator declares a `z.object` again.

### 2.4 Declare the types

`packages/shared/index.d.ts` is hand-written and precise on purpose. `ZodTypeAny` compiles and erases every field into `any` — the package would typecheck while proving nothing. Two shapes you will need:

- **`Blankable<T>`** — `""` in, `undefined` out. A form sends `""` for an untouched input; the original schemas wrote `.optional().or(z.literal(""))`, which **stores** the empty string, so `email` lands as `''` and `WHERE email IS NULL` misses it.
- **`BlankableNumeric`** — the same, but its INPUT accepts a string, because that is what `<input type="number">` holds. Declaring it as `number | ""` compiles and then rejects the only way a form can seed it.

### 2.5 Migrate the form

```tsx
const form = useZodForm(clientMaster.create, { defaultValues: { … } });

<Form form={form} onSubmit={async (values) => { await api.create(values); toast.success("Saved"); }}>
  <FormField form={form} name="email" label="Email">
    {(field) => <Input type="email" {...field} value={String(field.value ?? "")} />}
  </FormField>
  <FormError form={form} />
</Form>
```

Three things go away: the `useState` pile, the hand-built payload object (`values` is the schema's *output* — numbers are numbers, blanks are `undefined`), and the `canSubmit` boolean. `disabled` becomes only "already submitting", unless there is a domain rule (see the journal entry, which disables on `ledger.checkPostable`).

### 2.6 Test what the migration was FOR

Not "the form still works". Assert that the form's idea of valid is now the API's — and write one test per defect the old boolean allowed through. `client/src/features/finance/journal-form.test.tsx` is the model.

---

## 3. What is gated

| Gate | Holds |
|---|---|
| `npm run check:shared` | the package resolves, parses, and both halves share one Zod instance |
| `npm run check:schemas` | **every shared domain is imported by BOTH sides**, and no migrated validator re-declares a schema |

The second is the one that keeps this honest. A schema only one side imports is a *third* definition, not a shared one — and `packages/shared` sat with exactly one domain in it for two phases with nothing anywhere saying so.

---

## 4. The count

| | Migrated | Total |
|---|---|---|
| API validators on `@praxis/shared` | **3** | 99 |
| Client forms on `useZodForm` | **2** | ~40 with a hand-rolled gate |
| Shared domains | 4 (`common`, `finalInvoice`, `journalEntry`, `clientMaster`) + `ledger` rules | — |

**Done:** `final_invoice` (Phase 2, schema only), `journal_entry` (schema + ledger rules + form), `client_master` (schema + form).

### Next, in value order

1. **`credit_note`, `asset`, `debt`** — Finance, same shape as the invoice, and the screens are already decomposed.
2. **`service_type`, `dossier`** — Operations; `service-types.tsx` already uses `<InlineEdit>` for the name, so the form is the remaining half.
3. **`chart_of_accounts`** — the Phase 5 reference screen; a small form and a high-traffic one.
4. **`employees`, `supplier_master`** — the other master-data records with the same `Blankable` text-field problem.
5. The **sales** module (7 validators) is the largest single block and the least urgent: those forms write CRM records, not ledger entries.

### Not planned

Validators that only parse **query strings** or **path params** are not form payloads and gain nothing from sharing. Roughly a third of the 99 are that shape; they should be counted out of the denominator rather than migrated, and this file should say so once someone has done the counting.

---

## 5. One thing the first migration changed that is worth knowing

The backend's ledger tests asserted error **messages** (`/not balanced/i`). Rewording them for an operator therefore looked like a ledger regression, and eleven assertions failed.

They assert the **code** now. The code is what the 422 body carries, what the AI surface branches on, and what does not change when someone improves a sentence. If you migrate a module whose tests match on message text, change them to codes in the same commit — and expect to find, as here, that nothing outside the test file ever depended on the wording.
