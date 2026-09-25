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
| HIGH | 33 | Security hole, cross-tenant scale failure, or a feature that does not work in real use. |
| MEDIUM | 40 | Real defect with a narrower blast radius. |
| LOW | 12 | Hygiene, misleading docs, minor leaks. |

---

## How to use this document (read first if you are fixing a PR)

The fix is split into **seven PRs** (§3), done **one at a time, in order**. Each
PR is done in its own chat, starting from the latest `main` after the previous
PR has merged. Several PRs edit the same files, so running them in parallel
causes conflicts.

If you are the agent working on one of them:

1. **Read, in this order:** `CLAUDE.md`; §0 and §1 of this document; your PR's
   section in §3; the owner decisions in §2 O (they override everything else)
   and the PR-1 findings in §2 N; §4 if you are on PR-2 or PR-5; every entry in
   the **Progress
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

*A12–A15 were added on 2026-09-24 after the owner reported that calls only
ring while the app is open on both laptop and phone.*

**A12 · HIGH · One open tab stops every other device from ringing**
- Where: `smartcomm.call.service.js:577` (push waits 5 s), `:637-659` (the
  ack is per call, not per device), `:679-688` (the push is skipped once any
  ack exists); `client/src/features/comms/call/call-session.ts:587-601` and
  `ring-surface.ts:154-166` (a visible tab acks `socket`; a hidden tab with
  notification permission acks `notification`).
- What: the ring push waits 5 seconds and is then cancelled for all of the
  callee's devices if any single tab confirmed the ring. An open laptop tab,
  even a background one, therefore silences the phone. This is why calls only
  ring on the devices where the app is open.
- Fix: push to every device at the moment the call starts. Keep the ack for
  the ring-channel metric only; it never suppresses another device. Cancel
  rings explicitly when the call is answered, declined or ends (PR-4).

**A13 · HIGH · An app opened mid-ring never learns about the call**
- Where: `call-session.ts` `wireCallSocket` and `comms-live.tsx`. The client
  only learns of a ring from the `call:ringing` socket event. There is no
  "what is ringing for me" read on connect, reconnect or return to the
  foreground (`hydrateFromLink` runs only for a deep link).
- What: the ring is announced before the app has connected, so a person who
  opens the app because their phone buzzed sees nothing.
- Fix: add `GET /smartcomm/calls/ringing`. Read it on connect, reconnect and
  `visibilitychange`, merge it with socket events, and have rings expire on
  the client after the ring window so a stale ring cannot persist.

**A14 · MEDIUM · The ring push doesn't behave like a ring**
- Where: `smartcomm.call.service.js:698-730` (no `vibrate` pattern, sent
  once); `client/public/push-handler.js:68-124` (always shows an OS
  notification, even when the app is on screen).
- What: a closed phone gets one silent-looking notification. When the app is
  open, the OS notification is stacked on top of the in-app ring.
- Fix: send a vibration pattern, and re-alert with `renotify` every 15 s until
  the call is answered or ends (capped at 4). The service worker hands the
  ring to a visible page (`postMessage`) instead of showing a notification.

**A15 · MEDIUM · Nothing checks that a device can ring**
- Where: generic prompts only, in `client/src/components/pwa/push-opt-in.tsx`
  and `install-banner.tsx`.
- What: no call-specific "allow this device to ring" prompt, no warning that
  this device cannot ring (permission denied, no push subscription, iPhone not
  installed to the home screen), and no way to test it.
- Fix: a call push check in Settings → Calls. It shows whether this device can
  ring, explains how to fix it (including Add to Home Screen on iPhone), and
  has a "Test ring" button that sends a real ring push to this device.

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
- Update (PR-1, owner decisions A-1/A-2): Web Speech is removed. Call audio now
  goes to Groq, **and to Google (Gemini) when Groq fails** on a part.
  Transcripts go to Google (Gemini) for the summary, and to DeepSeek **only as
  the last resort** when Gemini is down. The disclosure below must name all
  three.
- Fix: list the processors in the consent text and the tenant DPA, allow
  region-pinned vendors, and remove Web Speech (E10, done in PR-1).

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

### N. Found while building PR-1 (#476)

PR-1's Progress entry (§6) logged these. They are routed to the PR that owns
the area.

**N1 · MEDIUM · Chat and mail rooms don't separate live from sandbox**
- Where: `src/realtime/index.js`. Channel rooms `t:<slug>:c:<groupId>` and the
  tenant mail room carry no env.
- What: if a sandbox schema shares group ids with live, sandbox chat,
  `mail:new` and presence events reach live sockets. PR-1 fixed this for user
  rooms only.
- Fix: env in every room name. → PR-5.

**N2 · LOW · Duplicate `mail:new` per API replica**
- Where: `attachMailBridge` in `src/realtime/index.js`.
- What: it re-emits each bus message with `io.to(...)` on every replica. With
  the Redis adapter attached, that is one duplicate per replica.
- Fix: `io.local.to(...)`. → PR-5.

**N3 · MEDIUM · Hardcoded Gemini defaults name retired models**
- Where:
  - `src/config/env.js:372` (`GEMINI_MODEL` defaults to `gemini-1.5-pro`);
  - `src/services/ai/vision.service.js:24` (falls back to `gemini-1.5-pro`);
  - `client/src/features/ai-control/pages.tsx:717` (prefills
    `gemini-1.5-flash`).
- What: these apply only when the platform `gemini` credential is missing,
  inactive or unreadable. Vendors resolve platform-first
  (`llm.service.js` `resolveVendor`, `ai-vendor.service.js` `getConfig`). On
  2026-09-24 the credential in Platform Console → Integrations names
  `gemini-2.5-flash`, so production uses that. But a platform-DB outage or a
  deactivated credential would fall back to a retired model, and the Gemini
  transcription (O1) and summary (O2) would fail with a 404.
- Fix: current defaults in all three places, and a health check that reports
  when the configured model does not exist. → PR-2; PR-7's platform check keeps
  watching it.

**N4 · LOW · "Transcription failed" is never shown**
- Where: `transcriptionIssue` in `client/src/features/comms/call/call-session.ts`.
- What: it is set by `call:transcription_failed` but rendered nowhere.
- Fix: → PR-6.

**N5 · LOW · The failure alarm still blames a browser capture that no longer exists**
- Where: `src/services/platform/comms-metrics.service.js:372`.
- What: the subject says calls "fell back to the browser capture".
- Fix: → PR-5.

### O. Owner decisions (2026-09-24)

These are decisions, not defects. They **override** anything else in this
document that conflicts with them.

