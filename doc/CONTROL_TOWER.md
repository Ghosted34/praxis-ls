# The Control Tower

How the home screen became a tool for running a Monday operations meeting rather
than a picture of one.

Companion to [VERIFIED_PLACES.md](VERIFIED_PLACES.md), which is where the
coordinates come from. Nothing here can be honest without that.

## What was wrong

The tower drew **one line per file**, from POL to POD.

That is the main carriage and nothing else. So an end-to-end file — collect from
the shipper's yard, export customs, sail, import customs, truck inland, deliver
to the door — showed **one of its five movements**, and the four an operator is
actually chased about were invisible. Three further consequences followed from the
same root:

1. **Files that move nothing had nowhere to go.** Warehousing, Customs Brokerage
   and Business Representation are real files with real deadlines and no route.
   The tower either dropped them off the screen or drew a lane between two places
   one of them happened to mention.
2. **A file with an unverified location was drawn anyway.** The coordinate was
   either absent or a background geocode nobody had confirmed — and the map made
   no distinction, so a guess and a fact rendered identically.
3. **Nothing could be selected.** No hover detail, no keyboard route, no way to
   ask "what is happening with this one?" without navigating away and losing the
   map, the other eleven files, and the thread of the conversation.

## A lane is now one itinerary leg

`toLanes` produces **one drawn segment per plottable leg**, with the file's
`dossier_id` tying them together for selection. A file with no structured
itinerary falls back to a single synthetic main carriage from its POL/POD — that
is not legacy cruft, it is exactly what such a file is.

`plottable` is the server's verdict and the rule that stops the map lying: **both**
ends must resolve to a coordinate. One end is not a leg, and a line drawn from a
real port to an assumed point is the fabricated route the old hand-drawn map drew.

## Mode comes from the itinerary, not from the service-type name

`MODE_EXPR` in `dashboard.repo.js` reads the main carriage's own mode first and
falls back to the key heuristic.

That order fixes a real misclassification. The key patterns had to put
`PROJECT_CARGO` somewhere and chose the road corridors — so a file whose main
carriage is a chartered vessel was **filtered, coloured and counted as a truck**.
The leg knows; the key is the fallback for a file with no structured legs yet.

`OTHER` is a real answer, not a failure. Warehousing, brokerage and representation
have no transport mode, and forcing one on them is how a storage file ends up
drawn as a shipping lane.

## Three layers, and the counts add up

| Layer | What is in it | Where |
|---|---|---|
| Movement | Files with endpoints or a transport leg | The map |
| Activity | Files that record work at a place | "Not on the map" |
| Needs a location | Files naming a place that is not verified | "Not on the map", exceptions first |

All three are computed **server-side over the whole filtered set**, not from the
visible page. A count derived from 50 rows would say "2 files need a location" on
page one of eleven, which is worse than saying nothing. The count query carries
every predicate the page query does — `TOWER_FROM` is shared so a filter added to
one cannot be missing from the other, which is the class of bug that makes a
header say 12 above a list of 3.

## Interaction

- **Click or Enter** a route, a list row or an activity row → selects that file:
  the map zooms to it, the other routes de-emphasise, the itinerary opens beside
  it. Clicking it again clears the selection; so does Escape.
- **Hover or focus** a route → a card with the file, the leg, the route, the
  milestone, the date and the progress.
- **Arrow keys** step between files. The routes are **one composite widget** with
  one tab stop, not one stop per lane: a hundred-file map has ~300 legs, and one
  stop each would make the keyboard a worse way to move than the mouse — which is
  how keyboard support ends up unused and then removed.
- **Hover is never the only route to information** (WCAG §1.4.13). The card
  renders on focus, and everything in it is in the panel a click opens.

## Honesty on the map

| Drawn as | Means |
|---|---|
| Solid marker | A verified place at a confirmed coordinate |
| **Hollow** marker | A **reference point** — verified, and explicitly not the exact address |
| Larger marker with `+n` | A cluster: several places that project into the same few pixels |
| Not drawn at all | No verified coordinate. It is in the exception list instead |

