# Smart Comms composer

## Interaction contract

- On mobile Chat, global quick actions move into the top bar rather than
  floating over the send/microphone control. Other screens keep their FAB.
- A single outlined **+** opens the tools panel above the composer. Emoji,
  record search and personal phrases stay in that anchored panel. File selection
  uses `FilePicker` / `useUpload` (progress, preview, retry), never a custom upload.
- Enter sends; Shift+Enter inserts a new paragraph or continues the active list.
  Shift+Enter on an empty list item exits the list. IME candidate confirmation
  never sends. `1. `, `- ` and `* ` at the start of a paragraph start native lists.
- The list-aware TipTap editor supports paragraphs and lists (including nested
  lists), not arbitrary HTML. `message-format.ts` serializes a small Markdown
  dialect to the existing text body. Drafts, search, notifications and certified
  exports remain readable; the bubble renders the same codec as safe React nodes.
- Edit in the bubble menu or Up Arrow in an empty composer loads the most recent
  own, non-deleted text message into the composer. Save changes text only; existing
  message attachments are unchanged. Cancel/Escape and successful Save restore the
  previous unsent draft, staged uploads and record references. Edited timestamps
  remain visible. Ownership and current membership are checked server-side.
- A failed send retains text, successful uploads and record references. In-flight
  sends are guarded against double activation; scheduled retries also carry a
  stable request UUID for the same payload.

## Personal phrases

Existing `comms_quick_reply` storage and `/smartcomm/quick-replies` endpoints are
used for a server-synced, personal library. Users can search, create, edit, insert
and delete phrases (with inline confirmation). Every mutation is constrained to
`owner_user_id = caller`; clients cannot create shared phrases or edit another
user's rows. Legacy shared rows remain in storage but are not exposed in this
personal library. A future shared-library surface requires separate admin rights.

## Scheduling and operation

Apply tenant migration **13795_comms_scheduled_message.sql** and restart the BullMQ
worker when deploying. The scheduler registers independently of the orchestration
interval and fans out to LIVE tenants every 30 seconds. Like scheduled email, this
is **LIVE-only**: TEST must not generate real colleague notifications. The UI and
API explicitly state this restriction. Worker and Redis availability are required;
there is no client-side timer and closing the browser does not lose a schedule.

Schedule Message opens scheduling plus the sender's recent schedule history for
this conversation (up to 100 rows). Users can review text and attachment captions,
reschedule pending/failed rows, and cancel pending/failed rows. Times use the
browser's explicit IANA timezone; API storage is an absolute timestamp plus that
zone. The date entry is day-first and 24-hour. Nonexistent DST wall-clock times
are rejected; for repeated hours the first occurrence is explicitly documented
in the dialog. Choose a future time no more than one year away.

Delivery semantics:

1. A schedule stores the full text, file/media descriptors, record references,
   reply target and sender. `(sender_user_id, request_id)` is unique; a reused key
   with changed content is refused, not silently substituted.
2. A due row is locked with `FOR UPDATE SKIP LOCKED`. Its message, attachments,
   normal domain event, and `SENT` transition commit together. Other workers,
   retries and restarts cannot duplicate that scheduled message.
3. Sender account status, current create rights, channel status, membership,
   attachment channel binding and reply binding are checked at delivery.
   Record cards still resolve against each reader's permissions when read.
4. Cancellation/rescheduling are conditional updates on the same row. They
   serialize against delivery; once SENT, neither can alter it. Only the owner
   can manage it. A retry-state update is version-guarded so it cannot overwrite
   a concurrent reschedule.
5. Transient failures retry at 1/2/4/8 minute intervals, up to five attempts.
   Permission/binding failures stop immediately. FAILED is visible in the
   scheduling dialog; rescheduling explicitly retries it. Polling catches up
   after outages; it never claims a guarantee of exact wall-clock delivery.
6. Realtime events and notifications follow the existing post-commit,
   best-effort chat path. Delivery persistence is transactional; notification
   delivery has the same limitations as ordinary chat messages.

## Verification

- `tests/unit/smartcomm-scheduling.test.js`: authorization, time validation,
  transaction boundaries, replay prevention, retries and phrase ownership.
- `client/src/features/comms/chat/message-format.test.tsx`: list round-trips,
  safe rendering and time validation.
- `client/e2e/comms-composer.spec.ts`: real browser tests of the built app at
  phone/desktop sizes, list continuation, send/edit/cancel, IME, tools placement,
  phrase creation, file selection/retry, and scheduling payloads. API fixtures
  are deterministic; these are not a production end-to-end delivery test.
