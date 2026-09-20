# Praxis LS — Smart Comms Calls: Engineering Guide

**Status:** Plan of record. Built from the feasibility review (WebRTC-in-PWA,
Groq/Whisper, browser fallback) plus the answers returned on all ten decisions
(six on scope & quality, four on bilingual code-switching and last seen).
**Read alongside:** `doc/CONVENTIONS.md` (module layout), `doc/BUILD_CONVENTIONS.md`
(document lifecycle, numbering, approval, AI), `doc/SMART_COMMS_COMPOSER.md`
(chat contracts), `doc/AI_ARCHITECTURE.md` (reads free, writes confirmed),
`doc/PUSH_NOTIFICATIONS.md` (web push is best-effort by design),
`doc/DB_ARCHITECTURE.md` (database-per-tenant).

**Audience.** An engineer or an AI agent implementing one PR chapter end to end
without needing to re-derive a decision. Every chapter is self-contained:
migrations, backend, frontend, contracts, acceptance criteria, tests, ordered
task list.

> **Binding answers, verbatim.** Two of the six answers carried standing
> instructions, and they are law in this document:
>
> - *"When Groq fails we must continue with the browser. We should never have a
>   situation of no transcripts."* → §4.5 (the transcript-never-dies guarantee).
> - *"We must try our utmost best to always have it ring… even if out of the
>   app."* → §4.6 (the ring-through matrix).

---

## 0. How to use this document

- **§1** is the decision log. It is binding. If the code disagrees with §1, the
  code is wrong.
- **§2** states what we are building and — just as importantly — what we are
  **not**, and why.
- **§3** is cross-cutting: gating, providers, budgets, testing gates, migration
  numbering. Read it once before starting any chapter.
- **§4** is the architecture: the state machine, the signaling protocol, the
  media flow, and the two standing instructions.
- **§5–§7** are the three PRs. Work them in the order given.
- **§8** is the index set (migrations, endpoints, socket events, env) and the
  v2 backlog (group calls).

Conventions used below: `→` marks a deliverable file. **MUST** / **MUST NOT**
are hard rules that a reviewer should reject a PR over. Anything marked
_(v2)_ is explicitly out of scope for this programme and is listed in §8.5.

---

## 1. Decision log

| # | Question                          | Decision                                                                                              | Consequence for the build                                                                      |
| - | --------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1 | Scope                             | **B** — 1:1 P2P now; group calls (SFU) documented as an explicit phase 2                               | Direct P2P mesh (WhatsApp/Signal/Telegram architecture for 1:1). No media server in this programme. v2 backlog §8.5. |
| 2 | Recording & consent               | **A** — always-on, live banner on both ends, tenant-level kill switch                                   | Banner is part of the call overlay from day one. Governance `calls` feature key, default ON, tenant admin can disable. |
| 3 | Summary approval                  | **A** — caller reviews an editable draft, one tap to send                                              | The pipeline never posts to chat itself. It produces a `PENDING_REVIEW` draft for the caller. No auto-post path exists in code. |
| 4 | Recording mode                    | **A** — two streams (caller + callee separately) → speaker-attributed transcript. **Plus binding:** Groq failure MUST fall through to the browser transcript — never a no-transcript state | Two `MediaRecorder`s per client, one Groq call per 60–120 s part (row 7), attributed `Caller: / Callee:` transcript. The fallback chain in §4.5 is a hard rule with an alert on the one visible failure path. |
| 5 | TURN infrastructure               | **A** — self-hosted `coturn` in docker-compose, STUN + TURN                                             | New compose service, `TURN_*` env per BUILD_CONVENTIONS, time-limited REST credentials (no static public creds). |
| 6 | Incoming call when app closed     | **A** — web push (best-effort) + presence dots & last-seen. **Plus binding:** try our utmost best to ring even out of app | Escalating ring: socket → system notification → web push, all in flight before the 60 s ring window closes. Presence is the honest floor. §4.6. |
| 7 | Code-switched calls (EN↔FR mid-call) | **A** — chunked auto-detect: each side's audio transcribed in 60–120 s parts, each part auto-detected, merged with per-part language markers | The pipeline sends **no forced language** for calls. A mid-call switch is a part boundary — both languages survive verbatim. §4.5. |
| 8 | Summary draft language            | **A** — caller's app language + one-tap regenerate in the other                                                    | The caller is the human in the loop (row 3). Key points / follow-ups stay **verbatim in the language spoken**; only the connective summary prose is in the draft language. §4.10. |
| 9 | Last-seen signal                  | **A** — app open + return-from-background + navigation beats (60 s throttle)                                       | Socket `comms:seen` from an app-wide boot connection (the comms socket moves from lazy to boot-time). §4.11. |
| 10 | Last-seen visibility              | **A** — everyone sees everyone: live online dot + last-seen text                                                   | Inhouse team tool, no per-user opt-out. Day-first display, EN + FR. §4.11. |

Derived decisions (consequences, not choices):

| D   | Decision                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **30-minute hard cap, server-enforced.** Warn at 29:00, end at 30:00. A call hung up at 29:58 still transcribes. The cap exists precisely so one upload + one summary always fits (Groq 25 MB ≈ 30 min mono audio). |
| D2  | **Signaling rides the existing comms socket.** No new transport. New `call:*` events on the Smart Comms namespace, same JWT + tenant + membership auth, same Redis adapter for multi-instance. |
| D3  | **The server is the single source of truth for call state.** Clients are renderers. The server creates the call row, owns every transition, and enforces the timers. A client that lies about the state changes nothing. |
| D4  | **Media never touches our servers.** 1:1 P2P with SRTP; TURN relays *media* only when NATs require it, and TURN traffic is encrypted. Our servers relay *signaling* only and never store SDP or candidates. |
| D5  | **Transcripts are vaulted, certified, and SHA-256-registered** like every other certified record in this codebase. The summary is the only thing posted to chat. |
| D6  | **En/fr only.** Same two languages as the rest of the workspace (transcription service, i18n). No free-text language field. |
| D7  | **Recording retention: 30 days** (tenant-overridable). Transcripts and summaries are permanent. Audio is the raw material; the text is the record. |
| D8  | **One active call per user.** A ringing/IN_CALL user who is invited again gets `call:busy`, and the inviter sees the plain sentence. |
| D9  | **Gating:** invite requires the governance `calls` feature key (default ON). Transcription usage is billed against the existing `voice` feature line — voice-to-text is voice-to-text. |

---

## 2. What we are building — and what we are not

### 2.1 We are building

An inhouse voice call between two employees of the same tenant:

1. **Dial.** A phone icon on the DIRECT conversation header and on every row of
   the InfoPane member list. Tap → the callee's device rings (in-app, system
   notification, or web push — §4.6).
2. **Call.** 1:1 P2P WebRTC, Opus, with the WebRTC baseline noise stack
   (AEC/NS/AGC) and — PR-3 — an RNNoise hardening layer for yard/forklift
   environments. Sub-50 ms one-way on LAN/WiFi, WhatsApp-grade on decent 4G.
