# Smart Comms Calls — integration audit and fix plan

**Date:** 2026-09-24 · **Scope:** the 1:1 voice-call integration merged in PRs
#454–#459 (commits `0231e59` → `bd77700`): about 9,000 lines of product code
across the backend, worker jobs, realtime layer, migrations, the tenant client,
the service worker and the platform console. **Method:** I read every file in
that diff and traced each user-visible symptom to the code path that causes it.
Every finding cites `file:line`. Nothing here was run against production data;
§0 gives the queries that confirm the root cause on a live tenant.

**Verdict.** The server-side state machine (guarded transitions, the
one-active-call partial indexes) and the database schema are sound and worth
keeping. The **record pipeline's scheduling and notifications, the client call
engine, the recorder, the call screen and the TURN deployment** are broken
badly enough that they should be rebuilt rather than patched. Section 5 says
what to keep, rebuild and remove. A targeted rebuild of those parts costs less
than starting from scratch, because the parts worth keeping are the hard ones
to get right.

| Severity | Count | Meaning |
| --- | --- | --- |
| CRITICAL | 7 | Wrong for every user or every call, or loses/corrupts data. Fix first. |
| HIGH | 31 | Security hole, cross-tenant scale failure, or a feature that does not work in real use. |
| MEDIUM | 36 | Real defect with a narrower blast radius. |
| LOW | 9 | Hygiene, misleading docs, minor leaks. |

---

## How to use this document (read first if you are fixing a PR)

The fix is split into **six PRs** (§3), done **one at a time, in order**. Each
PR is done in its own chat, starting from the latest `main` after the previous
PR has merged. Several PRs edit the same files, so running them in parallel
causes conflicts.

If you are the agent working on one of them:

1. **Read, in this order:** `CLAUDE.md`; §0 and §1 of this document; your PR's
   section in §3; §4 if you are on PR-2 or PR-5; every entry in the **Progress
   log (§6)**. Earlier PRs may have changed a file, a name or a plan you depend
   on, and the log is where they said so.
2. **Check the previous PR is merged.** Its Progress row must say `MERGED`. If
   it does not, stop and tell the owner.
3. **Re-verify each finding before you change anything.** The `file:line`
   references were correct on 2026-09-24 and will drift. Confirm the defect
   still exists in the current code. If one no longer applies, record that in
   your Progress entry and move on.
4. **Stay in scope.** Fix only your PR's IDs. If you find a new defect, add it
   to "New findings" in your Progress entry. Fix it only if it is small and in a
   file you are already changing; otherwise leave it for the PR that owns that
   area.
5. **Test first.** For each finding, where practical, write a test that fails
   on the current code, then fix it. A finding without a test is not fixed.
6. **Follow the repo's gates** (`CLAUDE.md`):
   - Run the full `npm run ci` before every push; a subset run is not evidence.
   - Regenerate `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md` with
     `node scripts/generate-api-docs.js` when you add or change an `AppError`
     or a route.
   - Migrations: take the next free number; include a DOWN section. An
     existing table may only gain **plain columns**; dropping a constraint is
     allowed, adding one is not (`tests/unit/migration-constraint-ordering.test.js`).
   - Frontend: no native dialogs, no `<input type="date">` or
     `<input type="file">`, no raw palette colours, day-first dates.
7. **Leave the code more honest than you found it.** Correct any false
   statement in the docs or comments you touch (H3). Cut essay comments in the
   files you edit down to short "why" notes (H4). Do not add new essays.
8. **PR hygiene.** The title uses a Conventional Commits prefix (the one given
   in your section). The description follows `.github/pull_request_template.md`
   and lists the IDs fixed, the IDs deferred (with the reason) and the test and
   gate results.
9. **Before the PR merges, update §6.** Set your row's status, add your log
   entry (what changed, deviations from this plan, new findings, anything the
   next PR must know) and commit it on your PR branch. The next agent starts
   from your entry.

---

## 0. Stop the bleeding (today, before any code change)

The nightly notifications come from the `comms-call-record-sweep` job (§1). It
is registered again every time the worker boots, so it **cannot be switched off
from configuration**. Turning the `call_recording` feature off does not stop it
either: the pipeline never checks that flag (A5). Until the PR-1 hotfix
ships, park the affected calls so the sweep's two queries no longer select
them.

**1. Confirm the pattern** (run in the tenant database, live schema):

```sql
-- When do the summary notifications land? Expect a spike at 00:00–00:59 UTC.
SELECT date_trunc('hour', created_at) AS hour_utc, count(*)
  FROM notification
 WHERE event_type_key = 'comms.call_summary_ready'
 GROUP BY 1 ORDER BY 1 DESC LIMIT 72;

-- How many times has each call been re-announced?
SELECT entity_ref, count(*) AS times, min(created_at), max(created_at)
  FROM notification
 WHERE event_type_key = 'comms.call_summary_ready'
 GROUP BY entity_ref ORDER BY times DESC LIMIT 20;

-- The calls that feed the loop.
SELECT c.call_id, c.status, c.duration_seconds, c.transcription_state,
       c.transcription_attempts, left(c.transcription_error, 120) AS error,
       s.draft_status
  FROM comms_call c LEFT JOIN comms_call_summary s USING (call_id)
 WHERE c.status IN ('ENDED','FAILED')
   AND c.transcription_state IS DISTINCT FROM 'CERTIFIED'
 ORDER BY c.started_at DESC LIMIT 50;
```

**2. Park them.** Run this per tenant database, in the live schema and, where it
exists, the sandbox schema. Take a backup first. The marker makes it
reversible:

```sql
BEGIN;
-- Out of listFailedTranscriptions (attempts < 20).
UPDATE comms_call
   SET transcription_attempts = 20,
       transcription_error = coalesce(transcription_error, '') || ' [parked 2026-09-24 audit]'
 WHERE transcription_state = 'TRANSCRIPTION_FAILED';
-- Out of listUntranscribedEndedCalls (NULL / PENDING / stale PROCESSING).
UPDATE comms_call
   SET transcription_state = 'TRANSCRIPTION_FAILED',
       transcription_attempts = 20,
       transcription_error = coalesce(transcription_error, '') || ' [parked 2026-09-24 audit]'
 WHERE status IN ('ENDED','FAILED')
   AND (transcription_state IS NULL OR transcription_state IN ('PENDING','PROCESSING'));
COMMIT;
```

New calls still enter the pipeline when they end. This stops the backlog, not
the defect. If calling should be off until PR-1 ships, switch the `calls`
feature off for the tenant in the platform console. That hides nothing already
queued, so run the SQL as well.

---

## 1. Root cause: the 01:00 "review and send the summary of your call" notifications and the "fake calls"

Seven defects combine. Each is listed in §2 with its fix; this is the chain:

1. **The daily sweep runs at 00:00 UTC, which is 01:00 in Douala/Lagos/Kinshasa.**
   `workers.js:366-367` registers it with `repeat: { every: 86_400_000 }`.
   BullMQ 5.79.3 (the locked version) computes the next run as
   `floor(now / every) * every + every` (`dist/cjs/classes/repeat.js:184`), so
   the run is aligned to the Unix epoch: midnight UTC. (A1)
2. **Most summaries are first created by that sweep, not after the call.**
   The only trigger after hang-up is one job delayed 20 s
   (`smartcomm.call.service.js:393-397`). The comments say uploads re-trigger
   the job when the last part lands, but nothing calls `startPipeline` from the
   upload path (only `call.service.js:394` and the sweep). If either side's
   audio has not arrived after 20 s, the job returns `waiting` and nothing runs
   again until the nightly sweep. The summary, and its push, are then created
   at 01:00. (A2)
3. **Every call longer than about 2 minutes fails transcription.** The
   recorder cuts one continuous `MediaRecorder` stream into 2-minute "parts"
   (`call-recorder.ts:181,214`). Only the first chunk of a WebM/MP4 stream
   carries the container header, so parts 2..N cannot be decoded. The provider
   rejects them, the whole side falls back, and the call goes to
   `TRANSCRIPTION_FAILED`. (A3)
4. **Failed calls are reprocessed and re-announced every night, 20 times.**
   `listFailedTranscriptions` retries until `transcription_attempts < 20`
   (`smartcomm.call.repo.js:315-319`). Each run re-drafts the summary and calls
   `notifySummaryReady` (`smartcomm.call.pipeline.service.js:742-779`), which
   sends an in-app notification and a web push. It also raises an ops alert
   and makes a billed LLM call. (A4)
5. **Calls with no audio at all go through the same path.** This covers
   recording switched off, calls from before PR-2, zero-second calls, and calls
   where the recorder never armed. The LLM is prompted with
   `"(no words were captured for this call)"` (`pipeline.service.js:295`) and
   its output is presented as your call's summary. (A5)
6. **You cannot open the draft, so you cannot stop it.** The review panel only
   opens on the `call:summary_ready` socket event (`call-session.ts:680`). That
   event is published from the worker process, where the socket server does
   not exist, so `publishToUser` does nothing (`realtime/index.js:438-439`).
   Tapping the notification opens `/comms?call=<id>`
   (`pipeline.service.js:921`). The client reads that as an incoming-call link
   (`ring-surface.ts:176`) and shows **"That call has already ended — Call
   again"** (`call-session.ts:819`, `comms-live.tsx:206-229`). You are offered
   a redial for a call you did not miss, and because the draft is never sent or
   discarded, step 4 continues. (A6)
7. **Other sources of "calls I never placed":**
   - Ring pushes are pinned (`requireInteraction`) and nothing clears them when
     the app was closed. (A7)
   - The Answer/Decline buttons on the notification both just open the app. (A8)
   - Sandbox (training) calls ring on live devices. (A9)
   - A call whose tab was closed stays open and is recorded as a **30-minute
     call**. The hang-up-on-close request goes to a URL that does not exist,
     and the liveness sweep crashes. (A10, B1)

---

## 2. Findings

Each finding lists **Where / What / Fix**. IDs are grouped by area:
A = notifications and phantom calls, B = backend correctness,
C = security, D = multi-tenant scalability, E = client engine,
F = call UI, G = privacy, H = tests and docs.

### A. The notification loop and phantom calls

**A1 · CRITICAL · The daily sweep fires at 01:00 West Africa Time**
- Where: `src/jobs/workers.js:366-367`
- What: `every: 24h` is aligned to the epoch by BullMQ, so it runs at 00:00 UTC.
  Every tenant's reprocess, LLM calls and pushes land at 01:00 WAT. The same
  instant is also a fleet-wide load spike (D2).
