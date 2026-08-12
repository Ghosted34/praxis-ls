# Milestone Engine — Design & Seed Spec (MOD-31)

**Status:** design, awaiting sign-off. No code written against it yet.
**Scope:** replaces the offset-only milestone engine with a weighted, continuously
re-baselined scheduler; seeds **14 editable system-default stages for each of the
12 system service types**; adds a working calendar, a published assumptions
register, delay attribution, and an SLA scanner.

---

## 1. Decisions locked

| # | Decision | Answer |
|---|---|---|
| 1 | Shape of the defaults | **14 real, curated stages per service type**, EN + FR, seeded as system defaults and fully editable per tenant — the financial-dictionary pattern. **No canonical archetype layer.** |
| 2 | Due-date maths | **Hybrid**: weight-share of the horizon when a target date exists; `default_offset_days` as the fallback when it does not. Both stored on every stage. |
| 3 | Dynamics | **Continuous re-baselining** + four guardrails: hard target locking, asymmetrical recalculation, frozen DONE, responsibility-based attribution. |
| 3a | Dates per stage | **Three** — `baseline_due` / `planned_due` / `forecast_due`. Behaviour **configurable** per tenant (and per service type) via a scheduling-policy modal. |
| 3b | Compression floor reached | **Configurable** per tenant / service type: hold-and-alert, auto-release, or require re-plan. Default **hold-and-alert**, and every outcome can trigger communications. |
| 4 | Target date | `dossier.promised_delivery_date` (per file) → `dossier.eta` → `service_type.default_duration_days` (tenant-set, working or calendar days). |
| 5 | Working time | **Working calendar per corporate entity** (hours + weekend mask + holidays), plus a **published assumptions register** per service type, seeded and editable. |
| 6 | Tenant ownership | Seeded per tenant with provenance (`is_system`, `system_code`, `source_version`) → drift visible, "restore default" available. Tenants may cut below 14; **hard cap 15**, floor 3. |
| 7 | New template version vs. live dossiers | Forward-only by default, plus an explicit, previewed, audited **"apply to open dossiers"** action. |
| 8 | Per-dossier deviation | Full insert-between / reorder / add / remove at instance level with downstream recalculation. |
| 9 | Health + alerting | Derived on read; **SLA scan at 06:00 and 18:00** tenant-local, tenant-configurable to hourly, emitting events into the notification engine. |
| 10 | Stage intelligence | Rich stage: owner tier, responsible role, required evidence, client visibility, declarative auto-advance trigger, blocking/optional. Built so the predictive layer can be injected later without schema change. |

**Deliberate divergence from the kickoff record.** Transcript D17 (§11.7) says
milestones are "not limited to a fixed number (e.g. not capped at 14)". We cap
templates at **15** stages. A chain longer than fifteen stops being an operating
procedure and becomes a task list, and the weight maths gets meaningless below
~2% per stage. Recorded here so it is a decision, not an accident.

---

## 2. What exists today

- `milestone_template` (versioned per `service_type`, one active) →
  `milestone_template_stage` (`stage_seq numeric(10,4)`, `code`, `label_fr`,
  `label_en`, `default_offset_days`) → `milestone_instance`
  (`due_date`, `PENDING/IN_PROGRESS/DONE/BLOCKED`, `completed_by`,
  `evidence_vault_id`) — `migrations/tenant/0310_operations.sql:48-80`.
- Due date = `base + offset_days`, calendar days (`milestone.rules.js:6`).
  No weights, no anchor, no ETA awareness, no re-forecast.
- **12 system service types are seeded** (`migrations/seeds/9080_seed_dictionary.sql:150`)
  and **zero system milestone templates**. Only `scripts/tenant/seed-sandbox.sql`
  creates chains (5 stages, sea/air/transit). A real tenant therefore gets
  `NO_TEMPLATE` on every dossier — this spec's primary gap.
- Orchestration already in place: `dossier.created → instantiate`,
  `transit_order/delivery_note.created → advance` via the
  `operations.milestone_map` setting, `all DONE → dossier.milestones_completed`.
- Control Tower progress is `done/total` (`dashboard.repo.js:74`) — becomes
  weight-based.
- `q_ticket` exists since 0310 with no module behind it.
- Bug to fix in passing: the UI reads `label_fr` on instances but the column is
  `label` (`0310:72`), so the dossier chain renders codes, not labels.

---

## 3. Schema deltas (PR1)

### 3.1 `milestone_template_stage`

| Column | Type | Why |
|---|---|---|
| `weight` | `int NOT NULL DEFAULT 0` | share of the horizon |
| `min_duration_hours` | `int NOT NULL DEFAULT 0` | compression floor — guardrail #1 |
| `owner_tier` | `text CHECK IN (INTERNAL, CARRIER, TERMINAL, AUTHORITY, CLIENT)` | baton pass — guardrail #4 |
| `responsible_role_id` | `uuid REFERENCES role` | internal accountability |
| `is_anchor` | `bool DEFAULT false` | schedule provisional until reached |
| `is_target_lock` | `bool DEFAULT false` | SLA-protected date |
| `is_client_visible` | `bool DEFAULT true` | portal + Smart Tracker |
| `is_optional` / `is_blocking` | `bool` | chain semantics |
| `chain_segment` | `text` | `INBOUND / STEADY / OUTBOUND / MANDATE / RENEWAL` for open-ended services |
| `cadence` | `text` | `DAILY / WEEKLY / MONTHLY / QUARTERLY` for steady-state stages |
| `required_evidence_doc_type` | `text` | proof gate |
| `auto_advance_on_event` | `text` | declarative trigger (supersedes `operations.milestone_map`) |
| `is_system`, `system_code`, `source_version` | provenance | drift + "restore default" |

