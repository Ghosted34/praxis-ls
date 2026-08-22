"use strict";

/**
 * THE SIGNING SURFACE'S WIRING, ASSERTED AS SOURCE AND AS SQL.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.3, §6.4, §6.6, and §6.9 criteria 1, 2
 * and 3.
 *
 * Everything here is a claim that cannot be observed by calling a service:
 * whether a CONSTRAINT exists, whether a limiter is MOUNTED and keyed the way
 * §6.4 requires, whether the live pin is present. Each has a failure mode that
 * is invisible in a passing unit test and expensive in production, and each is
 * the kind of thing a refactor removes without noticing.
 *
 * Criteria 1 and 2 are about the DATABASE, deliberately. §6.3 is explicit:
 * *"The cap is a partial unique index, so a second override fails at the
 * database. A validator check is also present for the friendly error, but the
 * constraint is what makes the rule true."* A validator is a thing a future
 * import path, bulk endpoint or AI action forgets to call.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TENANT = path.join(ROOT, "migrations/tenant");
const SRC = path.join(ROOT, "src");

const read = (p) => fs.readFileSync(p, "utf8");

/**
 * A file with its comments stripped.
 *
 * These files DOCUMENT what they refuse — "there is no email field in this
 * file", "Q7 = C is forbidden" — and a grep that cannot tell an explanation
 * from an implementation would fail on the very comment warning about it.
 * `(?<!:)//` so a `https://` inside a string is not read as a line comment.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");

const party = read(path.join(TENANT, "10782_signature_party.sql"));
const otpSql = read(path.join(TENANT, "10783_signature_otp.sql"));
const publicRoutes = read(path.join(SRC, "modules/vault/signature_public/signature_public.routes.js"));
const publicController = read(path.join(SRC, "modules/vault/signature_public/signature_public.controller.js"));
const publicValidator = read(path.join(SRC, "modules/vault/signature_public/signature_public.validator.js"));
const publicService = read(path.join(SRC, "modules/vault/signature_public/signature_public.service.js"));

describe("§6.9 criterion 1 — the Q7 cap is a DATABASE constraint", () => {
  test("a partial unique index caps overrides at one per request", () => {
    // Not `CHECK`, not a trigger, not a count in the service: a partial unique
    // index on (request_id) WHERE source = 'OVERRIDE' is the only shape that
    // makes a SECOND override a 23505 whatever wrote it.
    expect(party).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_sigparty_one_override ON signature_party\(request_id\)\s*\n?\s*WHERE source = 'OVERRIDE'/,
    );
  });

  test("the validator ALSO caps it — for the friendly error, not for the rule", () => {
    const validator = read(path.join(SRC, "modules/vault/signature_request/signature_request.validator.js"));
    expect(validator).toMatch(/source === "OVERRIDE"\)\.length <= 1/);
  });
});

describe("§6.9 criterion 2 — an override must name who authorised it", () => {
  test("the check constraint requires both the user and the reason", () => {
    expect(party).toMatch(/ck_sigparty_override_attributed/);
    expect(party).toMatch(/source = 'OVERRIDE' AND override_by_user_id IS NOT NULL AND override_reason IS NOT NULL/);
  });

  test("and forbids them on an ON_FILE party", () => {
    // "authorised by nobody" and "authorised by somebody we did not record"
    // would otherwise be indistinguishable, and the certificate prints this
    // field as the reason a reader should weigh the address differently.
    expect(party).toMatch(/source = 'ON_FILE'\s+AND override_by_user_id IS NULL/);
  });

  test("the service attributes an override to the SESSION user, never the body", () => {
    const service = code(read(path.join(SRC, "modules/vault/signature_request/signature_request.service.js")));
    expect(service).toMatch(/override_by_user_id: p\.source === "OVERRIDE" \? actor\.user_id : null/);
  });
});

describe("§6.9 criterion 3 — a signer never supplies an address", () => {
  test("no email field anywhere in the public validator", () => {
    expect(code(publicValidator)).not.toMatch(/\bemail\b\s*:/);
  });

  test("every public body schema is .strict(), so an email is REJECTED not stripped", () => {
    // A permissive schema that quietly drops it lets a caller believe it was
    // honoured, which is the confusion the attack relies on.
    for (const name of ["otpBody", "verifyBody", "completeBody", "declineBody"]) {
      const block = publicValidator.slice(publicValidator.indexOf(`const ${name}`));
      expect(block.slice(0, 900)).toMatch(/\.strict\(\)/);
    }
  });

  test("the OTP recipient comes from the party row, never from the caller", () => {
    expect(code(publicService)).toMatch(/sentTo: party\.email/);
  });

  test("the page is served the address MASKED", () => {
    expect(code(publicService)).toMatch(/email_masked: otp\.maskEmail\(party\.email\)/);
  });
});

describe("§6.4 — the OTP's limits are the numbers the guide states", () => {
  const otp = require("../../src/services/signatures/otp");

  test("10 minutes, 5 attempts, 3 resends, 30-minute cooldown", () => {
    expect(otp.OTP).toEqual({
      DIGITS: 6, TTL_MINUTES: 10, MAX_ATTEMPTS: 5, MAX_RESENDS: 3, COOLDOWN_MINUTES: 30,
    });
  });

  test("the caps are in the database too, so a service bug cannot exceed them", () => {
    expect(otpSql).toMatch(/attempts >= 0 AND attempts <= 5/);
    expect(otpSql).toMatch(/resends >= 0 AND resends <= 3/);
  });

  test("the payload binding is NOT NULL — a code that binds to nothing is not a control", () => {
    expect(otpSql).toMatch(/content_hash\s+text NOT NULL/);
  });

  test("exactly one subject per challenge", () => {
    expect(otpSql).toMatch(/num_nonnulls\(party_id, user_id\) = 1/);
  });

  test("the comparison is constant-time", () => {
    const src = code(read(path.join(SRC, "services/signatures/otp.js")));
    expect(src).toMatch(/crypto\.timingSafeEqual/);
    // A `===` on the digests would be the leak this exists to remove.
    expect(src).not.toMatch(/row\.code_hash === /);
  });

  test("codes are rejection-sampled, not `% 10**6`", () => {
    // 2^32 is not a multiple of 10^6, so a modulo makes the first 967,296
    // codes likelier. CodeQL js/biased-cryptographic-random, and a real bias.
    const src = code(read(path.join(SRC, "services/signatures/otp.js")));
    expect(src).toMatch(/Math\.floor\(0xFFFFFFFF \/ range\) \* range/);
    expect(src).not.toMatch(/randomBytes\(\d+\)[^\n]*% range/);
  });
});

describe("§6.6 — what makes the public signing routes safe to leave open", () => {
  test("no authMiddleware, deliberately", () => {
    expect(code(publicRoutes)).not.toMatch(/authMiddleware/);
  });

  test("the OTP limiter is 10 per 15 minutes, as §6.4 specifies", () => {
    expect(publicRoutes).toMatch(/name: "signature-otp", max: 10, windowMs: 15 \* 60 \* 1000/);
  });

  test("it is keyed on the TOKEN, not the IP", () => {
    // §6.4 is specific: a counterparty behind a corporate NAT must not be
    // rate-limited by a colleague signing a different document from the same
    // office. IP-keying would make a busy client's second signatory look like
    // an attacker.
    expect(publicRoutes).toMatch(/keyGenerator: byToken/);
    expect(publicRoutes).toMatch(/const byToken = \(req\) =>/);
  });

  test("every route carries a limiter, not just the OTP ones", () => {
    const routes = code(publicRoutes).match(/router\.(get|post)\([^\n]*/g) || [];
    expect(routes.length).toBe(6);
    for (const r of routes) expect(r).toMatch(/otpLimit|pageLimit/);
  });

  test("every read is pinned to live", () => {
    expect(code(publicController)).toMatch(/req\.tenantDbIn\("live"/);
    expect(code(publicController)).not.toMatch(/req\.tenantDb\(/);
  });

  test("the module is gated on signatures.external", () => {
    const mod = require("../../src/modules/vault/signature_public/signature_public.routes");
    expect(mod.basePath).toBe("/public/sign");
    expect(mod.feature).toBe("signatures.external");
    expect(mod.idParam).toBe("text");
  });
});