3. **30-minute cap.** Countdown, 29:00 warning, clean server-terminated end.
4. **The brain.** Both sides are recorded (consent banner live on both ends).
   After the call: Groq/Whisper transcribes each side separately →
   speaker-attributed transcript vaulted → LLM drafts
   *summary + key points raised + follow-ups (with owner)* → the draft lands in
   the **caller's** composer, editable, one tap to send. If the caller sends it,
   the channel gets a summary card from the caller; the full transcript stays in
   the vault behind a member-gated link.
5. **The never-dies guarantee.** Groq fails → retry → browser live-capture
   transcript takes over, flagged honestly. There is no silent no-transcript
   state. §4.5.

### 2.2 We are not building (this programme)

- **Group calls.** An SFU (mediasoup self-hosted, or LiveKit Cloud) is phase 2
  — §8.5 says exactly what it would mean. The data model here deliberately does
  not pre-empt it (a call references its DIRECT channel; v2 adds a participant
  set) but does not pay for it.
- **Video.** Audio only. The P2P engine is written so a video track is a v2
  constraint change, not a rewrite.
- **GSM fallback dialling.** We do not bridge to telephony. The honest answer to
  "the call can't connect" is the chat CTA (§4.7).
- **End-to-end encryption of media.** SRTP (encrypted in transit) is the bar.
  E2E media encryption is a v2 research item — it interacts badly with the
  always-on recording requirement.
- **Call recording playback in the UI.** The recording is transcribed, then
  deleted per D7. No audio player in the product. (The vault keeps it for the
  retention window for compliance re-transcription.)
- **Native app wrapping.** We are a PWA. The two iOS PWA quirks are handled
  (§4.8) rather than "solved" by leaving the web.

### 2.3 Quality position, stated honestly

- *Vs WhatsApp:* both are Opus P2P — on the same network we are at parity. What
  we beat is latency (direct inhouse mesh, no relayed path) and features
  (attributed transcript, AI summary, follow-ups, presence). Marketing copy must
  say "WhatsApp-grade quality, inhouse latency, plus the brain."
- *Vs GSM:* Opus 24–48 kbps on 4G/5G is clearly better quality than AMR-NB
  (12.2 kbps). But GSM works where data doesn't. Every call-failure surface in
  the UI degrades to chat, and presence tells the employee which is worth
  trying.

---

## 3. Cross-cutting

### 3.1 Merge order

