"use strict";

/**
 * The signing OTP — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.4, and §6.9
 * criteria 4, 5 and 6.
 *
 * The three assertions that matter most are negative, and each one is a
 * control that reads present in review while doing nothing at runtime if it
 * regresses:
 *
 *   · a code issued for one document must not verify against another
 *     (the content_hash binding);
 *   · a sixth wrong attempt must not be a sixth chance;
 *   · a fourth resend must not reset the attempt counter, because an attempt
 *     limit with unlimited resends is not a limit.
 */

const otp = require("../../src/services/signatures/otp");

/** An in-memory stand-in for the three repo functions the service uses. */
function makeRepo(initial = null) {
  const state = { row: initial };
  return {
    state,
    latestOtp: async () => state.row,
    insertOtp: async (_c, data) => {
      state.row = {
        otp_id: "otp-1", attempts: 0, resends: 0, cooldown_until: null, verified_at: null, ...data,
      };
      return state.row;
    },
    bumpOtpAttempt: async () => {
      state.row.attempts = Math.min(state.row.attempts + 1, otp.OTP.MAX_ATTEMPTS);
      return state.row;
    },
    resendOtp: async (_c, { otpId, codeHash, expiresAt }) => {
      state.row.code_hash = codeHash;
      state.row.expires_at = expiresAt;
      state.row.resends = Math.min(state.row.resends + 1, otp.OTP.MAX_RESENDS);
      return state.row;
    },
    setOtpCooldown: async (_c, _id, until) => {
      state.row.cooldown_until = until;
      return state.row;
    },
    markOtpVerified: async () => {
      state.row.verified_at = new Date();
      return state.row;
    },
  };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const subject = { partyId: "party-1", entityRef: "final_invoice:abc", contentHash: HASH_A, sentTo: "j@acme.cm" };

const codeOf = async (p) => {
  try { await p; return null; } catch (e) { return e.code || e.message; }
};

describe("§6.4 — the code itself", () => {
  test("six digits, zero-padded", () => {
    for (let i = 0; i < 500; i += 1) expect(otp.mintCode()).toMatch(/^[0-9]{6}$/);
  });

  test("uniform, not `randomBytes % 1000000`", () => {
    // 2^32 is not a multiple of 10^6, so a modulo makes the first 967,296
    // codes measurably likelier. Rejection sampling is what removes that, and
    // the property it buys is an even spread across the space.
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i += 1) buckets[Number(otp.mintCode()[0])] += 1;
    for (const n of buckets) expect(n).toBeGreaterThan(1400);
  });

  test("compared in constant time, and a length mismatch is false not a throw", () => {
    expect(otp.digestsMatch(otp.hashCode("123456"), otp.hashCode("123456"))).toBe(true);
    expect(otp.digestsMatch(otp.hashCode("123456"), otp.hashCode("654321"))).toBe(false);
    // timingSafeEqual THROWS on differing lengths; a control that crashes is a
    // louder oracle than one that returns the wrong answer.
    expect(otp.digestsMatch("short", otp.hashCode("123456"))).toBe(false);
    expect(otp.digestsMatch("", "")).toBe(false);
  });

  test("the address is masked with its domain intact", () => {
    // "is this going to my company?" is the question a signer actually has, so
    // masking the domain would leave them unable to answer it (§6.3).
    expect(otp.maskEmail("jean.mbarga@acme.cm")).toBe("j••••@acme.cm");
    expect(otp.maskEmail("@acme.cm")).toBe("••••");
  });
});

describe("§6.9 criterion 4 — a code verifies ONE payload", () => {
  test("a code issued for one document does not verify against another", async () => {
    const repo = makeRepo();
    const { code } = await otp.issue(repo, {}, subject);

    // Same party, same code, DIFFERENT document. Without the content_hash
    // binding this succeeds, and a code emailed for a 1.6M invoice completes a
    // 12M one inside the same window.
    expect(await codeOf(otp.verify(repo, {}, {
      partyId: "party-1", entityRef: "final_invoice:abc", contentHash: HASH_B, code,
    }))).toBe("OTP_INVALID");
  });

  test("a wrong entity_ref is refused for the same reason", async () => {
    const repo = makeRepo();
    const { code } = await otp.issue(repo, {}, subject);
    expect(await codeOf(otp.verify(repo, {}, {
      partyId: "party-1", entityRef: "final_invoice:other", contentHash: HASH_A, code,
    }))).toBe("OTP_INVALID");
  });

  test("a mismatched binding still COSTS an attempt", async () => {
    // Otherwise the binding check is a free oracle: guess codes against a
    // deliberately wrong hash and never burn the counter.
    const repo = makeRepo();
    const { code } = await otp.issue(repo, {}, subject);
    await codeOf(otp.verify(repo, {}, { partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_B, code }));
    expect(repo.state.row.attempts).toBe(1);
  });

  test("the right code against the right binding verifies", async () => {
    const repo = makeRepo();
    const { code } = await otp.issue(repo, {}, subject);
    const row = await otp.verify(repo, {}, {
      partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code,
    });
    expect(row.verified_at).toBeTruthy();
  });
});

