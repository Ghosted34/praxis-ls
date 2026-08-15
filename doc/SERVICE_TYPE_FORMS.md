# Service type forms

How the form a service type asks for is changed, and where each part of it lives.
Written because the first question anybody asks about it — *"how do I add an
Incoterm?"* — had no answer in the product.

## Where

**Master data → Service types →** pick a service type **→ Details.**

One screen configures the whole shared shipment/service-detail component: a manager
decides there that Sea Freight Import asks for a Bill of Lading, a vessel and two
ports, and every operations file, costing, quotation and invoice of that service
follows, with no deploy.

## Nothing is edited in place

Forms are **versioned**, one live at a time, and a published version is read-only.
To change anything:

1. **New version from live** — clones the live form into a draft.
2. Edit the draft.
3. **Publish** — every *new* file of that service type is created against it.

Files already open keep the version they were created under, which is the whole
point. Editing the live form in place breaks three ways at once: files created under
the old form become retroactively incomplete, a renamed key orphans every value
stored under it, and a locked invoice cites a field that no longer exists. Cloning
costs one click.

This mirrors the Milestones tab beside it deliberately — somebody who has learned
how milestone templates work already knows how this works, and both solve the
identical problem.

## What a row on the Details table can change

| Column | Editable on a draft | Notes |
|---|---|---|
| Key | **Never** | It is the property values are stored under. Asked once, at creation. |
| Label | Yes | Free — a label is read, not stored. |
| Type | No | Changing it after files exist changes what stored values *mean*. |
| Options | Yes, for `SELECT` / `MULTISELECT` | See below |
| Means (facet role) | Yes | How every document, costing and quotation understands the field |
| Required | Yes | Required *at creation* — see the note in the tab |
| Client sees | Yes | Renders on the client portal beside the milestone chain |
| — | Retire / delete | A shipped field is retired, not deleted |

## Option lists — Incoterms, customs regimes, units

The `Type` cell carries an **“n options”** button on every dropdown field. That is
the editor: add, remove, reorder, and edit the value and both labels.

It is also the answer to "which regimes does this service actually offer?", so it
opens on a **live** version too — read-only there, with no Save.

### Value versus label, and why one is dangerous to change

- **`value`** is what gets **stored on every file**, printed on every document and
  grouped by in every report.
- **`label_fr` / `label_en`** are what a person reads.

Renaming a label is free. Renaming a value is not: every file already filed under
the old code keeps it, and stops matching the list. So the editor **allows** it and
**says so** — freezing it would mean a typo in a seeded code could never be
corrected, and staying silent would make a rename look free. When both need to
exist, add the new option and retire the old one.

Codes are upper-cased as they are typed, because `ddp` and `DDP` must not become two
answers to the same question.

### What it refuses to save

- an empty list — a dropdown that cannot be answered;
- a row with no value, or with no label in either language;
- two rows sharing a value, compared case-insensitively. Nothing downstream could
  tell them apart, and it is the mistake a duplicated row makes by default.

Those are checked in the browser so the operator is told *before* pressing Save
rather than by a 422 afterwards — but the server enforces the same rules
(`service_type_field.validator`), so the browser is the courtesy and not the
control.

### Adding a new dropdown

The add-field form collects the options **before** the field is created. It used to
offer `SELECT` in its type list and send no options, which the server refuses — so
adding one always failed with no way past it. A dropdown *is* its option list;
asking for the list is not an extra step, it is the step that was missing.

## Where the seeded lists came from

`migrations/seeds/9092_seed_service_type_fields.sql` writes each list once and
applies it by field key — repeating an eleven-element Incoterm array in eight places
is eight chances to let one fall out of date. What ships:

| Field | Values |
|---|---|
| `incoterm` | EXW FCA FAS FOB CFR CIF CPT CIP DAP DPU DDP (Incoterms 2020, all eleven) |
| `customs_regime` | IM4 IM7 IM8 EX1 EX2 |
| `weight_unit` | KG TON LB |
| `bonded_status` | BONDED NON_BONDED |
| `storage_basis` | PER_PALLET PER_SQM PER_CBM PER_TON PER_CONTAINER FLAT_MONTHLY |
| `retainer_basis` | MONTHLY_RETAINER PER_ASSIGNMENT COMMISSION MIXED |

A tenant's edits are theirs from then on — the seed is idempotent by filename and
never re-applied.

## The API, for anything scripted

```
GET    /service-types/:id/field-sets              list versions
GET    /service-types/:id/field-sets/:setId       one version, with its fields
POST   /service-types/:id/field-sets              new draft (body: { from })
POST   /service-types/:id/field-sets/:setId/publish
POST   /service-types/:id/field-sets/:setId/fields
PATCH  /service-types/:id/field-sets/:setId/fields/:fieldId
DELETE /service-types/:id/field-sets/:setId/fields/:fieldId
```

`PATCH` takes `options_json` — an array of `{ value, label_fr, label_en? }`. All of
these need `edit` on the service-type module and are audited.

## Related

- [VERIFIED_PLACES.md](VERIFIED_PLACES.md) — `GEO_PLACE` fields, and why a location
  field is a picker rather than a text box.
- [CONTROL_TOWER.md](CONTROL_TOWER.md) — what the facet roles feed.
