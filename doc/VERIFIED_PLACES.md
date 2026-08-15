# Verified places

How a location gets onto an operations file, and why it can no longer be a
string somebody typed.

## The defect this closes

`dossier.pol` / `dossier.pod` are text columns, and the control that filled them
was a typeahead with `allowFreeText`. So:

1. **A typo saved cleanly.** "Doula" is one letter short of Cameroon's main port.
2. **The save path then guessed.** `operations_file.resolvePlaces` forward-geocoded
   the value in the background. A geocoder handed a typo does not fail — it
   returns something plausible, confidently. The dossier was linked to a
   coordinate nobody had ever looked at.
3. **Nothing on screen said which was which.** A port chosen from the catalogue
   and a string somebody typed rendered identically, so the map, the itinerary and
   the Monday meeting treated them as equally true.

The fix is not "validate harder". It is to make *verified* a state the schema can
hold, the UI can show, and the save path can require.

## What "verified" means

A place is verified when a **human** put it in the catalogue. Three ways in:

| `source` | How it got there | `verified_at` |
|---|---|---|
| `CATALOGUE` | Shipped in the reference data (0675) | set |
| `GEOAPIFY` | An operator confirmed a provider suggestion | set |
| `MANUAL` | An operator typed the coordinate | set |
| `GEOAPIFY` | Resolved in the background by `resolveMany`, nobody looked | **null** |

That last row is the pre-existing population, and it is why `verified_at` is
nullable rather than a `NOT NULL DEFAULT true`: those places exist, they are
plotted, and they are exactly what the Control Tower's location-needed queue is
built from in PR2.

`is_reference_point` is the other axis, and the honest half of the design: TRUE
means *we know where this is, and we are not claiming it is the exact address* —
a junction near a customer whose door no geocoder knows. The delivery
instructions stay on the file; the map stops claiming a precision nobody
promised.

## The four routes to a verified place

Each is one interaction deeper than the last, and **nothing below step 1 appears
until step 1 has visibly failed**. That is the whole UX: the common case stays
two keystrokes, and the hard case is reachable without anybody knowing in advance
that it exists.

1. **The catalogue.** Type, pick. 322 seeded places, so this is almost always the
   answer, and it costs nothing.
2. **Worldwide search.** One button, shown only when the catalogue came back
   thin (≤3 hits and no exact match). Opt-in: typing never spends provider quota.
3. **A nearby reference point.** A toggle on the confirmation step, not a separate
   flow — the operator has usually already found the junction and just needs to
   say "near, not at".
4. **Add it by hand.** A dialog, permission-gated on `MOD-29` create.

There is deliberately **no** "use what I typed". That affordance is the defect.

### The bug that made step 2 unusable

Reported as: *"I search for an address, I find the address, then when I click on it,
it disappears and the box becomes empty."*

The picker closes on a press outside itself, and that listener was on the **bubble**
phase — after React's own handler for the same event. Picking a suggestion swaps the
results list for the confirmation step, React flushes that synchronously for a
discrete event like `mousedown`, and the row the operator pressed is unmounted. So
by the time the listener ran, `e.target` was **detached**, `Node.contains()` on a
detached node is false, and the control read its own row as "outside" and closed
itself. Nothing was stored and nothing said why.

Catalogue rows hid it completely: they call `close()` themselves and commit a value,
so the spurious close was invisible on the path everyone tests. It also only
reproduced in a browser — jsdom's flush lands after the listener, so the bug shipped
green through the picker's whole suite. The regression test therefore pins the
**phase**, which is the invariant that actually prevents it.

The same listener also treated the manual-entry dialog as "outside", because a portal
is outside by construction — so every press inside that dialog collapsed the picker
behind it, and cancelling dropped the operator on an empty closed field instead of
back on the search they had already typed.

## Why confirmation re-queries the provider

`POST /geo-places/confirm` takes a query string and a `provider_place_id` — and
**no coordinate**. The server re-runs the same provider search and takes the
coordinate from the provider's own answer.

Without that, the browser could POST any coordinate and have it stored with
`source='GEOAPIFY'`: a place claiming a provider vouched for it when nobody did.
Provenance is the entire product claim being made here, so it is not something a
client gets to assert. The cost is one provider request per genuinely new place —
exactly the budget this module was built around. The failure mode is visible and
recoverable: a suggestion that has aged out of the ranking yields
`PLACE_SUGGESTION_EXPIRED`, and the picker re-searches rather than storing
something nobody confirmed.

## The gate

`shipment_details.assertPlacesVerified` runs when `enforceRequired` is true —
that is, when a file is being **opened**, and only then.

- Scoped by `facet_role` — `ORIGIN`, `DESTINATION`, `ROUTE_VIA`,
  `CUSTODY_LOCATION`, and the two door-leg roles `COLLECTION` and `FINAL_DELIVERY`
  (0678) — not by field key, so a tenant's own origin field is covered and a
  renamed one stays covered.
- A **local** lookup, never a geocode. Opening a file must not depend on a third
  party being up.
- Editing an existing file is never blocked. A value typed in 2024 must not stand
  between an operator and an ETA correction; those files surface in the
  location-needed queue instead.