describe("§6.9 criterion 5 — five attempts, and the sixth is not a sixth chance", () => {
  test("the sixth wrong attempt is refused as exhausted, not as wrong", async () => {
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    const wrong = { partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code: "000000" };

    for (let i = 0; i < otp.OTP.MAX_ATTEMPTS; i += 1) {
      expect(await codeOf(otp.verify(repo, {}, wrong))).toBe("OTP_INVALID");
    }
    // The distinction matters: OTP_INVALID means "try again", OTP_EXHAUSTED
    // means "ask for a new code". A signer who cannot proceed needs to be told
    // which.
    expect(await codeOf(otp.verify(repo, {}, wrong))).toBe("OTP_EXHAUSTED");
  });

  test("even the CORRECT code fails once the attempts are spent", async () => {
    const repo = makeRepo();
    const { code } = await otp.issue(repo, {}, subject);
    const wrong = { partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code: "000000" };
    for (let i = 0; i < otp.OTP.MAX_ATTEMPTS; i += 1) await codeOf(otp.verify(repo, {}, wrong));
    expect(await codeOf(otp.verify(repo, {}, {
      partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code,
    }))).toBe("OTP_EXHAUSTED");
  });

  test("an expired challenge says so rather than counting an attempt", async () => {
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    repo.state.row.expires_at = new Date(Date.now() - 1000);
    expect(await codeOf(otp.verify(repo, {}, {
      partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code: "000000",
    }))).toBe("OTP_EXPIRED");
    expect(repo.state.row.attempts).toBe(0);
  });
});

describe("§6.9 criterion 6 — three resends, then a cooldown", () => {
  test("a resend REUSES the row, so it cannot reset the attempt counter", async () => {
    // This is the whole point. Minting a fresh challenge on every resend would
    // reset `attempts` with it, and an attempt limit with unlimited resends is
    // not a limit at all: burn five guesses, resend, burn five more.
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    await otp.verify(repo, {}, { partyId: "party-1", entityRef: subject.entityRef, contentHash: HASH_A, code: "000000" })
      .catch(() => {});
    expect(repo.state.row.attempts).toBe(1);

    const again = await otp.issue(repo, {}, subject);
    expect(again.resent).toBe(true);
    expect(repo.state.row.otp_id).toBe("otp-1");
    expect(repo.state.row.attempts).toBe(1);
  });

  test("the fourth resend returns a cooldown, with the time it lifts", async () => {
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    for (let i = 0; i < otp.OTP.MAX_RESENDS; i += 1) await otp.issue(repo, {}, subject);
    expect(repo.state.row.resends).toBe(otp.OTP.MAX_RESENDS);

    let thrown = null;
    try { await otp.issue(repo, {}, subject); } catch (e) { thrown = e; }
    expect(thrown.code).toBe("OTP_COOLDOWN");
    expect(thrown.status).toBe(429);
    // The caller needs the time to show the signer, or the message is "wait,
    // unspecified", which is what makes people keep pressing the button.
    expect(thrown.details.cooldown_until).toBeTruthy();
  });

  test("a challenge in cooldown refuses a fresh issue too", async () => {
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    repo.state.row.cooldown_until = new Date(Date.now() + 60_000);
    expect(await codeOf(otp.issue(repo, {}, subject))).toBe("OTP_COOLDOWN");
  });
});

describe("the subject rules", () => {
  test("exactly one of party or user — never both, never neither", async () => {
    const repo = makeRepo();
    expect(await codeOf(otp.issue(repo, {}, { ...subject, userId: "u1" }))).toBe("BAD_OTP_SUBJECT");
    expect(await codeOf(otp.issue(repo, {}, { ...subject, partyId: null }))).toBe("BAD_OTP_SUBJECT");
  });

  test("the payload binding is required at issue time, not discovered at verify", async () => {
    const repo = makeRepo();
    expect(await codeOf(otp.issue(repo, {}, { ...subject, contentHash: null }))).toBe("NO_CONTENT_HASH");
  });

  test("verifying before a code was ever issued says so", async () => {
    expect(await codeOf(otp.verify(makeRepo(null), {}, {
      partyId: "p", entityRef: "x", contentHash: HASH_A, code: "123456",
    }))).toBe("OTP_NOT_ISSUED");
  });
});

describe("what the signing page may see", () => {
  test("never the code, never the hash", async () => {
    const repo = makeRepo();
    await otp.issue(repo, {}, subject);
    const shown = otp.present(repo.state.row);
    expect(JSON.stringify(shown)).not.toContain(repo.state.row.code_hash);
    expect(shown.sent_to).toBe("j••••@acme.cm");
    expect(shown.attempts_remaining).toBe(otp.OTP.MAX_ATTEMPTS);
    expect(shown.resends_remaining).toBe(otp.OTP.MAX_RESENDS);
  });
});
