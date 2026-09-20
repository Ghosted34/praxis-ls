# Smart Comms Calls — field notes

**What this is.** A running record of what broke after a Smart Comms calls PR
merged, why, and what now stops it recurring. It is deliberately **separate
from** `doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md`: the guide is the plan of
record and should read as the plan, not as a defect log. Read the guide to know
what we are building; read this to know what the building actually taught us.

Newest first.

---

## FN-2 · 2026-09-20 · A backgrounded or closed app never rang — only a small notification appeared

**Reported by:** the owner, on the first real-hardware run (Android ↔ desktop,
two test accounts). "The call does not ring when the app is not open. NEVER.
Just a small notification. It should ring like a call on a mobile phone. Also,
on mobile same."

### What was actually true

The ring has three tiers, and before this fix only the first one made a sound —
and it made the wrong kind:

| Tier | What it was doing | What the owner heard |
| --- | --- | --- |
| In-app ring (page alive, on ANY screen — the surface is mounted app-wide) | `IncomingRing` overlay + a repeated tone every 2.5 s, but the tone was the notification "urgent" blip (three quick descending notes — an "something arrived" figure) | not exercised in the failing case |
| Notification (page hidden) | `reg.showNotification` with Answer/Decline actions, **no sound of its own** — the device plays its own notification sound, which is not a ring | "a small notification" |
| Push (page closed) | the t=5 s escalation job, `requireInteraction`, Answer/Decline actions — the same ceiling: a page that does not exist cannot play a tone | "a small notification" (push itself was working — that is what delivered the notification) |

The platform ceiling, stated plainly: **a closed web page cannot play a
ringtone before the user taps something.** That is a fact about PWAs, not a
bug a PR can merge away — only a native app rings a truly closed app. The
guide already names the honest floor (§4.6: "a ringtone we cannot guarantee is
worse than a truthful dot"); this note adds the sound half of the same
sentence.

### The fix (closing PR, 2026-09-20)

- `notif-sound.ts` gained a `ring` tier: a synthesised two-note "ding" and a
  held "dong" (~0.9 s figure, a louder gain than the blips — a ring is a
  phone). Synthesised rather than an asset for the same reason the blips are
  (see that module's header).
- `comms-live.tsx` plays `ring` — not `urgent` — while `phase ===
  "incoming"`, which covers every moment the page is alive: visible **or
  hidden**. A backgrounded PWA (on Android the home button is a background,
  not a close) now rings like a phone, provided the page had a user gesture
  this session — the AudioContext unlock rule, and a person who is calling
  from the app has by definition had one.

### What remains

- A **closed** app (window gone, or the OS killed the page) still only gets
  the notification, with the device's own notification sound. If that is not
  acceptable for the corridor, the answer is a native shell, not a flag.
- The standing matrix rows R1–R5 on real hardware are the sign-off that the
  tone is loud enough and the ceiling is understood; the signer writes down
  what they heard, the way N3 does.

---

## FN-1 · 2026-09-20 · A dead call held both users busy for up to 30 minutes

**Reported by:** the owner, same run. "I pick the call and it goes off after
about 30 seconds and when I try calling back it tells me I am on a call. I
have logged out and in again but nothing."

### The mechanism

A `comms_call` row ends by exactly three writers: a client report (hangup /
decline / `ice_failed`), the 60 s ring deadline, or the 30-minute cap — the
sweep is "the only clock". The fourth case had no writer: **both devices
gone** — the tab closed, or (the most plausible reading of the ~30 s audio
death on the phone) the OS freezing or killing the backgrounded page. A page
that dies without a hang-up leaves the row `IN_CALL` until the 30-minute cap —
and the D8 guard (one active call per user) reads exactly that row, so every
dial touching either user is refused `CALLER_BUSY`/`CALLEE_BUSY`. Logout/login
cannot clear it: the row belongs to the *users*, not the session.

### The fix (closing PR, 2026-09-20)

1. **The client reports a deliberate close.** `call-session.ts` listens for
   `pagehide` (it fires on close, on reload and on mobile bfcache, where
   `beforeunload` cannot be trusted) and, in any active phase, POSTs a
   `keepalive: true` hang-up — the one network call the browser owes a dying
   page. The other end gets a clean "call ended"; the row ends at once.
2. **The server owns the case it cannot be reported from.** The sweep gained a
   liveness pass (`sweepLiveness` in `smartcomm.call.service.js`): the
   realtime layer keeps a Redis SET per tenant+env with one member per socket
   (`<userId>:<socket.id>`), and the sweep books each in-call participant's
   first offline sighting in a Redis ZSET, ending the call
   `ENDED(disconnected)` once BOTH have been gone for 60 s. The 60 s sits
   beyond the matrix's 20 s airplane row (I3 drops one device — the other is
   still in the set, so the rule cannot fire), and every read fails toward
   "leave it alone": a registry outage skips the pass and the 30-minute cap
   remains the backstop.
3. **The user sees it.** `disconnected` is a first-class end reason: the state
   machine in guide §4.1, the data-model comment in §4.2, the failure table in
   §4.7, and the EN/FR toast "The call was lost — the connection ended."

### What now stops it recurring

- `tests/unit/smartcomm-calls.test.js` — five liveness cases: both gone 60 s
  → `ENDED(disconnected)`; one online → untouched; fresh absence → untouched;
  RINGING rows never touched by liveness; a registry outage skips the pass
  without breaking the ordinary deadlines.
- `client/src/features/comms/call/call-session.test.ts` — a page hiding
  mid-call sends the keep-alive hang-up, and an idle tab sends nothing.

### Honest limits

- Worst-case clearance for an OS-killed pair is socket detection + grace: the
  server sees the kill when the socket's ping times out (≤ ~45 s: socket.io
  defaults, 25 s interval + 20 s timeout — no custom ping config), the
  liveness sweep notices on its next 15 s tick, then the 60 s offline grace
  runs — so under ~2 minutes, not instant. A deliberate close is instant
  (pagehide).
- A call whose two devices lose *network* (not pages) for 60 s or more at the
  same time ends `disconnected` even though a same-LAN P2P media path could in
  principle survive — the server cannot see media, by design (D4). The
  matrix's single-device network rows (I2/I3) are unaffected.
- The owner's stuck row from the report itself clears by the 30-minute sweep
  (`ENDED(max_duration)`); the one-line manual clear is in the PR body.
