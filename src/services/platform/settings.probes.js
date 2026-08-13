/**
 * Platform-settings connectivity probes — live, read-only checks for the
 * deploy-wide integration credentials (settings.service.test). Each takes the
 * resolved config (non-secret value merged with the decrypted secret), performs
 * one side-effect-free call, returns metadata on success and THROWS on failure.
 */
"use strict";

const axios = require("axios");

/** S3 / S3-compatible: HeadBucket verifies creds authenticate + bucket exists. */
async function s3(cfg) {
  if (!cfg.bucket) throw new Error("no bucket configured");
   
  const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
  const client = new S3Client({
    region: cfg.region || "us-east-1",
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.force_path_style !== false,
    credentials:
      cfg.access_key && cfg.secret_key
        ? { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key }
        : undefined,
  });
  await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  return { bucket: cfg.bucket, endpoint: cfg.endpoint || "aws-default" };
}

/** Geoapify: a reverse geocode round-trip. A bad key returns 401 (axios throws). */
async function geoapify(cfg) {
  const { data } = await axios.get("https://api.geoapify.com/v1/geocode/reverse", {
    params: { lat: 48.8566, lon: 2.3522, format: "json", limit: 1, apiKey: cfg.api_key },
    timeout: 8000,
  });
  return { results: data && Array.isArray(data.results) ? data.results.length : 0 };
}

/**
 * SMTP (system-email fallback): nodemailer verify() — opens a connection, runs
 * EHLO/AUTH, sends nothing. Auth is optional (some relays use IP allowlists).
 */
async function smtp(cfg) {
  if (!cfg.smtp_host) throw new Error("no SMTP host configured");
  const port = Number(cfg.smtp_port || 587);
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: cfg.smtp_secure === true || port === 465,
    auth: cfg.smtp_user && cfg.smtp_pass ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
  });
  try {
    await transport.verify();
  } catch (err) {
    // Classify the SMTP verdict (550 sender verify, 535 auth, …) so the
    // platform console can render the same fix guide the tenant console does.
    const { mapSmtpError, isSmtpError } = require("../../modules/mail/smtp-error.map");
    if (isSmtpError(err)) {
      const mapped = mapSmtpError(err);
      const wrapped = new Error(mapped.message);
      wrapped.code = mapped.code;
      wrapped.smtp_code = err.responseCode || null;
      throw wrapped;
    }
    throw err;
  }
  return { smtp_host: cfg.smtp_host, smtp_port: port, smtp_user: cfg.smtp_user || null };
}

/**
 * VAPID keys can't be exercised without a live browser subscription, so this
 * validates the keypair is present and well-formed (base64url, P-256 sizes:
 * 65-byte public → 87 chars, 32-byte private → 43 chars, unpadded).
 */
function vapid(cfg) {
  const pub = cfg.public_key || "";
  const priv = cfg.private_key || "";
  const b64url = /^[A-Za-z0-9_-]+$/;
  if (!pub || !priv) throw new Error("VAPID keypair not set — generate it first");
  if (!b64url.test(pub) || pub.length < 80) throw new Error("public key looks malformed");
  if (!b64url.test(priv) || priv.length < 40) throw new Error("private key looks malformed");
  return { public_key_len: pub.length, subject: cfg.subject || null };
}

/**
 * WS-ER1 — the alert destination probe.
 *
 * "Test" here means SEND A REAL MESSAGE to the configured channel, not merely
 * check that the URL parses. The failure this guards against is a webhook that
 * was pasted wrong months ago and has been silently swallowing every page since
 * — and the only way to find that out is for a human to look at the channel and
 * see the test arrive. A probe that just validated the URL would pass on
 * exactly the broken configuration it exists to catch.
 *
 * A non-2xx is a failure. Slack, Teams and Discord all answer 2xx on accept and
 * 4xx on a dead or malformed hook, so the status is meaningful.
 */