`PR-1 → PR-2 → PR-3`, strictly. Each PR is independently shippable behind the
`calls` flag — and that flag is **ON by default, not a rollout gate**: §1 row 2
decides it (the tenant's kill switch), §3.2 and §5.1 repeat it, and `9134` /
`9135` implement it (catalogue `default_state = 'on'`, included in every plan,
so an ordinary projection lands it 'on' with no manual step).

> **As built (PR-3), corrected.** This section originally read "off by default in
> production; on for Smart Logistics the moment its chapter's acceptance
> criteria pass — the Smart Mail pattern". That contradicted the row 2 decision
> log, §3.2, §5.1 and the seeds shipped in PR-1/PR-2, which all say the
> opposite; the code agreed with them, so the code was right and this sentence
> was wrong. The Smart Mail pattern (off everywhere, on for the pilot tenant) is
> for the `mail.*` keys, a programme that chose a per-tenant pilot. Calls did
> not: there is nothing to switch on, and the closing PR *verifies* the
> projection per tenant rather than writing anything by hand.

### 3.2 Gating & RBAC

- **Governance:** new feature key `calls` (seeded in the PR-1 migration, default
  ON). `governance.canUseFeature` at the invite endpoint and in the
  transcription job. Tenant kill switch = this flag, surfaced where the other
  feature flags are surfaced.
- **Membership:** every `call:*` socket event and every `/calls` endpoint
  re-checks channel membership server-side, exactly as messages do. A socket
  can never signal about a call it is not a participant of.
- **RBAC action:** `edit` (house spelling). No new role is needed: if you can
  message someone in a channel you can call them. The kill switch is tenant
  administration.

### 3.3 Providers

| Concern        | Provider(s)                                                                              | Fallback chain                                                                 |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Transcription  | Groq/Whisper (existing `services/ai/transcription.service.js`, en/fr hints)               | 3 retries w/ backoff → browser live-capture transcript (flagged) → visible `TRANSCRIPTION_FAILED` + ops alert + auto reprocess (§4.5) |
| Summary        | `services/ai/llm.service.js` (DeepSeek primary, Gemini fallback)                          | If the LLM is down: draft is the raw attributed transcript, labelled "summary unavailable — provider down". The transcript still exists. |
| TURN/STUN      | Self-hosted `coturn` (PR-1)                                                               | STUN-only paths still work for easy NATs; TURN down → clear "can't connect" sentence, never silence |
| Ring           | Socket → browser Notification API → web push (existing VAPID infra)                        | §4.6 matrix; presence is the floor, never faked |

### 3.4 Performance budgets

- One-way media: **< 50 ms** LAN/WiFi, **< 300 ms** good 4G. UI shows a
  connection-quality dot from `getStats()` RTT + jitter samples; > 600 ms =
  "poor connection" (the call continues — degrading is a human decision).
- Ring-to-answer path: socket ring must reach an open app in **< 2 s**; the 60 s
  ring window is shared with the push escalation (§4.6).
- Call-setup (accept → audio flowing): **< 3 s** on good networks (ICE + SRTP).
- Summary delivery (hang-up → draft in caller's composer): **< 90 s** typical
  (two ~7 MB uploads + two Groq calls at ~200× realtime + one LLM call). The
  caller sees a live "transcribing…" state on the call record, not a black box.
- Recording size: mono Opus ≈ 32 kbps → **≈ 7 MB per side per 30-min call**,
  carried as 60–120 s parts (~1–2 MB each, §4.5) — each part is one Groq call
  with its own detected language.

### 3.5 Migration numbering

Tenant schema. Next free block after `13990`:

| Migration | Contents                                                            | PR  |
| --------- | ------------------------------------------------------------------- | --- |
| `14000_comms_calls.sql`                 | `comms_call`, `comms_user_presence`, `ai_feature_flag` seed `calls` | 1   |
| `14010_comms_call_records.sql`          | `comms_call_recording` (parts), `comms_call_transcript` (per part), `comms_call_live_log`, `comms_call_summary` | 2 |
| `14020_comms_call_settings.sql`         | retention + noise-toggle tenant settings (existing settings table)   | 3   |

Numbering and reversibility gates apply (`npm run db:check:idempotency`, CI).

### 3.6 Env (`.env.example`, BUILD_CONVENTIONS §7 — DB-first where the platform
already stores it, env for deployment facts)

```
TURN_HOST=<turn host or internal service name>
TURN_PORT_TCP=3478
TURN_PORT_UDP=3478
TURN_TRANSPORTS=udp,tcp
TURN_CREDENTIAL_SECRET=__rotate_me__   # HMAC secret for time-limited TURN REST credentials
TURN_CREDENTIAL_TTL=1860               # 31 min: 30 min call + margin
STUN_URLS=stun:turn.<internal>:3478    # comma-sep; compose default uses the coturn service
```

No media secrets: media is P2P; the only credential that exists is the
short-TTL TURN credential (§5.5).

### 3.7 Testing gates

Every PR: `npm run ci` at root + `npm run ci --frontend` from `client/`
(includes the dialog ban, `check:dates` for the UI, a11y). Generated docs are
regenerated, not hand-edited (`node scripts/generate-api-docs.js`).
Call-specific strategy per chapter; the standing matrix:

| Layer      | Tooling                                   | Covers                                                             |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Backend    | jest (root)                                | state machine incl. 30-min cap (fake timers), job handlers (mocked Groq success / failure / fallback), TURN credential HMAC, route authz |
| Frontend   | vitest (`client/`)                          | `call-engine` with mocked `RTCPeerConnection`, summary contract, `use-call` state, live-transcript segment parser |
| E2E        | Playwright (`client/e2e`)                   | two contexts, Chromium fake-media flags, invite → accept → hangup → (stubbed transcript job) → draft → send |
| Manual     | scripted checklist (this guide, §5.7)       | **iPhone (installed PWA)**, Android Chrome, desktop Chrome + Safari. iOS PWA is the reference device for this corridor. |

---

## 4. Architecture

### 4.1 Call state machine (server-authoritative)

```
                 invite (POST /calls)
                          │
                          ▼
            ┌──────── RINGING ────────┐
            │        │                │
   callee accepts   callee declines /  caller cancels /
            │        │   already in call   60 s ring timeout
            ▼        ▼                ▼        ▼
        IN_CALL   DECLINED        CANCELLED  NO_ANSWER
            │
            │  hangup (either end) / 30:00 cap / network-fail notice
            ▼
          ENDED  ──▶ (PR-2) transcription pipeline runs regardless of reason
```

- `RINGING` timer: **60 s** → `NO_ANSWER` (server).
- `IN_CALL` timer: **1800 s** → `ENDED(reason: max_duration)` (server). Client
  also counts down and shows the 29:00 warning — the client's timer is a
  courtesy; the server's is the law.
- `FAILED`: terminal, set when media never connected (ICE exhaustion with
  TURN). The UI says the plain sentence (§4.7).
- Every transition is a DB write **then** a socket publish (the house
  service→publish pattern). A process restart re-derives open timers from
  `comms_call` rows (`status, started_at`) on boot — no timer is in memory
  only.

### 4.2 Data model (PR-1 + PR-2 tables)

```sql
-- 14000
comms_call (
  call_id         uuid PK,
  group_id        uuid NOT NULL,          -- the DIRECT channel (1:1 by construction)
  caller_id       uuid NOT NULL,
  callee_id       uuid NOT NULL,
  status          text NOT NULL,          -- RINGING|IN_CALL|ENDED|NO_ANSWER|CANCELLED|DECLINED|BUSY|FAILED
  started_at      timestamptz,            -- RINGING created
  connected_at    timestamptz,            -- IN_CALL
  ended_at        timestamptz,
  duration_seconds int,
  end_reason      text,                   -- hangup|declined|cancelled|no_answer|busy|max_duration|ice_failed
  UNIQUE (group_id, caller_id, callee_id, started_at)
)
-- partial index: one RINGING/IN_CALL call per user (D8)

comms_user_presence (
  user_id         uuid PK,
  last_seen_at    timestamptz NOT NULL,
  -- live "online now" = socket connected (in-memory + Redis for multi-instance);
  -- this table is the persistent last-seen, flushed on heartbeat (30 s) and disconnect.
)

-- 14010
comms_call_recording (
  recording_id    uuid PK,
  call_id         uuid NOT NULL,
  side            text NOT NULL,          -- 'caller' | 'callee'
  vault_ref       text NOT NULL,          -- vaulted audio
  media_type      text NOT NULL,          -- audio/webm;codecs=opus | audio/mp4 (Safari)
  size_bytes      bigint NOT NULL,
  duration_seconds int NOT NULL
)

comms_call_transcript (
  transcript_id   uuid PK,
  call_id         uuid NOT NULL,
  side            text NOT NULL,          -- 'caller' | 'callee'
  text            text NOT NULL,
  language        text NOT NULL,          -- 'en' | 'fr'
  provider        text NOT NULL,          -- 'groq' | 'browser-live'
  certified       boolean NOT NULL,       -- true only for provider-from-vaulted-bytes (D5)
  created_at      timestamptz NOT NULL
)

comms_call_summary (
  summary_id      uuid PK,
  call_id         uuid NOT NULL UNIQUE,
  summary_text    text NOT NULL,
  key_points      jsonb NOT NULL,         -- [{ "text", "raised_by": "caller"|"callee" }]
  follow_ups      jsonb NOT NULL,         -- [{ "text", "owner": "caller"|"callee", "due": null|"YYYY-MM-DD" }]
  provenance      text NOT NULL,          -- 'groq' | 'browser-live' | 'transcript-only'
  draft_status    text NOT NULL,          -- PENDING_REVIEW | SENT | DISCARDED
  sent_message_id uuid,                   -- set when the caller posts it
  created_at      timestamptz NOT NULL
)
```

The attributed transcript (what the LLM and the vault link render) is derived:
`Caller: <parts in seq order>` / `Callee: <parts in seq order>`, each part
carrying its detected language. A mid-call switch shows up as a language
change between parts — never re-guessed from a mix.

### 4.3 Signaling protocol (new `call:*` events on the comms socket)

Handshake auth is unchanged (JWT + Host-resolved tenant + active user). The
server validates **on every event** that the socket's authenticated user is a
participant of the named call; unknown or foreign calls are ignored (not
echoed back as errors — silence for lies).

| Event (sender → receiver)     | Payload                              | Server action                                   |
| ----------------------------- | ------------------------------------ | ----------------------------------------------- |
| `call:invite`  (caller → server) | `{ callId }`                      | already created by `POST /calls`; forwards ring |
| `call:ringing` (server → callee user room `t:<slug>:u:<uid>`) | `{ callId, from }` | — (also triggers push escalation, §4.6) |
| `call:ring_ack` (callee → server) | `{ callId }`                    | starts the push-stop clock                      |
| `call:accepted` (callee → server) | `{ callId }`                    | status IN_CALL; notifies caller                 |
| `call:declined` / `call:busy` (callee → server) | `{ callId, reason? }` | terminal status; notifies caller |
| `call:offer` / `call:answer` (participant → server) | `{ callId, sdp }` | relay to the other participant; **never stored** |
| `call:ice` (participant → server) | `{ callId, candidate }`        | relay; never stored                             |
| `call:hangup` (either → server) | `{ callId, reason }`             | status ENDED (or terminal if earlier); both notified |
| `call:ended` (server → both)  | `{ callId, durationSeconds, reason }` | UI closes; (PR-2) pipeline starts            |
| `call:summary_ready` (server → caller) | `{ callId, status }`       | caller gets the draft + notification            |
| `comms:presence` (server → tenant room) | `{ userId, online }` | presence dots; last-seen flushed on leave  |

SDP/candidate relay is the only path — the two clients never learn each
other's endpoint address from the server.

### 4.4 Media flow (PR-1 engine, PR-3 RNNoise)

```
mic ─▶ getUserMedia({ echoCancellation, noiseSuppression, autoGainControl: true })
      ─▶ [PR-3: RNNoise AudioWorklet] ─▶ RTCPeerConnection (P2P, STUN → TURN fallback)
remote track ─▶ <audio autoplay playsinline> (keep-alive, §4.8)
```

- **Codec:** Opus first via `setCodecPreferences`; adaptive bitrate
  (DTX/STAPB on); target ~32 kbps mono.
- **Resilience:** ICE restart on `disconnected` (not `failed`); TURN as the
  last ICE tier; `playoutDelayHint` set from measured RTT; jitter buffer left
  adaptive.
- **Quality dot:** sampled from `getStats()` — inbound jitter, RTT,
  packets-lost fraction. Three states: good / fair / poor.
- **RNNoise (PR-3):** `webrtc-noise-suppression`-class WASM plugin on the
  outbound track, per-user toggle (default ON — the corridor has forklifts),
  off-switch in the call overlay. This is the "better than a phone in a yard"
  layer; the baseline AEC/NS/AGC is what every app ships.

### 4.5 The transcript-never-dies guarantee (binding)

The pipeline after `ENDED`, as a job (`src/jobs/handlers/call-transcribe.js`,
modelled on `ai-transcribe.js` — same governance, same usage recording, same
"every exit marks the record" discipline):

```
1. Clients upload, at hang-up:
   - each side's recording SPLIT INTO 60–120 s PARTS (the recorder already
     holds ~5 s chunks; the client groups them — no server-side audio
     processing) → vault (media service, same path as voice notes)
   - both side LIVE segment logs → comms_call_live_log (captured during the
     call by the browser recogniser, §4.9)
2. Job, per side, per part: existing transcription.service.js with **no forced
   language** (the hint is omitted — row 7), 3 retries w/ backoff per part;
   each response's detected language is stored on the part row.
   ├─ ALL PARTS OK → transcript rows (provider 'groq', certified TRUE)
   └─ ANY PART FAILS → step 3 for that side (a transcript with one hole is
      worse than a complete flagged one — the whole side falls back)
3. FAILURE: that side's live log (§4.9) → transcript rows covering the same
   spans (provider 'browser-live', certified FALSE, one row per part span).
   Call row marked TRANSCRIPTION_FAILED (retryable) → ops alert.
   Auto-reprocess: job retry + daily sweep — when Groq is reachable again,
   the certified transcript REPLACES the flagged one (new row; the old row
   stays for audit). If the summary draft is still PENDING_REVIEW it is
   regenerated and the caller is re-notified; if already SENT, the caller is
   offered an optional "updated summary" message — never a silent rewrite of
   a sent message.
4. Summary: llm.service.js (DeepSeek → Gemini), §4.10 contract, language en/fr.
   ├─ SUCCESS → summary row, draft_status PENDING_REVIEW
   └─ FAILURE → summary row, provenance 'transcript-only', summary_text =
      the attributed transcript, labelled in the UI "summary unavailable —
      provider down". The draft is still sendable. The transcript exists.
5. call:summary_ready + push + browser notification to the CALLER.
```

**The only no-transcript state that exists** is: Groq down **and** the browser
recogniser unavailable (Firefox desktop — the recogniser is
Chrome/Edge/Safari-only) **and** the upload failed. That state is not silent:
the call record shows `TRANSCRIPTION_FAILED` with the reason, the caller sees
the sentence in the UI, and ops gets the alert. "Never a no-transcript state"
is satisfied in the only sense that is honest: it is caught, shown, alerted,
and auto-healed.

**Provenance is law.** A `browser-live` summary is visibly labelled
"generated from the in-call browser capture (unverified)". This honours the
standing rule in `client/src/features/comms/chat/browser-transcribe.ts`
(browser words are never certified into the record) while still delivering
text. Certified rows are always provider-produced from vaulted bytes.

**Code-switching and the fallback (stated plainly).** The live recogniser runs
in a single language — the caller's app language (two recognisers cannot run
at once in any shipping browser). On a code-switched call the fallback is
therefore strong in the app language and best-effort in the other. That is
exactly why the fallback is flagged and why the reprocess upgrade exists: the
flag says what the text is worth, and the retry replaces it with the
certified, per-part-detected version as soon as Groq is reachable.

