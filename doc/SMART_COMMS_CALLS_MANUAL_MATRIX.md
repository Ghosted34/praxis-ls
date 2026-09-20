# Smart Comms — manual matrix (standing, scripted)

> **SIGN-OFF PENDING.** No row is signed yet, and the programme is **not**
> allowed to claim §7.4.5 passed until somebody signs a column below. This is a
> voice product: a green CI proves the state machine, the aggregation and the
> media graph — it cannot hear a forklift, and it cannot ring a real phone.
>
> **First real-hardware attempt — 2026-09-20 (owner, Android ↔ desktop, two
> test accounts).** The media path worked — "for the few seconds I could
> actually talk and hear clearly" — but two defects blocked the run before a
> single row could be signed: no audible ring on a backgrounded or closed app
> (FN-2), and a call that dies with both devices gone holding both users busy
> for up to 30 minutes (FN-1). Both are fixed in the closing PR
> (`doc/SMART_COMMS_CALLS_FIELD_NOTES.md`); every row below stays `PENDING`
> until it is run on the fixed build and signed.

Derived from `doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md` §3.7 (the standing
matrix), §5.7 (the PR-1 checklist) and §7.2/§7.4 (what PR-3 adds). The devices
are the guide's, not a convenience list:

| Column | Device | Why this one |
| --- | --- | --- |
| **A** | iPhone — the app installed to the home screen (a PWA, not a Safari tab) | the reference device for the corridor; both iOS quirks live here |
| **B** | Android — Chrome, installed to the home screen | the push tier and the notification actions that go with it |
| **C** | Desktop — Chrome | the desk half of the ring |
| **D** | Desktop — Safari | the second engine, and the one most likely to differ silently |

Every row is scripted: the steps are what to DO, and the expected result is what
to look for. A row is signed only when the tester has done it on that device and
can say what they heard or saw.

---

## 1. PR-3 — the noise filter (§4.4)

| # | Script | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| N1 | Stand within ~2 m of a running engine, a forklift or a loading bay, and dial. **Export the clip** (below) with the filter ON. | PENDING | PENDING | PENDING | PENDING |
| N2 | Same spot, same call, filter OFF (overlay switch) — export the second clip. | PENDING | PENDING | PENDING | PENDING |
| N3 | Listen to both clips back to back on headphones. **The after clip must be the yard with a voice on top of it, not a voice in a tunnel.** Subjective, and the whole point of the feature. | PENDING | PENDING | PENDING | PENDING |
| N4 | Toggle the filter mid-call, twice. The call must not drop, re-negotiate audibly, or go silent — only the background changes. | PENDING | PENDING | PENDING | PENDING |
| N5 | Set **Settings → Calls → My preference = Always off**, then dial. The overlay switch starts OFF; the company default does not override it. | PENDING | PENDING | PENDING | PENDING |
| N6 | Set **My preference = Follow the company**, have an administrator set the company default OFF, then dial. The call starts unfiltered; the default is being followed, not cached. | PENDING | PENDING | PENDING | PENDING |
| N7 | On a browser without AudioWorklet (or with the worklet blocked), dial. The call connects, the overlay says the filter is unavailable, and it says it in the user's language. | PENDING | PENDING | PENDING | PENDING |