async function alertWebhook(cfg) {
  const url = String(cfg.url || "").trim();
  if (!url) throw new Error("no webhook URL configured");
  if (!/^https:\/\//i.test(url)) {
    // http:// would put an alert payload — which names tenants and quotes error
    // text — on the wire in clear.
    throw new Error("alert webhook must be https");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text:
        "Praxis test alert — if you can read this, the ops alert channel is wired correctly. " +
        "Backup failures, failed restore drills and RED tenants will arrive here.",
      praxis: { event: "alert.test", severity: "notify" },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`webhook returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    err.statusCode = res.status;
    throw err;
  }
  return { status: res.status, note: "test message sent — check the channel received it" };
}

/**
 * WS-B1 — the backup destination probe.
 *
 * A ROUND TRIP, not a credential check. It writes a small object, reads it back,
 * compares the bytes, and deletes it.
 *
 * Anything less would pass on the configuration that matters most: a bucket the
 * key can write to but not read from restores nothing, and a key with no delete
 * permission silently defeats retention until the bucket bill arrives. Those are
 * discovered at restore time otherwise — which is the one moment the answer is
 * useless.
 *
 * The probe object carries a timestamp so a stale one left by an interrupted
 * test is obvious rather than mysterious.
 */
async function backupStorage() {
  // Required lazily: this module is loaded by the settings service on every
  // console request, and the storage service pulls in the AWS SDK.
  const store = require("./backup-storage.service");

  const key = `probe/settings-test-${Date.now()}.txt`;
  const body = `praxis backup probe ${new Date().toISOString()}`;
  const { Readable } = require("stream");

  const dest = await store.describe();

  let wrote;
  try {
    wrote = await store.putStream(Readable.from([Buffer.from(body)]), key);
  } catch (err) {
    throw new Error(`write failed (${dest.driver} → ${dest.destination}): ${err.message}`);
  }

  try {
    const chunks = [];
    const stream = await store.openStream(key);
    for await (const c of stream) chunks.push(c);
    const readBack = Buffer.concat(chunks).toString();
    if (readBack !== body) {
      throw new Error("the object read back does not match what was written");
    }
  } catch (err) {
    throw new Error(`read-back failed (${dest.driver} → ${dest.destination}): ${err.message}`);
  } finally {
    // Best effort. A probe that cannot clean up is worth reporting, but not at
    // the cost of failing a test that otherwise proved the round trip works.
    await store.remove(key).catch(() => {});
  }

  return {
    driver: dest.driver,
    destination: dest.destination,
    settings_from: dest.source,
    bytes: wrote && wrote.bytes,
    note: "wrote, read back and deleted a probe object",
  };
}

/**
 * The email alert destination — SENDS A REAL MESSAGE, like every probe here.
 *
 * Checking that the address parses would prove nothing: the failure mode is not
 * a malformed address, it is a correct address that never arrives because the
 * mail fallback sender was never configured, or the relay rejects the domain, or
 * it lands in spam. Only a real send finds those, and only a human confirming
 * receipt finds the last one — hence the note.
 *
 * `platform-mail.send` never throws (it is built for the alerting path), so a
 * failure comes back as `ok:false` with a reason and is converted to a throw
 * here, because that is the contract `settings.test()` expects of a probe.
 */
async function alertEmail(cfg) {
  const to = String(cfg.to || "").trim();
  if (!to) throw new Error("no alert email address configured");
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(to)) {
    throw new Error(`"${to}" is not an email address`);
  }

  const platformMail = require("./platform-mail.service");
  const r = await platformMail.send({
    to,
    subject: "[Praxis NOTICE] alert.test — ops alert email is wired",
    text:
      "Praxis test alert — if you can read this, the ops alert EMAIL channel is wired correctly.\n\n" +
      "Backup failures, failed restore drills, corrupt documents and tenants that cannot serve " +
      "will arrive here as well as in the webhook channel.\n\n" +
      "Two channels on purpose: they fail independently, and a chat outage on the night a backup " +
      "fails should not also be the night nobody is told.",
  });

  if (!r || !r.ok) {
    // `no_smtp_configured` is the common one on a fresh deployment and is worth
    // saying plainly: the address is fine, the SENDER is not set up.
    const reason = (r && r.reason) || "unknown error";
    const err = new Error(
      reason === "no_smtp_configured"
        ? "no system-email sender configured — set Integrations → Mail fallback first"
        : `send failed: ${reason}`,
    );
    throw err;
  }
  return { message_id: r.message_id, note: "test email sent — check it arrives, and check the spam folder" };
}

module.exports = { s3, geoapify, smtp, vapid, alertWebhook, alertEmail, backupStorage };
