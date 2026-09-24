# Praxis LS — Smart Comms Calls: Engineering Guide

**Status:** Plan of record — **delivered.** All three PRs are merged to `main`
(each chapter below is stamped with its merge commit and date; §7.5 records
what actually shipped where it differed from this plan). Built from the
feasibility review (WebRTC-in-PWA, Groq/Whisper, browser fallback) plus the
answers returned on all ten decisions (six on scope & quality, four on
bilingual code-switching and last seen).
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
>   situation of no transcripts."* → §4.5. **Superseded 2026-09-24** by owner
>   decision A-1 (doc/SMART_COMMS_CALLS_AUDIT.md, PR-1): when Groq fails the
>   same audio goes to Gemini; the browser capture is removed.
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
| 4 | Recording mode                    | **A** — two streams (caller + callee separately) → speaker-attributed transcript. **Plus binding:** Groq failure MUST fall through to the browser transcript — never a no-transcript state | Two `MediaRecorder`s per client, one Groq call per 60–120 s part (row 7), attributed `Caller: / Callee:` transcript. The fallback chain in §4.5 is a hard rule with an alert on the one visible failure path. **Superseded 2026-09-24 (owner decision A-1, doc/SMART_COMMS_CALLS_AUDIT.md PR-1):** a Groq failure falls through to Gemini on the same stored audio, once; the browser live capture is removed. |
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
5. **The transcript fallback.** Groq fails → the same audio goes to Gemini,
   once. Both fail → the call says TRANSCRIPTION_FAILED, visibly. §4.5.

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

`PR-1 → PR-2 → PR-3`, strictly — and all three are now merged to `main`
(2026-09-20, in that order; each chapter below is stamped with its merge
commit). Each PR is independently shippable behind the
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
| Transcription  | Groq/Whisper (`services/ai/transcription.service.js`), then Gemini (`services/ai/gemini-transcription.service.js`) | One Groq attempt per part → one Gemini attempt on the same stored audio → visible `TRANSCRIPTION_FAILED` + ops alert + daily reprocess (§4.5). No browser fallback. |
| Summary        | `services/ai/llm.service.js`, called with Gemini first and DeepSeek as the last resort    | If both are down: draft is the raw attributed transcript, labelled "summary unavailable — provider down". The transcript still exists. |
| TURN/STUN      | Self-hosted `coturn` (PR-1)                                                               | STUN-only paths still work for easy NATs; TURN down → clear "can't connect" sentence, never silence |
| Ring           | Socket → browser Notification API → web push (existing VAPID infra)                        | §4.6 matrix; presence is the floor, never faked |

### 3.4 Performance budgets

- One-way media: **< 50 ms** LAN/WiFi, **< 300 ms** good 4G. UI shows a
  connection-quality dot from `getStats()` RTT + jitter samples; > 600 ms =
  "poor connection" (the call continues — degrading is a human decision).
- Ring-to-answer path: socket ring must reach an open app in **< 2 s**; the 60 s
  ring window is shared with the ring pushes (§4.6).