- Fix: use a cron `pattern` in the tenant's timezone during working hours, or
  run hourly in small batches. Never notify from a sweep (A4).

**A2 · CRITICAL · No trigger after the last upload, so summaries are created at night and transcripts are silently cut short**
- Where: `smartcomm.call.service.js:385-397` (single delayed enqueue);
  `smartcomm.call.pipeline.service.js:351-400` (`registerPart` never enqueues);
  `pipeline.service.js:649-654`.
- What: the pipeline runs once, 20 s after hang-up.
  - If one side has not uploaded yet, it returns `waiting` and nothing re-runs
    it until the nightly sweep.
  - If both sides have some parts but a side's last part has not arrived,
    `missing` is empty and the pipeline **certifies a transcript that lacks the
    end of the call**. `part_count` is a running index, not a declared total,
    so the gap cannot be detected.
- Fix: the client sends a final "side complete" request (`POST
  /calls/:id/recording/complete {parts: N}`). The server enqueues the job when
  both sides are complete or at a hard deadline. Certify only when every
  declared part is present.

**A3 · CRITICAL · Parts after the first are undecodable, so every call over about 2 minutes fails**
- Where: `client/src/features/comms/call/call-recorder.ts:181`
  (`rec.start(CHUNK_MS)`), `:214` (`groupChunks` of later chunks).
- What: with a timeslice, only the first `dataavailable` blob has the WebM
  EBML/Tracks header (fragmented MP4 on Safari has the same property). Part 2
  and later are headerless clusters that Whisper/ffmpeg cannot decode, so the
  side falls back and the call becomes `TRANSCRIPTION_FAILED`, feeding A4.
- Fix: stop and restart the `MediaRecorder` at each part boundary so every part
  is a complete file, or upload one continuous file with resumable chunked
  upload. Add a server-side probe of the container header before accepting a
  part.

**A4 · CRITICAL · The same call is re-announced every night for up to 20 nights**
- Where: `smartcomm.call.repo.js:315-319`; `pipeline.service.js:742-779,908-928`.
- What: every reprocess of a `TRANSCRIPTION_FAILED` call with a
  `PENDING_REVIEW` draft upserts the draft and pushes "Call summary ready".
  Each run also raises a `comms.transcription_failed` ops alert
  (`pipeline.service.js:725`) and makes a billed LLM call.
- Fix: notify once, when a draft is first created, and again only if a sent
  summary gains an update. Suppress notifications from sweep runs. Record the
  notification in a `notified_at` column and check it before sending.

**A5 · HIGH · Calls with no audio are summarised by the LLM anyway**
- Where: `smartcomm.call.repo.js:342-359` (`status IN ('ENDED','FAILED')`,
  state NULL); `pipeline.service.js:599-790` (no `recordingEnabled` check);
  `:295` (empty transcript placeholder).
- What: this covers tenants with recording off, calls from before PR-2,
  zero-length calls, and devices where the recorder never armed. The result is
  a `TRANSCRIPTION_FAILED` state, an ops alert, a "summary" drafted from
  nothing, and a push.
- Fix: process a call only if recording is on and at least one part or
  live-log segment exists. Otherwise set a terminal `NO_RECORDING` state and
  send nothing.

**A6 · CRITICAL · The draft cannot be opened, and the notification offers a redial instead**
- Where: `client/src/features/comms/call/call-session.ts:680` (only opener);
  `src/realtime/index.js:438-439` (no-op in the worker);
  `pipeline.service.js:921` (`/comms?call=`);
  `ring-surface.ts:172-181` (any `?call=` is treated as a ring);
  `call-session.ts:814-822`; `comms-live.tsx:206-229`.
- What: users are pushed to review a draft that no screen can open. The link
  shows "That call has already ended — Call again", and pressing it places a
  real call. Because the draft is never sent or discarded, A4 never stops.
- Fix: give summaries their own route (`/comms/calls/:id/summary`) and a
  "Calls" list with pending drafts. Use a distinct deep-link parameter for
  rings (`?ring=`). Publish worker-side socket events through
  `@socket.io/redis-emitter` (D-section).

**A7 · HIGH · Ring notifications stay on the lock screen after the call ends**
- Where: `smartcomm.call.service.js:698-730` (`requireInteraction: true`);
  `client/public/push-handler.js:68-124` (ignores `data.expires_at`).
- What: when the app was closed, nothing closes the push after the call
  times out or is answered elsewhere. "Incoming call from X" with Answer/Decline
  stays pinned for hours, and tapping it later produces the redial banner.
- Fix: on every terminal transition, send a data-only "call-ended" push that
  closes tag `call:<id>` in the service worker. In the push handler, schedule a
  close at `expires_at`.

**A8 · HIGH · The notification's Answer/Decline buttons do nothing different**
- Where: `client/public/push-handler.js:127-150`;
  `ring-surface.ts:93` (`ringUrl` without `act`).
- What: `notificationclick` handles only `dismiss`. Accept and Decline both
  navigate to the same URL, so Decline opens the app and the ring continues.
  The `act=accept|decline` handling in `call-session.ts:771-812` is
  unreachable.
- Fix: map `event.action` to `?ring=<id>&act=…`. For Decline, POST the decline
  from the service worker using a short-lived per-call action token, so the app
  does not need to open.

**A9 · HIGH · Sandbox (training) calls ring and notify on live devices**
- Where: `src/realtime/index.js:45` (`userRoom = t:<slug>:u:<uid>`, no env).
- What: every `call:*` event from the sandbox schema reaches the user's live
  sockets. Accepting then returns 404 on the live API, which looks like a ghost
  call.
- Fix: include the env in the user room (`t:<slug>:<env>:u:<uid>`) and join
  the socket's own env room.

**A10 · HIGH · A closed tab leaves a phantom 30-minute call**
- Where: `client/src/features/comms/call/call-session.ts:475` posts to
  `/api/tenant/comms/calls/:id/hangup`, but the route is
  `/api/tenant/smartcomm/calls/:id/hangup`, so it always 404s. The liveness
  sweep is broken too (B1, B2).
- What: the call stays `IN_CALL` until the 30-minute cap. History records a
  30:00 call (`durationSeconds` clamps to 1800), both users show as busy for 30
  minutes, and the call enters the summary pipeline.
- Fix: correct the URL, and have the e2e test exercise the real path (H1).

**A11 · MEDIUM · The notification does not say which call, and is English-only**
- Where: `pipeline.service.js:915-923`.
- What: "Call summary ready — Review and send the summary of your call." has
  no name, date or duration, so it is unrecognisable, especially when repeated.
  It is server-side English for French users, and it is sent at any hour (no
  quiet hours).
- Fix: include the counterpart and time. Localise via the service worker the
  way ring strings are. Respect quiet hours.

### B. Backend correctness (state machine and record pipeline)

**B1 · CRITICAL · The liveness sweep violates the database CHECK and crashes**
- Where: `smartcomm.call.service.js:552` (`reason: "disconnected"`) against
  `migrations/tenant/14000_comms_calls.sql:60-61`, which allows only hangup,
  declined, cancelled, no_answer, busy, max_duration and ice_failed.
- What: the UPDATE fails with 23514, the sweep job throws every 15 s for that
  tenant, and the abandoned call is never ended. On the pooled sandbox path the
  whole sweep runs in one transaction (`registry.service.js:480-490`), so the
  failure also rolls back that tick's NO_ANSWER and max-duration transitions,
  and sandbox rings never time out.
- Fix: map it to an allowed reason, or widen the vocabulary in a migration
  that follows the constraint-ordering rule (`migration-constraint-ordering.test.js`).
  Add a test that runs `sweepLiveness` against a real schema.

**B2 · HIGH · The liveness rule ends calls when only ONE device is gone**
- Where: `smartcomm.call.service.js:546` (`Math.min`).
- What: the documented rule is "both gone for 60 s". With `min`, one device
  gone 60 s plus a momentary blip on the other ends the call. Peer-to-peer
  audio keeps working without the socket, so this cuts healthy calls.
- Fix: use `Math.max`.

**B3 · HIGH · The online/offline registry never expires**
- Where: `src/realtime/index.js:350-386`; `call.service.js:513-560`.
- What: SET members are removed only on a clean disconnect. A crashed or
  redeployed replica leaves ghost "online" users forever, so liveness never
  fires for them. Offline ZSET entries are never cleared for calls that end
  normally. Both keys grow without bound.
- Fix: per-socket keys with a short TTL refreshed by heartbeat. Check liveness
  with `EXISTS`/`SCAN` per user. Delete the call's ZSET entries on every
  terminal transition.

**B4 · CRITICAL · Reprocessing crashes forever once one side is certified, and re-bills Groq nightly**
- Where: `smartcomm.call.repo.js:434-464` (retires only `browser-live` rows);
  `:350-352` (stale `PROCESSING` is selected with no attempts cap);
  `pipeline.service.js:656-657`.
- What: when the certified side is re-inserted it hits
  `uq_comms_call_transcript_current` (23505). The job fails after setting
  `PROCESSING`, and the stale-`PROCESSING` branch picks it up again every night
  with no cap. Each night the certified side is transcribed and billed again
  (twice, since the job has 2 attempts), and the call shows "Transcribing…"
  forever.
- Fix: skip sides whose current rows are already certified. Retire any
  current row being replaced. Cap attempts on the `PROCESSING` branch too.

**B5 · HIGH · Head-of-line starvation in the reprocess**
- Where: `smartcomm.call.repo.js:342-359` (`ORDER BY ended_at ASC LIMIT 25`);
  `pipeline.service.js:126-133,607`.
- What: FAILED calls that never connected match the query, but `processCall`
  skips them without changing their state. They take the oldest 25 slots every
  night. Once a tenant has 25 of them, which is common without TURN, no other
  call is ever retried. B4's stuck rows add to this.
- Fix: exclude ineligible calls in SQL, and mark every skip with a terminal
  state.

**B6 · HIGH · A summary sent or discarded during processing comes back as a draft**
- Where: `pipeline.service.js:613` (read) then `:764-771` (upsert minutes
  later); `smartcomm.call.repo.js:503-510` (`draft_status = 'PENDING_REVIEW'`
  on conflict).
- What: a SENT summary returns to `PENDING_REVIEW` with `sent_message_id`
  still set, so it can be sent again. A DISCARDED one is revived and pushed
  again.