- On success it rewrites the value to the catalogue's own spelling, so `pol` — the
  display value on every document and the grouping key in every report — cannot
  hold three spellings of one port.

## The catalogue: provenance and licence

Migration `0675_geo_place_catalogue.sql`, 322 hand-listed rows across 112
countries: 232 seaports, 50 air-cargo airports, 38 cities, and inland/rail
terminals.

- **Codes** are UN/LOCODE (UNECE, published for free public use) — the identifier
  that is actually on the booking, the B/L and the manifest. Airports additionally
  carry their **IATA** code in `formatted`, because UN/LOCODE codes the *locality*
  and so cannot distinguish Douala's port from Douala's airport.
- **Coordinates** are public port/airport reference points to 4 dp (~11 m). They
  are for route visualisation and distance estimation — **not survey data, not for
  navigation**. A berth is not a point and the table does not pretend otherwise.
  `provenance` records this per row, so the claim travels with the data.
- Not a bulk dump: every row is reviewable in the migration file.

The migration **never touches an existing coordinate**. `ON CONFLICT DO NOTHING`
on the insert, and the one gap-filling `UPDATE` is scoped to rows that are
`SEED`/`CATALOGUE` with a NULL code — never `MANUAL`, never `GEOAPIFY`.

## Migrations

| File | What |
|---|---|
| `0674_geo_place_verification.sql` | `unlocode`, `region`, `provider_place_id`, `confidence`, `is_reference_point`, `is_active`, `verified_at`, `provenance`; widened `kind`/`source` vocabularies; search indexes |
| `0675_geo_place_catalogue.sql` | The 322-place catalogue, plus the airport block |
| `0676_movement_fields_use_places.sql` | Converts seeded `TEXT` location fields to `GEO_PLACE` by facet role |
| `0678_delivery_place_asked_once.sql` | The `COLLECTION` / `FINAL_DELIVERY` roles, and the delivery/collection fields three profiles were missing |

0676 is the one that matters most to the road service types: `place_receipt`,
`place_delivery`, `final_destination` and `warehouse_location` were seeded as
`TEXT`, so the two service types whose entire job is a road movement — and the one
whose job is custody at a location — were the ones that could not name a mappable
place.

## Where 0676 missed, and what 0678 does about it

0676 scopes by role, which is right — and left one gap that mattered more than the
four it closed. The sea profile's `place_delivery` was seeded with **no facet role
at all**, so the promotion skipped it: on a sea import, the commonest file in the
system and the field a customer phones about, "Place of delivery" stayed a
free-text box with no picker, no verification and no coordinate.

The reason it had no role is worth keeping: `DESTINATION` was already taken by
`pod`, and the facet map is keyed by role, so a second `DESTINATION` on one form
means one of the two silently wins. 0678 gives the door legs their own names —

| Role | Column | Means |
|---|---|---|
| `ORIGIN` / `DESTINATION` | `pol` / `pod` | The **main carriage** — the pair on the bill of lading |
| `COLLECTION` | `place_receipt` | The shipper's door, **before** the main carriage |
| `FINAL_DELIVERY` | `place_delivery` | The consignee's door, **after** it |

— and fills three gaps in the seeded forms: air and project files had a delivery
leg in their template and no field to fill it from, and the two end-to-end types
had a *required* pickup leg and no collection field, so a door-to-door file could
not record the address it is sold on. The end-to-end pair keeps `place_delivery`
tagged `DESTINATION` deliberately: on a door-to-door file the delivery address IS
the destination every document prints, which is why 9092 re-tags their POD to
`ROUTE_VIA`.

Both new roles are in the gate, so a delivery address is verified at promote
exactly like a POL.

## Provider error taxonomy

`forwardGeocode` collapses every failure to `null`, because its caller (the map)
can only omit the lane either way. The picker faces a person, so
`searchPlaces` returns a typed status and the server composes the sentence:

`NO_KEY`, `TIMEOUT`, `RATE_LIMITED`, `UNAUTHORISED`, `PROVIDER_ERROR`,
`QUERY_TOO_SHORT`.

Two of those are somebody's job to fix, and the operator needs to know which two.
A single "search failed" is how a missing API key gets reported for months as
"the address book doesn't work".

The key never reaches a log: `logger.warn({ err })` on an axios error serialises
`err.config.params`, which is where `apiKey` lives. Every call site logs
`describeError(err)` instead, and a test asserts on the whole logged payload.

## What was built on this

All of it, in [CONTROL_TOWER.md](CONTROL_TOWER.md):

- Itinerary legs with verified endpoints, and a real editor for them.
- The whole journey derived from the file's four place fields at creation — so the
  delivery address is asked once and the wizard has no second question.
- Per-leg map geometry, with mode derived from the itinerary's main carriage
  rather than from the service type's name.
- Hover, selection, route focus, keyboard traversal, itinerary panel, deep links.
- The **location-needed queue** — every active file naming a place with
  `verified_at IS NULL` or no reference at all — and the activity layer for the
  three service types that move nothing.
- Full-screen and meeting mode.

The two halves meet at one rule: a route is only drawn when **both** of its
endpoints resolve to a verified coordinate. Everything else is listed, with what is
missing and a way to fix it.
