"use strict";

/**
 * Do not read the developer's `.env` at all.
 *
 * This file has always tried to isolate the suite from a local `.env` — see the
 * two lists below — but could not actually do it. Both techniques operate on
 * `process.env` BEFORE `src/config/env.js` is required, and that module's first
 * statement is `dotenv.config()`, which puts every deleted key straight back
 * from the file. So the isolation held for whatever ran first and leaked for
 * everything after.
 *
 * The symptom was a suite that passed in CI and failed on a configured machine:
 * `MAIL_FALLBACK_DOMAIN=nmail.praxisls.com` broke mail-fallback.test.js, and a
 * real `PG_DUMP_BIN` broke the backup preflight tests — both pointing at code
 * nobody had touched. CI has no `.env` file, which is precisely why it never saw
 * either.
 *
 * `env.js` honours this flag and skips the load. A local run now behaves exactly
 * like CI. The two lists below are kept because they also cover variables passed
 * through the real environment rather than a file.
 */
process.env.PRAXIS_SKIP_DOTENV = "1";

/**
 * A database password must exist, even though no unit test should use one.
 *
 * Not reading `.env` means `DB_PASSWORD` falls to its schema default of `""`,
 * and pg treats an empty password as ABSENT: `ConnectionParameters` resolves it
 * `config.password || PGPASSWORD || defaults.password`, and `""` is falsy, so it
 * becomes `null`. A null password sends pg down its deprecated `~/.pgpass`
 * lookup — `require('pgpass')`, which is not installed — and that surfaces as
 * `TypeError: pgPass is not a function`, thrown asynchronously from inside the
 * SASL handshake and reported against whichever test happened to be running.
 *
 * That is exactly what happened: portal-auth.test.js failed on an error from a
 * pool it does not own and does not use.
 *
 * So: any non-empty value. It is never expected to authenticate — CI's
 * build-test job has no Postgres at all and these suites pass there, which
 * proves the code paths handle a failed connection. This only stops a MISSING
 * password taking a different, undiagnosable route through pg's internals.
 *
 * Conditional, so the integration job (which sets real credentials in its job
 * env) keeps them.
 */
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = "unit-tests-never-connect";

// Deterministic env for unit tests: development mode with dev-safe secrets so
// modules that read config at require-time don't trip the production guard.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

// Isolate unit tests from the developer's local .env. env.js runs
// dotenv.config() at require-time, which would otherwise pull real/placeholder
// provider keys (GROQ_API_KEY=__rotate*me__, SMTP_HOST=__host__, etc.) into the
// test process and defeat the "not configured / no sender" guards. dotenv does
// not override an already-set var, so pinning these to "" here (before any
// service requires env.js) keeps the "no provider configured" paths testable.
for (const k of [
  "GROQ_API_KEY", "WHISPER_BASE_URL",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
  // Mail-fallback defaults: a developer .env may set MAIL_FALLBACK_DOMAIN
  // (e.g. nmail.praxisls.com) for real runtime, which would otherwise leak into
  // mail-fallback.test.js and break its assertions against the code defaults.
  // Pin them empty so the service's own "praxisls.com" fallbacks apply.
  "MAIL_FALLBACK_DOMAIN", "MAIL_DEFAULT_FROM", "MAIL_SUPPORT_FROM", "MAIL_FALLBACK_FROM_NAME",
  // A unit test must never make a network call. error-reporter.report() POSTs
  // to ALERT_WEBHOOK_URL, and the orchestration dispatcher calls it when an
  // event goes DEAD — so a developer with a real webhook in .env had that path
  // hang on a live HTTP request. Found while writing the outbox tests
  // (TEST-C8): the suite ran fine in a clean environment and timed out in a
  // configured one, which is the worst kind of flake.
  "ALERT_WEBHOOK_URL", "ALERT_EMAIL",
]) {
  process.env[k] = "";
}

/**
 * DELETED, not blanked — these are asserted against their zod DEFAULTS.
 *
 * Same isolation problem as the list above, opposite fix. `mail-fallback.test.js`
 * asserts `fallback_domain === "praxisls.com"`, which is `env.js`'s default. A
 * developer whose `.env` still carries the pre-2026-08-06 value
 * (`MAIL_FALLBACK_DOMAIN=nmail.praxisls.com` — see doc/MAIL_AUDIT_2026-08-06.md,
 * where that default was corrected) fails the suite on a file git does not
 * track, with a diff that points at code nobody touched.
 *
 * Blanking to "" would not work here: zod's `.default()` only fires on
 * `undefined`, so an empty string IS a value and the assertion would fail a
 * second, more confusing way. `delete` is what restores the default.
 *
 * This is the same class of flake the comment above describes — "the suite ran
 * fine in a clean environment and timed out in a configured one" — and it is
 * worth stating the rule: a unit test that reads a config default must not be
 * able to see the developer's .env.
 */
for (const k of ["MAIL_FALLBACK_DOMAIN", "MAIL_DEFAULT_FROM", "MAIL_SUPPORT_FROM"]) {
  delete process.env[k];
}