- Fix: `ON CONFLICT … DO UPDATE … WHERE comms_call_summary.draft_status =
  'PENDING_REVIEW'`, plus a row lock (`SELECT … FOR UPDATE`) or an optimistic
  version column.

**B7 · HIGH · Double-posting a summary, and the claimed atomic write does not exist**
- Where: `pipeline.service.js:1080-1136`; `smartcomm.call.repo.js:558-567`
  (no status guard); request handlers run in autocommit
  (`middleware/tenant-context.js:120-157`).
- What: a double tap or two tabs post two messages. A failure after
  `postMessage` leaves the draft `PENDING_REVIEW` and sendable again. Migration
  14010 says "NO code path posts without this write happening in the same
  transaction", which is false.
- Fix: one transaction. Claim the draft first with
  `UPDATE … SET draft_status='SENDING' WHERE draft_status='PENDING_REVIEW'
  RETURNING`, then post, then mark it SENT.

**B8 · MEDIUM · Terminal transitions do not record who acted**
- Where: `smartcomm.call.service.js:356-369` (`actorUserId: null`).
- Fix: pass the actor through `endCall` for hang-up, decline and fail; use
  `null` only for the sweep.

**B9 · MEDIUM · The client chooses the recorded end reason**
- Where: `smartcomm.validator.js` (`callHangup` enum includes `max_duration`,
  `no_answer` and `busy`); `smartcomm.controller.js` (`hangupCall` passes it
  through).
- What: an IN_CALL→ENDED transition can be labelled `max_duration` after 10
  seconds, which pollutes the metrics. The server is not authoritative here,
  despite the file's own claim.
- Fix: the server derives the reason and ignores the body.

**B10 · MEDIUM · Dead branch in the duration calculation**
- Where: `smartcomm.call.service.js:349`: `status === "IN_CALL"` is never
  true there, so the `max_duration` branch of `durationSeconds` never runs.
- Fix: pass `reason`.

**B11 · MEDIUM · The validator allows 60-minute parts but the column allows 120 s, after storage is already written**
- Where: `smartcomm.validator.js` (`duration_ms` max 3,600,000);
  `14010:94` (CHECK ≤120); `pipeline.service.js:376-388` (storage `put`
  before the insert).
- What: a slightly long part, for example from a throttled background tab,
  fails after its bytes are written. The object is orphaned and the part is
  lost.
- Fix: cap at 125,000 ms in the validator, and write the row before promoting
  the object.

**B12 · MEDIUM · Re-uploads orphan audio, so it is never purged (retention violation)**
- Where: `pipeline.service.js:376` (a new random key per upload);
  `smartcomm.call.repo.js:224-231` (overwrites `vault_ref`).
- What: the previous object stays in storage forever, beyond the tenant's
  retention window.
- Fix: use a deterministic key per (call, side, part), or delete the old
  object on replace.

**B13 · MEDIUM · Uploads accepted for any call at any time**
- Where: `pipeline.service.js:351-400,445-454`.
- What: uploads are accepted for NO_ANSWER, DECLINED, CANCELLED and months-old
  calls. There is no per-call byte quota, `part_index` is not checked against
  `part_count`, the live log accepts unbounded `seq` values, and
  `live_segments` sent with the audio are ignored by the controller
  (`smartcomm.controller.js` `uploadCallRecording`).
- Fix: accept uploads only while the call is IN_CALL or recently ENDED
  (15-minute window) and it connected. Add a per-call byte and segment cap.

**B14 · MEDIUM · Two copies of `recordingEnabled` with opposite failure behaviour**
- Where: `smartcomm.call.service.js:61-72` fails closed;
  `pipeline.service.js:313-319` throws.
- Fix: one helper.

### C. Security vulnerabilities

**C1 · HIGH · The TURN relay is an SSRF path into the host and Docker networks**
- Where: `docker-compose.yml:161-179` (`network_mode: host`, no
  `--denied-peer-ip`, no quotas).
- What: any credential holder can ask coturn to relay to RFC1918, Docker
  bridge and link-local (cloud metadata) addresses. That reaches Postgres and
  Redis on the host network. This is a well-known TURN misconfiguration.
- Fix: add `--denied-peer-ip` for 0.0.0.0/8, 10/8, 100.64/10, 127/8,
  169.254/16, 172.16/12, 192.168/16 and ::1/fc00::/7; keep
  `--no-loopback-peers` and `--no-multicast-peers`; add `--user-quota`,
  `--total-quota` and `--max-bps`; pin the image version; firewall the relay
  port range.

**C2 · HIGH · Anyone can mint TURN credentials, for any past call, without limit**
- Where: `smartcomm.turn.service.js:43-62` (username = expiry only);
  `smartcomm.call.service.js:756-761` (`turnFor` accepts any call the user ever
  joined, whatever its status); no rate limit; one secret for every tenant.
- What: any employee can generate unlimited 31-minute relay credentials that
  anyone can use. Nothing ties a credential to a call, user or tenant, so
  there is no attribution or targeted revocation. The comments at
  `call.service.js:753-755` claim the credential is user-scoped; it is not.
- Fix: issue credentials only for RINGING or IN_CALL calls. Use
  `<expiry>:<opaque-call-token>` as the username so relay logs can be
  attributed. Rate-limit issuance, and keep TTL at the call's remaining time
  plus a margin.

**C3 · HIGH · TURN is probably not working at all, so calls fail on mobile CGNAT**
- Where: `docker-compose.yml:179` (`TURNSHAREKEY`); `.env.example`
  (`TURN_HOST=` empty by default); the `turn` compose profile is opt-in.
- What: coturn does not read a `TURNSHAREKEY` variable. `--use-auth-secret`
  needs `--static-auth-secret`, so minted credentials are rejected. There is
  also no `--realm`, no `--external-ip` (needed behind cloud NAT) and no
  TLS/443 listener. Most deployments are STUN-only, which cannot connect the
  carrier-grade NAT mobile networks the corridor uses, and those failures then
  feed B5.
- Fix: correct the coturn flags, add a `turns:` listener on 443/TLS, and add a
  deployment health check that allocates a relay with `turnutils_uclient`.

**C4 · HIGH · IDOR: any member can surface another pair's call summary in any channel**
- Where: `smartcomm.validator.js` (`attachment` accepts
  `attachment_kind:"CALL", call_id`); `smartcomm.service.js:122-131` (stored
  unchecked); `pipeline.service.js:1033-1049` (`cardsForCallIds` has no
  participant or status filter).
- What: posting an ordinary message with a CALL attachment pointing at someone
  else's call id resolves its summary, key points, follow-ups, participant
  names, duration and transcription errors. That includes unsent
  `PENDING_REVIEW` and `DISCARDED` drafts. Call ids appear in push payloads,
  URLs, audit logs and ops alerts.
- Fix: reject `CALL` attachments on the generic message route (only
  `sendSummary` may create one). When resolving cards, require
  `sent_message_id = message_id` and `draft_status = 'SENT'`.

**C5 · MEDIUM · The signalling relay works for dead calls, has no size or rate limits, and uses a DB connection per event**
- Where: `src/realtime/index.js:262-335` (`otherParticipant` has no status
  filter, `repo.js:127-134`).
- What: a past participant can push SDP offers into the other person's client
  at any time. Payloads are unvalidated and can be any size up to socket.io's
  1 MB default. Every ICE candidate opens a tenant DB connection, so a flood of
  events exhausts the tenant pool.
- Fix: relay only for RINGING or IN_CALL calls. Cache the participant pair per
  socket for the call's lifetime. Validate SDP (type, ≤ 64 KB), rate-limit
  per socket, and set `maxHttpBufferSize`.

**C6 · MEDIUM · Call bombing, and rings reaching deactivated employees**
- Where: `smartcomm.routes.js` (`POST /calls` has no throttle);
  `smartcomm.call.repo.js:149-159` (`directPartner` has no `status =
  'ACTIVE'` check).
- What: a dial/cancel loop rings and pushes a colleague every few seconds, and
  there is no block or do-not-disturb. A deactivated employee's registered
  phone still receives "Incoming call from X".
- Fix: per-caller and per-callee dial rate limits, a block/DND option,
  callee must be ACTIVE, and delete push subscriptions on deactivation.

**C7 · MEDIUM · Unbounded client text is sent to the LLM (cost and prompt injection)**
- Where: `smartcomm.validator.js` (`callLiveLog` 2,000 × 2,000 chars, repeatable
  with new `seq`); `pipeline.service.js:191-207,269-299`.
- What: a participant can force a fallback (upload unreadable audio) and feed
  megabytes of chosen text into the prompt. The tenant is billed for it and the
  text can steer the summary.
- Fix: cap total live-log characters per side (for example 60 k), delimit and
  label untrusted transcript text in the prompt, and cap tokens.

**C8 · MEDIUM · Regenerate is an unmetered LLM call inside the request**
- Where: `pipeline.service.js:1175-1230`; `smartcomm.routes.js`
  (`/summary/regenerate`).
- What: the request's DB lease is held during the LLM call. There is no rate
  limit, and no "language must differ" check despite the comment, so re-rolls
  are unlimited.
- Fix: enqueue the regeneration as a job, rate-limit it, and enforce the
  language change.

**C9 · MEDIUM · Presence writes have no server-side throttle**
- Where: `src/realtime/index.js:348-386`.
- What: every `comms:seen` event and every connect or disconnect writes
  `comms_user_presence`. One client can flood it.
- Fix: throttle per socket on the server; coalesce writes through Redis.

**C10 · MEDIUM · The AI assistant bypasses the recording kill switch**
- Where: `smartcomm.ai.js` reads `comms_call_transcript` and
  `comms_call_summary`, gated only on MOD-64 view.
- What: the HTTP routes also require `call_recording`; the AI path does not.
- Fix: check the feature flag in the manifest reads.

**C11 · LOW · Vendor error text leaks to users**
- Where: `transcription_error` is returned in cards and summaries
  (`pipeline.service.js:1037-1040,1009-1010`).
- Fix: map to a reason code.

**C12 · LOW · Google STUN is used by default, contrary to the template**
- Where: `smartcomm.turn.service.js:31`.
- What: every client's address is sent to Google. `.env.example` says an empty
  value means the STUN server is omitted; it is not.
- Fix: default to the tenant's own STUN/TURN.