**The clip, so the listening check is reproducible:** export the same 30 seconds
from **Chat → the call's record** on the *other* device (`Call → transcript →
audio`), once per setting. The recording taps the RAW mic (see
`call-session.ts` — a certified transcript should be of what was said), so the
exported audio is the *unfiltered* side and proves nothing on its own; the
listening check is therefore done from the **receiving device's own recording**,
or with a second phone recording the earpiece. Whichever is used, say which in
the sign-off column.

---

## 2. PR-3 — the ring, on every channel (§4.6)

| # | Script | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| R1 | Call the device with the app **open and in the foreground**. The in-app ring shows the caller's name and counts down from 0:60. | PENDING | PENDING | PENDING | PENDING |
| R2 | Call the device with the app **open but hidden** (another tab/app in front). A system notification appears with **Answer / Decline**. | PENDING | PENDING | PENDING | PENDING |
| R3 | Tap **Answer** in the notification. The app comes to the front, the call is in progress, and both sides have audio. | PENDING | PENDING | PENDING | PENDING |
| R4 | **Force-quit the app**, then call it from the other device. (Android: the push tier — the notification should arrive within ~5 s. iOS: see R8.) | PENDING | PENDING | PENDING | PENDING |
| R5 | Android, closed app: tap **Answer** on the push. The app opens on the call and the media connects. | — | PENDING | — | — |
| R6 | **Expired push**: let a ring expire, then tap the stale notification. The app must show *"That call has already ended"* with a **Call again** button — never a ring for a call that is over. Tapping it dials. | PENDING | PENDING | PENDING | PENDING |
| R7 | Ring the same user on **two signed-in devices** at once. Acknowledge on one; the other's notification/ring must stop. | PENDING | PENDING | PENDING | PENDING |
| R8 | **iOS, closed app — documented as-is**: force-quit, then call. Expect NO ring on that device (a force-quit iOS PWA cannot be woken). The caller must see the honest offline sentence on their overlay rather than ringing into silence. Write down exactly what appeared. | PENDING | — | — | — |

---

## 3. PR-3 — ICE and network recovery (§4.4, §4.7)

| # | Script | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| I1 | On a call, background the app for 30 s (screen lock is the corridor version of this), then return. The call is still up, both sides still hear each other, and the timer has kept counting. | PENDING | PENDING | PENDING | PENDING |
| I2 | On a call, walk out of WiFi range so the phone drops to 4G. The quality dot may dip to Fair or Poor; **the call must not end**. Audio resumes within ~10 s. | PENDING | PENDING | PENDING | PENDING |
| I3 | On a call, lose all connectivity for 20 s (airplane mode), then restore it. The overlay says *"Reconnecting…"*, then the call either recovers or ends with the plain sentence — never a frozen timer with dead audio. | PENDING | PENDING | PENDING | PENDING |
| I4 | On a 4G corridor connection, hold a two-minute conversation while moving. No robot voice, no dropped syllables, no one talking over the other by more than ~half a second (this is what the `playoutDelayHint` is for). | PENDING | PENDING | PENDING | PENDING |

---

## 4. PR-1/PR-2 regressions on the same devices (§5.7)

| # | Script | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| G1 | Dial from the DIRECT header icon **and** from the InfoPane member row. Both work. | PENDING | PENDING | PENDING | PENDING |
| G2 | 30:00 → both ends hang up cleanly with the cap sentence; the call row is `ENDED(max_duration)` with an exact duration. | PENDING | PENDING | PENDING | PENDING |
| G3 | Callee already on a call → the dialer gets the busy sentence. | PENDING | PENDING | PENDING | PENDING |
| G4 | Kill the callee's network mid-ring → `NO_ANSWER` at 60 s. | PENDING | PENDING | PENDING | PENDING |
| G5 | Kill it mid-call → ICE restart, then the plain sentence if it truly cannot recover. | PENDING | PENDING | PENDING | PENDING |
| G6 | A 2-minute call produces a transcript and, for the caller, a summary draft to review and post. | PENDING | PENDING | PENDING | PENDING |
| G7 | `calls` flag off for the tenant → the dial affordance is absent and the API answers 403. | PENDING | PENDING | PENDING | PENDING |
| G8 | `call_recording` flag off → no consent banner, no recorder armed, the record routes 403. | PENDING | PENDING | PENDING | PENDING |

---

## 5. The two iOS quirks, as evidence (§4.8, §7.2)

The mitigations shipped in PR-1. These rows are the **scripted regression
checks** PR-3 adds — they exist to prove the mitigations still hold, on the
device where the quirks live.

| # | Script | A |
| --- | --- | --- |
| Q1 | Dial, and **force-quit the app while the mic permission prompt is still on screen**. Reopen the app and dial again. The mic prompt appears and the call connects — no silent, permanent loss of capture (WebKit bug 252465). | PENDING |
| Q2 | Start a call, let it run past the screen-sleep timeout. **iOS 18.4+ (installed PWA)**: the screen stays awake (Wake Lock). **iOS 26.1-regressed devices**: the screen may sleep — the call must still be alive after waking, via the silent-audio keepalive. Record the iOS version and which of the two happened. | PENDING |
| Q3 | On the first 30-minute-class call, the one-time *"keep your screen on during calls"* hint appears exactly once and not again on later calls. | PENDING |

---

## 6. Sign-off

A row is only signed by a human who did it on the device in that column. Copy
this table into the PR thread, or edit it here, with the date and the iOS/Android
build numbers.

| Column | Device + OS build | Tester | Date | Result |
| --- | --- | --- | --- | --- |
| A | iPhone (installed PWA), iOS ______ | ______ | ______ | PENDING |
| B | Android Chrome, Android ______ | ______ | ______ | PENDING |
| C | Desktop Chrome ______ | ______ | ______ | PENDING |
| D | Desktop Safari ______ | ______ | ______ | PENDING |

**Rules for the signer, because this is the one gate a machine cannot hold:**

1. A row that was not done is `NOT RUN`, never `PASS`. An unrun row is a fact
   about the release; a false `PASS` is a fact about nothing.
2. "It worked on my phone" is not a result. Write what the other person heard,
   which sentence appeared, or which dot colour showed.
3. If a row fails, say so in the PR. A failing manual row is exactly what the
   matrix exists to catch, and the honest failure is worth more than the
   programme's schedule.