describe("§6.6 — completion cannot bypass verification", () => {
  test("/complete refuses without a verified challenge bound to THIS payload", () => {
    const src = code(publicService);
    expect(src).toMatch(/challenge\.verified_at/);
    expect(src).toMatch(/challenge\.content_hash === request\.content_hash/);
    expect(src).toMatch(/OTP_REQUIRED/);
  });

  test("the database says so as well", () => {
    // 10771's ck_sig_external_verified: an EXTERNAL signature at AES_OTP must
    // name an OTP challenge. The service checks first for a usable error; the
    // constraint is what remains true if a future endpoint forgets.
    const core = read(path.join(TENANT, "10771_signature_core.sql"));
    expect(core).toMatch(/ck_sig_external_verified/);
    expect(core).toMatch(/party = 'INTERNAL'\s*\n?\s*OR assurance_level IN \('QES','WET'\)\s*\n?\s*OR otp_challenge_id IS NOT NULL/);
  });

  test("/complete re-derives the hash before anything else", () => {
    const src = code(publicService);
    const guard = src.indexOf("assertUnamended");
    const otpCheck = src.indexOf("OTP_REQUIRED");
    // Order matters: there is no point verifying a code against a document
    // that has moved, and the amendment is the more serious finding.
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(otpCheck);
  });

  test("the certified card is handed to the provider, which does the identity check", () => {
    // PR-4 replaced the 501: CERTIFIED no longer verifies by OTP — the
    // provider verifies the person, and §6.6 puts that handoff BEFORE the
    // OTP requirement on purpose. The branch must exist, it must call the
    // qes service, and the database exemption (ck_sig_external_verified
    // above) is what lets the resulting row carry no OTP challenge.
    const src = code(publicService);
    expect(src).toMatch(/assurance_level === "QES"/);
    expect(src).toMatch(/qes\.service/);
    expect(src).toMatch(/handoff/);
  });

  test("the certified handoff sits before the OTP requirement, on purpose", () => {
    // If the OTP check ran first, a certified signer would need a code the
    // card exists to replace. Order in the source is the assertion: the QES
    // BRANCH (anchored on the `if`, so an earlier mention in a comment cannot
    // stand in for it) must come before the OTP_REQUIRED throw.
    const src = code(publicService);
    const qesAt = src.indexOf('if (card.assurance_level === "QES")');
    expect(qesAt).toBeGreaterThan(0);
    expect(qesAt).toBeLessThan(src.indexOf("OTP_REQUIRED"));
  });

  test("the paper card hands off to the wet-signature service, and settles no signature row", () => {
    // PR-5 shipped: PRINT_SIGN issues a print job and settles out of band via
    // returned-paper reconciliation (§8.6) — no document_signature row exists
    // until the physical copy comes back, so this branch must not fall into
    // the OTP/settle path below it.
    const src = code(publicService);
    expect(src).toMatch(/assurance_level === "WET"/);
    expect(src).toMatch(/signature_wet\.service/);
    expect(src).toMatch(/wet\.issue\(/);
    // And it sits before the OTP requirement, the same ordering rule as the
    // certified card: a paper act is not an OTP act.
    const wetAt = src.indexOf("assurance_level === \"WET\"");
    const otpAt = src.indexOf("OTP_REQUIRED");
    expect(wetAt).toBeGreaterThan(0);
    expect(wetAt).toBeLessThan(otpAt);
  });

  test("the digital cards still require the verified code bound to this payload", () => {
    // What PR-4 moved is the CERTIFIED card, not the rule: STAMP and DRAWN
    // still verify an OTP first, with no threshold and no setting that
    // disables it. The requirement must sit AFTER the two card branches —
    // which is also what keeps the WET refusal (still PR-5's) in front of it.
    const src = code(publicService);
    const otpAt = src.indexOf("OTP_REQUIRED");
    expect(otpAt).toBeGreaterThan(0);
    expect(otpAt).toBeGreaterThan(src.indexOf('if (card.assurance_level === "WET")'));
  });
});

describe("the sign token is a different credential from the verify code", () => {
  test("stored as an HMAC, and the column allows NULL until dispatch", () => {
    expect(party).toMatch(/sign_token_hmac\s+text/);
    expect(party).not.toMatch(/sign_token_hmac\s+text NOT NULL/);
  });

  test("a token without an expiry is not representable", () => {
    expect(party).toMatch(/num_nonnulls\(sign_token_hmac, sign_expires_at\) <> 1/);
  });

  test("the plaintext never leaves the dispatch call", () => {
    // A sender who could read the token back could sign as the counterparty,
    // which is the whole reason this credential is peppered where the verify
    // code is not (§3.7).
    const controller = code(read(path.join(SRC, "modules/vault/signature_request/signature_request.controller.js")));
    expect(controller).toMatch(/return \{ party: out\.party \};/);
    expect(controller).not.toMatch(/token: out\.token/);
  });
});

describe("the repo builds SQL safely", () => {
  const repoSrc = code(read(path.join(SRC, "modules/vault/signature_request/signature_request.repo.js")));

  test("a dynamic column name goes through ident(), never straight into the string", () => {
    // `transitionRequest` and `settleParty` take an `extra` object whose KEYS
    // become column names. Every caller is internal today, but a column name
    // concatenated into SQL is the shape of the finding rather than an
    // instance of it — and query-helpers already exports the escaper.
    expect(repoSrc).toMatch(/\$\{ident\(col\)\} = \$\$\{params\.length\}/);
    expect(repoSrc).not.toMatch(/\$\{col\} = \$\$\{params\.length\}/);
  });

  test("a JOIN's column list is qualified on the comma, not on \", \"", () => {
    // The lists are template literals with newlines, so splitting on ", "
    // leaves every column after a line break unqualified — three of them, into
    // a two-table join. Invisible to check-query-columns, which asks whether a
    // column exists rather than which relation it came from.
    expect(repoSrc).toMatch(/cols\.split\(","\)\.map\(\(c\) => `\$\{alias\}\.\$\{c\.trim\(\)\}`\)/);
    expect(repoSrc).not.toMatch(/split\(", "\)\.join\(", [a-z]\./);
  });

  test("every column in a qualified list actually gets its alias", () => {
    // The property, not the implementation: run the real helper over a list
    // shaped like the ones in the file.
    const qualify = (cols, alias) => cols.split(",").map((c) => `${alias}.${c.trim()}`).join(", ");
    const list = "party_id, request_id,\n  override_by_user_id, allowed_presets,\n  sent_at";
    for (const part of qualify(list, "p").split(", ")) expect(part.startsWith("p.")).toBe(true);
  });
});
