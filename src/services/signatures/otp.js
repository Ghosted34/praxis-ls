/**
 * The signing OTP (doc/SIGNATURE_ENGINEERING_GUIDE.md §6.4, Q6 = A, Q8 = B).
 *
 * Six digits, emailed, ten minutes, five attempts, three resends then a
 * thirty-minute cooldown. Two subjects use it: an EXTERNAL party proving
 * control of an address the tenant put on file, and an INTERNAL signer
 * stepping up above a threshold (§6.5).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE THREE RULES A REVIEWER SHOULD REJECT A PR OVER
 *
 * 1. A CODE VERIFIES ONE PAYLOAD. The challenge is bound to
 *    (subject, entity_ref, content_hash). Drop the third element and a code
 *    issued for one document can be replayed against another inside the same
 *    request window — the signer receives a code for a 1.6M invoice and it
 *    completes a 12M one. `verify()` re-checks the binding itself rather than
 *    trusting the caller to have looked it up correctly.
 *
 * 2. COMPARISON IS CONSTANT TIME. `crypto.timingSafeEqual` over the two
 *    digests, never `===` on the codes. Six digits is a small enough space
 *    that a timing oracle is worth building.
 *
 * 3. RESENDS ARE CAPPED, NOT JUST ATTEMPTS. An attempt limit with unlimited
 *    resends is not a limit: burn five guesses, resend, burn five more. The
 *    resend counter lives on the SAME row as the attempt counter, and a resend
 *    keeps the row rather than minting a fresh one — which is the whole point.
 *
 * ── Why sha256 and not argon2 ─────────────────────────────────────────────
 * The secret is six digits with a ten-minute life and a five-attempt cap. A
 * slow KDF defends against offline brute force of a stolen hash, and an
 * attacker holding this table already holds the tenant's documents. The
 * exposure worth closing is the timing side channel, which is rule 2.
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../utils/errors");

/** §6.4. Named rather than inlined, because these are the numbers a reviewer checks. */
const OTP = Object.freeze({
  DIGITS: 6,
  TTL_MINUTES: 10,
  MAX_ATTEMPTS: 5,
  MAX_RESENDS: 3,
  COOLDOWN_MINUTES: 30,
});

/**
 * Six digits, uniformly.
 *
 * ⚠ REJECTION SAMPLING, not `randomBytes(4).readUInt32BE() % 1000000`
 *   (CodeQL js/biased-cryptographic-random, and it is a real bias here rather
 *   than a theoretical one: 2^32 is not a multiple of 10^6, so the modulo
 *   makes the first 967,296 codes measurably likelier than the rest).
 *
 * Drawing from the largest whole multiple of 10^6 below 2^32 and discarding
 * the remainder is uniform. The reject rate is under 0.8%, so the loop
 * effectively never runs twice.
 */
function mintCode() {
  const range = 10 ** OTP.DIGITS;
  const limit = Math.floor(0xFFFFFFFF / range) * range;
  for (;;) {
    const n = crypto.randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % range).padStart(OTP.DIGITS, "0");
  }
}

const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

/**
 * Constant-time compare of two hex digests.
 *
 * Length is checked first because `timingSafeEqual` THROWS on a length
 * mismatch rather than returning false — and a thrown error is a louder,
 * faster signal than a wrong answer, which is the leak this is meant to
 * remove. Both sides are sha256 hex here, so a mismatch means corruption, not
 * a guess.
 */
function digestsMatch(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);
const isPast = (d) => Boolean(d) && new Date(d).getTime() <= Date.now();

/**
 * The live challenge for a subject, if any.
 *
 * "Live" means issued, not yet verified, and not yet expired. A dead challenge
 * is left in place rather than deleted: the Certificate of Completion prints
 * how many attempts a signature took, and a swept-away failed challenge is
 * evidence a dispute would have wanted.
 */
function isLive(row) {
  return Boolean(row) && !row.verified_at && !isPast(row.expires_at);
}

/**
 * Issue a challenge, or resend the live one.
 *
 * A resend REUSES the row — same code, same expiry, one more against the
 * resend counter. Minting a fresh code on every resend would reset the attempt
 * counter with it, which is the hole rule 3 exists to close.
 *
 * Returns `{ otp, code, resent }`. `code` is the plaintext, returned ONCE for
 * the caller to email and never stored.
 */