Constraint: 3 ≤ stages ≤ 15 per template (validator **and** a deferred DB check).

### 3.2 `milestone_instance`

Snapshots the stage config at instantiation (the template may change under a live
file), and adds the three-date model:

- `baseline_due date` — frozen at instantiation. The yardstick; never moves.
- `planned_due date` — the commitment. Moves only on LATE, or an audited re-plan.
- `forecast_due date` — the prediction. Moves both ways, per policy.
- `actual_start timestamptz`, `completed_at timestamptz` (exists)
- `weight`, `min_duration_hours`, `owner_tier`, `is_target_lock`,
  `is_client_visible` — snapshotted
- `variance_hours int` — computed at completion against `baseline_due`
- `attributed_to text` — owner tier charged with the slip
- `cause_reason_code text` — force-majeure / exception override
- `is_ad_hoc bool`, `manual_due_override date` — per-dossier deviation
- `health text` — `OK / DUE / AT_RISK / DELAYED / BREACH_FORECAST`
- `reopened_at`, `reopened_by`, `reopen_reason` — governed un-DONE

### 3.3 New tables

- `working_calendar` — per corporate entity: timezone, per-weekday open/close,
  default working hours.
- `working_calendar_holiday` — date, `name_fr` / `name_en`, `is_recurring`.
  Seeded with Cameroon public holidays.
- `service_type_assumption` — `service_type_id`, `seq`, `code`, `text_fr`,
  `text_en`, `is_client_visible`, `is_system`. The published transparency
  register (§5.2).

### 3.4 Column additions

- `service_type`: `default_duration_days int`, `duration_basis text
  (WORKING_DAYS|CALENDAR_DAYS)`, `is_open_ended bool`.