**C13 · LOW · Peer-to-peer calls expose employees' IP addresses to each other**
- What: host and server-reflexive candidates reveal each participant's network
  location, and there is no relay-only option.
- Fix: offer a tenant setting for `iceTransportPolicy: "relay"`.

### D. Multi-tenant isolation and scalability

**D1 · HIGH · A 15-second fleet-wide sweep, run serially**
- Where: `src/jobs/workers.js:355-357`; `comms-call-sweep-scheduler.js`;
  `workers.js` (`comms-call-sweep` concurrency 1).
- What: every 15 s there is one job per tenant×env, each opening a tenant
  connection and running 2 queries plus Redis reads, including tenants that
  have never made a call. It runs 24/7. With concurrency 1, one slow tenant
  delays ring timeouts and the 30-minute cap for every other tenant. The
  scheduler also reads the platform DB every 15 s.
- Fix: per-call delayed jobs (ring timeout at +60 s, cap at +30 min, liveness
  check at +N) are the primary clock, with a low-frequency safety sweep that
  only visits tenants with active calls (tracked in a Redis set).

**D2 · HIGH · A midnight thundering herd with no per-tenant fairness**
- Where: `comms-call-record-sweep-scheduler.js:20-40`; `workers.js`
  (`call-transcribe` concurrency 2).
- What: 2 jobs per tenant×env are queued at 00:00 UTC for the whole fleet. A
  single platform Groq key and LLM budget are shared, so provider 429s cause
  more failures, which cause more reprocessing. One tenant's backlog starves
  every other tenant's transcripts.
- Fix: spread tenants across the day (hash the slug to an hour), use
  per-tenant queues or group rate limits (BullMQ groups), and back off on
  provider 429s.

**D3 · HIGH · Pooled DB connections are held while waiting on third parties**
- Where: `jobs/handlers/call-transcribe.js:34-35` wraps the whole
  `processCall` (`pipeline.service.js:599-790`): per-part Groq calls with
  retries and sleeps, then the LLM.
- What: each job holds a connection for minutes. On the pooled sandbox path it
  is one long open transaction (`registry.service.js:480-490`).
- Fix: fetch state, release the connection, call the vendors, then reacquire
  a connection for short writes.

**D4 · HIGH · An hourly fleet fan-out for metrics, with full scans**
- Where: `jobs/handlers/comms-call-metrics.js:47-57`;
  `services/platform/comms-metrics.service.js:84-198`.
- What: the alert tick re-aggregates every tenant×env serially every hour.
  That is exactly the fan-out the file header says it avoids.
  `WHERE started_at >= $1` has no supporting index: 14020's claim that
  `ix_comms_call_group (group_id, started_at)` serves it is wrong.
- Fix: increment counters at each terminal transition (in Redis or a platform
  table), aggregate daily, and add `ix_comms_call_started (started_at)` in a
  new migration.

**D5 · MEDIUM · The sustained-failure alarm mixes sandbox and live, and pages on no-audio calls**
- Where: `comms-metrics.service.js:332-341` (`GROUP BY tenant_slug` only).
- Fix: group by `(tenant_slug, env)`, alert on live only, and exclude
  `NO_RECORDING` (A5).

**D6 · MEDIUM · Presence fan-out is O(N²) and wrong with more than one replica**
- Where: `src/realtime/index.js:372,383` (tenant-wide broadcast per connect or
  disconnect); `:56` (per-process socket counter).
- What: mobile reconnect storms broadcast to the whole tenant. A user
  connected to two replicas is shown offline when one tab closes.
- Fix: keep presence in Redis with TTL keys; clients subscribe only to their
  contacts' presence and fetch a snapshot on connect.

**D7 · MEDIUM · One tenant DB connection per ICE candidate**
- Where: `src/realtime/index.js:266-272`.
- Fix: cache the participant pair per socket per call (see C5).

**D8 · MEDIUM · Unbounded Redis keys per tenant**
- Where: the online SET and offline ZSET never expire (B3).

**D9 · MEDIUM · Unbounded queries**
- Where: `smartcomm.call.repo.js:263-272` (purge read has no LIMIT and deletes
  serially); `smartcomm.repo.js` `PARTNER_SQL` (three correlated subqueries
  per channel row on every channel-list read).
- Fix: batch the purge (LIMIT 500 and loop); use one lateral join for the
  partner.

**D10 · MEDIUM · The live log re-uploads the whole list every 30 s**
- Where: `client/src/features/comms/call/live-transcript.ts:209`.
- What: bytes and DB upserts grow O(n²) over a 30-minute call.
- Fix: send only new segments (track the last acknowledged `seq`).

**D11 · LOW · Metric days can be off by one**
- Where: `comms-metrics.service.js:75,88,134`.
- What: `date_trunc` uses the tenant session's timezone, node-pg parses
  `date` into local time, and `toISOString` then shifts the day when the
  process timezone is not UTC.
- Fix: `(started_at AT TIME ZONE 'UTC')::date` and return `metric_date::text`.

**D12 · LOW · The wrong "env" is logged**
- Where: `smartcomm.call.service.js:738` logs `process.env.NODE_ENV` as the
  tenant env.

### E. Client call engine, recorder and live capture

**E1 · HIGH · ICE restart never happens, so any network change drops the call after 10 s**
- Where: `client/src/features/comms/call/call-engine.ts:493-512`.
- What: `pc.restartIce()` depends on a `negotiationneeded` handler, and there
  isn't one. No restart offer is ever sent. The fallback path only runs in
  browsers without `restartIce`, which means no current browser.
- Fix: implement the "perfect negotiation" pattern (`onnegotiationneeded` →
  `setLocalDescription()` → signal; polite/impolite roles to resolve glare).

**E2 · HIGH · Remote ICE candidates are dropped instead of queued**
- Where: `call-session.ts:632-635` (ignored until the callee has an engine);
  `call-engine.ts:360-371` (errors swallowed before the remote description is
  set).
- What: the caller's candidates sent while the phone is ringing are lost.
  Setup then depends on the accidental full re-offer in E3.
- Fix: buffer candidates per call until `remoteDescription` is set, then apply
  them in order. Handle end-of-candidates.

**E3 · HIGH · Every call sends the offer twice, and the two race**
- Where: `call-session.ts:650-653`.
- What: `call:accepted` re-sends the offer whenever no answer has been applied,
  which is always true at that moment. The callee may apply two offers
  concurrently with the `pendingOffer` path, and the resulting
  `InvalidStateError` is swallowed, so some setups fail intermittently.
- Fix: covered by perfect negotiation (E1). Re-offer only on an explicit
  "callee ready, did not receive offer" signal.

**E4 · HIGH · Remote audio can be silently blocked by autoplay rules**
- Where: `call-engine.ts:407-416`.
- What: `new Audio()` with `autoplay` and no `play()` call or rejection
  handling. For the caller, the track arrives up to 60 s after the tap; on
  push-accept there was never a gesture. iOS and Chrome can block playback,
  giving a connected but silent call.
- Fix: create the `<audio>` element on the dial/answer gesture, call `play()`,
  and show a "Tap to hear" control if it is rejected.

**E5 · HIGH · The noise filter can silence the outgoing microphone, and cannot load in production**
- Where: `noise-suppression.ts:69-82,137-150`; `src/server.js:159-195`.
- What:
  - The `AudioContext` is created after async work, without `resume()`, and at
    the device sample rate. RNNoise needs 48 kHz.
  - A suspended context sends silence while the UI says "on".
  - The CSP has no `'wasm-unsafe-eval'`, so WebAssembly compilation is refused
    and the filter always reports "could not load".
  - The filter is ON by default for every tenant.
- Fix: create the context with `{ sampleRate: 48000 }` on the user gesture and
  call `resume()`. Add `'wasm-unsafe-eval'` to `script-src`. Detect silence on
  the output and fall back to the raw track. Default the filter OFF until it is
  verified on devices.

**E6 · HIGH · A microphone or engine failure leaves a live call on the server**
- Where: `call-session.ts:353-377,379-409`.
- What: if `getUserMedia` is denied or `start()` throws, `dial()` and
  `answer()` just return to idle. There is no cancel or hang-up, so the callee
  keeps ringing for a caller who has gone, or an answered call stays IN_CALL
  with both users busy until the cap.
- Fix: open the mic before dialing or accepting, and on any engine failure
  call `hangup` or `fail`.

**E7 · MEDIUM · Double-dial race**
- Where: `call-session.ts:353-363`.
- What: the phase changes only after the POST returns. A double tap sends two
  POSTs; the second fails with CALLER_BUSY and sets the UI to idle while call
  #1 rings with the mic open.
- Fix: set an in-flight `dialing` phase synchronously.

**E8 · MEDIUM · Other devices keep ringing, then show a false "Missed call"**
- Where: `call-session.ts:637-654,326-349`; `comms-live.tsx:145-147`.
- What: when the call is answered on the phone, the desk tab keeps its ring
  screen and tone for up to 60 s. It then reads the row (IN_CALL, no end
  reason) and toasts "Missed call — X".
- Fix: on `call:accepted` for a call this device is ringing for, stop the ring
  and show "Answered on another device".

**E9 · MEDIUM · The live transcript leaks timers and restarts in a storm**
- Where: `live-transcript.ts:171,176-183`.
- What: each recogniser restart creates a new 30 s flush interval without
  clearing the previous one, and `stop()` clears only the last. The leaked
  intervals keep POSTing `/live-log` after the call has ended, until the page
  reloads. Permission or network errors restart the recogniser every 250 ms for
  the whole call.
- Fix: create one interval, back off on errors, and stop after N consecutive
  failures.

**E10 · HIGH · Speech recognition runs alongside the call microphone**
- Where: `call-session.ts:251-267`; `live-transcript.ts`.
- What: on Android Chrome the continuous recogniser plays a start/stop chime at
  every restart during the call and competes with WebRTC for the mic. Chrome
  sends that audio to Google's servers (see G2).
- Fix: remove the live capture. The server transcript plus the fixed recorder
  (A3) is the reliable path.

**E11 · MEDIUM · Recorder uploads are fragile**
- Where: `call-recorder.ts:192-245`.
- What:
  - A failed part upload is never retried (`lost += 1`).
  - Uploads compete with the call's audio every 2 minutes.
  - The last part is lost if the tab closes after hang-up.
  - `part_count` is a running index, so gaps cannot be detected.