- Call-setup (accept → audio flowing): **< 3 s** on good networks (ICE + SRTP).
- Summary delivery (hang-up → draft pinned above the caller's composer):
  **< 2 min** for a 30-minute call (every part but the last was transcribed
  during the call; what is left is one ~0.5 MB part per side, its Groq call,
  and one LLM call). The caller sees a live "transcribing…" state on the call
  record, not a black box.
- Recording size: mono Opus ≈ 32 kbps → **≈ 7 MB per side per 30-min call**,
  carried as 120 s parts (~0.5 MB each, §4.5) — each part is one Groq call
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
TURN_HOST=<public TURN hostname the clients reach>
TURN_PORT_TCP=3478
TURN_PORT_UDP=3478
TURN_TRANSPORTS=udp,tcp
TURN_CREDENTIAL_SECRET=<openssl rand -hex 32>   # shared by the API and coturn
TURN_REALM=<TURN_HOST>
TURN_EXTERNAL_IP=<public IP, behind cloud NAT only>
TURN_TLS_PORT=0                                  # 443 or 5349 with TURN_TLS_CERT / TURN_TLS_KEY
TURN_MIN_PORT=49152
TURN_MAX_PORT=65535
TURN_USER_QUOTA=12
TURN_TOTAL_QUOTA=400
TURN_MAX_BPS=64000
STUN_URLS=                                       # empty: TURN_HOST's STUN, else Google's (stopgap)
TURN_TLS_DIR=                                    # host dir with a nobody-readable cert copy
```

`.env.example` documents each one. The credential TTL is not configured: it
is the call's remaining allowance plus 60 s (§5.5). Production setup: `doc/TURN_PRODUCTION_SETUP.md`
and `scripts/turn-setup.sh`.

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
- **Liveness (field note FN-1):** `IN_CALL` with **both** participants' sockets
  gone for 60 s → `ENDED(disconnected)`. The 60 s sits beyond the matrix's 20 s
  airplane row — that test drops one device, and the other is still online —
  and the 30-minute cap remains the backstop if the online registry is down.
  The client's half of the same rule: a page closing mid-call sends a
  keep-alive hang-up, so a deliberate close ends the call at once.
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
  end_reason          text,                   -- hangup|declined|cancelled|no_answer|busy|max_duration|ice_failed|disconnected
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
  provider        text NOT NULL,          -- 'groq' | 'gemini' | 'browser-live' (old calls)
  certified       boolean NOT NULL,       -- true only for provider-from-vaulted-bytes (D5)
  created_at      timestamptz NOT NULL
)

comms_call_summary (
  summary_id      uuid PK,
  call_id         uuid NOT NULL UNIQUE,
  summary_text    text NOT NULL,
  key_points      jsonb NOT NULL,         -- [{ "text", "raised_by": "caller"|"callee" }]
  follow_ups      jsonb NOT NULL,         -- [{ "text", "owner": "caller"|"callee", "due": null|"YYYY-MM-DD" }]
  provenance      text NOT NULL,          -- 'groq' | 'gemini' | 'browser-live' | 'transcript-only'
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
| `call:ringing` (server → callee user room `t:<slug>:<env>:u:<uid>`; the env keeps sandbox rings off live tabs) | `{ callId, from }` | — (the ring push goes to every device at the same moment, §4.6) |
| `call:ring_ack` (callee → server) | `{ callId, channel }`           | records the ring-channel metric only; stops nothing (PR-4) |
| `call:accepted` (callee → server) | `{ callId }`                    | status IN_CALL; notifies caller                 |
| `call:declined` / `call:busy` (callee → server) | `{ callId, reason? }` | terminal status; notifies caller |
| `call:offer` / `call:answer` (participant → server) | `{ callId, sdp }` | relay to the other participant; **never stored** |
| `call:ice` (participant → server) | `{ callId, candidate }`        | relay; never stored                             |
| `call:hangup` (either → server) | `{ callId, reason }`             | status ENDED (or terminal if earlier); both notified |
| `call:ended` (server → both)  | `{ callId, durationSeconds, reason }` | UI closes; (PR-2) pipeline starts            |
| `call:summary_ready` (server → caller) | `{ callId, status }`       | a toast pointing at Comms › Calls; the draft is on `/comms/calls/:id` |
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

### 4.5 The transcript pipeline

Rebuilt in the calls audit's PR-2 (doc/SMART_COMMS_CALLS_AUDIT.md). The work
happens while the call is still going, part by part, so the summary is ready
about a minute after hang-up whatever the call's length. Code:
`src/modules/smartcomm/smartcomm.call.pipeline.service.js`, jobs
`call-transcribe-part` and `call-finalise`.

```
1. Record. Each side records 120 s parts. Every part is its own MediaRecorder,
   started with no timeslice, so every part is a complete file with its own
   header (a timesliced stream only has a header in its first chunk). The next
   recorder starts before the previous one stops. Mono Opus, 32 kbps. Parts go
   through an IndexedDB outbox that retries with backoff and resumes on the
   next app load, so the last part survives a tab closed at hang-up.
2. Upload (POST /calls/:id/recording). The server checks the container
   signature (WebM EBML, MP4 ftyp, Ogg OggS), accepts only calls that connected
   and are IN_CALL or ended less than 15 minutes ago, caps a part at 125 s and
   12 MB and a side at 50 MB, writes the row and then the bytes in one
   transaction, under a key fixed by (call, side, part). A part that already
   has a result is acknowledged and left alone.
3. Transcribe, one job per part (`callpart-<call>-<side>-<part>`), as soon as
   it is uploaded. Owner decision O1: Groq once (SDK retries off); on ANY Groq
   error the same stored part goes to Gemini once (webm/mp4/ogg converted to
   FLAC first); if Gemini fails too the part has FAILED. Nothing retries it
   automatically. Each part's result is stored on its recording row and its
   words as a certified transcript row. No database connection is held while
   a provider works.
4. Declare (POST /calls/:id/recording/complete { side, parts }). Each side
   says how many parts it made, 0 included, when its recorder stops.
5. Finalise (`callfinal-<call>`), queued the moment both sides have declared
   and every declared part has a result. At hang-up a deadline finalise is
   also queued for ended_at + 10 min (`callfinaldl-<call>`), for a side that
   never declares; it starts any part whose job never ran and waits for it.
   Finalise assembles the attributed transcript. It is CERTIFIED only when
   every declared part of both sides is; otherwise it is TRANSCRIPTION_FAILED
   and the draft names the minutes that are missing ("Not transcribed:
   02:00–04:00 (Awa Diallo).").
6. Summary: Gemini first, DeepSeek as the last resort (O2), §4.10 contract.
   The transcript goes to the model between <transcript> delimiters, labelled
   untrusted, capped at 60,000 characters.
   ├─ SUCCESS → summary row, draft_status PENDING_REVIEW
   └─ FAILURE → provenance 'transcript-only', summary_text = the attributed
      transcript, labelled "summary unavailable — provider down".
   A draft is only written over a PENDING_REVIEW draft; one sent or discarded
   meanwhile is left as it is.
7. One notification to the CALLER, claimed once on
   comms_call_summary.notified_at, opening the conversation with the draft
   pinned above the composer (/comms?channel=<group>&summary=<call>, owner
   decision O3). A finalise started by the daily sweep never notifies.
```

**Re-runs.** Finalise is idempotent: with nothing new since `finalised_at` it
calls no provider and no LLM. A part that settles later (an admin's re-run)
redrafts a PENDING_REVIEW draft without a second push. The only automatic
re-runs are for work that never happened: a part whose job never ran or died
(3 runs, then it is closed as failed) and a finalise that never ran (5 runs).
The daily sweep, a cron (COMMS_CALL_RECORD_SWEEP_CRON, default `0 10 * * *`
in COMMS_CALL_RECORD_SWEEP_TZ, default Africa/Douala), restarts those and
applies audio retention; it does not touch a part that failed on both
providers. An administrator (MOD-70 edit) can re-run such a part from the
call's page (POST /calls/:id/recording/:side/:part/rerun), at most 3 times.
Calls with nothing to transcribe (recording off, nothing uploaded, never
connected) end as NO_RECORDING and are never picked again.

**Sending.** `POST /calls/:id/summary/send` runs in one transaction: it claims
the draft (PENDING_REVIEW → SENDING, with the caller's final words), writes
the message, and marks the draft SENT with it. A second tap finds nothing to
claim; a failed write rolls the claim back. The message's broadcast and
notifications go out after the commit. (Migration 14010's comment says this
already held; it did not until PR-2.)

**Old calls.** Calls from before the change may still have `browser-live`
rows (the retired in-call capture). They are read and rendered as before,
labelled "generated from the in-call browser capture (unverified)", and a
later certified run retires them (kept for audit, no longer current). The
`/live-log` upload route answers 410 Gone (calls audit PR-3).

**Processors.** Call audio goes to Groq, and to Google (Gemini) when Groq
fails. Transcripts go to Google (Gemini) for the summary, and to DeepSeek only
when Gemini is down.

### 4.6 The ring-through matrix (binding: try our utmost best)

The 60-second ring window is shared by all three channels; they escalate in
parallel, not sequence:

| Caller sees | App open, tab visible | App open, tab backgrounded | App closed (same device) | App closed / offline |
| --- | --- | --- | --- | --- |
| Channel | `call:ringing` on socket → in-app ring + ringtone | socket ring → in-app ring + **browser Notification** + ringtone | **web push** (FCM data message on Android, APNs on iOS) with the call payload + display fallback | presence dot says offline → the invite UI shows "offline — last seen 14:02" **before** the ring starts, and offers "send a message instead" |
| Fires when | t=0 | t=0 | t=0 to every device, then every 15 s while it rings (at most 4 re-alerts) — since PR-4; PR-3 waited 5 s and skipped the push if any device acked | n/a |
| Caller UI | "Ringing…" with cancel | same | same (the caller does not know or care which channel will land) | rings anyway; 60 s → NO_ANSWER → UI suggests chat |
| Answer path | tap accept | tap accept / notification action | push tap → deep link `/comms?ring=<id>` → accept UI (if still RINGING) or "timed out — start a new call?" one-tap | — |

"Utmost best" is implemented as:

- **Aggressive subscription:** push subscription registered at app boot, before
  the first call attempt, and on every permission-state change. The existing
  `sendToUser` path is used verbatim.
- **High-priority data message** with `{ callId, callerId, expiresAt }`; the
  client discards expired rings (a 90-second-old ring is a chat, not a call).
- **Rings stop everywhere when the call is answered, declined or ends**, not
  when one device acks: a cancel push replaces the ring on every device, and
  `call:accepted` / the terminal events stop open tabs (PR-4). `call:ring_ack`
  only records which channel landed. (PR-3 had the ack stop the others, which
  let one open laptop tab silence the phone: audit A12.)
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
| Transcription failed | the draft names the minutes that could not be transcribed; the call record shows "Transcript failed" and lists them. Nothing retries a part that failed on both providers; an administrator can re-run it from the call record. |
| Summary LLM down | draft labelled "summary unavailable — provider down" + raw attributed transcript, still sendable |
| Call lost — both devices gone (FN-1) | "The call was lost — the connection ended." Dial is available at once; the row is `ENDED(disconnected)`. |

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

### 4.9 Live-capture segment log (removed)

The in-call browser recogniser was removed on 2026-09-24 (owner decision A-1):
it sent live microphone audio to Google through the Web Speech API, chimed on
Android, and its text was never certifiable. `comms_call_live_log` keeps the
rows old calls already have; the `/live-log` route answers 410 Gone since
calls audit PR-3, and nothing builds a transcript from it.

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

## 5. PR-1 — "feat(comms): 1:1 voice calls — signaling, P2P engine, 30-minute cap" · **DELIVERED**

**Status:** built, tested and merged — PR #455, merge commit `fc028af3e8`,
2026-09-20, all CI checks green. Delivered as specified in this chapter:
`14000` + the platform seed `9134`, the `smartcomm.call.*` service and the
TURN credentials, the `call:*` signaling, the call overlay and ring, and the
presence/last-seen machinery (§4.11). The human half of §5.7's acceptance —
real devices, real noise, a real ring — is the standing manual matrix; its
sign-off state is recorded in `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` and
§7.5, not here.

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
  credentials (HMAC with `TURN_CREDENTIAL_SECRET`, per call, TTL = the call's
  remaining time + 60 s; §5.5). Static public credentials are **MUST NOT**.
- `→ src/realtime/index.js` — `call:*` events (§4.3) + `comms:presence`
  (tenant room; live state in Redis so multi-instance behaves).
- `→ src/modules/smartcomm/smartcomm.routes.js` — endpoints below (or
  `smartcomm.call.routes.js` if the routes file exceeds its sensible size —
  reviewer's call, keep the existing prefix `/api/tenant/comms`).
- `→ .env.example` — §3.6.
- `→ docker-compose.yml` — `coturn`
  service (udp/tcp 3478, 5349 for TLS if the firewall demands it), internal by
  default.

### 5.3 Endpoints

| Method & path | Purpose |
| --- | --- |
| `POST /api/tenant/smartcomm/calls` `{ group_id }` | validate DIRECT channel + membership + `calls` flag + D8 → create RINGING → return `{ callId, turn: {...} }` |
| `POST /api/tenant/smartcomm/calls/:id/accept` | → IN_CALL (caller must still be RINGING-connected; 5 s grace) |
| `POST /api/tenant/smartcomm/calls/:id/decline` `{ reason? }` | terminal |
| `POST /api/tenant/smartcomm/calls/:id/hangup` `{ reason }` | terminal (either participant) |
| `GET /api/tenant/smartcomm/calls` | list (participant-only, newest first) |
| `GET /api/tenant/smartcomm/calls/:id` | detail (participant-only) |
| `GET /api/tenant/smartcomm/calls/:id/turn` | fresh TURN credential (participant-only) |

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
  fallback when backgrounded, push deep-link target `/comms?ring=<id>`.
  (`/comms?call=<id>` is the old summary-notification link; it now redirects
  to `/comms/calls/<id>` and never rings.)
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

(Rewritten by calls audit PR-3, C1–C3.) Credentials are minted only for a
RINGING or IN_CALL call. The username is `<expiry>:<turn_token>`, a random
token stored on the call row, so relay logs name the call and never a person;
the TTL is the call's remaining allowance plus 60 s. `coturn` runs from
`docker/coturn/docker-entrypoint.sh` with `use-auth-secret` and
`static-auth-secret` (the API's `TURN_CREDENTIAL_SECRET`), denies private,
loopback, link-local, CGNAT and ULA peers, has no TCP relay, and has
per-credential and total quotas and a bandwidth cap. `scripts/turn-check.sh`
proves allocation and the refusals on a deployed relay. **MUST NOT** ship a
static `--user` in compose.

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

## 6. PR-2 — "feat(comms): call recording, attributed transcription, AI summary to chat" · **DELIVERED**

**Status:** built, tested and merged — PR #456, merge commit `c9db715402`,
2026-09-20, all CI checks green. Delivered as specified in this chapter:
`14010` + the platform seed `9135`, the pipeline service and the
`call-transcribe` job, the recording/transcript/summary routes, the
two-`MediaRecorder` capture, the consent banner, and the summary draft and
card. The human half — a real call producing a real transcript on the matrix
devices — sits in the same standing manual matrix.

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
- `→ src/jobs/handlers/call-transcribe-part.js` and `call-finalise.js` — the
  per-part transcription and the finalise (§4.5, rebuilt in the calls audit's
  PR-2); governance-gated (`calls`), usage recorded against `voice` (D9), ops
  alert on a call's first failure. They replace the whole-call
  `call-transcribe` job.
- `→ src/modules/smartcomm/smartcomm.routes.js` —
  - `POST /api/tenant/smartcomm/calls/:id/recording` `{ side }` (upload via the
    existing media service, same path as voice notes) + `live_segments` jsonb
  - `POST /api/tenant/smartcomm/calls/:id/summary/send` — creates the chat message
    via `smartcomm.service` (caller as actor), flips draft to SENT, links
    `sent_message_id`
  - `POST /api/tenant/smartcomm/calls/:id/summary/discard`
  - `GET /api/tenant/smartcomm/calls/:id/transcript` — member-gated attributed
    transcript + provenance (certified vs flagged), parts carrying their
    detected language (row 7)
  - `GET /api/tenant/smartcomm/calls/:id/summary` — the current draft state
  - `POST /api/tenant/smartcomm/calls/:id/summary/regenerate` `{ language }` — the
    caller's EN/FR draft toggle (§4.10); PENDING_REVIEW only
- `→ packages/shared` — the summary Zod schema (§4.10), used by both sides.
- `→ src/modules/smartcomm/smartcomm.ai.js` — the call surface (reads: list
  calls, call detail with transcript/summary) so Praxis AI can answer "what
  calls happened today" — house rule, every module is wired or carries an
  explicit `// ai:none` (this one is wired).
- Recording retention sweep (D7, 30 days default) — the existing jobs
  infrastructure.

### 6.3 Frontend

- `→ client/src/features/comms/call/call-recorder.ts` — this device's side
  only, one `MediaRecorder` per 120 s part (§4.5), the house `pickMimeType()`
  logic (webm/opus, Safari mp4/aac); `call-upload-outbox.ts` keeps each part
  in IndexedDB until the server acknowledges it.
- ~~`client/src/features/comms/call/live-transcript.ts`~~ — removed with §4.9.
- **Consent banner (decision 2):** both ends see, from the first second of the
  call, "This call is recorded and summarized — both parties are informed" in
  the overlay. Not dismissible during the call.
- `→ client/src/features/comms/call/summary-draft.tsx` — the caller's draft
  editor (summary + key points + follow-ups, editable prose), "transcribing…"
  → "ready", **Send** / **Discard** (confirmed first), and the **EN / FR
  switch** (→ `summary/regenerate`, §4.10). It is embedded in the call's own
  page, `/comms/calls/:callId` (`call-record.tsx`), which the Calls list
  (`calls-list.tsx`, `/comms/calls`) opens. The provenance label is always
  shown.
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
3. With the Groq key disabled (sandbox), the same call is transcribed by
   Gemini (provenance `gemini`, still "Transcribed from the call recording").
   With both keys disabled the call shows "Transcript failed".
4. Re-enable the keys → the daily reprocess upgrades the record without a
   push; the pending draft is regenerated; an already-sent summary is only
   ever offered as an optional update message.
5. The consent banner is present on both ends for the entire call, in both
   languages.
6. `smartcomm.ai.js` surfaces calls (read) and `npm run ci` green on both sides;
   API reference regenerated.

---

## 7. PR-3 — "feat(comms): call hardening — RNNoise, ring escalation polish, iOS quirks, observability" · **DELIVERED**

**Status:** built, tested and merged — PR #457, merge commit `b29b036add`,
2026-09-20, all CI checks green. This chapter is the programme's closing bar;
what actually shipped where it differed from this plan is recorded in §7.5,
including the one gate a machine cannot hold — the human listening test and
the device matrix.

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
`setting` (`comms.call_noise_suppression`, seeded ON by `14020`; turned OFF by
`14070` in calls-audit PR-4 until the filter is verified on devices), the person's
own choice lives in `/me/preferences/calls` as `true | false | null`, and
`null` means *follow the tenant* — the same absent-≠-null rule the other
preference sections use. A checkbox could not express it.

**Ring escalation (§4.6).** *Superseded by calls-audit PR-4: the ring push now
goes to every device at t=0 and re-alerts every 15 s; the ack is the metric only;
a cancel push replaces the ring when it ends (see §4.6 and
`doc/SMART_COMMS_CALLS_AUDIT.md` §6). What PR-3 delivered:* The delayed push is a job, not a `setTimeout`:
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

**Closing-PR verification of the flags (2026-09-20).** The owner's instruction
for the close was verify-only: document the mechanism, prove the projection,
change nothing — and the code confirms what this document has always said.
Re-verified line by line in the closing PR: `migrations/seeds/9134_seed_calls_feature.sql`
and `migrations/seeds/9135_seed_call_recording_feature.sql` put both keys in
`platform.feature_catalogue` with `default_state = 'on'` and include them in
**all three plans** (`platform.plan_feature`, one `included = true` row per
plan); `migrations/tenant/14000_comms_calls.sql:105` and
`migrations/tenant/14010_comms_call_records.sql:279` seed the bootstrap
`feature_state` rows (`'on'`, `source = 'default'`) so the gate cannot 403 a
tenant before its first projection; `projectFeatures()`
(`src/services/platform/provisioning.service.js:469`) then recomputes every
key as *override → plan → default* — a plan-included key with no override
lands `state = 'on', source = 'plan'` — and upserts the result into **both**
`live` and `sandbox` `feature_state` with `projected_at = now()`
(`provisioning.service.js:510`). The routes gate on exactly these rows:
`requireFeature("calls")` and `requireFeature("call_recording")`
(`src/modules/smartcomm/smartcomm.routes.js:172,179`), mounted across the
`/calls` routes, and `tests/security/feature-catalogue-coverage.test.js` fails
a PR if the catalogue half ever drifts from the tenant half. Per-tenant live
verification on a running environment is
`scripts/tenant/feature-report.js --slug=…` (read-only, safe against
production). The closing PR inserts no flag rows, adds no migration, and
writes no override.

---

## 8. Index set

### 8.1 Migrations

`14000_comms_calls.sql` (PR-1) · `14010_comms_call_records.sql` (PR-2) ·
`14020_comms_call_settings.sql` (PR-3) · calls audit: `14040_comms_call_vocab_and_notified.sql`,
`14050_comms_call_part_pipeline.sql`

### 8.2 Endpoints (all under `/api/tenant/smartcomm`, membership-checked)

PR-1: `POST /calls` · `POST /calls/:id/accept` · `POST /calls/:id/decline` ·
`POST /calls/:id/hangup` · `GET /calls` · `GET /calls/:id` ·
`GET /calls/:id/turn`

PR-2: `POST /calls/:id/recording` · `POST /calls/:id/summary/send` ·
`POST /calls/:id/summary/discard` · `POST /calls/:id/summary/regenerate` ·
`GET /calls/:id/transcript` · `GET /calls/:id/summary`

Calls audit PR-2: `POST /calls/:id/recording/complete` ·
`POST /calls/:id/recording/:side/:part/rerun` (MOD-70 edit). The thread read
(`GET /channels/:id/messages`) carries `pending_call_summaries`.

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
`TURN_CREDENTIAL_SECRET` `STUN_URLS`; since calls audit PR-3 also
`TURN_REALM` `TURN_EXTERNAL_IP` `TURN_TLS_PORT` `TURN_TLS_CERT` `TURN_TLS_KEY`
`TURN_MIN_PORT` `TURN_MAX_PORT` `TURN_USER_QUOTA` `TURN_TOTAL_QUOTA`
`TURN_MAX_BPS` (and `TURN_CREDENTIAL_TTL` is gone).

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

**Verified accurate against the code — closing PR, 2026-09-20.** `git grep`
across `src/`, `migrations/`, `client/`, `packages/` and the lockfiles found
nothing of this phase 2 built or pre-empted: no `comms_call_participant` (or
any participant set) anywhere; no mediasoup or LiveKit dependency;
`comms_call` is still the two-column `caller_id`/`callee_id` 1:1 model (the
repo derives the counterparty as `CASE WHEN caller_id = $2 THEN callee_id
ELSE caller_id END`); `raised_by`/`owner` remain the `'caller' | 'callee'`
enum in the shared Zod schema (`packages/shared/schemas/call-summary.js`),
the validator and the pipeline prompt; `comms_call_recording.side` is
CHECK-constrained to `'caller' | 'callee'` — per-side browser capture, not
per-participant SFU streams. Nothing in the built work anticipates group
calls; the programme paid for 1:1 and only 1:1.
