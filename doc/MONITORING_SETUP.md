# Monitoring setup — what to configure outside the repo

**Created 2026-08-04** alongside the Week-1 fixes. Closes the repo-side half of
audit findings **OBS-A1** (no alerting), **OBS-A2** (health check cannot fail),
**OBS-I4** (deploy smoke test cannot fail) and **OBS-A4** (no restart policy).

The code changes are done. What is below needs an account, a URL or a person,
so it could not be committed — but none of it takes more than twenty minutes,
and until it is done, **nothing in this system is watched**.

> The observability audit's closing line: _"If only one thing is done: fix the
> health check and put an external uptime monitor on it. Everything else in that
> report assumes someone finds out."_ The first half shipped today. The second
> half is step 1 below.

---

## 1. Uptime monitor — 10 minutes, do this first

**Target the readiness endpoint, not the liveness one.**

```
URL       https://<tenant-host>/api/health/ready
Method    GET
Interval  60s
Timeout   10s
Alert on  2 consecutive failures      (one blip is a blip)
Expects   HTTP 200  AND  body contains  "status":"ready"
```

That last line matters. `/api/health/ready` returns **200 with
`"status":"degraded"`** when Redis is down or a module failed to load — the API
still serves, so it is not a page-someone-at-2am event, but it should not read
as fully healthy either. A monitor that only checks the status code will not see
it. Configure a **second, lower-severity check** on the same URL asserting
`"status":"ready"` if your provider supports body matching on a separate alert
tier.

Do **not** point the monitor at `/api/health`. That endpoint is deliberately
dependency-free — it answers 200 whenever the Node process is alive, which is
correct for a container restart policy and useless for detecting an outage. It
is the endpoint that produced OBS-A2 in the first place.

Any of these work; the audit expresses no preference:

| Provider                    | Free tier                   | Body matching    |
| --------------------------- | --------------------------- | ---------------- |
| Better Stack (Betteruptime) | 10 monitors                 | yes              |
| UptimeRobot                 | 50 monitors, 5-min interval | paid only        |
| Healthchecks.io             | 20 checks                   | n/a (push model) |
| Pingdom                     | trial                       | yes              |

**Also monitor the platform console host** (`admin.<domain>`) if it is served
separately — it is a different nginx vhost and can fail independently.

### What the endpoints return

```jsonc
// GET /api/health          — liveness, never fails while the process is up
{ "ok": true, "status": "alive", "uptime_s": 400,
  "build": { "version": "0.1.0", "commit": "a1b2c3d", "built_at": "…" } }

// GET /api/health/ready    — readiness, 503 when Postgres is unreachable
{ "ok": true, "status": "ready",
  "build": { "commit": "a1b2c3d", … },
  "checks": {
    "postgres":         { "status": "up", "latency_ms": 3 },
    "redis":            { "status": "up", "latency_ms": 1 },
    "modules":          { "status": "up", "mounted": 100, "skipped": [] },
    "rate_limit_store": { "status": "up", "kind": "redis" }
  } }
```

`checks.modules.skipped` is worth reading. A module whose `require()` throws is
skipped and boot continues (API F-19) — the API then serves an incomplete route
table and every missing endpoint returns a 404 indistinguishable from a typo.
Before today nothing reported that. Now it is one field.

`checks.rate_limit_store.kind` should read `redis` in production. `memory` means
each container is enforcing its own limits, so the real ceiling is N× what is
configured (SEC-H5).

---

## 2. Alert routing — where a failure lands

The repo side is wired: set **one** of these and errors and alerts flow.

```bash
# .env on the server
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/…   # Slack or Teams incoming webhook
ALERT_EMAIL=oncall@yourdomain.com                      # or a mailing list
```

Both are read by `src/config/env.js`. If neither is set the app boots normally
and logs a warning at startup — deliberately, so that "we forgot to configure
alerting" is visible rather than silent.

**Point it at a channel a human actually reads.** An alert channel nobody has
open is the same as no alerting, and it costs more, because it feels like
coverage. If the team lives in one busy channel, make a quiet `#praxis-alerts`
and pin it.

### Alert on these first

In priority order. The first two are the whole point; the rest can wait for
Phase 3.

1. **Readiness check fails twice** → page. The API cannot serve.
2. **Deploy fails its readiness gate** → notify. `scripts/deploy.sh` exits
   non-zero and prints the rollback command; someone needs to see that.
3. `checks.modules.skipped` non-empty → notify. Part of the API is missing.
4. `checks.redis.status == "down"` → notify. Sessions and rate limiting degrade.
5. Dead-lettered outbox events > 0 (OBS-A6) → notify. Money-path events are
   silently not being delivered. **Needs Phase 3** — there is no metric yet.

---

## 3. Restart policy — 2 minutes (OBS-A4)

No service in `docker-compose.yml` declares `restart:`, so a crashed container
stays down until a human notices. Add to `api`, `api-standby`, `worker`,
`postgres` and `redis`:

```yaml
restart: unless-stopped
```

`unless-stopped` rather than `always`: it will not resurrect a container you
deliberately stopped during an incident.

This pairs with the liveness endpoint. If you add a container healthcheck, point
it at `/api/health` — **not** `/api/health/ready`. A readiness-based restart
policy would restart every API container during a database blip, converting a
degradation into a full outage and then flapping.

---

## 4. Log shipping — deferred, deliberately (OBS-L7)

Logs go to stdout, are captured by Docker, and are **lost on every deploy**.
Shipping them somewhere is Phase 2 in the observability roadmap, not today.

One ordering constraint worth writing down: **do not ship logs until OBS-L4 is
closed.** The redaction list currently misses `refresh_token`, `password_hash`,
`totp_secret_enc`, and — most importantly — Postgres error objects, whose
`detail` field carries row values like
`Key (email)=(someone@example.com) already exists`. Shipping logs off-box before
that is fixed exports customer PII to a third party. It is a small fix and it
belongs in front of the shipping work, not behind it.

---

## Checklist

- [ ] Uptime monitor on `/api/health/ready`, 60s, alert after 2 failures
- [ ] Second check asserting `"status":"ready"` (catches degraded)
- [ ] Monitor on the platform console host, if separately served
- [ ] `ALERT_WEBHOOK_URL` or `ALERT_EMAIL` set in the server `.env`
- [ ] Alert channel is one a human has open
- [ ] `restart: unless-stopped` on all five services
- [ ] Someone has run `bash scripts/rollback.sh --list` once, before needing it