- Fix: retry with backoff, persist pending parts in IndexedDB until
  acknowledged, and upload the tail with the "side complete" call (A2).

**E12 · MEDIUM · Presence is never seeded**
- Where: `client/src/features/comms/presence.ts:30`; the server has no
  snapshot event.
- What: everyone shows as offline when the app loads. The outgoing call screen
  says "Their device looks offline" on most calls, and dots go stale after a
  reconnect.
- Fix: send a presence snapshot on connect and reset the map on reconnect.

**E13 · MEDIUM · The screen stays on against the user's cheek**
- Where: `wake-keepalive.ts`.
- What: a screen wake lock during calls, with no proximity sensor on the web,
  leads to accidental taps on Mute, Hang up or the noise toggle.
- Fix: do not hold a screen wake lock for audio calls, or add a "lock
  controls" state.

**E14 · LOW · Dead code, and no call history**
- `getCallTurn` and `listCalls` are never used, so there is no call history or
  missed-call list anywhere.
- `call:ringing_sent` is emitted but never handled.

### F. Call UI and design-system violations (glassmorphism)

**F1 · HIGH · Glassmorphism on the call and ring screens**
- Where: `call-overlay.tsx:92,156,166,176`; `incoming-ring.tsx:37`;
  `call-summary-card.tsx` (`bg-card/60`, `bg-background/60`).
- What: full-screen 97%-opaque tinted layers with `backdrop-blur-sm`,
  translucent `bg-card/90` pills and alpha-tinted chips. The blur is invisible
  at 97% opacity but is still recomposited every frame while the timer ticks.
  That is expensive on low-end Android phones and drains battery over a
  30-minute call, and it looks muddy.
- Fix: opaque `bg-background` surfaces, token borders, no `backdrop-filter`.

**F2 · HIGH · The call screen breaks white-labelling**
- Where: `call-overlay.tsx:194,217`; `incoming-ring.tsx:39`;
  `summary-draft.tsx` (EN/FR toggles); `calls-page.tsx` (checkbox);
  `text-white` at `call-overlay.tsx:205`, `incoming-ring.tsx:55,66`.
- What: these use the Praxis house blue (`--brand-blue`, `text-brand-blue-ink`)
  instead of the tenant's `--primary`, and raw white on `--bad`/`--ok` fills
  instead of `--destructive`/`--destructive-foreground`. The tenant's brand
  disappears on the one full-screen surface.
- Fix: use `--primary`/`text-primary-ink` for accents and the destructive/ok
  token pairs for buttons.

**F3 · MEDIUM · Banners overlap the name and timer**
- Where: `call-overlay.tsx:156,166,176`.
- What: the banners are absolutely positioned at `top-4`, `top-20` and
  `top-24`, so they collide with each other and with the header and the 48 px
  timer.
- Fix: put the banners in a normal flex column.

**F4 · MEDIUM · The call blocks the whole app**
- What: a full-screen modal with no minimise option. A dispatcher cannot open
  the shipment they are discussing.
- Fix: a dockable in-call bar that keeps the call running while the user
  navigates.

**F5 · MEDIUM · Hand-rolled controls instead of design-system primitives**
- Where: raw `<input type="checkbox">` (`call-overlay.tsx:214`,
  `calls-page.tsx`); the summary panel is a `role="dialog"` div with no focus
  trap or Escape handling (`summary-draft.tsx:142`); raw `<textarea>`; "✕"/"×"
  glyph buttons.
- Fix: use `Switch`, `Dialog`/`Sheet`, `Field` and `IconButton` per
  FRONTEND_GUIDE §3.5.

**F6 · MEDIUM · No recording notice before answering**
- Where: `incoming-ring.tsx` (props: name, seconds, accept, decline).
- What: only the hidden-tab notification mentions recording. In the app, the
  callee learns the call is recorded only after connecting.
- Fix: show the recording notice on the ring screen.

**F7 · MEDIUM · The caller cannot edit AI key points or follow-ups before posting**
- Where: `summary-draft.tsx:230-265`.
- What: only the prose is editable. AI-generated "verbatim quotes" are posted
  under the colleague's name with no way to remove a wrong one except
  discarding everything. Discard is irreversible and has no `useConfirm`.
- Fix: make each item editable or removable, and confirm Discard.

**F8 · MEDIUM · Due dates shown as ISO (breaks the day-first rule)**
- Where: `summary-draft.tsx:258` shows `f.due` as `YYYY-MM-DD`.
- Fix: `dateDmy(f.due)`.

**F9 · LOW · Accessibility and motion details**
- `animate-pulse` on the Answer button and `animate-fade-in` ignore
  reduced-motion.
- The `role="timer"` aria-label changes every second.
- "Incoming call from " renders with an empty name.
- The hang-up label is a detached paragraph.

**F10 · LOW · Feature gating is missing in the UI**
- The phone icon renders on every DIRECT thread even when the `calls` feature
  is off (`team-chat.tsx:511,1007`), so a tap gives a 403.
- The "Call audio" tab in the Comms hub shows company settings (MOD-70) to
  every user, and regular staff get an error state.

### G. Privacy and compliance

**G1 · HIGH · Recording, transcription and AI summaries are on by default for every tenant**
- Where: seeds `9134`, `9135`; migrations `14000:105-107` and `14010:279-281`.
- What: all plans, default ON. Tenant admins cannot switch recording off
  themselves: 14010 seeds no `ai_feature_flag` row for `call_recording`, and
  the Calls page does not expose it.
- Fix: default OFF, with an explicit tenant-admin opt-in and a documented
  lawful basis.