### 4.6 The ring-through matrix (binding: try our utmost best)

The 60-second ring window is shared by all three channels; they escalate in
parallel, not sequence:

| Caller sees | App open, tab visible | App open, tab backgrounded | App closed (same device) | App closed / offline |
| --- | --- | --- | --- | --- |
| Channel | `call:ringing` on socket → in-app ring + ringtone | socket ring → in-app ring + **browser Notification** + ringtone | **web push** (FCM data message on Android, APNs on iOS) with the call payload + display fallback | presence dot says offline → the invite UI shows "offline — last seen 14:02" **before** the ring starts, and offers "send a message instead" |
| Fires when | t=0 | t=0 | t=5 s (no `call:ring_ack`) — never waits for the socket to be declared dead | n/a |
| Caller UI | "Ringing…" with cancel | same | same (the caller does not know or care which channel will land) | rings anyway; 60 s → NO_ANSWER → UI suggests chat |
| Answer path | tap accept | tap accept / notification action | push tap → deep link `/comms?call=<id>` → accept UI (if still RINGING) or "timed out — start a new call?" one-tap | — |

"Utmost best" is implemented as:

- **Aggressive subscription:** push subscription registered at app boot, before
  the first call attempt, and on every permission-state change. The existing
  `sendToUser` path is used verbatim.
- **High-priority data message** with `{ callId, callerId, expiresAt }`; the
  client discards expired rings (a 90-second-old ring is a chat, not a call).
- **`call:ring_ack`** from any channel stops the others.
- **Presence:** `comms:presence` on the tenant room from socket join/leave +
  30 s heartbeat; `last_seen_at` flushed to `comms_user_presence` on heartbeat
  and disconnect. The member list and the dial UI both render it.
- **The honest ceiling, stated in the UI where it matters:** iOS does not
  guarantee waking a closed PWA. When the dot is offline we say so and offer
  the message. A ringtone we cannot guarantee is worse than a truthful dot.

### 4.7 Every failure says something (house rule)

| Failure | The user sees |
| --- | --- |
| Mic permission refused / no mic | "Calls need microphone access — enable it in your browser settings, then dial again." |
| ICE exhausted (no path, TURN down) | "We can't reach each other over the network. Check your connection, or send a message — I've stayed in the channel." |
| Ring timeout | "No answer — [name] was offline / didn't answer." + chat CTA |
| Callee busy | "[Name] is already on a call." |
| 30:00 cap | "Time's up — 30-minute limit. The summary is being prepared." (the pipeline runs) |
| Transcription failed | call record: "Transcript being retried — [reason]." Caller is re-notified on success. |
| Summary LLM down | draft labelled "summary unavailable — provider down" + raw attributed transcript, still sendable |

