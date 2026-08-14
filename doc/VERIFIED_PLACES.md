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

- Scoped by `facet_role` (`ORIGIN`, `DESTINATION`, `ROUTE_VIA`,
  `CUSTODY_LOCATION`), not by field key, so a tenant's own origin field is covered
  and a renamed one stays covered.
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

0676 is the one that matters most to the road service types: `place_receipt`,
`place_delivery`, `final_destination` and `warehouse_location` were seeded as
`TEXT`, so the two service types whose entire job is a road movement — and the one
whose job is custody at a location — were the ones that could not name a mappable
place.

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

## What PR2 builds on this

- Itinerary legs with verified endpoints, and the editor for them.
- Pickup and last-mile legs from the service-type template.
- Per-leg map geometry with correct Air/Sea/Land semantics.
- Hover, selection, route focus, itinerary panel, dossier deep links.
- The **location-needed queue** — every place with `verified_at IS NULL` on an
  active file — and the operational-activity layer for non-movement services.
- Full-screen and meeting mode.
