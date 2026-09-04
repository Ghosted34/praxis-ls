# Push notifications — why one didn't arrive, and how to find out

Web push is the only part of the notification system that is allowed to fail
silently. That is deliberate: a notification must never be able to break the
business operation that raised it, so every send is wrapped, every failure is a
log line, and the caller carries on. The cost is a chain where a break anywhere
looks identical from the outside — nothing happens — and the person who needs to
know is a tenant admin with no access to a log.

This document is the map of that chain, and the two things you can now press to
find out where it broke.

## The chain

| # | Link | Where it lives | How it fails |
| - | ---- | -------------- | ------------ |
| 1 | A VAPID keypair exists for the deployment | `platform_setting` `push`/`vapid`, or `VAPID_*` env | `sendToUser` answers `reason: "push not configured"`, and `deliverOutbound` logs it at **error** |
| 2 | The browser has permission and a subscription | the device | nothing is registered; the Settings panel says so |
| 3 | The subscription is stored | `push_subscription`, **live schema always** | `reason: "no registered devices"` |
| 4 | The subscription still matches the deploy's key | `push_subscription.vapid_key_hash` | see [Rotating the keypair](#rotating-the-keypair-is-not-free) |
| 5 | The push service accepts the message | FCM / Mozilla autopush / APNs | `failed`, with the verdict on `push_subscription.last_error` |
| 6 | The service worker displays it | `client/public/push-handler.js` | the push arrives and nothing is shown |
| 7 | The OS shows it | the phone | app notifications muted in system settings |

Link 3 is worth one extra sentence, because it looks like a bug and isn't: push
subscriptions are **identity**, not business data, so they are read and written
against the LIVE schema whatever `X-Praxis-Env` says. A browser is a device, and
switching to Test does not give you a different phone.

## The two things to press

**"Send a test" (Settings → Notifications, next to the push toggle).** Sends a
real push to your own devices through the same `sendToUser` an alert uses. A
pass means alerts will land. A failure names the link. It re-registers this
device first, so the commonest cause — link 4 — is repaired and then proved
rather than merely reported.

**`GET /api/tenant/notifications/push/devices`.** What the server can see: how
many devices, how many are on a superseded key, and per device the push service,
when it last actually received something (`last_delivered_at`), and the last
failure. The endpoint itself is never returned — it is a capability URL, and
anyone holding one can push to that device, which is why migration 12752 refused
to use it as proof of identity either.

## Rotating the keypair is not free

A `PushSubscription` is bound to **one** application server key. Regenerating the
deploy's VAPID pair in the Platform Console makes every subscription in every
tenant undeliverable in the same instant.

What made that a *permanent, invisible* outage rather than a brief one is which
error the push services return: **403** — this signature is not welcome here —
and not 404/410, which is what "this endpoint is gone" looks like. Every safety
net in the system watched for the second:

- nothing pruned the rows, so `/push/devices` kept counting them;
- the Settings panel kept saying *"You'll get alerts here even when the app is
  closed"*;
- the *"your device stopped receiving notifications"* email fires on
  `pruned > 0 && sent === 0`, so it never fired;
- and the client's boot-time sync re-POSTed whatever subscription the browser
  was holding **without ever asking which key it was minted under** — so the one
  mechanism that repairs a device kept the dead one registered, every boot,
  indefinitely.

Since migration `12770` each subscription records the fingerprint of the key it
was minted with, and:

- the client compares it on every boot and re-subscribes when it has moved on
  (`client/src/lib/push-sync.ts`);
- the server drops a superseded subscription *before* attempting a send, and
  drops one that predates the fingerprint when a 403 comes back
  (`src/shared/push/push.service.js`);
- both count as `pruned`, which is the number the "you went quiet" email and the
  Settings *Reconnect* banner already watch.

So a rotation now costs each user one app boot, not their notifications. It is
still not something to do casually: **a phone nobody opens stays silent**, so
regenerate only if the private key has been exposed.

One guard rail worth knowing about. The key resolution falls back to the `VAPID_*`
env values when the platform settings store is unreachable — silently, on a path
that looks like success. If a fingerprint mismatch were treated as authoritative
there, a few seconds of platform-database trouble would delete every push
subscription on the deployment and manufacture the exact outage this mechanism
exists to repair. So a degraded resolution never prunes; it sends, and lets the
push service have the final word.

## Reading `push_subscription`

| Column | Means |
| ------ | ----- |
| `created_at` | when this browser registered |
| `last_used_at` | when a push was last **successfully delivered** to it. Before 12770 only subscribe and rotate ever wrote this, so it silently meant "last registered" — the one column that could have answered "has this device ever received anything" answered a different question |
| `last_failed_at` / `last_error` | the classified verdict of the last failed send: `rejected_<status>` with the push service's own message, or `unreachable` |
| `vapid_key_hash` | SHA-256 of the public key this subscription was minted with. NULL for rows created before 12770 — those are attempted, and a 403 is what classifies them |
| `rotation_token_hash` | see migration 12752 — how a service worker with no session repairs a browser-initiated rotation |

## What this still does not cover

- **Delivery runs on the producer's connection.** `deliverOutbound` touches only
  identity tables (`push_subscription`, `app_user`), but it uses whichever client
  the notification producer held. Under LIVE that is the same schema and correct.
  A producer running under sandbox would read the sandbox tables and find no
  devices. Worth fixing when someone relies on notifications from Test.
- **The event fan-out excludes the actor** (`shared/notifications/notify-events.js`)
  — "do not tell me about my own action". A solo operator testing by creating
  something themselves gets no notification, in-app or push, and nothing is
  wrong. Test with a second account, or with the Send-a-test button above.