### 4.8 iOS PWA hardening (the two known quirks)

1. **Media-capture lockup (WebKit bug 252465):** if the user force-quits the
   PWA *while a mic permission prompt is pending*, the device can lose mic
   capture until reboot. Mitigation: the invite flow requests the mic **before**
   showing anything that could tempt a force-quit mid-prompt; on every
   hang-up/decline/timeout the tracks are explicitly stopped and the
   `AudioContext` closed; the prompt is never left pending across a navigation.
2. **Wake Lock:** supported in installed PWAs from iOS 18.4, with a reported
   regression on iOS 26.1. `wake-keepalive.ts` feature-detects: wake lock when
   available → else a silent-audio-element keepalive loop (the pattern Spotify
   uses) → plus a one-time "keep your screen on during calls" hint on first
   30-minute-class call. The remote `<audio playsinline autoplay>` element
   doubles as the media-session anchor so the OS treats the call as playing
   media (the same reason voice notes already use an `<audio>` element).

### 4.9 Live-capture segment log (the fallback's raw material)

During every IN_CALL, each client also runs the browser recogniser
(`webkitSpeechRecognition`, en or fr per the app language, same source as
`components/ai/speech.ts`) on its **own** mic and appends timestamped segments
to an in-memory ring buffer persisted to IndexedDB every ~5 s. This costs
nothing (no key, no vendor), is local-only, and is exactly the data §4.5 step 3
consumes. It is **not** shown in the call UI (no transcription theatre during a
call — the call UI is a call UI) and is never displayed as a transcript
anywhere; it is only uploaded at hang-up as fallback raw material.

### 4.10 Summary contract (LLM)

Prompt receives: attributed transcript (with per-side speaker labels), call
metadata (duration, date day-first in display only, participants by name),
language. Output is strict JSON, validated by a shared Zod schema
(`packages/shared` — the API and the form agree, house rule):

```ts
{
  summary: string;          // 2–4 sentences, the "what happened"
  key_points: Array<{ text: string; raised_by: "caller" | "callee" }>;
  follow_ups: Array<{ text: string; owner: "caller" | "callee"; due: string | null }>; // ISO date, display dd/mm/yyyy
}
```

**Language rules (binding, rows 7–8).** The draft is generated in the
**caller's app language** — the caller is the human in the loop (row 3) and no
summary should ever land that its sender could not verify.
`key_points[].text` and `follow_ups[].text` stay **verbatim in the language
spoken** (they are quotations from a certified, auditable channel — silently
rewriting a business statement is exactly what this codebase's message
certification exists to prevent); only the connective `summary` prose is in
the draft language. A visible **EN / FR toggle** on the draft calls
`POST /calls/:id/summary/regenerate { language }` — one tap, new draft, old
draft discarded (PENDING_REVIEW only; a SENT summary is never regenerated,
only offered as an optional update, §4.5).

The message the caller posts is a **summary card** reusing the existing chat
card infrastructure (the `erp-card`/`link-card` pattern): header "Call summary —
[Caller] ↔ [Callee] · 12:34 · 27/09/2026", body = summary + key points +
follow-ups with owners, footer link "Full transcript" (member-gated, vaulted,
certified status shown). Posted through `smartcomm.service` with the caller as
actor — it is a normal message from the caller, auditable and exportable like
every other.

### 4.11 Last seen (WhatsApp-style, inhouse)

Decision rows 9–10. The presence machinery PR-1 builds for dialing is
generalised to the whole chat surface:

- **Signal (what counts as "opened"):** the app connects the shared comms
  socket **at boot** (today `getCommsSocket()` is lazy — created only when a
  chat thread mounts; PR-1 moves the connect to app startup). The client then
  emits `comms:seen` — throttled to one beat per 60 s — on: first connect,
  `visibilitychange` hidden→visible (the phone was face-down, they came back),
  and each route navigation.
- **Storage:** the server writes `comms_user_presence.last_seen_at` on
  connect, beat, and disconnect; live "online now" = socket connected (Redis,
  so multi-instance agrees). One table serves both the dot and the text.
- **Display:** under the name in the conversation list and in the InfoPane
  member list — `last seen today at 14:02` / `last seen yesterday at 09:15` /
  `last seen 27/09/2026 at 14:02`, with the FR equivalents (`vu hier à
  09:15`…), rendered with the house day-first formatters (never raw
  `toLocaleDateString`), plus the online dot while the socket is live.
- **Visibility:** every tenant member sees every other's (row 10). No
  per-user opt-out.
- **Cost:** one small socket event per navigation/minute, one upsert per beat.
  Nothing new in the transport, the auth, or the rooms.

---

## 5. PR-1 — "feat(comms): 1:1 voice calls — signaling, P2P engine, 30-minute cap"

**Outcome:** two employees can call each other from the PWA and the browser,
ring through (open/backgrounded/closed), hit the 30-minute cap, and see
presence. No recording, no AI. (The consent banner lands with recording in
PR-2; a PR-1 call is a normal call.)

### 5.1 Migrations

`→ migrations/tenant/14000_comms_calls.sql` — §4.2 (PR-1 tables) +
`ai_feature_flag` seed for `calls` (default ON).

### 5.2 Backend

- `→ src/modules/smartcomm/smartcomm.call.service.js` — state machine (§4.1),
  timers re-derived from rows on boot, one-call-per-user check (D8),
  invite/accept/decline/hangup/cap transitions, service→publish.
- `→ src/modules/smartcomm/smartcomm.call.repo.js`
- `→ src/modules/smartcomm/smartcomm.call.events.js`
- `→ src/modules/smartcomm/smartcomm.turn.service.js` — time-limited TURN REST
  credentials (HMAC with `TURN_CREDENTIAL_SECRET`, TTL 1860 s). Static
  public credentials are **MUST NOT**.
- `→ src/realtime/index.js` — `call:*` events (§4.3) + `comms:presence`
  (tenant room; live state in Redis so multi-instance behaves).