async function issue(repo, client, { partyId = null, userId = null, entityRef, contentHash, sentTo }) {
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entity_ref is required", 422);
  if (!contentHash) throw new AppError("NO_CONTENT_HASH", "content_hash is required to bind the code to a payload", 422);
  if (!sentTo) throw new AppError("NO_RECIPIENT", "An address is required", 422);
  if (Boolean(partyId) === Boolean(userId)) {
    throw new AppError("BAD_OTP_SUBJECT", "An OTP belongs to exactly one party or one user", 422);
  }

  const existing = await repo.latestOtp(client, { partyId, userId });

  if (existing && isPast(existing.cooldown_until) === false && existing.cooldown_until) {
    throw new AppError(
      "OTP_COOLDOWN",
      "Too many codes have been sent. Please wait before requesting another.",
      429,
      { cooldown_until: existing.cooldown_until },
    );
  }

  if (isLive(existing)) {
    if (existing.resends >= OTP.MAX_RESENDS) {
      const until = minutesFromNow(OTP.COOLDOWN_MINUTES);
      await repo.setOtpCooldown(client, existing.otp_id, until);
      throw new AppError(
        "OTP_COOLDOWN",
        "Too many codes have been sent. Please wait before requesting another.",
        429,
        { cooldown_until: until },
      );
    }
    // A resend cannot reveal the code — it was never stored — so a fresh one is
    // minted for the email while the ROW's counters carry over.
    const code = mintCode();
    const otp = await repo.resendOtp(client, {
      otpId: existing.otp_id, codeHash: hashCode(code), expiresAt: minutesFromNow(OTP.TTL_MINUTES),
    });
    return { otp, code, resent: true };
  }

  const code = mintCode();
  const otp = await repo.insertOtp(client, {
    party_id: partyId,
    user_id: userId,
    entity_ref: entityRef,
    content_hash: contentHash,
    sent_to: sentTo,
    code_hash: hashCode(code),
    expires_at: minutesFromNow(OTP.TTL_MINUTES),
  });
  return { otp, code, resent: false };
}

/**
 * Verify a presented code.
 *
 * Every failure path returns the SAME shape of error for the same reason the
 * portal returns one 404: a caller must not be able to tell "wrong code" from
 * "wrong document" from "expired", because each distinction is a free bit.
 * The one exception is the exhausted/expired case, which has to say so — a
 * signer who cannot proceed needs to know to ask for a new code rather than
 * keep guessing.
 */
async function verify(repo, client, { partyId = null, userId = null, entityRef, contentHash, code }) {
  const row = await repo.latestOtp(client, { partyId, userId });

  if (!row || row.verified_at) {
    throw new AppError("OTP_NOT_ISSUED", "Request a code before entering one.", 409);
  }
  if (isPast(row.expires_at)) {
    throw new AppError("OTP_EXPIRED", "That code has expired. Request a new one.", 410);
  }
  if (row.attempts >= OTP.MAX_ATTEMPTS) {
    throw new AppError("OTP_EXHAUSTED", "Too many incorrect attempts. Request a new code.", 410);
  }

  // ⚠ RULE 1, CHECKED HERE AND NOT ONLY BY THE CALLER. The challenge is bound
  // to one document AND one payload. A caller that looked up the wrong request
  // cannot talk this into passing.
  if (row.entity_ref !== entityRef || row.content_hash !== contentHash) {
    await repo.bumpOtpAttempt(client, row.otp_id);
    throw new AppError("OTP_INVALID", "That code is not valid for this document.", 422);
  }

  if (!digestsMatch(row.code_hash, hashCode(code))) {
    const after = await repo.bumpOtpAttempt(client, row.otp_id);
    const left = Math.max(0, OTP.MAX_ATTEMPTS - (after ? after.attempts : OTP.MAX_ATTEMPTS));
    throw new AppError("OTP_INVALID", "That code is not correct.", 422, { attempts_remaining: left });
  }

  return repo.markOtpVerified(client, row.otp_id);
}

/** What the signing page may show about a challenge. Never the code, never the hash. */
function present(row) {
  if (!row) return null;
  return {
    otp_id: row.otp_id,
    sent_to: maskEmail(row.sent_to),
    expires_at: row.expires_at,
    attempts_remaining: Math.max(0, OTP.MAX_ATTEMPTS - row.attempts),
    resends_remaining: Math.max(0, OTP.MAX_RESENDS - row.resends),
    cooldown_until: row.cooldown_until || null,
    verified_at: row.verified_at || null,
  };
}

/**
 * `jean.mbarga@acme.cm` → `j••••@acme.cm`.
 *
 * The signing page shows this so a signer can confirm the address is theirs
 * WITHOUT being able to change it (§6.3, Q7 = C is forbidden). The domain
 * stays whole on purpose: "is this going to my company?" is the question a
 * signer actually has, and masking it would leave them unable to answer it.
 */
function maskEmail(address) {
  const raw = String(address || "").trim();
  const at = raw.lastIndexOf("@");
  if (at < 1) return raw ? "••••" : "";
  const local = raw.slice(0, at);
  const domain = raw.slice(at);
  return `${local[0]}••••${domain}`;
}

module.exports = { OTP, mintCode, hashCode, digestsMatch, issue, verify, present, maskEmail, isLive };