Clustering is **off below 24 endpoints**. Collapsing four ports at the mouth of one
river loses information, and on a five-file map there is room to draw all four.
Past two dozen there is not — they become a smear with no readable name in it,
which is the state a hundred-file tower is in and the one a meeting is most likely
to hit. The surviving marker keeps the **first** node's position rather than the
centroid, because an averaged pin sits in the sea between two ports and points at
neither.

## Full screen and meeting mode

Both are fixed overlays with `role="dialog"`, `aria-modal` and Escape — **not** the
Fullscreen API, which takes the whole display and is unavailable on non-video
elements in iOS Safari and inside an iframe-embedded deployment.

Meeting mode is a **mode, not a route**: a separate screen would be a second
surface to keep in step, and it would drift. It wraps the same components with a
different emphasis, so every filter and the current selection carry straight into
it. It is read-only by construction — the person driving a projector is talking,
not watching their cursor, and an "archive" one click from the mouse position is a
hazard.

Auto-refresh is **off until asked for** and pausable, with the last refresh time on
screen. A map that silently re-fits mid-sentence because a file changed in another
tab is worse than a stale one: the room loses its place. A number that is honestly
stale beats one that is silently moving.

## The itinerary editor

`dossier_itinerary_leg` gained execution columns in `0677`: `actual_departure`,
`actual_arrival`, `milestone_instance_id`, and `source` (`TEMPLATE` vs `MANUAL`).

The editor was 37 lines — a leg type, a mode, and two free-text boxes. So the one
screen whose job is to record where cargo goes could not record a verified place, a
date, a carrier, or **the order the legs happen in**. It now does all four, plus
reordering, optional legs, unsaved-change tracking and revert.

Two rules are enforced on the server, in `itinerary.service`:

- **Places must already be in the catalogue.** Saving used to call
  `geoPlace.resolveMany`, which reaches Geoapify on a miss — so an itinerary could
  silently invent a coordinate for a mistyped place, the exact failure the
  dossier's own save path was fixed to stop. The lookup is now local, and errors
  are keyed by leg index so the editor marks the offending row.
- **The service type's structural legs must survive an edit.** A Sea Import with
  its main carriage deleted is not an edited Sea Import; it is a file whose service
  type no longer describes it while everything downstream still assumes it does.
  Legs the template did not mark optional are required, and the refusal names them.

### `replace` is transactional now

It was a `DELETE` followed by `INSERT`s on a pooled client with no transaction. A
leg that violated a CHECK constraint on insert left the dossier with **no itinerary
at all** — the whole route silently gone, while the operator looked at a save error
that said nothing about it. It now either replaces or changes nothing.

`seq` is assigned from **array position** and the caller's own value is ignored.
Ordering is what the array means; honouring a client's numbering is how you get two
legs numbered 3 and a `UNIQUE (dossier_id, seq)` violation reported as a database
error.

## Door-to-door legs at creation

The wizard offers a pickup leg (end-to-end service types) and a last-mile delivery
leg (sea, air, end-to-end, project). Both require a **verified** place, both go
through the same picker as every other location field, and pickup is prepended
while last-mile is appended — the itinerary's order is its array order, so a pickup
added after the main carriage would draw a truck leg that happens after the vessel
sails.

These exist at creation, not only in the editor, because a door-to-door file is
sold as door-to-door: both addresses are known on the day the booking lands, and
they are the first two things the client asks about. Making the operator open the
file and find the itinerary tab is how those legs end up in a notes field.

## Deep links

The itinerary panel links to `/operations/files?ref=<ref>&focus=<dossier_id>`.

`ref` seeds the hub's search so the row is on the page; `focus` is the hub's
existing convention (`useFocusRow`) for scrolling to a row and opening its 360. The
previous tower could only send `ref` — a display string — so the link landed on a
filtered **list** and the operator had to click the row they had already chosen on
the map.