- `→ src/modules/smartcomm/smartcomm.routes.js` — endpoints below (or
  `smartcomm.call.routes.js` if the routes file exceeds its sensible size —
  reviewer's call, keep the existing prefix `/api/tenant/comms`).
- `→ .env.example` — §3.6.
- `→ docker-compose.yml` (+ `docker-compose.wal.yml` parity) — `coturn`
  service (udp/tcp 3478, 5349 for TLS if the firewall demands it), internal by
  default.

### 5.3 Endpoints

| Method & path | Purpose |
| --- | --- |
| `POST /api/tenant/comms/calls` `{ group_id }` | validate DIRECT channel + membership + `calls` flag + D8 → create RINGING → return `{ callId, turn: {...} }` |
| `POST /api/tenant/comms/calls/:id/accept` | → IN_CALL (caller must still be RINGING-connected; 5 s grace) |
| `POST /api/tenant/comms/calls/:id/decline` `{ reason? }` | terminal |
| `POST /api/tenant/comms/calls/:id/hangup` `{ reason }` | terminal (either participant) |
| `GET /api/tenant/comms/calls` | list (participant-only, newest first) |
| `GET /api/tenant/comms/calls/:id` | detail (participant-only) |
| `GET /api/tenant/comms/calls/:id/turn` | fresh TURN credential (participant-only) |

### 5.4 Frontend

- `→ client/src/features/comms/call/call-engine.ts` — `RTCPeerConnection`
  wrapper: constraints (§4.4), Opus preference, ICE config from
  `POST /calls` response, ICE restart, stats sampler, full teardown
  (tracks stopped, `AudioContext` closed — §4.8).
- `→ client/src/features/comms/call/use-call.ts` — hook wiring engine +
  socket events + UI state (idle → outgoing → ringing → in-call → ended +
  every failure sentence from §4.7).
- `→ client/src/features/comms/call/call-overlay.tsx` — in-call UI: avatar,
  name, live timer with 29:00 warning, quality dot, mute, speaker, end.
  Tokens only, `tr()` everywhere, no native dialogs (the "time's up" moment is
  a `<Callout>`-style in-overlay notice, never `window.alert`).
- `→ client/src/features/comms/call/incoming-ring.tsx` — ring UI + ringtone
  (reuses the `notif-sound.ts` machinery), accept/decline, notification
  fallback when backgrounded, push deep-link target `/comms?call=<id>`.
- **The icon at the top (the original ask):** phone icon on (a) the DIRECT
  conversation header — primary surface — and (b) every member row in
  `InfoPane` (`team-chat.tsx`). Offline members show the last-seen tooltip
  before the dial.
- `→ client/src/features/comms/call/wake-keepalive.ts` — §4.8.
- **App-wide socket boot** (§4.11): the shared comms socket connects at app
  startup, not on first chat open — presence and last-seen are app-level
  concerns from day one.
- `comms:seen` beat (§4.11): first connect / return-from-background /
  navigation, 60 s client-side throttle.
- **Last seen under names** (conversation list + InfoPane member rows):
  day-first, EN + FR, online dot while live (§4.11).

### 5.5 TURN security

Credentials are per-call, TTL 1860 s, scoped to the callee+caller transport
session. `coturn` runs with `use-auth-secret` + `web-auth-secret` HMAC mode.
**MUST NOT** ship a static `--user` in compose.

### 5.6 Tests

- jest: state machine (all transitions + illegal ones), 30-min cap and 60 s
  ring timeout with fake timers, timer re-derivation after simulated restart,
  TURN credential HMAC (valid / expired / wrong secret), route authz
  (stranger to a call → 403/404 per house conventions), D8 busy.
- vitest: `call-engine` with a mocked `RTCPeerConnection` (offer/answer/ICE
  restart/teardown), `use-call` state transitions, quality sampler.
- Playwright: two contexts with `--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream`: dial → ring visible in context B →
  accept → both in-call → hangup → call listed with duration.
- Manual checklist (§3.7): the standing three devices, incl. closed-app push
  ring on Android and the honest-offline sentence on iOS.

### 5.7 Acceptance criteria

1. Dial from the DIRECT header icon and from the InfoPane member row — both work.
2. Callee gets: in-app ring (open app), notification (backgrounded), push (closed app, Android), truthful offline state (iOS closed app).
3. A call connects with audible two-way audio on the manual matrix; quality dot moves with measured network.
4. 30:00 → both ends hang up cleanly with the cap sentence; call row `ENDED(max_duration)`, exact duration.
5. Callee on another call → inviter gets the busy sentence, call row `BUSY`.
6. Kill the callee's network mid-ring → NO_ANSWER at 60 s; kill mid-call → ICE restart, then the plain sentence if it truly can't recover; call row `FAILED(ice_failed)` or `ENDED`.
7. `calls` flag off → dial UI absent, invite endpoint 403 with the feature sentence.
8. Last seen (§4.11): open app → online dot under the name for other online
   members; close it, reopen 3 min later → `last seen today at HH:MM`
   (day-first, correct in FR); socket down → no fake dot, last-seen text only.
9. `npm run ci` green at root and in `client/`; API reference regenerated.

---

## 6. PR-2 — "feat(comms): call recording, attributed transcription, AI summary to chat"

**Outcome:** the brain. A 27-minute call produces a vaulted attributed
transcript and a reviewable summary card the caller can send to the channel in
one tap. Groq down → the browser capture carries the call, flagged honestly.

### 6.1 Migrations

`→ migrations/tenant/14010_comms_call_records.sql` — §4.2 (PR-2 tables).

### 6.2 Backend

- `→ src/modules/smartcomm/smartcomm.call.pipeline.service.js` — orchestrates
  §4.5: reads vaulted recording **parts** and the live logs, transcribes part
  by part with **no forced language** (row 7), merges the attributed
  transcript, drives the summary in the caller's app language with the
  verbatim rule (§4.10), writes the rows, notifies.
- `→ src/jobs/handlers/call-transcribe.js` — the job (enqueue on `ENDED`);
  governance-gated (`calls`), usage recorded against `voice` (D9), retry +
  daily reprocess sweep, ops alert on the terminal-failure path (§4.5).
- `→ src/modules/smartcomm/smartcomm.routes.js` —
  - `POST /api/tenant/comms/calls/:id/recording` `{ side }` (upload via the
    existing media service, same path as voice notes) + `live_segments` jsonb
  - `POST /api/tenant/comms/calls/:id/summary/send` — creates the chat message
    via `smartcomm.service` (caller as actor), flips draft to SENT, links
    `sent_message_id`
  - `POST /api/tenant/comms/calls/:id/summary/discard`
  - `GET /api/tenant/comms/calls/:id/transcript` — member-gated attributed
    transcript + provenance (certified vs flagged), parts carrying their
    detected language (row 7)
  - `GET /api/tenant/comms/calls/:id/summary` — the current draft state
  - `POST /api/tenant/comms/calls/:id/summary/regenerate` `{ language }` — the
    caller's EN/FR draft toggle (§4.10); PENDING_REVIEW only
- `→ packages/shared` — the summary Zod schema (§4.10), used by both sides.
- `→ src/modules/smartcomm/smartcomm.ai.js` — the call surface (reads: list
  calls, call detail with transcript/summary) so Praxis AI can answer "what
  calls happened today" — house rule, every module is wired or carries an
  explicit `// ai:none` (this one is wired).
- Recording retention sweep (D7, 30 days default) — the existing jobs
  infrastructure.

### 6.3 Frontend

- `→ client/src/features/comms/call/call-recorder.ts` — **two**
  `MediaRecorder`s (local mic stream + remote track), the house
  `pickMimeType()` logic from `voice-recorder.tsx` (webm/opus, Safari
  mp4/aac), chunks to IndexedDB every ~5 s (crash-tolerant), final blob at
  hang-up, upload per side.
- `→ client/src/features/comms/call/live-transcript.ts` — §4.9 (recogniser,
  en/fr, IndexedDB segments, uploaded at hang-up; invisible in the call UI).
- **Consent banner (decision 2):** both ends see, from the first second of the
  call, "This call is recorded and summarized — both parties are informed" in
  the overlay. Not dismissible during the call.
- `→ client/src/features/comms/call/summary-draft.tsx` — post-call: the
  caller's composer arrives pre-filled with the summary card draft
  (summary + key points + follow-ups, editable body), live "transcribing…" →
  "ready" state, **Send** / **Edit** / **Discard**, and the **EN / FR toggle**
  (one tap → `summary/regenerate`, §4.10). Provenance label visible whenever
  `provider` is `browser-live` or `transcript-only`.
- `→ client/src/features/comms/chat/call-summary-card.tsx` — the posted card
  (§4.10) with the member-gated "Full transcript" link.
- Post-call notification to the caller: socket + push + browser notification
  ("Call summary ready — review and send").

### 6.4 Tests

- jest: pipeline with mocked Groq — success (certified rows), failure→fallback
  (flagged rows, `TRANSCRIPTION_FAILED`, alert emitted), reprocess upgrade
  (certified replaces flagged, draft regenerated only while PENDING_REVIEW,
  sent summary never rewritten), LLM-down path (transcript-only draft),
  send-message actor is the caller, retention sweep, **per-part language
  handling** (a part sequence EN, EN, FR, FR merges with per-part language
  markers and the summary follows the §4.10 language rules), and
  **regenerate** (language swap, PENDING_REVIEW only).
- vitest: recorder stream wiring (mocked `MediaRecorder`), live-transcript
  segment parser, summary schema validation (shared Zod — both sides),
  `summary-draft` state (send/edit/discard, provenance label).
- Playwright: PR-1 e2e extended: hangup → (job stubbed with a canned
  attributed transcript + summary) → draft appears pre-filled → edit one word →
  send → card in channel with transcript link → transcript endpoint returns
  attributed text.
- Manual: a real 2-minute call on the standing matrix; verify the banner on
  both ends, Groq success path, and the failure path (test with the key
  disabled in a sandbox tenant — the fallback must produce the flagged draft).

### 6.5 Acceptance criteria

1. Every ENDED call has vaulted recordings for both sides and a transcript for
   both sides — `groq` certified, or `browser-live` flagged with
   `TRANSCRIPTION_FAILED` + alert. No third state exists in the schema.
2. The summary draft arrives at the caller (not the callee) within the §3.4
   budget, editable, one-tap send; the posted message is a normal caller
   message with the summary card; the transcript is member-gated and shows
   provenance.
3. With the Groq key disabled (sandbox), the same call produces the flagged
   draft from the browser capture — and the UI says so in so many words.
4. Re-enable the key → the daily reprocess upgrades the record; the pending
   draft is regenerated; an already-sent summary is only ever offered as an
   optional update message.
5. The consent banner is present on both ends for the entire call, in both
   languages.
6. `smartcomm.ai.js` surfaces calls (read) and `npm run ci` green on both sides;
   API reference regenerated.

---

## 7. PR-3 — "feat(comms): call hardening — RNNoise, ring escalation polish, iOS quirks, observability"

**Outcome:** the programme reaches its world-class bar. Noise for the yard,
every ring channel polished, the two iOS quirks proven mitigated, the failure
surfaces observable by ops, and the standing manual matrix signed off.

### 7.1 Migrations

`→ migrations/tenant/14020_comms_call_settings.sql` — tenant settings:
recording retention (default 30 d, D7) and the RNNoise default (default ON).

### 7.2 Scope

- **RNNoise** — §4.4: WASM plugin on the outbound track, per-user toggle
  (persisted preference), settings toggle for the tenant default, overlay
  switch during the call. Test: a 30 s clip with forklift-level background
  noise — before/after listening check on the manual matrix (subjective,
  recorded in the checklist).
- **Ring escalation polish** — §4.6: notification action buttons (Accept /
  Decline) on Android + desktop, push deep-link edge cases (expired ring →
  one-tap redial), `ring_ack` stops-all verified across channels.
- **iOS quirk evidence** — §4.8: the two mitigations are already in code from
  PR-1; this PR adds the scripted regression checks to the manual checklist
  (force-quit during prompt → next dial works; 30-minute-class call with
  screen-sleep policy → call survives via keepalive on iOS 18.4+, sentence on
  26.1-regressed devices).
- **ICE & network recovery polish** — backgrounding/resuming (the PWA going to
  background mid-call — the common corridor case), network-switch recovery
  (WiFi → 4G), `playoutDelayHint` tuning from field RTT samples.
- **Observability** — call metrics into the existing ops surface: calls
  started/answered/failed per day, average duration, `TRANSCRIPTION_FAILED`
  count with reasons, ring channel distribution (socket/notification/push —
  tells us how hard push is actually working). Alert on sustained
  `TRANSCRIPTION_FAILED` (the never-dies guarantee is only as good as its
  alarm).
- **Docs** — this guide updated to as-built, `doc/API_REFERENCE.md`
  regenerated, the manual matrix checklist committed, `WORK_TO_BE_DONE` entry
  closed, v2 backlog confirmed in §8.5.

### 7.3 Tests

- vitest: RNNoise toggle wiring (mocked worklet), keepalive state machine.
- jest: metrics aggregation, alert thresholds, settings plumbing.
- Playwright: background/resume scenario on Chromium (tab → background →
  resume, call survives, audio continues).
- Manual: the full standing matrix, all three devices, signed off by a human —
  this is a voice product; a green CI is not a listening test.

### 7.4 Acceptance criteria

1. Noise: the subjective before/after check passes on the yard clip; toggle
   works per-user and per-tenant.
2. A call survives tab-backgrounding and a WiFi→4G switch on the matrix
   devices (quality dot may dip; the call must not die on a recoverable
   condition).
3. Ring: push deep-link accept works on a closed Android app; expired push
   shows the redial path; iOS closed-app behaviour is documented as-is in the
   UI (offline sentence) — no fake rings.
4. Ops: after one day of sandbox traffic, the metrics screen shows calls,
   durations, failure reasons, and ring channel split; the alert fires when
   the failure count crosses threshold (test with `ops:alert-test` patterns).
5. Manual matrix signed off for iOS PWA (reference device), Android, desktop.
6. `npm run ci` green on both sides; guide as-built; v2 backlog accurate.

### 7.5 As built (PR-3)

What shipped, and where it differs from the plan above. Nothing here is
aspirational: if a line is in this list, there is code behind it in this PR.

**RNNoise (§4.4).** `@sapphi-red/web-noise-suppressor` — an RNNoise-derived
AudioWorklet with the wasm shipped as its own asset — rather than the
`webrtc-noise-suppression` class of plugin named in the plan. It is the same
denoiser; it is the maintained packaging of it. The graph lives in
`client/src/features/comms/call/noise-suppression.ts` and is attached OFF the
media path: the call starts on the unfiltered mic track and the filtered track
is swapped in with `replaceTrack`, so there is no renegotiation and no window in
which the caller waits for a wasm fetch. **Every** failure path (no
`AudioContext`, no worklet support, a blocked `addModule`, a failed wasm fetch)
returns the unfiltered track plus a reason the overlay renders — a filter that
could take a call down is worse than no filter. The package is excluded from the
`vendor` chunk so a user who never calls never downloads it. The toggle is
covered from both ends: `call-engine.test.ts` drives the mocked worklet
(`replaceTrack` in place with no second SDP, `unavailable` leaving the raw track
on the wire, teardown closing the context) and `call-session.test.ts` checks the
honesty rule — off is instant, on is the engine's answer and is never claimed
early.

The switch is three-state on purpose: the tenant's default lives in
`setting` (`comms.call_noise_suppression`, seeded ON by `14020`), the person's
own choice lives in `/me/preferences/calls` as `true | false | null`, and
`null` means *follow the tenant* — the same absent-≠-null rule the other
preference sections use. A checkbox could not express it.

**Ring escalation (§4.6).** The delayed push is a job, not a `setTimeout`:
`createCall` enqueues `comms-call-ring-escalate` with a 5 s delay and a static
job id, and the handler re-reads the ROW before sending — answered, declined,
cancelled, swept or already acked all stand it down. The device's own ack
(`call:ring_ack`, carrying `socket`/`notification`/`push`) is written to
`ring_ack_at`/`ring_ack_channel`, broadcast to the user's other devices, and
used both to stop the push and to build the ops screen's channel split. A device
that could present nothing sends NO ack, so the escalation it would have
suppressed still fires. The notification carries Answer/Decline actions and
`tag: call:<id>` (so a second escalation replaces rather than stacks); its
body and action labels are rendered on the device from `navigator.language`,
while the server sends the caller's name as the title — a name needs no
translation. An expired link is a **redial** offer, never a ring for a call that
is over.

**ICE and recovery (§4.4, §4.7).** `disconnected` mid-call arms a 10 s recovery
window and (caller side) an ICE restart — `restartIce()` where it exists, a
re-offer with `iceRestart: true` otherwise; `failed` mid-call gets one restart
before the call is declared dead. `playoutDelayForSample` sets
`playoutDelayHint` on the receivers from the measured RTT and jitter, floored at
20 ms and capped at 500 ms, and is left alone when there is nothing to base it
on. The quality dot is fed by a 2 s `getStats()` sampler (RTT from the
nominated candidate pair, jitter and loss from inbound audio).

**Push-cold accept.** A callee who accepted from a closed app never received the
caller's offer — the socket message that carried it was published while no page
was open. `call:accepted` therefore makes the CALLER re-send its local
description when the callee has not answered. Without it, push-accept connects to
silence; with it, one extra socket frame closes acceptance criterion 3.

**Observability (§7.2).** `platform.comms_call_metric` (migration `0107`) holds
one row per tenant+env+day: outcome counts, `avg_duration_seconds` stored with
its denominator (so a range mean is weighted, not a mean of means),
`transcription_failed` with a `transcription_failed_reasons` jsonb, and the four
ring channels. The job aggregates the last 7 days nightly — repairs a worker that
was down for a long weekend — and skips a broken tenant rather than aborting the
fleet. The alert (`comms.transcription_sustained`, severity `page`) fires at the
**rate**, deduped on the row's `transcription_alert_at`, because the per-call
`notify` PR-2 already sends is the right level for one call and the wrong level
for a provider outage. The console screen is `/ops/comms` in
`platform-console/`; the tenant-facing half is one settings editor on the same
screen.

**What is NOT done here.** The human listening test and the standing device
matrix — `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` is committed with every row
`PENDING`. A machine cannot hear a forklift, and this PR does not claim it
can.

**The flags, and a correction.** There is nothing to switch on: `calls` and
`call_recording` are already ON by default, by design. `9134` / `9135` (PR-1,
PR-2) put both in the platform catalogue with `default_state = 'on'` and include
them in all three plans; the tenant migrations seed matching `feature_state`
rows; so an ordinary `projectFeatures()` lands them 'on' with no manual step —
verified in this session against a provisioned tenant (`live` and `sandbox` both
show `state='on', source='plan'`). That is §1 row 2's locked decision: for these
two keys the flag is the tenant's KILL SWITCH, not a rollout gate, and a
hand-written `INSERT` would be overwritten by the next projection anyway. §3.1's
old "off by default … on for Smart Logistics" sentence contradicted that and is
corrected in place above. The closing PR verifies the projection per tenant
(`scripts/tenant/feature-report.js --slug=…`) and the console override path;
it does not insert flag rows.

---

## 8. Index set

### 8.1 Migrations

`14000_comms_calls.sql` (PR-1) · `14010_comms_call_records.sql` (PR-2) ·
`14020_comms_call_settings.sql` (PR-3)

### 8.2 Endpoints (all under the existing comms prefix, membership-checked)

PR-1: `POST /calls` · `POST /calls/:id/accept` · `POST /calls/:id/decline` ·
`POST /calls/:id/hangup` · `GET /calls` · `GET /calls/:id` ·
`GET /calls/:id/turn`

PR-2: `POST /calls/:id/recording` · `POST /calls/:id/summary/send` ·
`POST /calls/:id/summary/discard` · `POST /calls/:id/summary/regenerate` ·
`GET /calls/:id/transcript` · `GET /calls/:id/summary`

PR-3: `GET /calls/...` unchanged — the ring acknowledgement rides the socket
(`call:ring_ack`, below) rather than adding a route the client would have to
retry. Two new routes live OUTSIDE this prefix: the per-user noise preference
(`GET|PUT /me/preferences/calls`, the identity surface the other preferences
use) and the platform ops read (`GET /api/platform/ops/comms/calls`, console
side, `ops.read`).

### 8.3 Socket events (comms namespace)

`call:invite` `call:ringing` `call:ring_ack` `call:accepted` `call:declined`
`call:busy` `call:offer` `call:answer` `call:ice` `call:hangup` `call:ended`
`call:summary_ready` `comms:presence` `comms:seen`

### 8.4 Env (new)

`TURN_HOST` `TURN_PORT_TCP` `TURN_PORT_UDP` `TURN_TRANSPORTS`
`TURN_CREDENTIAL_SECRET` `TURN_CREDENTIAL_TTL` `STUN_URLS`

PR-3: `COMMS_TRANSCRIPTION_ALERT_THRESHOLD` ·
`COMMS_TRANSCRIPTION_ALERT_WINDOW_HOURS` · `COMMS_METRICS_ALERT_INTERVAL_MS`
(the vault's `ops.tuning` overrides all three) — see §7.5.

### 8.5 v2 backlog (group calls — the phase 2 this programme deliberately does not pay for)

- **SFU:** self-hosted mediasoup service (fits the compose pattern) or LiveKit
  Cloud; a media server enters the trust boundary — re-run the security pass
  for it specifically.
- **Model:** `comms_call` gains a participant set (N rows in
  `comms_call_participant`); the DIRECT-channel 1:1 becomes a special case.
- **Recording:** per-participant streams from the SFU (cleaner than browser
  capture for attribution — the browser side of §4.5 may retire for group
  calls, surviving as the 1:1 fallback).
- **Summary:** same contract, one added field (`raised_by` becomes a name);
  the draft flow is unchanged (organizer reviews).
- **Signaling:** M:N `call:*` relay; admission control per tenant seat count.