**G2 · HIGH · Third-party processors are not disclosed**
- What: audio goes to Groq; transcripts go to the DeepSeek → Gemini LLM chain
  (per the pipeline's own header); live microphone audio goes to Google through
  the Web Speech API; STUN goes to Google. The banner says only "recorded and
  summarized". There are cross-border transfers and no processor disclosure.
- Fix: list the processors in the consent text and the tenant DPA, allow
  region-pinned vendors, and remove Web Speech (E10).

**G3 · MEDIUM · Transcripts and summaries are kept forever, and audio retention is broken**
- What: text is kept indefinitely by design, with no erasure path for a data
  subject request. Audio retention is undermined by orphaned objects (B12).
- Fix: a configurable text retention period and an erasure procedure.

**G4 · MEDIUM · Every employee's "last seen" is visible to every colleague**
- Where: `smartcomm.repo.js` `listColleagues`; tenant-wide presence
  broadcasts.
- What: no opt-out; this raises an employee-monitoring concern.
- Fix: a per-user privacy setting, and share presence only with DIRECT
  contacts.

**G5 · MEDIUM · The callee cannot refuse recording**
- What: the only option is to decline the call.
- Fix: a per-call "don't record" choice on the ring screen, or require both
  parties to consent.

### H. Tests, docs and process

**H1 · HIGH · The tests mock exactly the parts that are broken**
- Where: `client/e2e/call.spec.ts:146` stubs `**/api/tenant/smartcomm/**`;
  unit tests use fake peer connections.
- What: the wrong keepalive URL, worker-side socket no-ops, the CSP-blocked
  WASM, headerless recorder parts, the CHECK violation and the TURN
  configuration never run in any test.
- Fix: one real end-to-end test (API, worker, Postgres, Redis, two Chromium
  pages) covering a 3-minute call through transcription, notification and
  opening the draft.

**H2 · HIGH · The manual device matrix was never run**
- Where: `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md`.
- What: 30 rows, 36 cells marked PENDING, none marked PASS. It shipped anyway.
- Fix: make the matrix a release gate.

**H3 · MEDIUM · The docs describe behaviour the code does not have**
- "Clients re-trigger the job when the last part lands": nothing does.
- "TURN credential scoped to the user": it is not.
- "No code path posts without this write in the same transaction": false.
- "The dial icon does not render when calls is off": it does.
- "The index serves the metrics read": it does not.
- `.env.example` says an empty STUN value omits STUN: it defaults to Google.
- Compose says the username is `<expiry>:<user>`: the code uses `<expiry>`.
- Fix: correct each statement, and make every guarantee a test.

**H4 · LOW · Comment volume hides defects**
- What: about a third of the lines are narrative comments. They assert intent
  the code then contradicts (H3), and reviewers read the comment instead of the
  code.
- Fix: cut the narrative to short "why" notes and move guarantees into tests.

---

## 3. The fix, as six PRs

| PR | Title prefix | Covers | Size |
| --- | --- | --- | --- |
| PR-1 | `fix(comms): stop phantom call notifications` | A1, A4, A5, A6, A9, A10, A11, B1, B2, B5, B10, E14 | M |
| PR-2 | `fix(comms): rebuild the call recorder and transcription pipeline` | A2, A3, B4, B6, B7, B11–B14, C7, D3, D10, E9–E11, H1 | L |
| PR-3 | `fix(comms): harden calls — TURN, credentials, relay, IDOR, rate limits` | B8, B9, C1–C6, C8, C10–C13, D7 | M |
| PR-4 | `fix(comms): reliable call engine — negotiation, audio, rings` | A7, A8, E1–E8, E13 | L |
| PR-5 | `perf(comms): scale calls and transcription across tenants` | B3, C9, D1, D2, D4–D6, D8, D9, D11, D12, E12 | L |
| PR-6 | `feat(comms): new call screen and privacy defaults` | F1–F10, G1–G5, H2, C6 (do-not-disturb) | L |

All six PRs also apply H3 and H4 to the files they touch. Together they cover
all 83 findings.

### PR-1 · Stop the phantom notifications and calls

**Goal.** No notification is ever sent from the nightly job. Calls with no audio
never reach the AI. The summary notification opens the summary. A closed tab
ends its call. Sandbox calls stay in the sandbox.

**Depends on:** this document merged to `main`.

**Main files:** `src/jobs/workers.js`, `src/jobs/handlers/comms-call-record-sweep*.js`,
`src/jobs/handlers/call-transcribe.js`,
`src/modules/smartcomm/smartcomm.call.{service,repo,pipeline.service}.js`,
`src/realtime/index.js`, `src/modules/notification/notification.service.js`
(for the `publishToUser` signature only), a new tenant migration,
`client/src/features/comms/call/{call-session,ring-surface,summary-draft}.ts(x)`,
`client/src/features/comms/{comms-live,hub}.tsx`, `client/src/app/app.tsx`,
`client/src/app/screen-registry.json`, `client/src/lib/smartcomm-api.ts`,
`client/public/push-handler.js`.

**Out of scope:** the recorder, the transcription logic itself, TURN, the engine
and the call-screen visuals. Those belong to later PRs. Do not restyle the call
screen here, but do not add new design-system violations either.

**Steps**
1. **Schedule (A1).** Replace `repeat: { every: 86_400_000 }` for
   `comms-call-record-sweep-scheduler` with a cron pattern at a daytime hour.
   Add two new env settings, `COMMS_CALL_RECORD_SWEEP_CRON` (default
   `0 10 * * *`) and `COMMS_CALL_RECORD_SWEEP_TZ` (default `Africa/Douala`), in
   both `src/config/env.js` and `.env.example`. The `check-env-template` gate
   requires both. **Also remove the old repeatable at worker boot.** BullMQ
   keeps a repeatable registered under its old key, so the midnight run keeps
   firing unless `getRepeatableJobs()` is scanned and every entry for that
   queue with `every` set is removed. Add a test for the removal.
2. **Notify once, never from a sweep (A4).**
   - Pass `origin: "hangup" | "sweep"` from `startPipeline` through the job
     data to `processCall`.
   - Add a plain column `notified_at timestamptz` to `comms_call_summary`.
     Claim it atomically with
     `UPDATE … SET notified_at = now() WHERE call_id = $1 AND notified_at IS NULL RETURNING`
     and push only when the claim succeeds **and** `origin !== "sweep"`.
   - Sweep-created drafts appear in the Calls list (step 5) and send no push.
   - Raise the per-call ops alert only on the first failure of a call, not on
     sweep re-runs.
3. **No audio, no pipeline (A5, B5).**
   - In `processCall`, before any attempt is counted: if recording is off for
     the tenant, or there are no uploaded parts and no live-log rows and the
     upload grace has passed, set the terminal state `NO_RECORDING` and return.
     No LLM call, no alert, no notification.
   - Change `listUntranscribedEndedCalls` to exclude calls that never connected
     (`AND (status = 'ENDED' OR connected_at IS NOT NULL)`). Give every other
     skip in `processCall` a terminal state, so no row is selected forever.
   - Add `NO_RECORDING` to the client's `CallTranscriptState` type and render
     it as "Not recorded".
   - Migration: backfill `NO_RECORDING` for calls that ended more than a day ago
     with a NULL state and no recording or live-log rows. The state column has
     no CHECK, so this is data only.
4. **Separate ring links from summary links (A6).**
   - Rings use `?ring=<id>[&act=…]`: server `escalateRing` URL,
     `ring-surface.ringUrl`, and `parseCallLink` reading `ring`.
   - Summary notifications use `/comms/calls/<id>`.
   - Keep `?call=<id>` working for notifications already delivered: redirect
     it to `/comms/calls/<id>`, never treat it as a ring.
   - Add unit tests showing `?call=` never produces a ring or the redial
     banner.
5. **A reachable summary (A6, E14).**
   - `/comms/calls` lists the user's calls from `GET /smartcomm/calls`. Extend
     the list query with `transcription_state`, `draft_status` and
     `notified_at`, and badge the drafts that are waiting.
   - `/comms/calls/:id` shows the summary editor inline, plus the transcript.
   - Split `CallSummaryPanel` into an embeddable editor used by both this page
     and the floating panel.
   - The hub's current `calls` section is the settings page. Move it off the
     hub (it stays at `/settings/calls`) so the "Calls" tab is the list.
   - Update `screen-registry.json`. Use the primitives from
     `doc/FRONTEND_GUIDE.md` §3.5.
   - The `call:summary_ready` socket event now shows a toast linking to the
     page instead of opening a floating panel over the user's work.
6. **Worker events reach clients, and the env is part of the room (A6, A9).**
   - Add `@socket.io/redis-emitter` (check it is compatible with the installed
     `@socket.io/redis-adapter`). When `io` is null (the worker process),
     `publishToUser` emits through the emitter.
   - Change the user room to `t:<slug>:<env>:u:<uid>`. Give `publishToUser` an
     `env` argument and update all three callers (notification, call and
     pipeline services).
   - Sockets join the room for their own env.
   - Test that a worker-side publish reaches a socket in the same env and
     never one in the other env.
7. **Closed tab and liveness (A10, B1, B2, B10).**
   - Build the keepalive hang-up URL from the same helper as `hangupCall`, so
     it becomes `/api/tenant/smartcomm/calls/:id/hangup`. Add a test that the
     URL matches the router.
   - New migration: drop the `end_reason` CHECK on `comms_call` (dropping is
     allowed; re-adding a wider one is not). Enforce the closed set, including
     `disconnected`, in `repo.transition`. Before writing the migration, check
     the constraint's real name in `pg_constraint`.
   - Change `Math.min` to `Math.max` in `sweepLiveness`.
   - Pass the real `reason` to `durationSeconds`.
8. **Notification copy (A11).** The summary push states the counterpart's name,
   a day-first time and the duration. Localise it in the service worker the
   same way ring strings are (`data.kind = "call_summary"` plus fields), so
   French devices read French.
9. **Docs.** Correct the engineering guide's description of the nightly sweep
   and the deep links.

**Tests to add or extend:** `tests/unit/smartcomm-call-records.test.js`
(origin=sweep never notifies; `notified_at` is claimed once; `NO_RECORDING`
never calls the LLM; the SQL excludes calls that never connected);
`tests/unit/smartcomm-calls.test.js` (liveness uses max; a `disconnected` end
is accepted); a worker test for removing the old repeatable;
`client/src/features/comms/call/{call-session,ring-surface}.test.ts` (link
parsing, the keepalive URL); a realtime room test.

**Acceptance.**
- A 3-minute call produces exactly one push, within a minute of hang-up, and it
  opens `/comms/calls/<id>`.
- Running the record sweep job by hand sends no push.
- A call with recording off ends as `NO_RECORDING` with no LLM call.
- Closing the tab mid-call ends the call within 60 s.
- A sandbox call never rings a live tab.
- `npm run ci` is green.

### PR-2 · Rebuild the recorder and the transcription pipeline

**Goal.** Every recorded part is a valid audio file. Each part is transcribed as
it arrives, during the call. The summary is ready about a minute after hang-up,
whatever the call's length. Retries are per part, capped, and never re-bill
finished work. Summary state changes are race-free.

**Depends on:** PR-1 merged. Read its Progress entry: the job `origin` flag and
the `NO_RECORDING` state are used here.

**Main files:** `client/src/features/comms/call/{call-recorder,call-session}.ts`,
`client/src/lib/smartcomm-api.ts`,
`src/modules/smartcomm/smartcomm.call.{pipeline.service,repo,service}.js`,
`smartcomm.{validator,controller,routes}.js`, `src/jobs/handlers/call-transcribe.js`
(split into per-part and finalise handlers), `src/jobs/workers.js`, new tenant
migration(s), `tests/unit/smartcomm-call-records.test.js`, a new integration test.

**Steps**
1. **Valid parts (A3).**
   - Stop the `MediaRecorder` at each part boundary and start a new one on the
     same stream, so every part is a complete file with its own header.
   - Measure each part's real duration from timestamps; do not assume 5 s per
     chunk.
   - Set mono Opus at `audioBitsPerSecond` 24 000–32 000. Browsers otherwise
     pick a much higher rate.
   - On the server, check the container signature (WebM EBML `1A 45 DF A3`,
     MP4 `ftyp`, Ogg `OggS`) before accepting a part.
2. **Transcribe during the call (A2; design in §4).**
   - Each accepted part enqueues a `call-transcribe-part` job with jobId
     `callpart-<call>-<side>-<part>`.
   - The result is stored per part. Plain columns on `comms_call_recording` are
     allowed.
   - A new `POST /smartcomm/calls/:id/recording/complete { side, parts }`
     declares a side finished, stored as plain columns on `comms_call`.
   - A `call-finalise` job runs when both sides are declared and every declared
     part has a result, or at a deadline (ended_at + 10 min) as a delayed job.
   - It assembles the transcript and certifies only when every declared part is
     certified. Otherwise the draft is labelled with the missing minutes. It
     then drafts the summary and notifies once (PR-1's `notified_at`).
3. **Idempotent reprocessing (B4, B5).**
   - Only parts that failed are retried; a certified part is never sent to the
     provider again.
   - Attempts are capped per part and per call on every branch, including stale
     `PROCESSING`.
   - Inserting a certified row retires whatever row is current for that part.
4. **Race-free drafts (B6, B7).**
   - Guard the draft upsert with
     `ON CONFLICT … DO UPDATE … WHERE comms_call_summary.draft_status = 'PENDING_REVIEW'`.
   - `sendSummary` runs in one transaction. It claims the draft with
     `SET draft_status = 'SENDING' WHERE draft_status = 'PENDING_REVIEW' RETURNING`,
     posts the message, marks it `SENT`, and rolls back if the post fails.
   - `draft_status` is on a table created in 14010, so enforce the new value in
     code (no new CHECK).
   - Correct the false "same transaction" claim in migration 14010's comments
     by stating it in a new migration or in the guide. Do **not** edit 14010
     itself.
5. **Upload rules (B11–B13, B14).**
   - Cap `duration_ms` at 125 000.
   - Use a deterministic object key per (call, side, part), or delete the old
     object on replace.
   - Accept uploads only for calls that connected and are `IN_CALL` or ended
     within 15 minutes.
   - Add a per-call byte cap, and reject `part_index` above the declared
     `parts`.
   - Keep one `recordingEnabled` helper that fails closed.
6. **Remove the browser speech capture (C7, D10, E9, E10).**
   - Delete `live-transcript.ts` from the call path, and remove the
     `/live-log` write route.
   - Keep reading existing `browser-live` rows, so old calls still render.
   - Update the consent text accordingly.
7. **Release DB connections during vendor calls (D3).** Read state in one short
   `withTenantConnection`, release it, call the provider, then write in another
   short connection.
8. **Durable uploads (E11).** Retry each part upload with backoff. Keep
   unacknowledged parts in IndexedDB and resume them on the next app load, so
   the last part survives a closed tab.
9. **A real end-to-end check (H1).**
   - Add `tests/integration/call-pipeline.test.js`, which needs Postgres and
     Redis; follow `tests/integration/entity-concurrency.test.js`. It uploads
     real multi-part recordings through the routes and runs the part and
     finalise handlers. The transcription vendor is stubbed, but the stub
     **rejects headerless audio**, so A3 cannot regress. It asserts one
     certified transcript, one notification and a readable summary.
   - Add a Playwright check that decodes every recorded part independently
     with `decodeAudioData`.
10. **Docs.** Rewrite guide §4.5 to the new trigger model, and remove the claims
    that "clients re-trigger the job when the last part lands" and "no code path
    posts without this write in the same transaction".

**Acceptance.**
- Calls of 5, 15 and 29 minutes on Chrome Android, Safari iOS and desktop all
  reach `CERTIFIED`.
- The summary is ready within 2 minutes of hang-up for a 29-minute call.
- Re-running finalise or reprocess never calls the provider for a certified
  part (asserted by a test).
- A double-tapped send posts one message.
- `npm run ci` is green.

### PR-3 · Security hardening

**Goal.** The relay cannot reach private networks. Relay credentials are tied to
a live call. Summaries cannot leak through chat attachments. Call signalling is
limited to live calls and bounded. The server decides every recorded outcome.

**Depends on:** PR-2 merged.

**Main files:** `docker-compose.yml`, `.env.example`, `src/config/env.js`,
`src/modules/smartcomm/smartcomm.{turn.service,call.service,call.repo,validator,service,routes,ai}.js`,
`smartcomm.call.pipeline.service.js` (`cardsForCallIds`, `regenerateSummary`),
`src/realtime/index.js` (relay only; presence is PR-5).

**Steps**
1. **coturn (C1, C3).**
   - Replace `TURNSHAREKEY` with `--static-auth-secret=${TURN_CREDENTIAL_SECRET}`,
     and add `--realm`, `--external-ip` and a TLS listener (`turns:` on 443 or
     5349, with certificate paths).
   - Deny peer IPs: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
     `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`,
     `fe80::/10`.
   - Keep `--no-loopback-peers` and `--no-multicast-peers`. Add
     `--user-quota`, `--total-quota`, `--max-bps` and `--fingerprint`.
   - Pin the image version.
   - Add the new variables to `env.js` and `.env.example`, and a runbook step
     using `turnutils_uclient` to prove that allocation works and that a peer
     in 169.254.169.254 and 172.17.0.1 is refused.
2. **Credentials (C2, C12, C13).**
   - `turnFor` and dial/accept mint credentials only for `RINGING` or
     `IN_CALL` calls.
   - The username is `<expiry>:<opaque per-call token>`: random, stored on the
     row, with no user id in it.
   - TTL is the call's remaining allowance plus 60 s. Add a rate limit on the
     turn endpoint.
   - STUN comes from configuration. With TURN configured, use its STUN port;
     never Google unless it is configured explicitly. Correct `.env.example`.
   - Add a tenant setting `comms.call_privacy { relay_only }` that sets
     `iceTransportPolicy: "relay"`.
3. **IDOR (C4).**
   - The generic message, edit and scheduled-message validators reject
     `attachment_kind: "CALL"`. Grep every use of the shared `attachment`
     schema.
   - Only `sendSummary` may create one, through an internal flag on
     `postMessage`.
   - `cardsForCallIds` resolves a card only when the message is the summary's
     `sent_message_id` or `update_message_id` and `draft_status = 'SENT'`.
4. **Relay (C5, D7).**
   - Relay only for `RINGING`/`IN_CALL` calls, with a new repo function
     instead of `otherParticipant`.
   - Cache the counterpart per socket per call, cleared on terminal events.
   - Validate payloads: SDP is a string ≤ 64 KB; a candidate is an object
     ≤ 2 KB.
   - Add a per-socket token bucket, and set `maxHttpBufferSize` on the
     server.
5. **Abuse and authority (B8, B9, C6, C8, C10, C11).**
   - Record the actor on hang-up, decline and fail. The server derives the
     end reason and ignores the body.
   - Dial rate limits per caller and per callee.
   - `directPartner` requires `status = 'ACTIVE'`. Delete a user's push
     subscriptions when they are deactivated.
   - `regenerateSummary` becomes a queued job, rate-limited per call, and
     requires a language change.
   - The AI manifest reads check the `call_recording` feature.
   - Clients receive a reason code instead of raw vendor error text.

**Acceptance.**
- A TURN allocation to 169.254.169.254 or 172.17.0.1 is refused.
- A credential request for an ended call returns 404.
- Posting a message with a `CALL` attachment returns 422.
- A signal for an ended call is dropped.
- A dial flood returns 429.
- `npm run ci` is green, and `/security-review` has been run on the diff.

### PR-4 · Call engine reliability

**Goal.** Calls connect first time, survive network changes, always play audio,
and ring correctly on every device, including the notification buttons.

**Depends on:** PR-3 merged (relay payload shapes may have changed; read its
entry).

**Main files:** `client/src/features/comms/call/{call-engine,call-session,noise-suppression,wake-keepalive,ring-surface}.ts`,
`client/src/features/comms/comms-live.tsx`, `client/public/push-handler.js`,
`src/server.js` (CSP), `src/modules/smartcomm/smartcomm.call.service.js`
(call-ended push, noise default), `src/realtime/index.js` (signal event
shape, if changed).

**Steps**
1. **Perfect negotiation (E1–E3).**
   - Implement the standard pattern: the callee is polite;
     `onnegotiationneeded` → `setLocalDescription()` → signal; use
     `makingOffer`, `ignoreOffer` and `isSettingRemoteAnswerPending`.
   - Buffer remote candidates until `remoteDescription` is set.
   - Remove the blind re-offer on `call:accepted`. The callee sends an explicit
     "ready" after accepting, and the caller then sends its current description
     if it has no answer yet.
   - An ICE restart refreshes TURN credentials when they are close to expiry
     (`getCallTurn`).
2. **Audio always plays (E4).**
   - Create the `<audio>` element during the dial/answer gesture and call
     `play()`.
   - If `play()` is rejected, show a "Tap to hear" control on the call
     screen.
3. **Noise filter (E5).**
   - Create `AudioContext({ sampleRate: 48000 })` in the gesture and call
     `resume()`.
   - Add `'wasm-unsafe-eval'` to `script-src` (it allows WebAssembly
     compilation only, not `eval`).
   - Detect silence on the filtered output and fall back to the raw track.
   - Default the tenant setting to OFF: `callSettings` defaults, plus a
     migration that flips the seeded value only where it is still
     `{"enabled": true}`.
4. **Failures and races (E6, E7, E8).**
   - Open the mic before `dialCall` or `acceptCall`. Any engine failure sends
     `hangup`, `decline` or `fail`.
   - Set a synchronous `dialing` phase so a double tap cannot dial twice.
   - When a device is ringing and receives `call:accepted` for its own user from
     another device, it stops ringing and shows "Answered on another
     device", not "Missed call".
   - Handle `call:ringing_sent` in the caller's other tabs.
5. **Rings (A7, A8).**
   - On every terminal transition where a ring push was sent, send a
     data-only `kind: "call_end"` push that closes tag `call:<id>`.
   - The service worker maps `event.action`: `accept` opens
     `/comms?ring=<id>&act=accept`; `decline` opens `…&act=decline`, and the
     app declines and closes.
   - An expired ring, when tapped, opens `/comms/calls/<id>` instead of a
     ring.
6. **Screen on the cheek (E13).** Do not hold a screen wake lock by default.
   If device tests show the call dies with the screen off, keep the lock and add
   a "controls locked" state that ignores taps until a deliberate unlock
   gesture.

**Tests:** the engine unit tests (glare, buffered candidates, restart offer
sent); Playwright two-page tests (a call connects; `context.setOffline` toggled
mid-call and the call recovers; a double-tap dial creates one call);
service-worker action tests.

**Acceptance.**
- The engine rows of `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` pass on Chrome
  Android, Safari iOS and desktop, including a Wi-Fi→4G switch mid-call and
  Answer/Decline from the lock screen.
- `npm run ci` is green.

### PR-5 · Scale calls and transcription across tenants

**Goal.** Cost and latency grow with the number of calls, not the number of
tenants. No tenant can delay another. Transcription stays within provider
limits with a measured latency target (§4).

**Depends on:** PR-4 merged.

**Main files:** `src/jobs/workers.js`, `src/jobs/handlers/comms-call-*.js`,
`src/jobs/handlers/call-transcribe*.js`, `src/jobs/queue-producer.js`,
`src/modules/smartcomm/smartcomm.call.{service,repo}.js`, `smartcomm.repo.js`,
`src/realtime/index.js` (presence),
`src/services/platform/comms-metrics.service.js`,
`src/jobs/handlers/comms-call-metrics.js`, a new tenant migration (index),
`client/src/features/comms/{presence.ts,comms-live.tsx}`.

**Steps**
1. **Per-call clocks (D1).**
   - `createCall` enqueues a ring-deadline job at +60 s; accept enqueues a cap
     job at +30 min. A participant's socket disconnect during an active call
     enqueues a liveness check at +60 s. JobIds are per call.
   - Replace the 15-second fleet sweep with a 5-minute safety sweep that only
     visits tenants in a Redis set of tenants with active calls.
2. **Fair, limited transcription (D2; §4).**
   - One global limiter sized to the provider's per-key limits, from
     configuration.
   - Per-tenant fairness: a Redis token bucket per tenant, or per-tenant queues
     served round-robin. BullMQ groups need BullMQ Pro, so do not assume them.
   - Priorities: parts of live calls, then finalise, then reprocess.
   - A 429 delays the job by `retry-after` without spending an attempt.
   - A per-tenant daily audio-minute budget through the governance service.
   - Spread any remaining daily work by a hash of the tenant slug.
3. **Metrics without fan-out (D4, D5, D11, D12).**
   - Increment day counters at each terminal transition, and aggregate once a
     day.
   - Add an index on `comms_call (started_at)` (an index is not a constraint;
     it is allowed).
   - Group the alarm by `(tenant, env)` and alert on live only.
   - Compute UTC dates in SQL and return `metric_date::text`.
   - Log the tenant env, not `NODE_ENV`.
4. **Presence (B3, C9, D6, D8, E12).**
   - Per-user Redis keys `presence:<slug>:<env>:<uid>` with a 90 s TTL,
     refreshed by a throttled socket heartbeat.
   - Send a snapshot of the user's DIRECT contacts on connect.
   - Send presence changes only to those contacts' user rooms.
   - Liveness reads these keys. Delete the global SET and ZSET.
   - Write `last_seen_at` to the database at most every 5 minutes per user.
5. **Bounded queries (D9).** Batch the audio purge (LIMIT 500, looped). Use one
   lateral join for the DIRECT partner in the channel list.
6. **Observability.** Export the age of the oldest transcription job, the
   hang-up→summary latency (p50/p95) and the provider 429 rate, per tenant.
   Alert on latency, not on failure counts.

**Acceptance.**
- A load script (in `scripts/`) simulating 10, 50 and 200 tenants: ring
  timeouts fire within 5 s for every tenant while one tenant has 2 000 queued
  transcriptions.
- At 10-tenant load, p95 hang-up→summary is under 2 minutes.
- Tenant DB pool use stays within budget.
- `npm run ci` is green.

### PR-6 · New call screen and privacy defaults

**Goal.** A calm, solid, tenant-branded call experience that does not block the
ERP, and privacy-respecting defaults a tenant can defend.

**Depends on:** PR-5 merged.

**Main files:** `client/src/features/comms/call/{call-overlay,incoming-ring,summary-draft,call-summary-card}.tsx`,
a new in-call bar component in the app shell, `client/src/features/settings/calls-page.tsx`,
`client/src/features/comms/team-chat.tsx`, `client/src/lib/i18n-dict.ts`,
migrations and seeds for defaults, the consent copy, the AI and transcript
retention code, `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md`.

**Steps**
1. **Screens (F1–F5, F9).**
   - Opaque `bg-background` surfaces with token borders; no `backdrop-filter`,
     no translucent layers.
   - Accents use the tenant `--primary`/`text-primary-ink`; hang-up and answer
     buttons use the destructive and ok token pairs.
   - Banners sit in the layout flow.
   - A minimise action turns the call into a docked in-call bar (name, timer,
     mute, hang-up) that survives navigation.
   - Use `Switch`, `Dialog`/`Sheet`, `Field` and `IconButton`.
   - Honour reduced motion.
   - Pass the gates: `check:palette`, `check:contrast`, `check:motion`, and
     the axe tests in `screens.axe.test.tsx`.
2. **Consent and review (F6, F7, F8, G5).**
   - The ring screen states that the call will be recorded.
   - The callee can choose "Answer without recording". The server records the
     choice on the call, and neither side arms the recorder.
   - Key points and follow-ups can be edited and removed.
   - Discard uses `useConfirm` with `destructive`.
   - Due dates use `dateDmy`.
3. **Gating (F10, C6).**
   - The phone icon renders only when `calls` is on for the tenant and the
     user may create in MOD-64.
   - Add a per-user do-not-disturb setting for calls.
4. **Privacy defaults (G1–G4).**
   - `call_recording` defaults to OFF in the catalogue. For tenants still on
     `source = 'default'`, flip it off in a migration, after the owner signs
     off.
   - Add a tenant-admin switch on the Calls settings page (MOD-70 edit).
   - Name the outside companies that actually receive call data in the consent
     text and a "How calls are processed" panel, reading the configured
     transcription and LLM vendors rather than hard-coding them. Add them to
     the tenant DPA doc.
   - A transcript retention setting with a sweep, and an audited admin erasure
     of a user's call records.
   - A "hide my last seen" setting.
5. **Release gate (H2).** Run every row of the manual matrix and record the
   results. `call_recording` must not be enabled by default for any new tenant
   until the matrix passes.

**Acceptance.**
- The screens pass the frontend gates and a light/dark visual check.
- A tenant created after this PR has recording off.
- The matrix has no PENDING cells.
- `npm run ci` is green.

---

## 4. Transcription at scale: what changes from 1 tenant to 10 and beyond

**Worked example for 10 tenants.** Assume 40 active callers per tenant, 5 calls
each a day, averaging 6 minutes: about **2,000 calls and 12,000 call-minutes a
day**. Both sides are transcribed separately, so that is 24,000 audio-minutes
(~400 audio-hours) a day. The busiest hour carries about 15%: ~300 calls and
~3,600 audio-minutes.

**The volume is small. How the current code bunches it is the problem.**

- 3,600 audio-minutes an hour is 60 audio-minutes a minute, which is 30
  two-minute parts a minute, or **0.5 provider requests a second**. At ~3 s a
  request, that is 1–2 requests in flight on average.
- The current code instead:
  1. waits until hang-up and then sends a whole call serially (a 30-minute call
     is 30 sequential requests after hang-up);
  2. runs on **one queue of concurrency 2 for every tenant**;
  3. piles everything left over onto one midnight run;
  4. treats a provider rate limit (429) as a failure, which triggers the
     browser fallback and then nightly reprocessing.
- At 10 tenants that becomes hours of backlog at peak, 429 storms at
  midnight, and the nightly notification loop multiplied by ten.

**The design that holds (built in PR-2 and PR-5):**

1. **Transcribe during the call.** Each 2-minute part is transcribed as soon as
   it uploads. A 30-minute call becomes 15 small jobs per side spread over the
   30 minutes. At hang-up only the last part is left, so the summary arrives in
   about a minute whether the call lasted 3 minutes or 30. Load follows talk
   time, with no post-call spike and no midnight spike.
2. **One rate limiter for the provider, fair shares for tenants.** A global
   limiter sized to the provider's per-key limits (requests per minute and
   audio-seconds per hour; check your plan, since audio-seconds is usually the
   binding one), and a per-tenant token bucket so one busy tenant cannot starve
   the others.
3. **Priorities.** Live calls first, then finalising, then retries. A 429 waits
   for `retry-after` and is not counted as a failure.
4. **No database connection held while waiting on the provider.** Workers can
   then run 10–20 requests each without draining tenant pools.
5. **Scale workers by queue lag.** Run transcription as its own worker
   deployment and add replicas when the oldest job is older than the target.
   The work is I/O-bound, so the ceiling is the provider limit, not CPU.
6. **Keep audio small.** Mono Opus at 24–32 kbps is ~240 KB per audio-minute:
   ~6 GB a day and ~175 GB at 30-day retention at the volume above. The
   browsers' default rate can be several times that. Text is negligible
   (~1 KB per audio-minute).
7. **Budgets per tenant.** A daily audio-minute budget per plan, enforced before
   the provider is called, with a clear "over budget" state rather than a
   failure.
8. **Measure the right thing.** Target: 95% of summaries ready within 2 minutes
   of hang-up. Alert on the age of the oldest job and the 429 rate, per tenant.
   Failure counts on their own are not enough.
9. **Beyond ~50 tenants.** Add a second transcription provider as a fallback
   (it keeps transcripts certified, unlike the browser capture). Use multiple
   provider keys or an enterprise tier, and consider letting large tenants bring
   their own key.

**Cost** is priced per audio-hour. At a few cents per audio-hour (check the
provider's current price), 400 audio-hours a day is tens of dollars a day across
10 tenants. Cost is not the constraint. Scheduling and rate limits are.

---

## 5. Keep, rebuild, remove

| Part | Decision | Why |
| --- | --- | --- |
| `comms_call` schema, partial unique "one active call" indexes, guarded `transition()` | **Keep** | Correct and race-safe; the hardest part to get right. |
| Call REST routes and membership authorisation | **Keep**, with fixes B8, B9, C2, C6 | Sound model: the channel is the authorisation. |
| Transcript tables (`is_current`, certified CHECK) | **Keep**, with B4 fixed | Good audit design; the bug is in the writer, not the schema. |
| Shared `call-summary` schema | **Keep** | One contract for the API and the editor. |
| Record pipeline triggers, sweep and notifications | **Rebuild** | The source of the 01:00 loop; its trigger model is wrong. |
| Client engine signalling | **Rebuild** (perfect negotiation) | ICE restart, candidate buffering and the double offer are structural. |
| Recorder | **Rebuild** | The part model is incompatible with how browser recorders produce files. |
| Call and ring screens | **Rebuild** | Glassmorphism, white-label breaks, overlapping layout, no minimise. |
| Web Speech live capture | **Remove** | Privacy, Android chimes, timer leaks; not needed once A3 is fixed. |
| 15-second per-tenant sweep | **Replace** with per-call delayed jobs | Does not scale across tenants (D1). |
| RNNoise filter | **Park**, default OFF | Cannot load under the current CSP; can silence iOS. Re-enable after device tests. |
| coturn service | **Reconfigure** | Security holes and probably non-functional as written. |
| Platform metrics table and screen | **Keep**, change the producer to counters | The table and screen are fine; the hourly fan-out is not. |

**Fix or rewrite?** About 40% of the code (pipeline triggers, engine, recorder,
UI) needs rewriting. The rest needs local fixes. Starting from scratch would
re-derive the schema, the state machine and the shared contract that already
work, so the targeted plan above is the cheaper route.

---

## 6. Progress log

Every PR chat updates this section **on its own PR branch before merging**: its
row in the table, and one log entry appended at the bottom. Keep entries
factual. The next agent relies on them.

| PR | Status | Branch | GitHub PR | Merged | Notes |
| --- | --- | --- | --- | --- | --- |
| Audit (this document) | OPEN | `claude/integration-audit-report-u6twc5` | #474 | — | Report, PR plan, scale design |
| PR-1 | NOT STARTED | — | — | — | |
| PR-2 | NOT STARTED | — | — | — | |
| PR-3 | NOT STARTED | — | — | — | |
| PR-4 | NOT STARTED | — | — | — | |
| PR-5 | NOT STARTED | — | — | — | |
| PR-6 | NOT STARTED | — | — | — | |

Status values: `NOT STARTED` → `IN PROGRESS` → `OPEN` (PR raised) → `MERGED`.
Use `BLOCKED` with a reason in Notes if you stop.

### Log entry template

```
### PR-N · <date> · <status>
- Fixed: <IDs>, each with the test that proves it.
- Not fixed / deferred: <IDs and why; which PR now owns them>.
- Deviations from §3: <what you did differently and why>.
- Schema: <migrations added, with numbers; new columns, states or events>.
- New findings: <defects found that are not in §2, with file:line>.
- For the next PR: <anything the next agent must know>.
- Gates: <`npm run ci` result; manual checks done>.
```

### Entries

### Audit · 2026-09-24 · OPEN
- Wrote §0–§5: 83 findings, the emergency runbook, the six-PR plan and the
  transcription scale design.
- For PR-1: merge this document first, so the PR-1 chat can read it from
  `main`. The §0 parking SQL is optional and can be run before PR-1 ships;
  record here if it was run and on which tenants.