**O1 · Transcription: Groq once, then Gemini. No browser, no retries.** Each
part gets one Groq attempt. On any Groq error (rate limit, timeout, server
error, bad key), the same part goes to Gemini once. If Gemini also fails, the
part fails; neither provider is retried automatically. The browser's live
speech capture is never used to build a transcript. A Gemini transcript is made
from the stored audio, so it counts as certified. *Consequence:* call audio goes
to Google whenever Groq fails, which must be disclosed (G2). → **Done in PR-1
(#476)**, where it is recorded as "A-1". PR-2's per-part jobs must keep it.

**O2 · Summaries: Gemini first, DeepSeek as last resort.** Only the call summary
changes order; the rest of Praxis AI keeps its current order. If both fail, the
draft is the labelled transcript ("summary unavailable"). → **Done in PR-1
(#476)**, where it is recorded as "A-2".

**O3 · The draft lands in the conversation.** After a call, the caller sees the
summary draft **pinned above the composer** of that conversation, with **Review
& send**: edit the summary, key points and follow-ups, switch EN/FR, Send or
Discard. The notification opens that conversation. PR-1 already removed the
floating panel and built a call page with the editor. → **PR-2** pins that
editor above the composer; PR-6 gives it its final design.

**O4 · Ring like pixie-girl-hub's WhatsApp calls, but better, and never
glass.** Reference implementation in `tomblakeasaah196/pixie-girl-hub`:
`src/modules/calls/calls.push.js`, `apps/admin/public/sw.js`,
`apps/admin/src/lib/call-alert.ts`,
`apps/admin/src/components/calls/{CallLayer,IncomingCallToast,InThreadCallBanner,ActiveCallBar,CallPushGate}.tsx`,
`docs/WHATSAPP_CALLING.md`. Attach that repo to your session to read it.
Copy its **behaviour**, not its styling: it uses translucent `dropglass`
surfaces, which this product does not. → PR-4 (delivery), PR-6 (screens).

**O5 · Test calls: a new permission right, a manual test and a platform
check.** A new permission right, **Test**, sits beside Read, Create, Update,
Delete, Approve, Validate, Disburse and Export in the permission matrix. No
role holds it by default. Holding it on Smart Comms (MOD-64) allows running the
full call-pipeline test from Comms → Setup. That test spends provider credit,
so it is capped at **3 runs per tenant per day**. A minimal automatic check
runs on its own and reports **only to the platform console**
(admin.praxisls.com) as a notification plus a section under Health, never in
tenant apps. → PR-7.

---

## 3. The fix, as seven PRs

| PR | Title prefix | Covers | Size |
| --- | --- | --- | --- |
| PR-1 | `fix(comms): stop phantom call notifications; Gemini fallback for transcripts and summaries` | **Done (#476).** O1, O2, A1, A4, A5, A6, A9, A10, A11, B1, B2, B5, B10, D10, E9, E10, E14, and C7's live-log half | L |
| PR-2 | `fix(comms): rebuild the call recorder and transcription pipeline` | O3, A2, A3, B4, B6, B7, B11–B14, C7 (prompt delimiting), D3, E11, H1, N3 | L |
| PR-3 | `fix(comms): harden calls — TURN, credentials, relay, IDOR, rate limits` | B8, B9, C1–C6, C8, C10–C13, D7 | M |
| PR-4 | `fix(comms): reliable call engine and rings on every device` | O4 (delivery), A7, A8, A12–A15, E1–E8, E13 | L |
| PR-5 | `perf(comms): scale calls and transcription across tenants` | B3, C9, D1, D2, D4–D6, D8, D9, D11, D12, E12, N1, N2, N5 | L |
| PR-6 | `feat(comms): new call screen and privacy defaults` | O3 (design), O4 (screens), F1–F10, G1–G5, H2, C6 (do-not-disturb), A11 (quiet hours), N4 | L |
| PR-7 | `feat(comms): test calls — Test permission, pipeline diagnostics, platform check` | O5 | L |

All seven PRs also apply H3 and H4 to the files they touch. Together they cover
all 87 audit findings, the 5 PR-1 findings (N1–N5) and the owner decisions
O1–O5.

### PR-1 · Stop the phantom notifications and calls

**Status: done and merged in #476.** This section is the plan it started from.
Where this section and PR-1's Progress entry (§6) disagree, the entry is what
was built. The pinned summary (O3) was decided after PR-1 started and moved to
PR-2.

**Goal.** No notification is ever sent from the nightly job. Calls with no audio
never reach the AI. The summary notification opens the summary. A closed tab
ends its call. Sandbox calls stay in the sandbox.

**Depends on:** this document merged to `main`.

**Owner decisions (2026-09-24), done first in this PR.** They override this
plan where the two conflict.

- **A-1 · Transcription: Groq once, then Gemini. No browser fallback, no
  retries.** Each part gets one Groq attempt (the SDK's own retries off). On
  any Groq error the same stored part goes to Gemini once. If Gemini also
  fails, the part fails; neither provider is retried inside the job. Gemini
  transcribes verbatim in the language spoken (never translated), reports
  en/fr, runs at temperature 0 with a strict JSON reply, and reuses the
  platform `gemini` credential (env `GEMINI_API_KEY` fallback). The Gemini
  Developer API does not accept `audio/webm`, so browser audio is converted to
  FLAC with ffmpeg on the server. A Gemini transcript comes from the stored
  audio, so it is certified; every transcript row records its real provider.
  The 14010 CHECKs on `provider`/`certified` and `provenance` are dropped and
  the closed sets are enforced in code. The browser live capture is never used
  to build a transcript; old `browser-live` rows still render; the client no
  longer starts the speech recogniser; `/live-log` stays for old cached
  clients. Gemini usage is recorded through `governance.recordUsage` with
  provider `gemini`.
- **A-2 · Summaries: Gemini first, DeepSeek last resort.** `llm.chat` gains an
  optional `fallbackVendor` (default: today's FALLBACK), and the call summary
  calls it with `vendorName: "gemini", fallbackVendor: "deepseek"`. The rest
  of Praxis AI keeps DeepSeek → Gemini.

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
it arrives, during the call, using PR-1's Groq → Gemini order (O1). The summary
is ready about a minute after hang-up, whatever the call's length. It waits for
the caller **pinned above the composer** of the conversation (O3). Nothing
re-bills finished work, and a provider failure never turns into an automatic
retry loop. Summary state changes are race-free.

**Depends on:** PR-1 merged (#476). Read its Progress entry: the job `origin`
flag, `notified_at`, the `NO_RECORDING` state, the Gemini transcription service
(`src/services/ai/gemini-transcription.service.js`, WebM → FLAC through
ffmpeg), the provenance values and `CallSummaryEditor` are used here.

**Main files:** `client/src/features/comms/call/{call-recorder,call-session}.ts`,
`client/src/lib/smartcomm-api.ts`,
`src/modules/smartcomm/smartcomm.call.{pipeline.service,repo,service}.js`,
`smartcomm.{validator,controller,routes}.js`, `src/jobs/handlers/call-transcribe.js`
(split into per-part and finalise handlers), `src/jobs/workers.js`, new tenant
migration(s), `tests/unit/smartcomm-call-records.test.js`, a new integration test,
`client/src/features/comms/team-chat.tsx` (the composer area),
`client/src/features/comms/call/{summary-draft,call-record}.tsx`,
`src/config/env.js` (N3).

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
     `callpart-<call>-<side>-<part>`. The job runs O1 exactly: one Groq
     attempt, then Gemini once, then the part is failed.
   - The result is stored per part. Plain columns on `comms_call_recording` are
     allowed.
   - A new `POST /smartcomm/calls/:id/recording/complete { side, parts }`
     declares a side finished, stored as plain columns on `comms_call`.
   - A `call-finalise` job runs when both sides are declared and every declared
     part has a result, or at a deadline (ended_at + 10 min) as a delayed job.
   - It assembles the transcript and certifies only when every declared part is
     certified. Otherwise the draft is labelled with the missing minutes. It
     then drafts the summary and notifies once (PR-1's `notified_at`).
3. **Idempotent reprocessing (B4, B5, O1).**
   - A part that failed on both providers is **not** retried automatically
     (O1). The transcript says which minutes are missing. An admin can re-run
     a failed part manually from the call page, which runs O1 once more.
   - The only automatic re-run is for work that never happened: a part whose
     job never ran, or a finalise that never ran because a worker died. Those
     are capped per part and per call on every branch, including stale
     `PROCESSING`.
   - A certified part is never sent to a provider again.
   - Inserting a certified row retires whatever row is current for that part.
   - The daily record sweep keeps only the audio retention and these never-ran
     cases. PR-1 left it re-sending failed calls, at one Groq request per
     failing part a day; that stops here.
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
6. **The browser speech capture is already gone (PR-1, owner decision A-1).**
   It no longer feeds the transcript and the client no longer starts it, which
   closes D10, E9, E10 and C7's live-log vector. What is left for this PR: in
   the summary prompt, delimit and label the spoken transcript as untrusted
   text and cap its tokens (the rest of C7). Remove the `/live-log` write route
   only once no supported client build still calls it. The consent-text update
   belongs to PR-6 (G2).
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
10. **The draft lands in the conversation (O3).**
    - In a DIRECT conversation where the caller has a `PENDING_REVIEW` draft,
      show it **pinned above the composer** as "Call summary — Review & send".
      It expands to PR-1's `CallSummaryEditor` (summary, key points,
      follow-ups, EN/FR, Send, Discard with confirmation).
    - The thread read returns the caller's pending draft for that
      conversation, so the card is there when the conversation opens.
      `call:summary_ready` refreshes it live.
    - Only the caller sees it. The callee sees the summary once it is sent.
    - The summary notification opens the conversation with the card
      expanded. The call page (`/comms/calls/:callId`) stays as the record,
      and links to the conversation.
    - Design stays within the primitives; PR-6 does the final look.
11. **Gemini model (N3).**
    - Replace the retired defaults with a current audio-capable model in all
      three places N3 lists: `env.js`, `vision.service.js` and the
      `ai-control` prefill. Check Google's current model list; do not guess.
      The platform credential (`gemini-2.5-flash` today) stays what
      production uses.
    - Add a boot or health check that logs, and shows in the platform AI
      Vendors screen, when the configured Gemini model does not exist.
12. **Docs.** Rewrite guide §4.5 to the new trigger model, and remove the claims
    that "clients re-trigger the job when the last part lands" and "no code path
    posts without this write in the same transaction".

**Acceptance.**
- Calls of 5, 15 and 29 minutes on Chrome Android, Safari iOS and desktop all
  reach `CERTIFIED`, and still do with the Groq key disabled (Gemini carries
  every part).
- A part that fails on both providers is never retried automatically, and the
  draft names the missing minutes.
- Staying in the conversation after a 10-minute call, the caller sees the
  draft pinned above the composer within 2 minutes of hang-up. Sending it posts
  exactly one message, and the card disappears.
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
6. **Handed over by PR-2 (added after PR-2).**
   - C4: reject `attachment_kind: "CALL"` at the route/validator level for
     the generic message, edit and scheduled-message routes, **not** inside
     `smartcomm.service.writeMessage`, which `sendSummary` uses. Resolve a
     card only for a SENT summary whose `sent_message_id` or
     `update_message_id` is that message.
   - C11: `getSummary` and `getTranscript` still return
     `transcription_error`. Return reason codes to clients; keep raw vendor
     text in server logs only.
   - C8: `regenerateSummary` still calls the LLM inside the request. Make it
     a queued job, rate-limited per call, and require a language change.
   - B9: the client still sends a hang-up `reason`. The server derives it
     and ignores the body.
   - Rate-limit the part re-run route
     (`POST /calls/:id/recording/:side/:part/rerun`) together with dial,
     TURN credentials and regenerate.
   - `/live-log`: nothing has used it since PR-1, but it still accepts and
     stores up to 2,000 segments of 2,000 characters per request. Make it
     return 410 Gone (preferred), or cap and rate-limit it.

**Acceptance.**
- A TURN allocation to 169.254.169.254 or 172.17.0.1 is refused.
- A credential request for an ended call returns 404.
- Posting a message with a `CALL` attachment returns 422.
- A signal for an ended call is dropped.
- A dial flood returns 429.
- `npm run ci` is green, and `/security-review` has been run on the diff.

### PR-4 · Call engine reliability and rings on every device

**Goal.** Calls connect first time, survive network changes and always play
audio. A call rings on **every** device of the callee, including a closed or
backgrounded installed app on phone and laptop. The rings stop everywhere the
moment the call is answered or ends, and the notification's Answer/Decline
work. This follows pixie-girl-hub's behaviour (O4) and goes further.

**Depends on:** PR-3 merged (relay payload shapes may have changed; read its
entry).

**Main files:** `client/src/features/comms/call/{call-engine,call-session,noise-suppression,wake-keepalive,ring-surface}.ts`,
`client/src/features/comms/comms-live.tsx`, `client/public/push-handler.js`,
`src/server.js` (CSP), `src/modules/smartcomm/smartcomm.call.service.js`
(ring pushes, noise default), `smartcomm.{routes,controller}.js` (the ringing
read), `src/jobs/handlers/comms-call-ring-escalate.js` (becomes the re-alert
job), `src/realtime/index.js` (signal event shape, if changed),
`client/src/features/settings/calls-page.tsx` (device check). Reference:
pixie-girl-hub's `calls.push.js`, `sw.js`, `call-alert.ts`, `CallLayer.tsx`
and `CallPushGate.tsx` (O4).

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
5. **Rings reach every device (A12, A14, O4).**
   - At dial, push the ring to **every** device of the callee immediately:
     `kind: "call_ring"`, `urgency: "high"`, TTL equal to the time left in the
     ring, `requireInteraction`, `renotify`, a vibration pattern such as
     `[600, 250, 600, 250, 600]`, and Answer/Decline actions.
   - Re-alert every 15 s with `renotify` until the call is answered, declined or
     ends (at most 4 re-alerts). The existing delayed job becomes this
     re-alert job and re-reads the row before each send.
   - `call:ring_ack` is kept **only** for the ring-channel metric. It never
     suppresses a push to another device.
   - The service worker hands a ring to a visible page (`postMessage`) instead
     of showing an OS notification, so an open app rings in-app with no
     duplicate. Hidden or closed, it shows the notification.
6. **Rings stop everywhere (A7, E8).**
   - When the call is answered, declined or ends, send a cancel push to the
     callee's devices. The service worker **replaces** the ring notification
     in place (same tag) with a visible, non-sticky one: "Answered on another
     device", "Missed call — <name>" or "Call ended".
   - The replacement is deliberate: a push that shows nothing breaks the
     browsers' user-visible-push rule, and iOS revokes subscriptions that do
     it (pixie-girl-hub notes the same risk).
   - In-app, other devices stop ringing on `call:accepted`, `call:ended` or
     the cancel `postMessage`.
7. **Answer/Decline from the notification (A8).**
   - The service worker maps `event.action`. If a window is open, focus it and
     `postMessage` the intent, so the app is not reloaded and no live call is
     dropped. Otherwise open `/comms?ring=<id>&act=accept|decline`.
   - The intent survives a login redirect, and the app performs it if the call
     is still ringing.
   - An expired ring, when tapped, opens the call's conversation instead.
8. **Never miss a ring the app wasn't open for (A13).**
   - Add `GET /smartcomm/calls/ringing` (calls ringing for me).
   - The client reads it on socket connect, reconnect and return to the
     foreground, and merges it with socket events.
   - A ring expires on the client at the end of its window, so a ring can
     never stick.
9. **Every device knows whether it can ring (A15).**
   - Settings → Calls gets a "This device" check: notification permission,
     push subscription, whether the app is installed (iPhone requires Add to
     Home Screen), whether audio is unlocked. Each shows a fix.
   - A **Test ring** button sends a real ring push to this device only.
   - A one-time, call-specific prompt ("Allow this device to ring for calls")
     appears for users who can take calls, with iPhone install guidance
     instead of a dead-end prompt (see pixie-girl-hub's `CallPushGate`).
   - In-app ring extras: flash the tab title (`📞 <name> is calling`), and
     show "Tap to enable ring sound" when audio is blocked.
10. **Screen on the cheek (E13).** Do not hold a screen wake lock by default.
   If device tests show the call dies with the screen off, keep the lock and add
   a "controls locked" state that ignores taps until a deliberate unlock
   gesture.

**Tests:** the engine unit tests (glare, buffered candidates, restart offer
sent); Playwright two-page tests (a call connects; `context.setOffline` toggled
mid-call and the call recovers; a double-tap dial creates one call); tests that
the ring push goes to every device even when one acked, that re-alerts stop
when the call is answered, and that the cancel replaces the notification; the
ringing read; service-worker action and `postMessage` tests.

**Acceptance.**
- With the app open on the laptop and **closed** on the phone, both ring, and
  answering on one stops the other within 2 s.
- With the app closed everywhere, the phone buzzes every 15 s until answered or
  missed. Answer from the lock screen connects; Decline declines without
  opening a call screen.
- Opening the app mid-ring shows the ring.
- **Test ring** works on Android, desktop and an installed iPhone app.
- The engine rows of `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` pass on Chrome
  Android, Safari iOS and desktop, including a Wi-Fi→4G switch mid-call.
- **Platform limit:** no installed web app can show a native full-screen call
  screen or loop a ringtone while fully closed. That needs a native shell
  (CallKit on iPhone, full-screen call alerts on Android) and is out of scope.
  Laptops must have the browser running in the background for push to arrive.
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
   - A Groq 429, or a full Groq limiter, routes the part to Gemini immediately
     (O1). A Gemini 429 fails the part, and it is counted in the 429 metric.
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
7. **From PR-1 (N1, N2, N5).** Put the env in every room name (channel,
   mail, presence), not just user rooms. Make the mail bridge re-emit with
   `io.local.to(...)`. Correct the failure alarm's wording: there is no
   browser capture any more.

**Acceptance.**
- A load script (in `scripts/`) simulating 10, 50 and 200 tenants: ring
  timeouts fire within 5 s for every tenant while one tenant has 2 000 queued
  transcriptions.
- At 10-tenant load, p95 hang-up→summary is under 2 minutes.
- Tenant DB pool use stays within budget.
- `npm run ci` is green.

### PR-6 · New call screen and privacy defaults

**Goal.** A calm, solid, tenant-branded call experience that does not block the
ERP, laid out like pixie-girl-hub's calls but with no glass anywhere (O4). The
summary draft pinned above the composer gets its final design (O3). Privacy
defaults a tenant can defend.

**Depends on:** PR-5 merged.

**Main files:** `client/src/features/comms/call/{call-overlay,incoming-ring,summary-draft,call-summary-card,call-record,calls-list}.tsx`,
a new in-call bar component in the app shell, `client/src/features/settings/calls-page.tsx`,
`client/src/features/comms/team-chat.tsx`, `client/src/lib/i18n-dict.ts`,
migrations and seeds for defaults, the consent copy, the AI and transcript
retention code, `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md`.

**Steps**
1. **Layout (O4).** Take pixie-girl-hub's structure, not its surfaces:
   - **Incoming call:** a solid card, top-right on desktop and top-centre on a
     phone. It shows the caller's name and avatar, how long it has been
     ringing, the recording notice, and large Decline and Answer buttons. On a
     phone it can expand to a full solid screen. It never covers the app on
     desktop.
   - **In the caller's conversation:** a ring banner at the top of that thread
     replaces the card, so there is only ever one Answer button. Once
     answered, it becomes the live-call strip.
   - **Active call:** a floating bar (name, timer, mute, open conversation,
     hang up) that survives navigation. On a phone, tapping it opens a full
     solid call screen with the quality indicator and noise switch.
   - **Summary draft (O3):** the pinned card above the composer gets its final
     design: calm, solid, with the provenance label and clear Send and
     Discard.
   - pixie-girl-hub's translucent `dropglass` class and blur are **not**
     copied.
2. **Screens (F1–F5, F9).**
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
3. **Consent and review (F6, F7, F8, G5).**
   - The ring screen states that the call will be recorded.
   - The callee can choose "Answer without recording". The server records the
     choice on the call, and neither side arms the recorder.
   - Key points and follow-ups can be edited and removed.
   - Discard uses `useConfirm` with `destructive`.
   - Due dates use `dateDmy`.
4. **Gating (F10, C6).**
   - The phone icon renders only when `calls` is on for the tenant and the
     user may create in MOD-64.
   - Add a per-user do-not-disturb setting for calls. It also gives the call
     notifications quiet hours (A11's deferred part).
   - Show the "transcription failed" state that is set but never rendered
     (N4), in the call page and the pinned draft.
5. **Privacy defaults (G1–G4).**
   - `call_recording` defaults to OFF in the catalogue. For tenants still on
     `source = 'default'`, flip it off in a migration, after the owner signs
     off.
   - Add a tenant-admin switch on the Calls settings page (MOD-70 edit).
   - Name the outside companies that actually receive call data in the consent
     text and a "How calls are processed" panel, reading the configured
     transcription and LLM vendors rather than hard-coding them. Since O1 and
     O2, that includes Google (Gemini) for transcription whenever Groq fails,
     Gemini for summaries, and DeepSeek as the summary fallback. Add them to
     the tenant DPA doc.
   - A transcript retention setting with a sweep, and an audited admin erasure
     of a user's call records.
   - A "hide my last seen" setting.
6. **Release gate (H2).** Run every row of the manual matrix and record the
   results. `call_recording` must not be enabled by default for any new tenant
   until the matrix passes.

**Acceptance.**
- The screens pass the frontend gates and a light/dark visual check.
- On desktop, an incoming call never hides the screen the user is working on;
  an active call leaves the app fully usable.
- A tenant created after this PR has recording off.
- The matrix has no PENDING cells.
- `npm run ci` is green.


### PR-7 · Test calls: the Test permission, pipeline diagnostics and the platform check

**Goal.** Anyone holding the new **Test** right can prove, from Comms → Setup,
that every step of a call works on their device and on the server. The run uses
the real code, creates no fake call, and names the exact step that is broken. A
minimal automatic check tells the platform team (not tenants) when a provider,
the worker or the relay breaks (O5).

**Depends on:** PR-6 merged. By then every step being tested exists in its
final form. Read every Progress entry, because each PR changed something this
PR tests.

**Main files:** a tenant migration (the `can_test` column and the diagnostics
run table), `src/middleware/rbac.js`, `src/shared/cache/identity-cache.js`,
`src/modules/security/permission/permission.{repo,validator}.js`,
`src/services/ai/action-authz.js`, `client/src/lib/rbac.ts`,
`client/src/features/security/permission-matrix-page.tsx`, a new
`src/modules/smartcomm/smartcomm.diagnostics.{service,repo}.js` with its routes,
the production call and pipeline services (each gains a diagnostics mode), a new
Setup tab in `client/src/features/comms/setup/`, reference audio fixtures, a
platform migration and job for the automatic check,
`platform-console/src/features/ops/OpsHealth.tsx`, and the console notification
feed read by `platform-console/src/components/NotificationBell.tsx`.

**Steps**
1. **The Test permission right.**
   - Tenant migration: `ALTER TABLE permission ADD COLUMN IF NOT EXISTS
     can_test boolean NOT NULL DEFAULT false`. This is a plain column, which
     the migration rules allow. Follow migration 12771's pattern and add a
     column comment, but **no backfill**: no role holds Test until someone
     grants it, because every run spends money.
   - Add `test: "can_test"` to `ACTION_COLUMN` in `rbac.js`. Carry the column
     through every place the other eight rights are listed:
     `identity-cache.js`, `permission.repo.js` (the column list and the
     `COALESCE` upsert, so saving other rights never clears it),
     `permission.validator.js`, `action-authz.js` and `client/src/lib/rbac.ts`
     (with its test).
   - In the permission matrix, add a legend entry and a popover row: "Test —
     run live checks that spend provider credit". The cell dot counts it like
     the others.
   - The CEO bypass in `rbac.js` passes every right by design (PRD §3), so the
     CEO can always test. Keep that and say so in the matrix legend's tooltip.
   - Run `node scripts/generate-api-docs.js` for the validator change.
2. **The manual run (Comms → Setup → "Test calls").**
   - `POST /smartcomm/diagnostics/runs` requires
     `requirePermission("MOD-64", "test")` and the `calls` feature. Without
     the right, the tab is hidden and the route returns 403.
   - **Cap: 3 runs per tenant per day**, counted in the run table and enforced
     by the server. The fourth returns 429 with the time the next run is
     available, and the button shows the same.
   - It runs the steps in this order, each with status, time, plain-language
     cause, fix hint and error code:

     | # | Step | Proves | Pass when |
     |---|---|---|---|
     | 1 | Server and worker | A job goes through the real queue and worker | Round trip ≤ 5 s |
     | 2 | Schedules | The nightly job is at a daytime hour in the tenant's time zone; the per-call ring and cap jobs are being processed | Next run shown in local time; no overdue ring or cap job |
     | 3 | Live signals | The worker can reach this screen (the missing-summary bug) | Received ≤ 5 s |
     | 4 | Ring to this device | A real ring push reaches this device and the service worker reports it back; the device check (A15) is green | Received ≤ 10 s |
     | 5 | Microphone | Permission, device, live level meter while the user reads a sentence | Voice level detected |
     | 6 | Audio | Remote audio would play; the noise filter loads and is not silent | Both OK, or a clear reason |
     | 7 | Connection | STUN finds a public address; a TURN credential is minted; a 10-second test call to itself through the relay | Relay connects; RTT, jitter and loss shown |
     | 8 | Recording | 3 short parts of the user's voice; each decodes on its own; each uploads and passes the container check | All 3 |
     | 9 | Transcription | Bundled English and French reference clips go to Groq, then the same clips are **forced** through Gemini; the user's own parts go through the normal order (O1) | ≥ 85% word match, correct language, time per provider |
     | 10 | Summary | Gemini summarises the reference transcript, then DeepSeek is **forced** (O2) | Both pass the shared summary schema, in the requested language, with key points quoted from the transcript |
     | 11 | Clean-up | Test audio and objects deleted | Nothing left |

   - **Real code, separate records.** Each production function used here gains
     a diagnostics mode. It runs the same code but writes results to the run
     instead of the call tables. A run must leave **zero** rows in `comms_call*`,
     call metrics, chats and call notifications (asserted by tests).
   - Forcing a provider is possible only in diagnostics.
   - Storage goes under `tenant_<slug>/comms/diagnostics/<run>/` and is
     deleted at the end.
   - Usage is recorded under a `diagnostics` feature line. A full run is about
     4–6 transcription requests and 2 AI summaries: cents.
   - Progress streams live over the socket (PR-1's worker emitter), with
     polling as a fallback.
   - **Result screen:** green, amber or red per step. **Copy report** produces
     a plain-text report (run id, versions, timings, errors; never audio or
     secrets) to paste to support or an AI agent. Past runs are listed for
     people with the Test right.
   - Runs are stored in a new tenant table `comms_call_diagnostic_run`: run
     id, user, env, started and finished, status, steps as jsonb, report. It is
     a new table, so constraints are allowed. Keep runs 90 days.
   - Reference clips: about 20 s each, EN and FR, with known text. Record them
     in-house, or generate them with TTS so there are no licence issues.
     Commit them as fixtures with their expected text.
3. **The automatic platform check (reported to admin.praxisls.com only).**
   - A worker job `comms-call-canary` runs **once a day** at a daytime hour
     (configurable cron and time zone; default 10:00 Africa/Douala). It is
     platform-wide, not per tenant, so it costs one small run a day.
   - It is minimal: the queue round trip; the worker's live-signal emitter;
     scheduler registrations (next nightly run is daytime, no midnight
     repeatable); one short English clip through Groq and the same clip forced
     through Gemini; one Gemini summary with DeepSeek forced as well; a TURN
     relay allocation from the server.
   - It also runs cheap per-tenant checks that spend no provider credit:
     tenant DB reachable; no call stuck `RINGING` or `IN_CALL` past its
     deadline; no transcript stuck `PROCESSING` for more than an hour.
   - Results go to a new platform table `platform.comms_call_canary_run`.
   - **Reporting:** a "Calls pipeline" section on the console Health page
     (`/ops`) shows the latest run, per-check status and history.
   - A failure, and the recovery after one, lands as a notification on the
     console bell (the Error Center in-house feed `NotificationBell.tsx`
     reads). It also goes out through `alerts.raise` with severity `notify`.
   - **Nothing is shown in tenant apps.**
4. **Docs.** A short "Test calls" page in the engineering guide: what each step
   proves, what a red step usually means, and how to read a report.

**Tests:**
- RBAC: `test` maps to `can_test`; saving other rights never clears it; a role
  without it gets 403.
- The 3-per-day cap, including a concurrent-request race.
- A run writes zero rows to the call tables, metrics and notifications.
- Each step turns red on its own injected failure (bad Groq key, bad Gemini
  key, stopped worker, wrong TURN secret, push permission denied, blocked mic),
  and only that step.
- The canary job writes its run and raises one bell notification on failure and
  one on recovery.

**Acceptance.**
- The Test right appears in the permission matrix and no role holds it by
  default; the CEO can always run.
- A user with the right, on a healthy stack, gets 11 green steps in under 2
  minutes.
- Breaking any one dependency turns exactly its step red, with a hint that
  names the fix.
- A fourth run in a day is refused with the next available time.
- The platform console shows the daily check under Health, and a deliberate
  Groq-key break raises a bell notification there and nothing in the tenant
  app.
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
     browser fallback and then nightly reprocessing. (Since PR-1 a Groq 429
     sends that part to Gemini once instead; there is no browser fallback.)
- At 10 tenants that becomes hours of backlog at peak, 429 storms at
  midnight, and the nightly notification loop multiplied by ten.

**The design that holds (built in PR-2 and PR-5):**

1. **Transcribe during the call.** Each 2-minute part is transcribed as soon as
   it uploads. A 30-minute call becomes 15 small jobs per side spread over the
   30 minutes. At hang-up only the last part is left, so the summary arrives in
   about a minute whether the call lasted 3 minutes or 30. Load follows talk
   time, with no post-call spike and no midnight spike.
2. **One rate limiter per provider, fair shares for tenants.** A limiter for
   Groq and one for Gemini, each sized to that provider's per-key limits
   (requests per minute and audio-seconds per hour; check your plan, since
   audio-seconds is usually the binding one). A per-tenant token bucket stops
   one busy tenant starving the others.
3. **Priorities, and what a failure means (O1).** Live calls first, then
   finalising. Any Groq failure, including a 429, sends that part to Gemini
   immediately. Groq is on a free tier and will hit its limits at busy times,
   so Gemini is the working backup, not a rare path. A Gemini failure fails
   the part, with no retry. The limiters are therefore what keeps failures
   rare: when Groq's limiter is full, send the part straight to Gemini rather
   than wait.
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
9. **Beyond ~50 tenants.** A second transcription provider now exists (PR-1:
   Gemini, one attempt when Groq fails; its transcripts are certified). Note
   what that means for data: **call audio goes to Google (Gemini) whenever
   Groq fails a part**, and summaries go to Gemini first with **DeepSeek only
   as the last resort** (G2). Size the Gemini quota for Groq's worst hour, not
   its average. Use multiple provider keys or an enterprise tier, and consider
   letting large tenants bring their own key. PR-7's platform check shows each
   provider's health daily.

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
| Web Speech live capture | **Removed** (PR-1, A-1) | Privacy, Android chimes, timer leaks; Gemini is the fallback now. |
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
| Audit (this document) | MERGED | `claude/integration-audit-report-u6twc5` | #474 | 2026-09-24 | Report, PR plan, scale design |
| PR-1 | MERGED | `claude/magical-einstein-xqhkn1` | #476 | 2026-09-24 | Includes owner decisions A-1 (Groq → Gemini transcription, no browser capture) and A-2 (Gemini → DeepSeek summaries) |
| PR-2 | MERGED | `claude/wizardly-ptolemy-dyazt1` | #477 | 2026-09-24 | Per-part recorder and transcription, finalise, race-free drafts, pinned draft (O3), N3; migration 14050 |
| PR-3 | MERGED | `claude/tender-davinci-v1eh8y` | #479 | 2026-09-24 | TURN, credentials, relay, IDOR, rate limits; migration 14060; null-payload crash in the relay |
| PR-4 | MERGED | `claude/smart-comms-pr-4-9e8q91` | #481 | 2026-09-24 | Perfect negotiation, rings on every device (push at dial, re-alerts, cancel everywhere), ringing read, Answer/Decline, device check + Test ring, noise default off, no screen wake lock; TURN relay-to-relay and TLS on 443 (owner's Step 0/0b); migration 14070 |
| PR-5 | MERGED | `claude/smart-comms-pr-5-jzgkt1` | #482 | 2026-09-25 | Per-call clocks, Redis presence, fair/limited transcription, fair ring queue, metrics from counters, latency alarm, bounded queries, env in every room; rate-limit memory fallback, sandbox status mirror; `scripts/load-calls.js`; migration 14080 |
| PR-6 | MERGED | `claude/smart-comms-pr-5-jzgkt1` (restarted from `main` after #482) | #483 | 2026-09-25 | Solid ring card, call screen, docked bar and thread strip (O4); answer without recording; recording is the tenant's opt-in; processors named; DND, quiet hours, hide last seen; transcript retention and erasure; N4; F10 gating; migration 14090 |
| PR-7 | MERGED | `claude/smart-comms-pr-5-jzgkt1` (restarted from `main` after #483) | #484 | 2026-09-25 | Test right (can_test); Comms → Setup → Test calls, 11 steps, 3 a day; reference clips; daily platform call check → console Health and bell; migrations 14100, 14110, platform 0108 |
| Plan update (O1–O5, A12–A15, N1–N5, PR-7) | MERGED | `claude/integration-audit-report-u6twc5` | #475 | 2026-09-24 | Owner decisions, ringing findings, PR-1 findings, test calls |
| Chat UI redesign (**parallel, not a plan PR**) | MERGED | `claude/message-ui-redesign-gzxylv` | #478 | 2026-09-24 | Cosmetic chat-thread restyle. Touches `team-chat.tsx` **header + sidebar + thread scroller only** — NOT the composer area (PR-2) and adds no feature gating (PR-6). See the log entry below before PR-2/PR-6. |

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

### PR-1 · 2026-09-24 · OPEN (#476)
- Owner decisions, done first:
  - **A-1** Transcription is Groq once (SDK retries off), then Gemini once on
    any Groq error; no retries in the job, no browser fallback. New
    `src/services/ai/gemini-transcription.service.js`: native generateContent
    on the platform `gemini` credential's host (env `GEMINI_API_KEY`
    fallback), verbatim, en/fr reported, temperature 0, strict JSON schema.
    The Gemini Developer API does not accept `audio/webm` (webm is
    Vertex-only), so webm/mp4/ogg are converted to 16 kHz mono FLAC with
    ffmpeg. Proven on a real Chromium MediaRecorder WebM/Opus fixture
    (`tests/fixtures/audio/`). Rows record `groq` or `gemini`, both certified.
    Gemini usage goes through `governance.recordUsage` with provider
    `gemini`. The client no longer starts the speech recogniser;
    `live-transcript.ts` is deleted; `/live-log` stays for old clients.
    Closes D10, E9, E10 and C7's live-log vector. Tests:
    `gemini-transcription.test.js`, `smartcomm-call-records.test.js`
    ("Groq once, then Gemini once"), `transcription-platform-vendor.test.js`,
    `call-session.test.ts` (no recogniser), `summary-draft.test.ts` (label).
  - **A-2** `llm.chat` takes `fallbackVendor` (default FALLBACK); the call
    summary uses gemini → deepseek. Tests: `ai-llm-fallback-vendor.test.js`,
    `smartcomm-call-records.test.js`.
- Fixed, each with the test that proves it:
  - A1: cron `COMMS_CALL_RECORD_SWEEP_CRON` (`0 10 * * *`) in
    `COMMS_CALL_RECORD_SWEEP_TZ` (Africa/Douala); boot removes every other
    repeatable on the queue. `call-record-sweep-schedule.test.js` (BullMQ's
    own `getNextMillis`: 09:00Z, not 00:00Z). Also checked on real
    BullMQ + Redis: the old repeatable and its pending 00:00Z run are removed.
  - A4: `origin` hangup | sweep through the job; only hangup notifies,
    claimed once on `comms_call_summary.notified_at`; ops alert on a call's
    first failure only. `smartcomm-call-records.test.js` ("notify once"),
    `call-record-jobs.test.js`, `smartcomm-call-repo.test.js`.
  - A5: recording off, nothing uploaded after the grace, or never connected →
    terminal `NO_RECORDING`, before any attempt is counted; no words → no LLM.
    `smartcomm-call-records.test.js` ("no audio, no pipeline").
  - A6: `?ring=` for rings, `?call=` redirects to `/comms/calls/<id>` and
    never rings; Calls list (`/comms/calls`) and the call's page
    (`/comms/calls/:callId`, editor inline, transcript); worker socket
    events through `@socket.io/redis-emitter`; `call:summary_ready` is a
    toast. `ring-surface.test.ts`, `call-session.test.ts`,
    `calls-screens.test.tsx`, `realtime-user-rooms.test.js`, e2e
    `call.spec.ts` (old link opens the page).
  - A9: user rooms are `t:<slug>:<env>:u:<uid>`; every publisher passes the
    env. `realtime-user-rooms.test.js` (real emitter → real redis adapter),
    `smartcomm-calls.test.js`, `notification-interrupt.test.js`. Also run
    end to end on real Redis with two `socket.io-client` tabs.
  - A10: keepalive URL from `callHangupUrl` (the same helper as
    `hangupCall`). `smartcomm-api.test.ts` (matches the router),
    `call-session.test.ts` (exact URL).
  - A11: the push names the other person, a day-first time and the minutes,
    links to the call's page, and the service worker renders it in French or
    English. `smartcomm-call-records.test.js`,
    `push-handler-call-summary.test.ts`.
  - B1: 14040 drops `comms_call_end_reason_check`; the repo holds the set.
    `smartcomm-call-repo.test.js`, `tests/integration/call-liveness.test.js`
    (real schema, with a control that reproduces 23514).
  - B2: `Math.max`. `smartcomm-calls.test.js`.
  - B5: never-connected calls excluded in SQL and marked `NO_RECORDING`; a
    governance refusal counts an attempt. `smartcomm-call-repo.test.js`,
    `smartcomm-call-records.test.js`.
  - B10: see deviations. `smartcomm-calls.test.js`.
  - E14: call history exists (the Calls list uses `listCalls`).
- Not fixed / deferred:
  - A11 quiet hours: there is no quiet-hours mechanism in the notification
    service. The summary push is now sent only by the hang-up run, within a
    minute of the caller's own call, never by the sweep. A general setting
    belongs with PR-6's do-not-disturb.
  - E14 remainder: `getCallTurn` and `call:ringing_sent` stay unused; PR-4
    uses them (its steps 1 and 4).
  - A2 is PR-2's. Until then, a call whose parts land after the 20 s hang-up
    job gets its draft from the 10:00 sweep, silently, found by its badge.
- Deviations from §3:
  - B10: the dead `max_duration` branch was removed, not activated. Passing
    `reason` would let a client-sent `max_duration` record a 10 s call as
    30:00, because the client still picks the reason until PR-3 (B9). The cap
    end still records exactly 1800 through the clamp.
  - A5: no audio parts means `NO_RECORDING` even if a live log exists (A-1).
  - Step 5: the floating `CallSummaryPanel` is gone (nothing could open it
    once the socket event became a toast). `CallSummaryEditor` is embedded in
    `call-record.tsx`, which follows the house record pattern (page on
    desktop, `?focus=` sheet on a phone). `call:summary_ready` toasts only for
    an update: a first draft already arrives as a notification whose toast
    honours the user's interrupt preference, and a second toast would ignore
    it. The toast is text-only (`Toast` has no action slot by design); the
    notification row and push carry the link. The page shows a draft whenever
    one exists (`getCall` returns `draft_status`), so an old call whose only
    words came from the browser capture keeps its draft after it becomes
    `NO_RECORDING`.
    The editor now uses `Field`/`Textarea`/`Segmented`/`Button`/`Callout`,
    confirms Discard (`useConfirm`, destructive) and shows due dates with
    `dateDmy`; the call overlay and ring screens are untouched (PR-6).
  - Step 6: the request context gains `env`; worker jobs without one run in
    live, so their announcements go to live rooms.
  - A `list_comms_calls` AI read was added; `comms_call_transcript` and
    `comms_call_summary` moved to the new `comms_call_record` screen.
- Schema and config: migration 14040 drops `comms_call_end_reason_check`,
  `comms_call_transcript_provider_check`, `ck_comms_call_transcript_certified`
  and `comms_call_summary_provenance_check` (names read from `pg_constraint`),
  adds `comms_call_summary.notified_at`, and backfills `NO_RECORDING` for
  calls over a day old with no recording. New values: transcription state
  `NO_RECORDING`, provider and provenance `gemini`. New env
  `COMMS_CALL_RECORD_SWEEP_CRON` / `_TZ`. New dependency
  `@socket.io/redis-emitter@^5.1.0`. ffmpeg is needed at runtime (already in
  the Docker image) and in CI `build-test` (install step added).
- New findings:
  - Channel rooms `t:<slug>:c:<groupId>` and the tenant mail room
    (`mail:new`, presence) have no env (`src/realtime/index.js:32-33`). If a
    sandbox schema shares group ids with live, sandbox chat events reach live
    sockets. Suggest PR-5 (it owns presence).
  - `attachMailBridge` re-emits each bus message with `io.to(...)` on every
    API replica; with the redis adapter attached that is one duplicate
    `mail:new` per replica. Should be `io.local.to(...)`
    (`src/realtime/index.js`, `attachMailBridge`).
  - `GEMINI_MODEL` defaults to `gemini-1.5-pro` (`src/config/env.js:372`),
    which Google has retired. The platform `gemini` credential must name a
    current audio-capable model, or the Gemini fallback (and the chat
    fallback) fails with 404.
  - `transcriptionIssue` in `call-session.ts` is set by
    `call:transcription_failed` and rendered nowhere.
  - The sustained-failure alarm's subject still says calls "fell back to the
    browser capture" (`src/services/platform/comms-metrics.service.js:372`);
    there is no browser fallback now. PR-5 owns the metrics.
  - Until A3 (PR-2), parts 2..N are headerless, so they fail on Groq and on
    Gemini (ffmpeg refuses them before any request is sent). Each nightly
    retry of such a call still costs one Groq request per failing part, up
    to the 20-attempt cap. The §0 parking SQL is still worth running.
- For the next PR (PR-2):
  - Job data carries `origin` ("hangup" | "sweep"); `processCall(…, { origin })`;
    only a non-sweep run claims `notified_at` and notifies. A finalise job
    should notify through the same claim.
  - `NO_RECORDING` is terminal and has no CHECK; the client type has it.
  - Keep A-1's contract in per-part jobs: Groq once (`maxRetries: 0`), then
    Gemini once, no retry loops. §4 notes the 429 conflict for PR-5.
  - The browser capture removal is done; do not redo step 6 beyond the
    prompt-delimiting half of C7.
  - `publishToUser(slug, env, userId, event, payload)`. Worker publishes work.
  - Client: `CallSummaryEditor` (`summary-draft.tsx`), `call-record.tsx`,
    `calls-list.tsx`, `call-labels.ts`. `listCalls` rows carry
    `draft_status`, `notified_at`, `summary_update_available`.
  - The §0 parking SQL was not run by this PR.
- Gates: `npm run ci` 47/47 passed (414 s) on `57457a0`, run alone on a clean
  tree. Of the jobs it skips, these were run by hand: provisioning and
  migration replay on local Postgres 16 + pgvector (re-run applied 0 files),
  live/sandbox schema parity, AI catalogue sync + `--check` for live and
  sandbox, `RUN_DB_TESTS=1` `tests/integration/call-liveness.test.js`, and
  Playwright `call.spec.ts` 6/6 against a production build. Also checked by
  hand: the repeatable removal on real BullMQ + Redis, the worker emitter →
  redis adapter → two `socket.io-client` tabs (live/sandbox) on real Redis,
  and the Calls list and call page in light and dark. `npm audit`: the same
  highs as `main`, none from the new dependency. Not run: the Docker build,
  PgBouncer, the AI golden-set eval, the full desktop layout gate. The §0
  parking SQL was not run, and nothing here touched production.
  A pre-existing flake seen once: `tests/db/query-columns.test.js` can hit
  `ENOENT` on `migrations/tenant/99999_gate_probe.sql`, which
  `tests/unit/constraint-guards.test.js` writes and deletes in the real
  migrations directory while another jest worker reads it.

### Plan update · 2026-09-24 · OPEN (#475)
- Rebuilt on top of PR-1's merged version of this document; PR-1's text and
  its log entry are kept as written.
- Added A12–A15: rings only reached devices with the app open, because one
  open tab suppressed every other device's push, and an app opened mid-ring
  never learned of the call.
- Added the owner decisions O1–O5 (§2 O); they override the rest of the plan.
  O1 and O2 are PR-1's "A-1" and "A-2", and are done.
- Added N1–N5 from PR-1's new findings (§2 N) and routed them: N3 to PR-2, N1,
  N2 and N5 to PR-5, N4 to PR-6. A11's deferred quiet hours go to PR-6.
- PR-2 now also pins the summary above the composer (O3), never auto-retries a
  part that failed on both providers, and fixes the Gemini model default (N3).
- PR-4: rings reach every device, following pixie-girl-hub (O4), plus a
  device check and Test ring.
- PR-6: pixie-girl-hub's layout, with solid surfaces.
- New PR-7: the Test permission right, the 3-per-day pipeline test in Comms →
  Setup, and a daily platform check reported only to admin.praxisls.com.
- §4 item 3: PR-1 left the rate-limit question open; the owner's O1 decides it
  (any Groq failure goes to Gemini at once).

### PR-2 · 2026-09-24 · OPEN (#477)
- Owner decisions:
  - **O1** kept exactly in the per-part jobs. `call-transcribe-part` runs
    Groq once (`maxRetries: 0`), then Gemini once, then marks the part
    FAILED, and the queue has `attempts: 1`. A settled part is never sent to a
    provider again, and the sweep never touches a FAILED part. The one
    exception is a person: an admin (MOD-70 edit, who must also be a
    participant) can re-run a failed part from the call page, at most 3
    times. `smartcomm-call-records.test.js` ("O1 exactly", "a second run
    calls no provider"), `tests/integration/call-pipeline.test.js` ("never
    retried automatically").
  - **O3** built. The thread read returns `pending_call_summaries` (the
    caller's own PENDING_REVIEW drafts, and only while recording is on).
    `pinned-call-summary.tsx` sits above the composer in `team-chat.tsx`, and
    "Review & send" opens `CallSummaryEditor` there. Key points and
    follow-ups (text, owner, due date via `DateField`) can now be edited or
    removed. The notification opens `/comms?channel=<g>&summary=<c>`, and the
    call page links back to the conversation. `call:summary_ready` bumps
    `summaryTick`, so an open conversation re-reads its card. Tests:
    `pinned-call-summary.test.tsx`, `calls-screens.test.tsx`,
    `call-session.test.ts`, e2e `call.spec.ts` ("the summary link opens the
    conversation with the draft pinned above the composer"). That e2e test
    also asserts the composer stays on screen with the card open on a 720 px
    window: the card shrinks and its editor scrolls. It failed before that
    fix. The card was looked at in light and dark.
- Fixed, each with the test that proves it. The new tests were also run
  against `main`'s code: 80 of 100 backend unit tests, every new client test
  and the integration suite fail there. The 20 that pass on `main` are PR-1
  guards carried over.
  - A3: one MediaRecorder per 120 s part, started with no timeslice; the next
    one starts before the previous one stops. The server refuses a part
    without a WebM/MP4/Ogg header (422 `RECORDING_NOT_AUDIO`). Tests:
    `call-recorder.test.ts`; `smartcomm-call-records.test.js`; e2e "every
    recorded part decodes on its own" (real Chromium, `decodeAudioData` per
    part, with a headerless control that must fail); the integration stub,
    which refuses headerless audio and decodes each part with ffmpeg where
    it is installed.
  - A2: each upload enqueues its part job
    (`callpart-<call>-<side>-<part>`). `POST /calls/:id/recording/complete`
    stores `<side>_parts_declared`. Finalise (`callfinal-<call>`) runs once
    both sides have declared and every declared part has a result. The
    hang-up queues a deadline finalise at +10 min (`callfinaldl-<call>`),
    after which an undeclared side counts what it uploaded. The call is
    CERTIFIED only if every declared part is. Tests: `finaliseReady`,
    `completeSide`, "the last part's result starts finalise", the
    integration suite.
  - B4: a part's result lands only on a PENDING part. Inserting a transcript
    row retires whatever row is current for that part, whatever its
    provider. Finalise with nothing new since `finalised_at` calls no
    provider and no LLM. Automatic re-runs are capped on every branch: 3 per
    part, 5 finalises per call, stale PROCESSING included.
    `smartcomm-call-repo.test.js`, `smartcomm-call-records.test.js`
    ("re-running finalise…"), integration.
  - B5: the sweep selects only unfinalised calls that connected, within the
    cap. `smartcomm-call-repo.test.js`.
  - B6: the draft upsert has `WHERE draft_status = 'PENDING_REVIEW'`;
    finalise and regenerate leave a sent or discarded draft alone.
    `smartcomm-call-records.test.js` (both B6 tests), `smartcomm-call-repo.test.js`.
  - B7: `sendSummary` is one transaction. It claims PENDING_REVIEW → SENDING
    with the caller's final words, writes the message, and marks it SENT;
    the broadcast and notifications happen after the commit. To allow this,
    `postMessage` is split into `writeMessage` (the rows, inside the
    transaction) and `announceMessage` (links, socket, notifications). Its
    other callers are unchanged. Unit tests for the order, the rollback and
    a double tap; integration: two concurrent sends on real Postgres give
    one 200, one 409 and one message.
  - B11: the validator caps a part at 125 000 ms, the repo at 125 s, and the
    row and the bytes are written in one transaction, row first.
  - B12: the storage key is fixed by (call, side, part), so a re-upload
    replaces its object.
  - B13: uploads and declarations are accepted only for connected calls that
    are IN_CALL or ended within 15 minutes; 50 MB per side; no part number
    above the declared count.
  - B14: one `recordingEnabled` helper (`call.service`, fails closed); the
    pipeline calls it.
  - C7 (prompt half): the transcript is sent inside `<transcript>`
    delimiters, labelled untrusted, capped at 60 000 characters, with a
    2 048-token output cap.
  - D3: part and finalise jobs read in one short connection, call the
    provider or LLM with none held, then write in another. The unit tests
    count open connections during every provider and LLM call.
  - E11: `call-upload-outbox.ts` keeps each part in IndexedDB, then the
    side's declaration, until acknowledged. It retries with backoff on
    network/408/429/5xx, drops on any other 4xx, and resumes on the next app
    load (`wireCallSocket`). `call-upload-outbox.test.ts`.
  - H1: `tests/integration/call-pipeline.test.js` runs real routes, real
    handlers and real Postgres with five real WebM parts. It checks one
    certified transcript, one notification row and a readable summary,
    pinned for the caller only. CI now installs ffmpeg in the job that runs
    the integration suites.
  - N3: the defaults are now `gemini-2.5-flash` (`env.js`,
    `vision.service.js`, the ai-control prefill).
    `gemini-model-check.service.js` asks Google's `models/{id}` endpoint and
    logs at API boot (ERROR if the model is missing).
    `GET /api/platform/ai-vendors/gemini/model-check` feeds a status pill on
    the console's Gemini card. `gemini-model-check.test.js`.
- Not fixed / deferred:
  - The E11 point "uploads compete with the call's audio": each part is now
    ~0.5 MB at 32 kbps, sent one at a time, but there is no bandwidth
    shaping. → PR-4 if device tests show it matters.
  - `/live-log` stays, because cached pre-PR-1 builds still call it. Remove
    it once no supported build does.
  - The per-provider limiters, per-tenant fairness, budgets and lag alerts
    (§4 items 2, 3, 7, 8). → PR-5. `call-transcribe-part` is where they go.
  - The consent text naming Groq, Gemini and DeepSeek (G2). → PR-6.
  - The device acceptance matrix (5/15/29 minutes × Chrome Android, Safari
    iOS, desktop; the same with the Groq key off). It needs real phones, so
    it is listed for the owner in the PR body.
- Deviations from §3:
  - 14050 drops two 14010 CHECKs the plan did not mention.
    `comms_call_summary_draft_status_check` would refuse `SENDING`, and
    `comms_call_recording_duration_seconds_check` (≤ 120) would refuse a
    121–125 s part. Both sets now live in `smartcomm.call.vocab.js`
    (`DRAFT_STATUSES`, `PART_MAX_SECONDS`). Names were read from
    `pg_constraint`.
  - The per-call byte cap is enforced per side (50 MB each), so one side
    cannot use up the other's share.
  - Key points and follow-ups became editable because O3 requires it (this
    is F7's editing half). PR-6 keeps the final design.
  - The draft's prose gains a closing "Not transcribed: …" sentence in the
    draft language when minutes are missing, so the posted message says so
    too; the caller can edit it out. A transcript-only draft is cut to the
    1 200-character contract. Before this, a long one could not be sent
    without editing (`send` validates it).
  - A part stored with a timer throttled for minutes is reported as 125 s,
    so the minute labels for that part can be short.
  - The old whole-call job `call-transcribe` is removed (the orphan-wiring
    gate refuses a queue nothing enqueues). A call whose job was still
    queued at deploy time is finalised by the daily sweep's
    never-finalised branch, silently: no push, found by its badge.
  - The recorder records its own clone of the mic track, asked for mono,
    and stops only that clone.
- Schema:
  - Migration 14050 adds:
    - `comms_call`: `caller_parts_declared`, `callee_parts_declared`,
      `caller_completed_at`, `callee_completed_at`, `finalised_at`;
    - `comms_call_recording`: `provider`, `transcribe_started_at`,
      `transcribed_at`, `job_runs`, `manual_runs`;
    - the index `ix_comms_call_recording_pending`.
    It drops the two CHECKs above and closes as FAILED the still-PENDING
    parts 2..N of pre-PR-2 calls, which have no header, so the part sweep
    never bills Groq for them.
  - New `draft_status` value `SENDING`, never visible outside the send
    transaction.
  - New queues: `call-transcribe-part` (concurrency 4, attempts 1) and
    `call-finalise` (concurrency 2, attempts 2).
  - New routes: `POST /calls/:id/recording/complete`,
    `POST /calls/:id/recording/:side/:part/rerun` (MOD-70 edit) and
    `GET /api/platform/ai-vendors/gemini/model-check`.
  - The thread read gains `pending_call_summaries`. `call:summary_ready`
    gains `group_id` and, on a redraft, `redraft: true`.
- New findings:
  - gemini-2.5-flash. Google's documentation sites are blocked from this
    environment; search results quoting the Gemini API deprecations page
    say the 2.5 models are not deprecated and are served until further
    notice, but only to accounts that already use them, and Google Cloud's
    lifecycle page lists 2026-10-20. Nothing here is broken today, and the
    new check turns the console card red if the model goes. Choose the
    successor for the platform credential before then (PR-7's platform
    check keeps watching).
  - `postMessage` used to issue a ROLLBACK after its COMMIT when an
    after-commit step threw (a Postgres warning, no harm). The split removes
    it.
  - `transcription_error` and `comms_call_recording.error` still hold vendor
    text. The UI shows statuses only, but `getSummary` and `getTranscript`
    still return `transcription_error`. That is C11 → PR-3.
- For the next PR (PR-3):
  - `regenerateSummary` still calls the LLM inside the request (C8). It now
    uses the guarded upsert and records usage.
  - `cardsForCallIds` is unchanged (C4).
  - The client still sends a hang-up `reason` (B9).
  - The re-run route is new surface for PR-3's rate-limit review.
  - `smartcomm.service.writeMessage` is the transactional half of
    `postMessage`; C4's "reject CALL attachments on the generic route"
    belongs in the route/validator, not there, because `sendSummary` uses
    `writeMessage`.
- Gates: `npm run ci` passed 47/47 (431 s) on `0fd3b69`, run alone on a
  clean tree. The first run failed one gate: the orphan-wiring sweep, which
  needs a literal `enqueue("<queue>"` and caught the removed whole-call job;
  it is fixed. `npm run ci` skips some jobs; these were run by hand on local
  Postgres 16 + pgvector:
  - provisioning a tenant from nothing, with 14050 applied twice (the second
    run applied 0 files);
  - live/sandbox schema parity;
  - the AI catalogue sync and `--check`, for live and sandbox;
  - `tests/integration/call-pipeline.test.js` and `call-liveness.test.js`
    (5/5, three runs, plus one without ffmpeg);
  - Playwright `call.spec.ts`, 8/8 against a production build.
  Not run: the Docker build, PgBouncer, the desktop layout gate and the AI
  golden set. The device matrix is the owner's (PR body, "For the owner to
  run"). Nothing here touched production, and the §0 parking SQL was not
  run.

### Chat UI redesign · 2026-09-24 · IN PROGRESS (parallel, not a plan PR)

Recorded here at the owner's request so the calls PRs know which files a
**parallel, cosmetic** effort has touched. This is **not** one of the seven PRs
and fixes none of the audit's findings; it restyles the in-house chat thread
(bubbles, backdrop, voice player, link/ERP cards, sidebar, header) for a
premium, WhatsApp-grade finish. Branch `claude/message-ui-redesign-gzxylv`
(GitHub PR #478).

- **Reconciled with PR-2.** PR-2 (#477) merged first; this branch has merged
  `main` back in and resolved the one overlapping file by keeping BOTH sides:
  PR-2's pinned call-summary plumbing in `Thread` (`useCall`, `summaryTick`,
  `openSummary`/`setOpenSummary`, `PinnedCallSummary` above the composer) sits
  untouched next to this redesign's `useBranding()` backdrop hook.
- **Overlap — `client/src/features/comms/team-chat.tsx`.** This effort changed
  only these regions:
  - **Thread header:** removed the `· direct` kind label; the dial button is now
    a circular icon button; the info-pane toggle moved into a WhatsApp-style ⋮
    (`MoreVerticalIcon`) dropdown; a presence subtitle was added under the name.
  - **Sidebar:** the New button is a gradient pill; the filter tabs and
    `ChannelRow` (glowing unread, active-row tint) were restyled.
  - **Thread scroller:** gained the washed backdrop (`.chat-thread-bg`) + tenant
    hero image via `useBranding()`; the shell got `.chat-shell`.
  - **NOT touched:** PR-2's composer / pinned-summary area, and no feature
    gating was added (that is **PR-6**'s F10).
  - **Heads-up for PR-6 (F10).** The audit cites the phone icon at
    `team-chat.tsx:511,1007`; those line numbers and the button markup have
    moved. The dial affordance now lives in (a) the circular header icon button
    and (b) a "Start a voice call" ⋮-menu item. Re-locate both when adding the
    `calls`-feature + MOD-64 gate. The member-area dial button (in `InfoPane`)
    is unchanged.
- **No overlap — chat-only files** (in none of the seven PRs' file lists):
  `chat/message-bubble.tsx`, `chat/link-card.tsx`, `chat/voice-note.tsx`,
  `chat/erp-card.tsx`, a new section in `src/index.css`, a new
  `MoreVerticalIcon` in `components/ui/icons.tsx`, and updated tests
  (`team-chat.test.tsx`, `chat/chat.test.tsx`, `chat/message-links.test.tsx`).
- **Gates:** `check:palette`, `check:motion`, `check:contrast`, `check:docs`,
  `lint` (0 errors) and `tsc -b` pass; the touched comms unit suites pass.
- **For PR-6:** re-read the header/sidebar before applying any line-referenced
  fix — the 2026-09-24 snapshot's markup has moved.

### PR-3 · 2026-09-24 · OPEN (#479)
- Fixed, each with the test that proves it. Each test was run against the
  code before its fix and failed there; the only ones that already passed
  are guards: a stranger's TURN refresh is 404, `STUN_URLS` is used as
  given, the sweep records no actor, a live call's signal is relayed, and
  a non-null primitive socket payload is ignored.
  - C1: `docker/coturn/docker-entrypoint.sh` renders coturn's config into a
    mode-600 file (the secret is not in argv): REST auth, denied peers for
    0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
    192.168/16, 198.18/15, 240/4, ::1, IPv4-mapped IPv6, 64:ff9b::/96,
    fc00::/7 and fe80::/10, plus this host's public IP; no TCP relay; user
    and total quotas; a bandwidth cap. Image pinned by version and digest.
    Tests: `turn-deployment.test.js` (the rendered config, the compose
    service, every option checked against coturn 4.18.0's parser);
    `tests/integration/turn-relay.test.js` (`RUN_TURN_TESTS=1`, a real
    coturn): allocation works, and 169.254.169.254, 172.17.0.1, 127.0.0.1,
    10.0.0.1 and 192.168.1.1 are refused with 403.
  - C3: `static-auth-secret` replaces `TURNSHAREKEY`, which coturn never
    read; realm, external IP, a `turns:` listener, and a health check that
    allocates. Real coturn accepts a credential minted by
    `smartcomm.turn.service` and refuses an expired or altered one
    (`turn-relay.test.js`). `scripts/turn-check.sh` is the owner's check on
    the deployed relay.
  - C2: credentials only for RINGING/IN_CALL calls (404 otherwise, the same
    as a stranger); username `<expiry>:<comms_call.turn_token>`, a random
    per-call token written with the row at dial; TTL = the call's remaining
    allowance + 60 s; `call-turn` rate limit. `smartcomm-call-hardening.test.js`,
    `smartcomm-call-routes.test.js`, `call-hardening.test.js` (real SQL).
  - C12: STUN from `STUN_URLS`, else the TURN host. Google's public STUN is
    only the fallback when neither is set (owner decision below), logged
    once, and gone as soon as `TURN_HOST` is configured.
  - C13: setting `comms.call_privacy {relay_only}` → `iceTransportPolicy:
    "relay"`, a switch in Settings → Calls, and the engine passes it to
    `RTCPeerConnection`. `smartcomm-call-hardening.test.js`,
    `call-engine.test.ts`, `calls-page.test.tsx`.
  - C4: the message, scheduled-message and AI-post schemas refuse
    `attachment_kind: "CALL"`; an edit is body-only (`.strict()`); a stored
    schedule carrying one is refused at send time; `writeMessage` is
    unchanged. A card resolves only for a SENT summary whose
    `sent_message_id` or `update_message_id` is that message (in SQL and in
    code). `smartcomm-call-hardening.test.js`; `call-pipeline.test.js` on
    real Postgres (the posted card resolves; a stranger's forged post is
    422, and a CALL row inserted another way resolves to nothing). On
    `main` the forged post is accepted (201).
  - C5, D7: relay only for RINGING/IN_CALL calls (`liveCounterpart`); the
    counterpart is cached per socket per call and dropped when a terminal
    call event reaches the socket (any replica) or after 30 s; SDP a
    string ≤ 64 KB; a candidate its four known fields ≤ 2 KB, or null; a
    per-socket token bucket (burst 120, 20/s); `maxHttpBufferSize` 128 KB.
    `realtime-call-relay.test.js` (on `main`, with only the export added,
    12 of its 13 tests fail; the passing one is the "live call is relayed"
    guard).
  - B8: hang-up, decline and failure record the actor in the event and the
    audit; the sweep records nobody.
  - B9: the server decides the reason; an old client's `reason` is
    accepted and ignored; the client no longer sends one.
  - C6: `directPartner` requires an ACTIVE callee, read from
    `live.app_user` (see new findings); ≤ 6 dials per callee per minute
    (Redis, fails open); `call-dial` limiter per caller (8/min); a
    deactivated user's push subscriptions are deleted from live and
    sandbox (`user-deactivated-drop-push.js`).
  - C8: regenerate answers 202 and queues `call-summary-regenerate`
    (jobId `callregen-<call>-<lang>`, failed jobs not kept); the job reads,
    calls the LLM with no connection held, writes through the guarded
    upsert and emits `call:summary_ready {redraft, language}`. The
    language must change (422 `SAME_LANGUAGE`), a draft has at most 6
    rewrites (409 `REGENERATE_LIMIT`), and `call-regenerate` limits a call
    to 3 requests per 10 minutes. The editor polls until the draft is in
    the new language, and puts the old language back if it fails.
  - C10: the AI reads need `calls` / `call_recording`.
  - C11: `getSummary`, `getTranscript` and `call:transcription_failed` give
    a reason code (`SIDE_NOT_RECORDED`, `PARTS_NOT_TRANSCRIBED`,
    `TRANSCRIPTION_FAILED`); call rows and cards no longer carry
    `transcription_error` (or `turn_token`).
  - Handed over by PR-2: the part re-run route has a `call-part-rerun`
    limiter; `/live-log` answers 410 Gone and its write path is removed
    (the table and its rows stay).
- Found and fixed while re-reviewing this PR's own diff:
  - `call:offer` / `answer` / `ice` / `ring_ack` with a `null` payload
    threw inside socket.io's listener, and `server.js` exits on
    `uncaughtException`: one emit from any signed-in user restarted an API
    replica. Pre-existing on `main`; fixed here because it is the relay C5
    hardens. `realtime-call-relay.test.js`.
- Not fixed / deferred:
  - C6's block / do-not-disturb option stays with PR-6, as §3 plans.
  - The acceptance run on the production relay (`turn-check.sh`) is the
    owner's; see the PR body.
- Deviations from §3:
  - `--no-loopback-peers` is not written: coturn 4.18.0 (the pinned image)
    has no such option and refuses loopback peers by default
    (`allow-loopback-peers` is opt-in); 127/8 and ::1 are in the deny list
    too. `no-cli` and `no-dtls` are left out for the same reason (off by
    default in 4.18.0, and they only log errors there).
  - Step 3's "internal flag on postMessage" is not used. The owner asked for
    the refusal at the route/validator, with `writeMessage` untouched.
  - `TURN_CREDENTIAL_TTL` is removed: the TTL is derived from the call.
  - The per-callee limit is in the service (Redis counter), because only
    the service knows the callee; the per-caller limit is a route limiter.
- Schema: migration 14060 adds `comms_call.turn_token` (plain column) and
  seeds `setting comms.call_privacy {"relay_only": false}` ON CONFLICT DO
  NOTHING. New queue `call-summary-regenerate` (concurrency 2, attempts 1).
  New env: `TURN_REALM`, `TURN_EXTERNAL_IP`, `TURN_TLS_PORT`,
  `TURN_TLS_CERT`, `TURN_TLS_KEY`, `TURN_MIN_PORT`, `TURN_MAX_PORT`,
  `TURN_USER_QUOTA`, `TURN_TOTAL_QUOTA`, `TURN_MAX_BPS`; removed
  `TURN_CREDENTIAL_TTL`. New error codes: `CALLEE_INACTIVE`, `GONE`,
  `QUEUE_UNAVAILABLE`, `RATE_LIMITED` (service), `REGENERATE_LIMIT`,
  `SAME_LANGUAGE`. `POST /summary/regenerate` now answers 202.
- New findings:
  - `src/shared/http/rate-limit.js`: when `initRateLimitStore()` cannot
    build the Redis store, it sets `storeKind = "memory"` but leaves
    `store` null, and every limiter's `increment` then returns
    `totalHits: 1`. With Redis down at boot, no limiter in the product
    limits anything (login included), while the header comment says it
    "degrades to the in-process store". Shared code outside this PR's
    files; suggest a small fix (express-rate-limit's `MemoryStore` as the
    fallback) in its own PR.
  - `sandbox.app_user` is a mirror whose `status` is never updated after
    the first copy (`shared/db/sandbox-user-mirror.js`: ON CONFLICT DO
    NOTHING), so any sandbox query that trusts `app_user.status` sees a
    suspended user as ACTIVE. PR-3 reads `live.app_user` for the callee;
    other modules may have the same assumption. Like the mirror, this
    assumes the live schema is named `live` (`platform.tenant_database.
    live_schema` defaults to it and provisioning never changes it).
  - `tests/integration/call-pipeline.test.js` ("O1: a part both providers
    fail…") fails without ffmpeg installed, on `main` as well. PR-2's log
    says it passed without ffmpeg; here it did not. CI installs ffmpeg, so
    CI is unaffected.
  - `client/src/features/comms/call/call-upload-outbox.ts:110` has a
    silent catch without a taxonomy marker (a lint warning, PR-2's file).
- For the next PR (PR-4):
  - `iceConfigFor` returns `iceTransportPolicy` and `expiresAt`; the client
    passes the policy through `rtcConfiguration()` in `call-engine.ts`.
    `GET /calls/:id/turn` (rate-limited, live calls only) is still unused
    by the client; PR-4's ICE restart can refresh through it.
  - Signal payloads are validated server-side now: an SDP must be a string
    and a candidate an object (or null). The relay drops a signal for an
    ended call and answers nothing.
  - Hang-up takes no body reason; the server records `hangup`.
- Owner decision (2026-09-24, during PR-3): keep Google's STUN as the
  fallback while no STUN or TURN is configured, so calls between networks
  keep working until the self-hosted relay is up. This departs from C12's
  fix, which dropped Google entirely. The relay is set up once by hand with
  `scripts/turn-setup.sh` (`doc/TURN_PRODUCTION_SETUP.md`), not from
  deploy.sh. Moving the TURN host and secret into the admin console,
  encrypted, is proposed for a later PR. The guide says how: coturn reads
  its secret from Redis, with a two-secret rotation. No static TURN
  username: that is what C2 removed.
- Gates: `npm run ci` 47/47 passed (534 s) on `6d1eca3`, run alone on a
  clean tree; the first run failed only the backend lint warning budget
  (four new warnings in this PR's tests), fixed. Run by hand, because
  `npm run ci` skips them, on local Postgres 16 + pgvector: provisioning
  two tenants from nothing (14060 in live and sandbox; the replay applied
  0 files), live/sandbox schema parity, the AI catalogue sync and
  `--check`, `tests/integration/call-{pipeline,liveness,hardening}.test.js`
  (8/8, with ffmpeg), and `RUN_TURN_TESTS=1 tests/integration/
  turn-relay.test.js` (2/2) on a real coturn 4.6.1. coturn 4.18.0 (the
  pinned image) could not be pulled here (Docker Hub's anonymous rate
  limit); its option parser was checked from the 4.18.0 source tag
  instead. `/security-review` on the diff: nothing at the reporting bar;
  one sub-threshold note fixed (a respelled call uuid had its own
  regenerate budget), the other is the owner's step 5 in the PR body. Not
  run: the Docker build, PgBouncer, the desktop layout gate, the AI golden
  set, and the Settings → Calls card in light and dark. Nothing touched
  production; the §0 parking SQL was not run.

### PR-4 · 2026-09-24 · OPEN (#481)
- Before the plan (owner's Step 0 and 0b), each with its test:
  - **Relay to relay.** PR-3's entrypoint denied the relay's own public
    address, so a call with both callers relayed (client → TURN → TURN →
    client, normal on mobile data) got `403 Forbidden IP` on the relay leg.
    The entrypoint now writes `allowed-peer-ip` for the relay's own
    addresses (the public external IP, the private part of `public/private`,
    and `TURN_LISTENING_IP`) and keeps every deny range. Checked in coturn
    4.18.0's source (`good_peer_addr`): `allowed-peer-ip` is checked before
    `denied-peer-ip`, so an allowed address wins inside a denied range;
    multicast, loopback, `0.0.0.0` and 169.254/16 (and IPv6 link-local and
    ULA) are refused before both, so no allow can re-open them. The order of
    config lines does not matter. `scripts/turn-check.sh` checks relay to
    relay (`turnutils_uclient -y`) and probes the next address after the
    relay's own private one, which must stay 403.
    `tests/integration/turn-relay.test.js` (`RUN_TURN_TESTS=1`, real coturn
    4.6.1) runs both layouts (public IP on the interface, and 1:1 NAT
    `public/private`); on PR-3's entrypoint the relay-to-relay check fails
    with 403, on this one all checks pass, including 169.254.169.254,
    172.17.0.1, 127.0.0.1, 10.0.0.1, 192.168.1.1 and the neighbour.
    `tests/unit/turn-deployment.test.js`: 22 of its new tests fail on PR-3's
    code.
  - **TURN over TLS on 443.** `TURN_LISTENING_IP` makes coturn bind that one
    address (`listening-ip` and `relay-ip`), so it can take 443 on a second
    IP while nginx keeps 443 on the main one; the IP is also self-allowed.
    `turn-setup.sh --listening-ip <ip>` writes it, and before changing
    anything stops with the holder's address when the TLS port is already
    taken on that IP (`ss -ltnpH`; a wildcard `listen 443` counts, coturn's
    own listener does not). The blanket 443 warning now shows only when
    nginx is on the host and no IP of its own is given. The compose health
    check and `turn-check.sh` ask the listening IP. `doc/TURN_PRODUCTION_SETUP.md`
    documents both layouts (a second IP, with the nginx `listen <main-ip>:443`
    change; a dedicated host) and when 443 is worth it. TURN is not routed
    through nginx.
- Fixed, each with the test that proves it. The new tests were written
  first and run against the code before their fix: on `main`, 22 of the 44
  session tests fail, and the new engine (glare, buffering, restart,
  refresh, audio), noise (48 kHz, suspended, silence), service-worker (15 of
  17) and server tests (16 ring tests, the route, relay and CSP tests) fail;
  the ones that pass there are guards (the ack still records its channel,
  the answering device is not told it answered elsewhere, an in-call
  hang-up has no ring to cancel, mute, the old summary link).
  - E1–E3: perfect negotiation in `call-engine.ts` (callee polite, caller
    impolite, `makingOffer` / `ignoreOffer` / `isSettingRemoteAnswerPending`,
    explicit rollback). Only the caller opens the first negotiation; the
    callee's `call:ready` makes the caller re-send its offer only while it has
    no answer; the blind re-offer on `call:accepted` is gone; a duplicate
    offer is answered again. Either side restarts ICE; before a restart the
    engine refreshes TURN through `GET /calls/:id/turn` when the credential
    is within 5 minutes of expiry. `call-engine.test.ts` on a realistic fake
    peer connection (`client/src/test/fake-peer-connection.ts`): a two-engine
    glare test, buffered candidates, restart offer, refresh only when stale,
    no implicit `setLocalDescription`. `call-session.test.ts` (ready,
    buffered candidates across the ring). Playwright: two browser contexts
    with the real app on both ends connect.
  - E2: remote candidates wait for the remote description, then apply in
    order, end-of-candidates included; the session keeps the caller's
    candidates while the callee rings.
  - E4: an `<audio>` element primed in the dial/answer tap plays the remote
    voice; a refused `play()` sets `audioBlocked` and the call screen shows
    **Tap to hear**.
  - E5: the filter's AudioContext is 48 kHz and resumed in the tap; a context
    that stays suspended is reported "unavailable"; a filter that sends
    silence while the mic hears speech falls back to the raw track;
    `script-src` has `'wasm-unsafe-eval'` (`server.buildScriptSrc`,
    `csp-blob-media.test.js`); the tenant default is off (`callSettings`, and
    migration 14070 flips a value still at the 14020 seed).
  - E6/E7: dial and answer open the mic first; `dialing` is set before the
    first await (a double tap is one POST — unit and Playwright); an engine
    failure after the dial hangs up, after the accept reports the failure.
  - E8: a ringing device told `call:accepted` stops and says "Answered on
    another device" (unit and Playwright); `call:ringing_sent` shows "On a call
    with X on another device" in the caller's other tabs.
  - A12: the ring push goes to every device of the callee at dial; the ack is
    the ring-channel metric only (no broadcast, suppresses nothing).
  - A14: the push is a ring (`call_ring`, urgency high, TTL = time left,
    sticky, renotify, vibrate `[600,250,600,250,600]`, Answer/Decline) and
    re-alerts every 15 s while the row rings, at most 4, each claimed on
    `comms_call.ring_alerts` (unit and real Postgres). The service worker
    hands a ring to a visible page instead of a notification (not on
    WebKit, see deviations).
  - A7: a cancel push replaces the ring in place on every device when it is
    answered, declined, cancelled, missed or failed; the service worker
    shows a quiet, non-sticky line ("Answered on another device", "Missed
    call — <name>", "Call ended"), closes expired rings on every push, and a
    ring push that lands after its own cancel shows the cancel's line.
  - A8: Answer/Decline in an open window are handed over by `postMessage`
    (no reload, so no live call is dropped); otherwise the app opens with
    `?ring=<id>&act=…`, kept across a login redirect (`call-intent.ts`,
    sessionStorage, 90 s). Decline declines without a ring screen. An expired
    ring opens the conversation. `push-handler-call-ring.test.ts` runs the
    real worker script.
  - A13: `GET /smartcomm/calls/ringing` (real Postgres test for the SQL); the
    client reads it at wiring, on socket (re)connect, focus, online and return
    to the foreground; a ring the server no longer lists ends; a ring whose
    row still rings 15 s after its window ends here anyway. Playwright: an app
    opened mid-ring shows the ring.
  - A15: Settings → Calls → **This device** (notifications, push
    registration, installed app, ring sound, each with its fix) and **Send a
    test ring** (`POST /smartcomm/calls/test-ring`, one of the caller's own
    subscriptions, 5 per 10 minutes); a one-time "Allow this device to ring
    for calls" prompt for people who can take calls, with iPhone install
    guidance; the tab title flashes who is calling; "Tap to enable ring
    sound" on the ring.
  - E13: a call holds the audio keep-alive only, never a screen wake lock.
  - E14 remainder (from PR-1): `getCallTurn` and `call:ringing_sent` are used.
- Not fixed / deferred:
  - E11's "uploads compete with the call's audio" (handed over by PR-2 "if
    device tests show it matters"): still no device evidence either way;
    left with the owner's P8/I4 runs.
  - A8's original suggestion of a per-call token so the service worker
    declines without opening the app is not built: §3 step 7 chose opening
    the app with the intent, and that path declines without a call screen.
  - A native full-screen call screen or a looping ringtone with the app fully
    closed: the platform limit §3 names (CallKit / full-screen intents need a
    native shell).
  - PR-3's new findings, as routed by the owner: `src/shared/http/rate-limit.js`
    (no store when Redis is down) → the owner's separate PR; the stale
    sandbox `app_user` mirror → PR-5; `call-pipeline.test.js` needing ffmpeg
    → PR-7 (it passes here with ffmpeg installed); the silent catch at
    `client/src/features/comms/call/call-upload-outbox.ts:110` → PR-5 (this PR
    does not edit that file).
- Deviations from §3:
  - Step 0: coturn itself whitelists the private part of `public/private`
    (4.6.1 and 4.18.0 both log "Whitelisting external-ip private part"), so
    what actually broke relay to relay was the self-block of the public
    address in the single-address form `turn-setup.sh` wrote behind NAT.
    The explicit allow keeps both stated, and `turn-setup.sh` now writes
    `public/private` behind 1:1 NAT so the relay leg does not depend on the
    cloud hairpinning to its own public IP.
  - Step 0b: `TURN_LISTENING_IP` refuses loopback and `0.0.0.0`; a re-run of
    `turn-setup.sh` keeps the listening IP already in `.env`.
  - Step 1: the recovery window is 20 s (was 10 s): a Wi-Fi → 4G switch needs
    the socket to reconnect before the restart offer can travel. The TURN
    credential lasts until the call's cap + 60 s, so the refresh before a
    restart rarely fires; it is there for a call near its end.
  - Step 4: a microphone refused on **answer** leaves the call ringing on the
    person's other devices instead of declining it; "any engine failure
    sends hangup/decline/fail" is applied to failures after the server
    transition, which is where a live call could be left behind.
  - Step 5: the queue keeps its PR-3 name (`comms-call-ring-escalate`) so a
    job queued across the deploy still runs; its jobs are `ring` (alert n)
    and `cancel`, and a PR-3 `escalate` job runs as alert 0. "At most 4
    re-alerts" is 3 in practice: the window closes before the 4th.
  - Steps 5/6 on WebKit: Safari and every installed iPhone/iPad app revoke a
    push subscription after pushes that show nothing, even with the app on
    screen, so there the service worker always shows the ring (on top of the
    in-app ring) and a cancel line ("Call answered" on the device that
    answered). Elsewhere the visible page takes the ring and nothing is
    stacked on it.
  - Step 6: "declined" reads "Call ended" (the plan's three phrases).
  - Closing a tab that is only ringing no longer sends the keep-alive
    hang-up: the server read it as a decline, which ended the ring on every
    device (A12's cousin, found while building step 5).
  - The ringing read and the test ring are not AI tools (device plumbing);
    `smartcomm.ai.js` says so in a comment. The catalogue check is unchanged.
- Schema and config: migration 14070 adds `comms_call.ring_alerts` (plain
  integer), rewrites the 14020 comments on `ring_ack_at` / `ring_push_sent_at`
  (they said the ack stops the push), and flips `comms.call_noise_suppression`
  from the seeded `{"enabled": true}` to `{"enabled": false}`. New env
  `TURN_LISTENING_IP`. New routes `GET /calls/ringing`, `POST /calls/test-ring`
  (limiter `call-test-ring`). New socket event `call:ready` (relayed with the
  call id only). `call:ringing` carries `group_id`; `call:ringing_sent`
  carries `to {user_id, name}`. Push kinds `call_ring`, `call_cancel`,
  `call_test` (the worker still accepts PR-3's `call`). `push.sendToUser`
  takes `endpoint`. Removed: `escalateRing`, `enqueueRingEscalation`,
  `RING_PUSH_DELAY_MS`, `repo.markRingPushSent`. Page ↔ worker messages:
  `praxis:call-ring`, `praxis:call-cancel`, `praxis:call-action`,
  `praxis:call-test`, `praxis:navigate`.
- New findings:
  - Settings → Calls used `<Card title=…>`; `Card` has no title prop, so it
    became an HTML tooltip and the three cards had no visible heading or
    padding (PR-3). Fixed here (`Panel`), since this PR edits that page.
  - The pagehide keep-alive "hung up" a call that was only ringing on the
    closing tab, which the server records as a decline for every device.
    Fixed (above).
  - The ringing read ran only on the socket's `connect`, and on a fresh load
    the socket can connect before the session wires its handlers; found by
    the Playwright test, fixed, unit test added.
  - `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` Q3 described a "keep your screen
    on" hint that was never built; withdrawn. R4, R7 and Q2 are rewritten for
    PR-4, and section 5b (P1–P11) holds this PR's device runs.
  - Playwright's `context.setOffline` does not touch WebRTC media on
    loopback, so the e2e network-drop test proves the signalling and session
    survive a drop, not an ICE restart. The restart is proven on the fake peer
    connection; a real Wi-Fi → 4G restart is the owner's P8.
- For the next PR (PR-5):
  - Ring pushes run on `comms-call-ring-escalate` (jobs `ring` / `cancel`,
    concurrency 2). `endCall` queues the cancel for any ring that ends, so
    per-call deadline jobs (D1) need no change to keep missed-call cancels.
  - The client calls `GET /calls/ringing` at wiring, on every socket connect,
    `focus`, `online` and return to the foreground (throttled to one per 2 s
    per tab); it is an indexed read (`uq_comms_call_one_active_callee`).
  - `call:ring_ack` is no longer broadcast; the ring-channel metric still
    reads `ring_ack_channel`.
  - Presence (E12) is untouched.
- For PR-6: the new controls use existing components and tokens, not a final
  design: **Tap to hear** (overlay), **Tap to enable ring sound** (ring), the
  "on another device" line, the ring prompt and the This-device panel.
  `endedReason` gains `answered_elsewhere`.
- Gates: `npm run ci` 47/47 passed (335 s) on `6dca1b5`, run alone on a
  clean tree; the first run failed only `public-web-csp-cors.test.js`,
  whose SEC-M8 guard matched the `scriptSrc` source text that the
  `buildScriptSrc` refactor moved (now asserted through the function),
  fixed. Backend jest 9,939 passed / 108 skipped; client vitest 3,138
  passed / 10 skipped. Run by hand, because `npm run ci` skips them:
  Playwright `e2e/call.spec.ts` 13/13, three runs in a row, against a
  production build; on local Postgres 16 + pgvector, provisioning a tenant
  from nothing (14070 in live and sandbox; the replay applied 0 files),
  live/sandbox schema parity, the AI catalogue sync and `--check`, and
  `tests/integration/call-{rings,hardening,liveness,pipeline}.test.js`
  (11/11, with ffmpeg); `RUN_TURN_TESTS=1 tests/integration/
  turn-relay.test.js` 3/3 on coturn 4.6.1 in both layouts (relay to relay
  fails with 403 on PR-3's entrypoint). Not run: the Docker build,
  PgBouncer, the desktop layout gate, the AI golden-set eval, anything on
  a real phone (the owner's checklist on #481). Nothing touched
  production; the §0 SQL was not run.

### PR-5 · 2026-09-25 · OPEN (#482)
- Fixed, each with the test that proves it. The new tests were written first
  and fail on PR-4's code (the `realtime-presence`, `call-clock`,
  `call-transcribe-gate`, `worker-deferral`, `tenant-db-slots` and
  `smartcomm-channel-list-sql` suites, and the new cases in
  `smartcomm-calls`, `smartcomm-call-records`, `call-record-jobs`,
  `comms-call-metrics`, `presence.test.ts`); the ones that pass there are
  guards (a call with a socket online is kept, a fresh absence is kept).
  - D1: each call's deadlines are delayed jobs on a new queue,
    `comms-call-clock`: `ring` at dial + 60 s (`callclock-ring-<call>`),
    `cap` at answer + 30 min (`callclock-cap-<call>`), `liveness` 60 s after
    a participant's last socket leaves mid-call (`callclock-live-<call>-<s>`).
    Each re-reads the row and re-queues itself if it ran early. The 15 s
    fleet sweep is a 5-minute safety sweep over the tenants in the Redis
    sorted set `praxis:comms:call-tenants` (dial/answer activity), which a
    tenant leaves once it has no live call and 10 quiet minutes; the old
    15 s repeatable is removed at boot. `smartcomm-calls.test.js`
    ("per-call clocks"), `call-clock.test.js`.
  - D2 (and §4 items 2, 3, 7, 8 routed by PR-2): `smartcomm.call.gate.js`.
    One limiter per provider key in Redis (Groq requests/min and
    audio-seconds/hour, Gemini requests/min, from config). O1 kept exactly:
    Groq once, then Gemini once, no retries. A Groq 429 or a full Groq
    limiter goes straight to Gemini; a Groq error with Gemini's limiter
    full fails the part as a Gemini 429 would; with both full nobody is
    called and the job waits. A per-tenant GCRA bucket reserves a slot per
    part (burst 20, 12/min), so 2,000 parts at one tenant are spread at its
    own rate and every other tenant's first part goes straight through;
    waiting is a delayed job (`DelayedError`), never an attempt.
    Priorities: live-call parts 1, ended-call parts 2, re-runs 3. The daily
    audio budget is `governance.audioBudget` (usage ledger, call type
    `call.transcribe`, `CALL_AUDIO_DAILY_MINUTES`); an over-budget part is
    settled `FAILED` with error `over_budget: …`, reason code `OVER_BUDGET`,
    no provider and no ops page. The daily record sweep is spread over 6 h
    by a hash of the slug. `call-transcribe-gate.test.js`,
    `smartcomm-call-records.test.js` ("the provider limiters", "over the
    tenant's daily audio budget", "D2: parts of a call still going…"),
    `call-record-jobs.test.js`, `call-clock.test.js`.
  - Redis down (the owner's rule for the new buckets): the fair share and
    the provider limiters fall back to per-process state with the same
    limits, logged at WARN; never unlimited. Tested in
    `call-transcribe-gate.test.js`.
  - D4: the call service increments Redis day counters at every transition
    (`smartcomm.call.signals.js`); the hourly metrics tick writes today's
    rows from them and reads no tenant database. The daily 7-day
    aggregation stays as the authoritative repair, now on
    `ix_comms_call_started` (14080; 14020's claim that
    `ix_comms_call_group` served the read was wrong). D5: the failure alarm
    groups by (tenant, env), live only. D11: the day is computed in SQL in
    UTC and returned as text. N5: the subject says "could not be fully
    transcribed". `comms-call-metrics.test.js`, `smartcomm-calls.test.js`
    ("day counters").
  - Step 6: per tenant, the part's queue wait, the oldest waiting part, 429s
    per provider beside requests (Prometheus and Redis), and hang-up →
    summary seconds for each first notified draft. A new latency alarm
    (`comms.transcription_latency`) pages once per window when a live
    tenant's p95 is over `COMMS_CALL_SUMMARY_P95_ALERT_S` (120) or its oldest
    waiting part is older than `COMMS_CALL_BACKLOG_ALERT_AGE_S` (600).
  - B3, C9, D6, D8, E12: presence per user in Redis
    (`smartcomm.presence.js`): a sorted set of sockets scored by expiry,
    90 s TTL, refreshed by a 30 s server heartbeat, so a crashed replica's
    sockets stop counting within 90 s. A snapshot of the user's DIRECT
    contacts on connect (`comms:presence_snapshot`); changes go only to those
    contacts' user rooms. `last_seen_at` at most once per user per 5 minutes;
    `comms:seen` beats inside 30 s are ignored. The global online SET and the
    offline ZSET are gone; liveness reads presence. The client replaces its
    dots with each snapshot and clears them on disconnect.
    `realtime-presence.test.js`, `presence.test.ts`.
  - D9: the audio purge reads 500 at a time, deletes 8 at a time, skips a
    part that keeps failing, and stops after 40 batches a run; the channel
    list's DIRECT partner is one lateral join. `smartcomm-call-records.test.js`
    ("D9"), `smartcomm-channel-list-sql.test.js`, and the real-schema
    `tests/integration/smartcomm-channel-partner.test.js`.
  - N1: env in every room (`t:<slug>:<env>:c:<group>`, `t:<slug>:<env>:mail`,
    user rooms already had it); `realtime.publish(slug, env, group, …)`.
    N2: the mail bridge re-emits with `io.local.to(…)`.
    `realtime-presence.test.js`, `realtime-user-rooms.test.js`.
  - D12: no longer present (the `NODE_ENV` log line went in an earlier PR);
    the terminal log line now carries the call's env.
- The owner's list (left over from PR-3 and PR-4), each with its test:
  1. `rate-limit.js`: with no Redis store every limiter falls back to its own
     express-rate-limit `MemoryStore` (WARN at boot); the header comment is
     true. `rate-limit-memory-fallback.test.js` (all four failed before:
     login was unlimited).
  2. Ring pushes: first alerts and cancels are prioritised over re-alerts
     and ranked per tenant (a 10 s window), so a burst at one tenant does not
     delay another's ring; `COMMS_CALL_RING_CONCURRENCY` (16). The queue name
     is unchanged. `smartcomm-calls.test.js` ("ring pushes are fair").
  3. `GET /calls/ringing`: measured in the load script (a reconnect storm
     with every tab at once, then once a minute per tab). It stays a DB read:
     p95 3 ms, max 36 ms at 200 tenants × 12 tabs, 0 pool timeouts. No
     change to the route.
  4. The sandbox `app_user` mirror updates status (and name, 2FA flag) on an
     existing row, and `setStatus` mirrors. `sandbox-user-mirror.test.js`,
     real schema `tests/integration/sandbox-user-status.test.js` (a user
     suspended after the first mirror is SUSPENDED in sandbox).
  5. `call-upload-outbox.ts:110`: `@silent:storage`; a node:test in
     `eslint-local-rules/` holds `features/comms/call` at zero unmarked
     silent catches.
- The load script, `scripts/load-calls.js` (local Postgres 16 + Redis 7, one
  worker process unless stated, third parties stubbed: push 100–200 ms, Groq
  1.5–3 s, Gemini 2–4 s, LLM 2–4 s). Each case: one tenant with 2,000 parts
  queued and a burst of 30 simultaneous rings; every tenant dials 3 rings
  nobody answers; every other tenant hangs up 1 call a minute; every tab
  (12 per tenant) reads `/calls/ringing` in a storm at +30 s, then once a
  minute. Default limits (Groq 20 rpm / 7,200 s·h, Gemini 60 rpm; fair
  share 12/min, burst 20). Each simulated tenant has its own emulated
  4-connection pool with the 5 s acquire timeout.

  | Tenants | Ring timeouts late (p50 / p95 / max) | First ring push p95 (other tenants' worst / burst tenant) | Re-alert / cancel p95 | Hang-up → summary p50 / p95 | Ringing read storm p95 / max | Pool timeouts; wait p95 other / heavy |
  | --- | --- | --- | --- | --- | --- | --- |
  | 10 | 0.57 / 1.11 / 1.27 s (60/60) | 282 / 1,176 ms | 285 / 512 ms | 6 / 11 s (18/18) | 3 / 5 ms | 0; 0 / 366 ms |
  | 50 | 0.54 / 0.99 / 1.26 s (180/180) | 217 / 1,078 ms | 249 / 466 ms | 19 / 55 s (98/98) | 3 / 10 ms | 0; 0 / 353 ms |
  | 200 | 0.52 / 0.58 / 1.24 s (630/630) | 236 / 1,213 ms | 223 / 204 ms | 42 / 99 s (88 of 398 in the run) | 3 / 36 ms | 0; 0 / 335 ms |
  | 200, 4 worker replicas, Groq 400 / Gemini 600 rpm | 0.52 / 0.57 / 0.63 s | 223 / 1,135 ms | 222 / 201 ms | 7 / 8 s (398/398) | 3 / 34 ms | 0; 0 / 487 ms |

  Acceptance: every ring timed out within 5 s at every scale (max 1.27 s)
  while one tenant had 2,000 queued; p95 hang-up→summary at 10 tenants is
  11 s (target < 2 min); no tenant ever waited for a connection past its
  budget (0 acquire timeouts; other tenants ≤ 2 ms). The burst tenant's own
  first rings wait up to ~1.2 s behind its own pool (each ring push holds a
  connection while the push service answers); nobody else's do. At 200
  tenants on one worker and free-tier limits, summaries lag: 400 hang-ups a
  minute is ~800 parts against 80 provider requests a minute, and one
  worker's finalise concurrency. Sized as §4 item 9 says (paid provider
  tiers) and scaled by queue lag (§4 item 5, four worker replicas), 200
  tenants run at p95 8 s. The busy tenant's own backlog drains at its
  share (its oldest part is ~3 min old at the end of each run, and the new
  latency alarm pages at 10 minutes).
- Found by the load script and fixed here:
  - Part jobs held 8 of one tenant's connections at once against a pool of
    4, so that tenant's own ring deadline and reads queued behind
    transcription. `src/jobs/tenant-db-slots.js`: part, finalise and
    regenerate jobs take at most `TENANT_POOL_MAX - 2` of a tenant's
    connections per process. `tenant-db-slots.test.js`.
  - Finalise ran 2 at a time per worker; it is `CALL_FINALISE_CONCURRENCY`
    (4) now (it holds no connection while the LLM works).
- Found re-reading the diff and fixed here: the worker wrapper logged a
  deferred part (`DelayedError`) as "job threw" at ERROR
  (`worker-deferral.test.js`); a socket that disconnected before its join
  landed could look online for 90 s (`realtime-presence.test.js`, "races").
- Not fixed / deferred:
  - PR-7: `tests/integration/call-pipeline.test.js` needs ffmpeg (it passes
    here with ffmpeg installed; CI installs it).
  - PR-6: the design of PR-4's new controls; `OVER_BUDGET` needs a line on
    the call page with N4's "transcription failed".
  - The owner's device runs (P1–P11) are unchanged by this PR.
  - `/live-log` stays (410) until no supported build calls it.
  - A ring push holds its tenant connection while the push service answers
    (the burst tenant's ~1.2 s above). Splitting the subscription read from
    the send would need `push.sendToUser` to change shape; left, since it
    only ever delays that tenant's own rings.
- Deviations from §3:
  - Over budget is a settled part with a reason code (`OVER_BUDGET`), not a
    new part status: `transcript_status` has a CHECK (PENDING/OK/FAILED), and
    a new status would touch every reader of the column for no behaviour a
    reason code cannot carry.
  - The daily fleet aggregation is kept (once a day, on the new index) as
    the repair for counters lost to a Redis restart; the hourly one is gone.
  - Presence goes to DIRECT contacts only, as §3 says. Decision row 10
    ("everyone sees everyone") is unaffected: the client shows the dot only
    for DIRECT partners (thread header, info pane, call screen).
  - The ringing read was measured and kept on the database (item 3).
- Schema and config: migration 14080 adds `ix_comms_call_started` (index
  only). New queue `comms-call-clock`. New env: `COMMS_CALL_SAFETY_SWEEP_MS`,
  `COMMS_CALL_CLOCK_CONCURRENCY`, `COMMS_CALL_RING_CONCURRENCY`,
  `CALL_TRANSCRIBE_CONCURRENCY`, `CALL_FINALISE_CONCURRENCY`,
  `GROQ_TRANSCRIBE_RPM`, `GROQ_TRANSCRIBE_AUDIO_SECONDS_PER_HOUR`,
  `GEMINI_TRANSCRIBE_RPM`, `CALL_TRANSCRIBE_TENANT_PER_MIN`,
  `CALL_TRANSCRIBE_TENANT_BURST`, `CALL_AUDIO_DAILY_MINUTES`,
  `COMMS_CALL_SUMMARY_P95_ALERT_S`, `COMMS_CALL_BACKLOG_ALERT_AGE_S`. New
  socket event `comms:presence_snapshot`; `comms:presence` now goes to user
  rooms. New alert event `comms.transcription_latency`. Call-part usage rows
  are `call_type = 'call.transcribe'` (was `transcribe`, shared with voice
  notes). No route, AppError or AI manifest change.
- For the next PR (PR-6):
  - Reason codes now include `OVER_BUDGET` (`CallTranscriptReason`); N4 is
    still unrendered.
  - Presence: `useOnline` is fed by the snapshot and `comms:presence`, only
    for DIRECT partners; `replaceOnline` resets the map.
  - Channel rooms carry the env; nothing in the client names a room.
- Gates: see the PR body (`npm run ci`, the integration suites on local
  Postgres with ffmpeg, the load script). Nothing touched production; the
  §0 SQL was not run.

### PR-6 · 2026-09-25 · MERGED (#483)
- Fixed, each with the test that proves it (written first; they fail on
  PR-5's code):
  - F1, F2, F3, F9 (O4): the ring card (`incoming-ring.tsx`), the call screen
    (`call-overlay.tsx`), the docked bar (`active-call-bar.tsx`, new) and the
    thread strip (`thread-call-strip.tsx`, new) are solid `bg-background` /
    `bg-card` with token borders: no `backdrop-filter`, no alpha surfaces
    (also removed from `call-summary-card.tsx`), no `--brand-blue`, no
    `text-white`. Answer is the new `confirm` Button variant (`--background`
    on `--ok`, added to `check-contrast.mjs`: 5.27 light / 7.20 dark), hang-up
    is `destructive`. Banners are in the layout flow; animation is
    `motion-safe:` only; the timer has a fixed label ("Call duration"); an
    unknown caller reads "Someone", never an empty name.
    `call-surfaces.test.tsx` (incl. axe), `thread-call-strip.test.tsx`.
  - F4 (O4): Minimise turns the call screen into the docked bar, which lives
    in the app shell and survives navigation; desktop never covers the app
    (ring card top-right 380 px, call panel bottom-right); a phone's ring can
    expand to a full solid screen. In the caller's open conversation the ring
    strip replaces the card, so there is one Answer button, and becomes the
    live strip once answered (`comms-live.tsx` hides the card and the bar for
    that thread); the strip's **Open the call** shows the full call screen
    and the strip steps aside while it is open, so End call is never on
    screen twice (`call-view.ts`). The ring card is an `alertdialog`.
    `thread-call-strip.test.tsx`, and `e2e/call.spec.ts` (updated for the
    in-thread strip and the capability read; a new case for the in-thread
    ring; 65/65 e2e locally).
  - F5: `Checkbox` for every checkbox (call screen noise filter, Settings →
    Calls), `Button` with an icon for every "×"/"✕" glyph. `useConfirm` for
    Discard was already PR-2's.
  - F6, G5: the ring states the call will be recorded and names who processes
    it; **Answer without recording** sends `POST /calls/:id/accept`
    `{record:false}`; the server stamps `comms_call.recording_declined_at/_by`,
    tells both sides `recording_enabled: false`, and refuses the call's parts
    (409 `RECORDING_DECLINED`), so neither recorder arms and nothing is sent
    to a vendor. `smartcomm-calls.test.js` ("answer without recording"),
    `smartcomm-call-records.test.js`, `call-session.test.ts`,
    `calls-screens.test.tsx` (the call page says it was answered without
    recording).
  - F7, F8: key points and follow-ups were already editable and removable
    with `DateField` due dates (PR-2); the posted card shows due dates with
    `dateDmy`. Verified, not changed.
  - F10: the phone icon (header, ⋮ menu, InfoPane) renders only when
    `GET /smartcomm/calls/capabilities` says `can_dial` (calls feature on AND
    MOD-64 create); the Comms hub's Calls tab only while calls are on;
    Settings → Calls tells a person without MOD-70 edit that the company half
    is read-only instead of showing the 403. `team-chat.test.tsx` (F10 cases),
    `hub-calls-tab.test.tsx`, `calls-page.test.tsx`,
    `smartcomm-call-routes.test.js` (capabilities).
  - C6 (do not disturb), A11 (quiet hours): `/me/preferences/calls` gains
    `doNotDisturb`, `quietHours {from,to}` and `hideLastSeen`. A dial to a
    DND callee is refused with 409 `CALLEE_DND` before anything rings (the
    read fails open). Inside quiet hours, in the callee's time zone, a summary
    notification is in-app only (`notifyMany` `silentFor`; never for
    security/forced). `smartcomm-calls.test.js`, `user-preference.test.js`,
    `notification-delivery-reliability.test.js`,
    `smartcomm-call-records.test.js` ("quiet hours").
  - G1: recording is the tenant's opt-in, `comms.call_recording.enabled`
    (migration 14090), read beside the `call_recording` feature; both must be
    on. Settings → Calls has the switch (MOD-70 edit). Every save writes the
    merged `call_recording` value — the old page's retention save replaced
    the whole value (a defect found here: it would have dropped `enabled`).
    `calls-page.test.tsx`, `smartcomm-calls.test.js`.
  - G2: `GET /smartcomm/calls/processing` lists the vendors that are
    configured (Groq, then Google (Gemini) when Groq fails; Google (Gemini),
    then DeepSeek as last resort; Google STUN when no TURN of our own). The
    ring's consent line and Settings → Calls → "How calls are processed" read
    it. New `doc/CALLS_DATA_PROCESSING.md` is the sub-processor annex the
    tenant DPA cites. `smartcomm-call-routes.test.js`, `calls-page.test.tsx`.
  - G3: `transcript_retention_days` (30–3650, absent = keep) and the daily
    record sweep deletes transcripts, live notes and unsent drafts past it;
    `POST /smartcomm/calls/erase-user` (MOD-70 edit) erases one person's call
    records for both sides, audited as `CALL_RECORDS_ERASED`, behind a
    destructive `useConfirm` in Settings → Calls.
    `smartcomm-call-records.test.js`, `calls-page.test.tsx`.
  - G4: "Hide my last seen" removes the person's last-seen from the channel
    list and colleagues (`smartcomm-channel-list-sql.test.js`,
    `smartcomm-channel-partner.test.js`). Presence was already DIRECT-only
    (PR-5).
  - N4: the pinned draft shows the transcription reason
    (`transcriptionReasonSentence`, incl. `OVER_BUDGET`), the posted card
    says when part of the call could not be transcribed, and a failure mid
    call is a toast. The call page already said so (PR-2).
- Not fixed / deferred:
  - H2: the manual matrix is the owner's (device runs). §5c of
    `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md` adds rows S1–S13 for this PR.
    The gate is held in code: recording is off for every new tenant.
  - Light/dark visual check: done in jsdom (tokens only, contrast gate), not
    on a device; it is matrix row S13.
- Deviations from §3:
  - G1 is a tenant setting, not a catalogue default. Changing the
    `call_recording` catalogue default re-projects every existing tenant on
    the next migrate (`provisioning.projectFeatures`), which is the owner's
    sign-off step, not a migration's. 14090 turns it off for new tenants
    only (a tenant with no users at migrate time). **Owner, to run after
    signing off (not run here):**
    `UPDATE setting SET value = value || '{"enabled": false}'::jsonb WHERE section = 'comms' AND key = 'call_recording';`
    per tenant schema, live and sandbox.
  - `Switch` and `IconButton` do not exist in `components/ui`; `Checkbox` and
    `Button size="icon"` with an `aria-label` are what FRONTEND_GUIDE §3.5
    offers. No new primitive.
  - The "Call audio" tab of F10 no longer exists (PR-3 moved it to Settings →
    Calls); F10 is applied there.
  - The tenant DPA is not in the repo; the annex is.
  - pixie-girl-hub could not be cloned in this session (the request was
    refused by the session's permission policy); the layout follows §3's
    written description of it.
  - Erasure leaves summaries already sent to a conversation (they are
    messages) and runs in the environment it is called in.
- Schema: migration 14090 (`comms_call.recording_declined_at`,
  `recording_declined_by`; `comms.call_recording.enabled` seeded). New
  routes `GET /calls/capabilities`, `GET /calls/processing`,
  `POST /calls/erase-user`; accept takes `{record?}`. New AppErrors
  `CALLEE_DND`, `RECORDING_DECLINED`, `RECORDING_OFF`. New audit event
  `CALL_RECORDS_ERASED`. AI manifest: documented as not tools (the erasure
  is deliberately a person's decision).
- For the next PR (PR-7): `recordingForCall(client, call)` is the one
  question "is this call recorded"; a test call should go through it. The
  capability read is cached per session in `call-capabilities.ts`
  (`resetCallCapabilities` on logout).
- Gates: see the PR body. Nothing touched production; no owner SQL was run.

### PR-7 · 2026-09-25 · MERGED (#484)
- Fixed (O5), each with the test that proves it:
  - The **Test** right: `permission.can_test` (migration 14100, no backfill,
    commented like 12771's), `test → can_test` in `rbac.js` and
    `action-authz.js`, carried through `identity-cache.js`,
    `permission.repo.js` (the column list and the COALESCE upsert, so saving
    other rights never clears it) and `permission.validator.js`; the matrix
    shows it as "T" (Test — run live checks that spend provider credit), the
    legend's tooltip says the CEO always passes it. `rbac-enforcement.test.js`
    (the map, "not implied by any other right", the CEO),
    `permission-test-right.test.js`, `client/src/lib/rbac.test.ts`.
  - The manual run, Comms → Setup → **Test calls**: nine routes under
    `/smartcomm/diagnostics/runs`, every one `requirePermission("MOD-64",
    "test")` + `calls` (403 with every other right:
    `call-diagnostics-routes.test.js`). The 3-a-day cap is counted in
    `comms_call_diagnostic_run` (migration 14110, live schema, 90 days) under
    an advisory lock: six simultaneous starts make exactly three runs
    (`tests/integration/call-diagnostics-cap.test.js`; with the lock removed
    it makes six). The fourth is 429 `DIAGNOSTICS_DAILY_CAP` with
    `next_available_at`; the tab disables its button and names the time.
    The eleven steps of §3 in order, each with status, time, cause, fix and
    code; the server's half in `smartcomm.diagnostics.service.js` and the
    `comms-diagnostics` job, the device's in `test-calls-runner.ts`. Real
    code: `transcribePart` / `draftSummary` gained a diagnostics mode (audio
    from the run, no call signals, a FORCED provider only there), the ring is
    `testRing` with the run's nonce (the service worker echoes it), the
    recorder is `CallRecorder`, the filter `applyNoiseSuppression`. A run
    writes nothing but its row and its `diagnostics` usage
    (`call-diagnostics.test.js`: no call table, metric, signal, chat or
    notification). Each step turns red on its own injected failure — bad
    Groq key, bad Gemini key, stopped worker, a queue that refuses, wrong
    TURN secret / push denied / blocked microphone as the device reports
    them, a part that is not a complete file — in `call-diagnostics.test.js`
    and `test-calls-runner.test.ts`. Progress streams over the socket
    (`comms:diagnostics`), polling as the fallback; **Copy report** is plain
    text with keys redacted; past runs are listed for Test holders.
  - Reference clips: `src/modules/smartcomm/diagnostics-fixtures/`, EN and FR,
    ~18 s each, synthesised with espeak-ng from the text in
    `reference.json` (no licence issue), with the summary's reference
    transcript.
  - The platform check: `comms-call-canary`, daily at
    `COMMS_CALL_CANARY_CRON` / `_TZ` (10:00 Africa/Douala): the queue, the
    live-signal emitter's subscribers, the scheduler registrations, one EN
    clip through Groq and forced through Gemini, a Gemini and a forced
    DeepSeek summary, a TURN allocation from the server (`turn-probe.js`, a
    minimal RFC 5766 Allocate, proven against a real coturn:
    `tests/integration/turn-probe.test.js`, opt-in with RUN_TURN_TESTS=1),
    and per-tenant checks that spend no credit. Results in
    `platform.comms_call_canary_run` (platform migration 0108); console
    Health → **Calls pipeline**; one bell (`notifyCapable`) and one
    `alerts.raise` (`comms.call_canary`, `notify`) on a failure and on the
    recovery. `comms-call-canary.test.js`.
  - PR-5's leftover: `tests/integration/call-pipeline.test.js` ("O1: a part
    both providers fail…") failed without ffmpeg because every part was the
    same fixture and the provider stubs find a part by its bytes; each part
    is now distinct. Reproduced without ffmpeg first; passes with and
    without it.
- Deviations from §3:
  - "Only that step" turns red; a step that NEEDS the broken one is shown
    skipped (grey), not red. A stopped worker therefore shows step 1 red and
    step 3 skipped (step 3 is the worker's own emitter), and 9–11 skipped.
    A bad Gemini key turns 9 and 10 red: both use Gemini, and each names it.
  - Steps 4–7 are the device's report: the server records what the runner's
    browser measured and cannot re-verify a microphone. Step 8's success is
    the server's own container check on the uploaded parts.
  - The canary's "live signal" check asks Redis whether an API instance is
    subscribed to the adapter channel the worker publishes on (there is no
    screen to echo at 10:00); its queue check measures how late the daily
    job ran against its due time.
  - A second failing day stays quiet on the bell (the console shows it red);
    the recovery rings once.
  - Diagnostics routes are not AI tools (smartcomm.ai.js says why).
- Schema: tenant 14100 (`permission.can_test`), 14110
  (`comms_call_diagnostic_run`); platform 0108 (`comms_call_canary_run`).
  New routes as above and `GET /api/platform/ops/comms/canary`; capabilities
  gains `can_test`. New AppErrors `DIAGNOSTICS_DAILY_CAP`,
  `DIAGNOSTICS_RUN_CLOSED`, `DIAGNOSTICS_BAD_SIGNAL`. New socket event
  `comms:diagnostics`; new alert event `comms.call_canary`; new env
  `COMMS_CALL_CANARY_CRON`, `COMMS_CALL_CANARY_TZ`; new queues
  `comms-diagnostics`, `comms-call-canary`.
- Owner's: grant the Test right to the roles that should have it (no role
  holds it); run matrix §5d (T1–T5) on devices.
- CodeQL on the PR flagged the probe's MD5 (the TURN long-term key, RFC 5389
  §15.4, which the relay computes too) because values reached it through
  names its heuristic reads as a person's credentials. Fixed by naming, not
  by suppression: `turn.service.signedLabel({ id })` gives the label and its
  HMAC, the platform check signs a random id, and the integration test's
  shared value no longer contains "secret" (a string literal argument was
  the last source). Verified with CodeQL 2.27.1 locally before the push.
- Gates: `npm run ci` 47/47; Playwright e2e 65/65; the call integration
  suites on local Postgres; the probe against a real coturn; CI and CodeQL
  green on the PR. Nothing touched production.
- The programme: PR-1 to PR-7 are merged. What remains is the owner's —
  the device matrix (§1–§5d), granting the Test right, and the signed-off
  SQL that turns recording off for existing tenants (PR-6's entry).