- `dossier`: `promised_delivery_date date` — the client SLA, distinct from `eta`
  (the carrier's estimate). These are different numbers and must not be conflated.

---

## 4. The scheduling engine

### 4.1 Three dates, and why

`baseline_due` answers *"were we ever on plan?"*. `planned_due` is what the client
is told. `forecast_due` is what we actually believe. The split is not decoration —
guardrail #2 ("early completion must not pull dates forward") is unimplementable
without it: with a single date, an early finish either lies or breaks the rule.
It is also the training target for the predictive layer: `baseline → forecast →
actual` per stage, per lane, per carrier.

**UI rule:** two dates by default (commitment + forecast, with the delta).
Baseline appears only in variance and scorecard views.

### 4.2 Recalculation (pure, unit-tested)

1. **Freeze completed work.** Every `DONE` stage keeps its dates permanently.
   Recalculation reads only `PENDING` / `IN_PROGRESS` stages. (Guardrail #3.)
2. **Anchor** = the actual completion of the latest `DONE` stage, else the
   dossier open date. While no `is_anchor` stage is reached, the chain is flagged
   *provisional*.
3. **Horizon** = target date − anchor, measured in **working time** from the
   entity's calendar. Target = locked stage's `planned_due` → dossier
   `promised_delivery_date` → `eta` → `service_type.default_duration_days`.
4. **Distribute** the horizon across remaining stages by `weight` share.
5. **Apply floors.** No stage may be compressed below `min_duration_hours`.
6. **Floor breach.** If Σ floors > horizon, the locked date is unreachable →
   apply the configured breach policy (§6.2). The schedule is *not* silently
   made feasible.
7. **Asymmetry.** LATE pushes `planned_due` **and** `forecast_due` downstream.
   EARLY moves `forecast_due` only — `planned_due` holds unless policy says
   otherwise. (Guardrail #2.)
8. **Attribution.** Slip is charged to the `owner_tier` of the stage that
   *slipped*, not the stage that revealed it, with a `cause_reason_code`
   override drawn from the same vocabulary as the assumptions register — so a
   carrier is not scored for a port strike we already published as a risk.

### 4.3 Open-ended services

`WAREHOUSING` and `BUSINESS_REPRESENTATION` are not a race to a date. Their
chains are segmented:

- **bounded segment** (inbound / mandate) — weights and duration apply, anchored
  on gate-in or mandate signature;
- **steady-state segment** — cadence-driven (`cadence`), never reads as overdue,
  never enters the horizon maths;
- **re-anchored segment** (outbound / renewal) — starts its own horizon when the
  release order or renewal window arrives.

Weights sum to 100 **within a segment**, not across the chain.

---

## 5. Working time and published assumptions

### 5.1 Working calendar (Corporate Entities → Settings)

Per entity: timezone, working days, opening/closing hours, and a holiday list
seeded with Cameroon public holidays (1 Jan, 11 Feb, Labour Day, 20 May, 15 Aug,
1 Oct, 25 Dec, plus the movable Islamic and Christian feasts). Due-date maths
counts working time only.

### 5.2 Assumptions register (per service type, seeded, editable, client-visible)

The engine's honesty layer: the counterparties we depend on keep their own hours,
and a schedule that pretends otherwise is a schedule nobody trusts. Each service
type ships a seeded register the tenant can edit and the client can read.

Example — `SEA_FREIGHT_IMPORT`:

| Code | Assumption |
|---|---|
| `CUSTOMS_HOURS` | Customs (CAMCIS / GUCE) processes Mon–Fri, 07:30–15:30. Declarations lodged after 14:00 are assessed the next working day. |
| `TERMINAL_HOURS` | Terminal gate operations Mon–Sat, 06:00–18:00. Sundays and public holidays excluded. |
| `LINE_COUNTER_HOURS` | Shipping-line release counters Mon–Fri 08:00–16:00, Sat 08:00–12:00. |
| `FREE_TIME` | Demurrage/detention free time is carrier-specific (commonly 11 / 7 days from discharge) and is not a milestone commitment. |
| `INSPECTION_CHANNEL` | Declarations routed to the red or yellow channel add one working day for scanning or physical inspection. |
| `FORCE_MAJEURE` | Excluded: port strike, customs system outage, vessel omission or roll-over, exceptional weather, civil disruption. |

Equivalents are seeded for all twelve service types (border-post hours for
hinterland transit, airline cut-off times for air export, abnormal-load convoy
windows for project cargo, and so on).

---

## 6. Configuration surfaces

Both live behind a **⚙ config icon → modal**, at tenant level with a per-service-type
override.

### 6.1 Scheduling policy (3a)

- Early-completion behaviour: **hold** (never pull forward) / **pull on
  readiness confirmation** / **pull always**
- Which stages require readiness confirmation before pulling forward
- Whether the client sees `forecast_due` or only `planned_due`
- Baseline visibility (analytics only, or on the chain)
- Provisional-until-anchor display

### 6.2 SLA & breach policy (3b)

- On compression floor reached: **hold and alert** (default) / **auto-release the
  lock** / **require re-plan**
- Risk thresholds (`AT_RISK` at N hours, `DUE` at M hours)
- Scan cadence — default **06:00 and 18:00** tenant-local, configurable to hourly
- Who is notified per owner tier, on which channel (in-app, email, portal Q
  ticket), and with which template
- Force-majeure reason codes available to ops when overriding attribution

Every outcome — re-baseline, at-risk, breach forecast, lock release — is an event
the comms engine can subscribe to, so "unforeseen circumstances trigger
communications" is configuration, not code.

---

## 7. The 14 seeded chains

Legend — **W** weight, **Min** `min_duration_hours`, **Owner** tier,
⚓ anchor, 🔒 target lock, 👁 client-hidden, 📎 evidence required.

### 7.1 SEA_FREIGHT_IMPORT — *Fret Maritime Import*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `PRE_ALERT` | Pre-alert & work order | Pré-alerte et ordre de travail | 3 | 4 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Shipping documents verified | Documents d'expédition vérifiés | 5 | 8 | CLIENT | 📎 |
| 3 | `ARRIVAL_NOTICE` | Arrival notice received | Avis d'arrivée reçu | 4 | 4 | CARRIER | |
| 4 | `VESSEL_ARRIVED` | Vessel arrived (ATA) | Navire arrivé (ATA) | 15 | 12 | CARRIER | ⚓ |
| 5 | `DISCHARGE` | Cargo discharged | Marchandise déchargée | 6 | 12 | TERMINAL | |
| 6 | `DECLARATION_LODGED` | Customs declaration lodged | Déclaration en douane déposée | 8 | 8 | INTERNAL | 📎 |
| 7 | `INSPECTION` | Customs inspection / scanning | Inspection douanière / scanner | 8 | 8 | AUTHORITY | |
| 8 | `DUTIES_PAID` | Duties & taxes paid | Droits et taxes payés | 7 | 4 | CLIENT | 📎 |
| 9 | `CUSTOMS_RELEASED` | Customs release (BAE) | Bon à enlever délivré | 6 | 4 | AUTHORITY | 📎 |
| 10 | `CARRIER_RELEASE` | Carrier release / D.O. issued | Bon de livraison armateur | 5 | 8 | CARRIER | |
| 11 | `TERMINAL_EXIT` | Terminal exit / gate-out | Sortie terminal | 6 | 6 | TERMINAL | |
| 12 | `DELIVERY` | Delivery to consignee | Livraison au destinataire | 15 | 8 | INTERNAL | 🔒 📎 |
| 13 | `EMPTY_RETURN` | Empty container returned | Conteneur vide restitué | 6 | 8 | INTERNAL | |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 6 | 8 | INTERNAL | 👁 |

### 7.2 SEA_FREIGHT_EXPORT — *Fret Maritime Export*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `BOOKING_REQUEST` | Booking requested | Demande de réservation | 4 | 4 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Export documents verified | Documents d'export vérifiés | 5 | 8 | CLIENT | 📎 |
| 3 | `BOOKING_CONFIRMED` | Booking confirmed | Réservation confirmée | 6 | 8 | CARRIER | 📎 |
| 4 | `EMPTY_PICKUP` | Empty container picked up | Conteneur vide enlevé | 5 | 8 | CARRIER | |
| 5 | `STUFFING` | Cargo stuffed & sealed | Empotage et plombage | 8 | 8 | INTERNAL | 📎 |
| 6 | `EXPORT_DECLARATION` | Export declaration lodged | Déclaration d'export déposée | 8 | 8 | INTERNAL | 📎 |
| 7 | `CUSTOMS_INSPECTION` | Customs inspection | Inspection douanière | 7 | 8 | AUTHORITY | |
| 8 | `TRANSFER_TO_PORT` | Haulage to port | Acheminement au port | 6 | 6 | INTERNAL | |
| 9 | `GATE_IN` | Gate-in / terminal acceptance | Entrée terminal | 6 | 6 | TERMINAL | |
| 10 | `BOARDING_AUTH` | Boarding authorisation | Autorisation d'embarquement | 5 | 4 | AUTHORITY | 📎 |
| 11 | `VESSEL_LOADED` | Loaded on vessel | Chargé à bord | 8 | 8 | TERMINAL | |
| 12 | `VESSEL_DEPARTED` | Vessel departed (ATD) | Navire parti (ATD) | 12 | 4 | CARRIER | ⚓ 🔒 |
| 13 | `BL_RELEASED` | Bill of lading released | Connaissement délivré | 10 | 8 | CARRIER | 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 10 | 8 | INTERNAL | 👁 |

### 7.3 AIR_FREIGHT_IMPORT — *Fret Aérien Import*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `PRE_ALERT` | Pre-alert received | Pré-alerte reçue | 4 | 2 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Documents verified (MAWB, invoice) | Documents vérifiés (LTA, facture) | 6 | 4 | CLIENT | 📎 |
| 3 | `FLIGHT_DEPARTED` | Flight departed origin | Vol parti de l'origine | 8 | 2 | CARRIER | |
| 4 | `FLIGHT_ARRIVED` | Flight arrived | Vol arrivé | 10 | 2 | CARRIER | ⚓ |
| 5 | `MANIFEST_BREAKDOWN` | Manifest breakdown at handler | Éclatement manifeste | 5 | 4 | TERMINAL | |
| 6 | `DECLARATION_LODGED` | Import declaration lodged | Déclaration d'import déposée | 9 | 4 | INTERNAL | 📎 |
| 7 | `INSPECTION` | Customs inspection | Inspection douanière | 9 | 4 | AUTHORITY | |
| 8 | `DUTIES_PAID` | Duties & taxes paid | Droits et taxes payés | 8 | 4 | CLIENT | 📎 |
| 9 | `CUSTOMS_RELEASED` | Customs release (BAE) | Bon à enlever délivré | 7 | 2 | AUTHORITY | 📎 |
| 10 | `HANDLING_SETTLED` | Handling & storage settled | Frais de magasinage réglés | 6 | 2 | INTERNAL | 👁 |
| 11 | `CARGO_RELEASED` | Cargo released from bond | Marchandise sortie du magasin | 7 | 4 | TERMINAL | |
| 12 | `DELIVERY` | Delivery to consignee | Livraison au destinataire | 12 | 4 | INTERNAL | 🔒 |
| 13 | `POD` | Proof of delivery signed | Bon de livraison signé | 5 | 2 | CLIENT | 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 4 | 8 | INTERNAL | 👁 |

### 7.4 AIR_FREIGHT_EXPORT — *Fret Aérien Export*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `BOOKING_REQUEST` | Booking requested | Demande de réservation | 5 | 2 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Export documents verified | Documents d'export vérifiés | 6 | 4 | CLIENT | 📎 |
| 3 | `SPACE_CONFIRMED` | Space confirmed | Espace confirmé | 7 | 4 | CARRIER | |
| 4 | `CARGO_RECEIVED` | Cargo received | Marchandise réceptionnée | 7 | 4 | INTERNAL | |
| 5 | `EXPORT_DECLARATION` | Export declaration lodged | Déclaration d'export déposée | 9 | 4 | INTERNAL | 📎 |
| 6 | `CUSTOMS_INSPECTION` | Customs inspection | Inspection douanière | 8 | 4 | AUTHORITY | |
| 7 | `SECURITY_SCREENING` | Security screening | Contrôle de sûreté | 6 | 2 | TERMINAL | |
| 8 | `AWB_ISSUED` | Air waybill issued | LTA émise | 6 | 2 | CARRIER | 📎 |
| 9 | `AIRLINE_ACCEPTANCE` | Airline acceptance (RCS) | Acceptation compagnie (RCS) | 7 | 2 | CARRIER | |
| 10 | `FLIGHT_DEPARTED` | Flight departed | Vol parti | 12 | 2 | CARRIER | ⚓ 🔒 |
| 11 | `FLIGHT_ARRIVED` | Flight arrived destination | Vol arrivé à destination | 9 | 2 | CARRIER | |
| 12 | `DEST_CLEARANCE` | Destination clearance | Dédouanement à destination | 8 | 8 | INTERNAL | |
| 13 | `POD` | Proof of delivery | Preuve de livraison | 6 | 4 | CLIENT | 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 4 | 8 | INTERNAL | 👁 |

### 7.5 HINTERLAND_TRANSIT — *Transit Hinterland*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `TRANSPORT_ORDER` | Transport order received | Ordre de transport reçu | 4 | 4 | INTERNAL | |
| 2 | `TRANSIT_DOCS` | Transit documents verified | Documents de transit vérifiés | 5 | 8 | CLIENT | 📎 |
| 3 | `T1_LODGED` | Transit declaration lodged | Déclaration de transit déposée | 7 | 8 | INTERNAL | 📎 |
| 4 | `TRANSIT_BOND` | Transit bond secured | Caution de transit constituée | 5 | 8 | INTERNAL | 📎 |
| 5 | `CARRIER_RELEASE` | Carrier release obtained | Bon de livraison obtenu | 5 | 8 | CARRIER | |
| 6 | `TRUCK_LOADED` | Loaded on truck | Chargement sur camion | 6 | 8 | INTERNAL | |
| 7 | `SEALED_ESCORT` | Customs sealing / escort | Plombage et escorte douanière | 5 | 8 | AUTHORITY | |
| 8 | `LEG1_DEPART` | Departure — leg 1 | Départ — tronçon 1 | 8 | 12 | INTERNAL | |
| 9 | `BORDER_CROSSING` | Border crossing | Passage frontière | 12 | 24 | AUTHORITY | |
| 10 | `LEG2_ARRIVAL` | Arrival at destination | Arrivée à destination | 15 | 24 | INTERNAL | ⚓ |
| 11 | `DEST_CLEARANCE` | Destination clearance | Dédouanement à destination | 8 | 16 | AUTHORITY | 📎 |
| 12 | `DELIVERY` | Delivery to consignee | Livraison au destinataire | 10 | 8 | INTERNAL | 🔒 📎 |
| 13 | `T1_DISCHARGED` | Transit discharged / bond released | Transit apuré / caution levée | 6 | 24 | AUTHORITY | 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 4 | 8 | INTERNAL | 👁 |

### 7.6 INLAND_TRANSPORTATION — *Transport Terrestre*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `TRANSPORT_ORDER` | Transport order received | Ordre de transport reçu | 5 | 2 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Documents verified | Documents vérifiés | 4 | 2 | CLIENT | |
| 3 | `TRUCK_ASSIGNED` | Truck & driver assigned | Camion et chauffeur affectés | 6 | 4 | INTERNAL | |
| 4 | `TRUCK_POSITIONED` | Truck positioned at loading point | Camion positionné au chargement | 7 | 4 | INTERNAL | |
| 5 | `LOADING` | Loading | Chargement | 8 | 4 | CLIENT | |
| 6 | `DEPARTURE` | Departure from origin | Départ de l'origine | 6 | 2 | INTERNAL | ⚓ |
| 7 | `IN_TRANSIT` | In transit | En route | 14 | 8 | INTERNAL | |
| 8 | `CHECKPOINT` | Checkpoint formalities | Formalités aux postes de contrôle | 6 | 2 | AUTHORITY | |
| 9 | `ARRIVAL` | Arrival at destination | Arrivée à destination | 10 | 4 | INTERNAL | |
| 10 | `OFFLOADING` | Offloading | Déchargement | 8 | 4 | CLIENT | |
| 11 | `POD` | Delivery confirmed (POD) | Livraison confirmée (BL signé) | 8 | 2 | CLIENT | 🔒 📎 |
| 12 | `TRUCK_RELEASED` | Truck released | Camion libéré | 6 | 2 | INTERNAL | 👁 |
| 13 | `FINAL_INVOICE` | Final invoice issued | Facture finale émise | 6 | 8 | INTERNAL | 👁 |
| 14 | `FILE_CLOSED` | File closed | Dossier clos | 6 | 8 | INTERNAL | 👁 |

### 7.7 WAREHOUSING — *Entreposage* (open-ended)

Segmented: **inbound** (weights sum 100) · **steady state** (cadence, never
overdue) · **outbound** (re-anchored on release order, weights sum 100).

| # | Code | EN | FR | W | Min | Owner | Segment / Flags |
|---|---|---|---|---|---|---|---|
| 1 | `WORK_ORDER` | Storage work order | Ordre d'entreposage | 10 | 2 | INTERNAL | INBOUND |
| 2 | `INBOUND_BOOKED` | Inbound slot booked | Créneau de réception réservé | 15 | 4 | CLIENT | INBOUND |
| 3 | `GATE_IN` | Receipt / gate-in | Réception / entrée | 15 | 4 | INTERNAL | INBOUND ⚓ |
| 4 | `INSPECTION_COUNT` | Verification & count | Vérification et comptage | 20 | 4 | INTERNAL | INBOUND 📎 |
| 5 | `PUT_AWAY` | Put-away | Rangement | 25 | 4 | INTERNAL | INBOUND |
| 6 | `GRN_ISSUED` | Goods received note issued | Bon de réception émis | 15 | 2 | INTERNAL | INBOUND 🔒 📎 |
| 7 | `INVENTORY_CONTROL` | Inventory control | Contrôle des stocks | — | — | INTERNAL | STEADY · daily |
| 8 | `CYCLE_COUNT` | Cycle count | Inventaire tournant | — | — | INTERNAL | STEADY · monthly 📎 |
| 9 | `STORAGE_BILLING` | Storage period billed | Période de stockage facturée | — | — | INTERNAL | STEADY · monthly 👁 |
| 10 | `RELEASE_ORDER` | Release order received | Ordre de sortie reçu | 15 | 2 | CLIENT | OUTBOUND ⚓ |
| 11 | `PICK` | Pick | Prélèvement | 20 | 2 | INTERNAL | OUTBOUND |
| 12 | `PACK_STAGE` | Pack & stage | Emballage et mise à quai | 20 | 2 | INTERNAL | OUTBOUND |
| 13 | `GATE_OUT` | Dispatch / gate-out | Expédition / sortie | 25 | 2 | INTERNAL | OUTBOUND 🔒 📎 |
| 14 | `FILE_CLOSED` | Handover confirmed & closed | Remise confirmée et dossier clos | 20 | 4 | INTERNAL | OUTBOUND 👁 |

### 7.8 END_TO_END_AIR_FREIGHT — *Fret Aérien Porte-à-Porte*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `BOOKING` | Booking | Réservation | 4 | 2 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Documents verified | Documents vérifiés | 4 | 4 | CLIENT | 📎 |
| 3 | `ORIGIN_PICKUP` | Origin pickup | Enlèvement à l'origine | 6 | 4 | INTERNAL | |
| 4 | `EXPORT_CLEARANCE` | Export clearance | Dédouanement export | 7 | 4 | AUTHORITY | 📎 |
| 5 | `AIRLINE_ACCEPTANCE` | Airline acceptance | Acceptation compagnie | 6 | 2 | CARRIER | |
| 6 | `FLIGHT_DEPARTED` | Flight departed | Vol parti | 8 | 2 | CARRIER | |
| 7 | `FLIGHT_ARRIVED` | Flight arrived | Vol arrivé | 10 | 2 | CARRIER | ⚓ |
| 8 | `IMPORT_DECLARATION` | Import declaration lodged | Déclaration d'import déposée | 8 | 4 | INTERNAL | 📎 |
| 9 | `INSPECTION` | Customs inspection | Inspection douanière | 8 | 4 | AUTHORITY | |
| 10 | `DUTIES_PAID` | Duties & taxes paid | Droits et taxes payés | 7 | 4 | CLIENT | 📎 |
| 11 | `CUSTOMS_RELEASED` | Customs release | Mainlevée douanière | 7 | 2 | AUTHORITY | 📎 |
| 12 | `CARGO_RELEASED` | Cargo released | Marchandise libérée | 6 | 4 | TERMINAL | |
| 13 | `DELIVERY_POD` | Delivery & POD | Livraison et preuve de livraison | 15 | 4 | INTERNAL | 🔒 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 4 | 8 | INTERNAL | 👁 |

### 7.9 END_TO_END_SEA_FREIGHT — *Fret Maritime Porte-à-Porte*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `BOOKING` | Booking | Réservation | 3 | 4 | INTERNAL | |
| 2 | `DOCS_VERIFIED` | Documents verified | Documents vérifiés | 4 | 8 | CLIENT | 📎 |
| 3 | `ORIGIN_PICKUP` | Origin pickup | Enlèvement à l'origine | 5 | 8 | INTERNAL | |
| 4 | `EXPORT_CLEARANCE` | Export clearance | Dédouanement export | 6 | 8 | AUTHORITY | 📎 |
| 5 | `GATE_IN_ORIGIN` | Gate-in at origin port | Entrée port d'origine | 5 | 6 | TERMINAL | |
| 6 | `VESSEL_DEPARTED` | Vessel departed | Navire parti | 7 | 4 | CARRIER | |
| 7 | `OCEAN_TRANSIT` | Ocean transit | Transit maritime | 14 | 48 | CARRIER | |
| 8 | `VESSEL_ARRIVED` | Vessel arrived (ATA) | Navire arrivé (ATA) | 10 | 12 | CARRIER | ⚓ |
| 9 | `DISCHARGE` | Discharge | Déchargement | 6 | 12 | TERMINAL | |
| 10 | `IMPORT_DECLARATION` | Import declaration lodged | Déclaration d'import déposée | 8 | 8 | INTERNAL | 📎 |
| 11 | `CUSTOMS_CLEARED` | Customs cleared | Dédouanement obtenu | 9 | 8 | AUTHORITY | 📎 |
| 12 | `TERMINAL_EXIT` | Terminal exit | Sortie terminal | 6 | 6 | TERMINAL | |
| 13 | `DELIVERY_POD` | Delivery & POD | Livraison et preuve de livraison | 13 | 8 | INTERNAL | 🔒 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 4 | 8 | INTERNAL | 👁 |

### 7.10 BUSINESS_REPRESENTATION — *Représentation Commerciale* (open-ended)

Segmented: **mandate** (weights sum 100) · **steady state** (cadence) ·
**renewal** (weights sum 100). Matches transcript §12 — yearly renewable,
milestone-based, performance reviewed on delivery and willingness.

| # | Code | EN | FR | W | Min | Owner | Segment / Flags |
|---|---|---|---|---|---|---|---|
| 1 | `MANDATE_SIGNED` | Mandate signed | Mandat signé | 20 | 8 | CLIENT | MANDATE ⚓ 📎 |
| 2 | `SCOPE_AGREED` | Scope & KPIs agreed | Périmètre et KPI validés | 20 | 8 | INTERNAL | MANDATE 📎 |
| 3 | `KICKOFF` | Kick-off held | Réunion de lancement tenue | 20 | 4 | INTERNAL | MANDATE |
| 4 | `REGISTRATIONS` | Registrations & accreditations filed | Immatriculations et agréments déposés | 25 | 24 | AUTHORITY | MANDATE 📎 |
| 5 | `REP_ACTIVE` | Representation live | Représentation active | 15 | 8 | INTERNAL | MANDATE 🔒 |
| 6 | `MONTHLY_REPORT` | Monthly activity report | Rapport d'activité mensuel | — | — | INTERNAL | STEADY · monthly 📎 |
| 7 | `CLIENT_REVIEW` | Client review meeting | Revue client | — | — | CLIENT | STEADY · monthly |
| 8 | `COMPLIANCE_FILING` | Statutory filing | Déclaration statutaire | — | — | AUTHORITY | STEADY · quarterly 📎 |
| 9 | `MARKET_INTEL` | Market intelligence report | Note de veille marché | — | — | INTERNAL | STEADY · quarterly |
| 10 | `RETAINER_INVOICE` | Retainer invoiced | Honoraires facturés | — | — | INTERNAL | STEADY · monthly 👁 |
| 11 | `ESCALATION_LOG` | Escalations logged & closed | Escalades enregistrées et clôturées | — | — | INTERNAL | STEADY · monthly |
| 12 | `PERFORMANCE_REVIEW` | Annual performance review | Revue annuelle de performance | 35 | 8 | CLIENT | RENEWAL 📎 |
| 13 | `RENEWAL_DECISION` | Renewal decision | Décision de renouvellement | 40 | 8 | CLIENT | RENEWAL 🔒 |
| 14 | `FILE_CLOSED` | Renewed or closed out | Renouvelé ou clôturé | 25 | 8 | INTERNAL | RENEWAL 👁 |

### 7.11 CUSTOMS_BROKERAGE — *Dédouanement*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `INSTRUCTION` | Clearance instruction received | Instruction de dédouanement reçue | 5 | 2 | CLIENT | |
| 2 | `DOCS_VERIFIED` | Documents verified | Documents vérifiés | 8 | 4 | CLIENT | 📎 |
| 3 | `HS_CLASSIFICATION` | Tariff classification | Classification tarifaire | 8 | 4 | INTERNAL | |
| 4 | `VALUATION_CHECK` | Valuation check | Contrôle de la valeur | 6 | 4 | INTERNAL | |
| 5 | `DECLARATION_PREPARED` | Declaration prepared | Déclaration préparée | 8 | 4 | INTERNAL | |
| 6 | `DECLARATION_LODGED` | Declaration lodged | Déclaration déposée | 8 | 2 | INTERNAL | 📎 |
| 7 | `ASSESSMENT_ISSUED` | Duty assessment issued | Liquidation émise | 8 | 4 | AUTHORITY | 📎 |
| 8 | `DUTIES_PAID` | Duties & taxes paid | Droits et taxes payés | 10 | 4 | CLIENT | 📎 |
| 9 | `INSPECTION` | Inspection / scanning | Inspection / scanner | 10 | 8 | AUTHORITY | |
| 10 | `QUERY_RESOLUTION` | Customs query resolved | Contentieux / réserve levé | 7 | 8 | INTERNAL | |
| 11 | `BAE_ISSUED` | Release order (BAE) issued | Bon à enlever délivré | 10 | 2 | AUTHORITY | 🔒 📎 |
| 12 | `DOCS_HANDOVER` | Cleared documents handed over | Documents dédouanés remis | 5 | 2 | INTERNAL | 📎 |
| 13 | `FINAL_INVOICE` | Final invoice issued | Facture finale émise | 4 | 8 | INTERNAL | 👁 |
| 14 | `FILE_CLOSED` | File closed | Dossier clos | 3 | 8 | INTERNAL | 👁 |

### 7.12 PROJECT_CARGO — *Cargaison Spéciale*

| # | Code | EN | FR | W | Min | Owner | Flags |
|---|---|---|---|---|---|---|---|
| 1 | `FEASIBILITY` | Feasibility & route survey | Étude de faisabilité et reconnaissance | 5 | 24 | INTERNAL | 📎 |
| 2 | `METHOD_STATEMENT` | Lift plan & method statement approved | Plan de levage et mode opératoire validés | 6 | 24 | INTERNAL | 📎 |
| 3 | `PERMITS` | Abnormal-load permits & escorts | Autorisations convoi exceptionnel et escortes | 9 | 48 | AUTHORITY | 📎 |
| 4 | `EQUIPMENT_BOOKED` | Cranes / lowbeds / space booked | Grues, porte-chars et espace réservés | 6 | 24 | INTERNAL | |
| 5 | `INSURANCE_BOUND` | Cargo insurance bound | Assurance facultés souscrite | 5 | 8 | CLIENT | 📎 |
| 6 | `ORIGIN_LOADING` | Loading at origin | Chargement à l'origine | 8 | 12 | INTERNAL | |
| 7 | `EXPORT_CLEARANCE` | Export clearance | Dédouanement export | 6 | 8 | AUTHORITY | 📎 |
| 8 | `MAIN_CARRIAGE` | Main carriage | Transport principal | 12 | 48 | CARRIER | |
| 9 | `ARRIVAL_DISCHARGE` | Arrival & heavy-lift discharge | Arrivée et déchargement lourd | 9 | 24 | TERMINAL | ⚓ |
| 10 | `IMPORT_CLEARANCE` | Import clearance | Dédouanement import | 8 | 8 | AUTHORITY | 📎 |
| 11 | `HEAVY_HAUL` | Heavy haulage to site | Transport exceptionnel vers le site | 12 | 24 | INTERNAL | |
| 12 | `SITE_DELIVERY` | Delivery & offloading at site | Livraison et déchargement sur site | 9 | 12 | INTERNAL | 🔒 📎 |
| 13 | `SITE_ACCEPTANCE` | Site acceptance | Réception sur site | 3 | 8 | CLIENT | 📎 |
| 14 | `FILE_CLOSED` | Final invoice & file closed | Facture finale et dossier clos | 2 | 8 | INTERNAL | 👁 |

---

## 8. Per-service defaults

| Service type | Default duration | Basis | Anchor | Locked stage | Open-ended |
|---|---|---|---|---|---|
| SEA_FREIGHT_IMPORT | 25 | working days | `VESSEL_ARRIVED` | `DELIVERY` | no |
| SEA_FREIGHT_EXPORT | 15 | working days | `VESSEL_DEPARTED` | `VESSEL_DEPARTED` | no |
| AIR_FREIGHT_IMPORT | 8 | working days | `FLIGHT_ARRIVED` | `DELIVERY` | no |
| AIR_FREIGHT_EXPORT | 6 | working days | `FLIGHT_DEPARTED` | `FLIGHT_DEPARTED` | no |
| HINTERLAND_TRANSIT | 20 | working days | `LEG2_ARRIVAL` | `DELIVERY` | no |
| INLAND_TRANSPORTATION | 5 | working days | `DEPARTURE` | `POD` | no |
| WAREHOUSING | 3 in / 2 out | working days | `GATE_IN` / `RELEASE_ORDER` | `GRN_ISSUED` / `GATE_OUT` | **yes** |
| END_TO_END_AIR_FREIGHT | 12 | working days | `FLIGHT_ARRIVED` | `DELIVERY_POD` | no |
| END_TO_END_SEA_FREIGHT | 35 | working days | `VESSEL_ARRIVED` | `DELIVERY_POD` | no |
| BUSINESS_REPRESENTATION | 12 | months | `MANDATE_SIGNED` | `REP_ACTIVE` / `RENEWAL_DECISION` | **yes** |
| CUSTOMS_BROKERAGE | 7 | working days | `DECLARATION_LODGED` | `BAE_ISSUED` | no |
| PROJECT_CARGO | 45 | working days | `ARRIVAL_DISCHARGE` | `SITE_DELIVERY` | no |

Every value is a seeded default the tenant can change.

---

## 9. Events, notifications, SLA scan

New domain events, all subscribable by the comms engine:

- `milestone.rebaselined` — forecast moved, with the variance and attribution
- `milestone.at_risk` — inside the risk threshold
- `milestone.overdue` — past `planned_due`
- `milestone.sla_breach_forecast` — compression floor reached, locked date
  unreachable
- `milestone.lock_released` — a locked date was moved (who, why, when)
- `milestone.reopened` — a DONE stage was un-done

The scanner is a scheduled job in the shape of `src/jobs/handlers/regie-aging.js`,
running at **06:00 and 18:00** tenant-local (configurable to hourly), computing
health and emitting only on transitions — so a stuck file does not alert twice a
day forever.

---

## 10. Build plan

**PR1 — engine + data.** Migrations (§3), the 12 × 14 seeded bilingual templates
with provenance, the working calendar + Cameroon holidays, the assumptions
register, the re-baselining engine with all four guardrails, working-time maths,
API + validators (3–15 bounds), the SLA scanner and its events, the `label` /
`label_fr` fix, and full unit tests on the pure scheduler. No UI dependency;
existing screens keep working. Merged green before PR2 starts.

**PR2 — experience.** Template editor 360 with the ⚙ policy modals (§6),
working-calendar and hours UI under Corporate Entities, per-dossier
insert/reorder with live recalculation, assumptions editor and portal rendering,
attribution scorecards, the Q-ticket module, and the injection points for the
predictive layer.

---

## 11. Open items

- Owner-tier scorecard placement — its own screen, or a tab on the party 360?
- Whether `promised_delivery_date` should also drive the invoice-readiness prompt.
- Portal: does the client see forecast movement live, or a daily digest?
