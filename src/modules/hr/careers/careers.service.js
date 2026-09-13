/**
 * The public careers surface.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM EVERY OTHER MODULE ──────────────────────
 *
 * Nobody is authenticated here. There is no `req.user`, no permission scope, no
 * grant to check — the tenant is resolved from the HOST (a subdomain is a
 * tenant, see host-tenent-resolver), and after that anyone on the internet is
 * the caller. Every design decision below follows from that one fact:
 *
 *   * A VACANCY IS ONLY REACHABLE BY ITS TOKEN. Not by vacancy_id — ids appear
 *     in admin URLs, exports and logs, so accepting one here would quietly turn
 *     every internal identifier into a public credential. The token is 32 bytes
 *     of CSPRNG minted at publish time and is the only key this surface knows.
 *
 *   * THE RESPONSE IS AN ALLOW-LIST, NEVER A ROW. `SELECT *` on `vacancy` would
 *     today ship `scope_id` and `ai_generated` to the public and TOMORROW would
 *     ship whatever column somebody adds next, with nobody noticing. The repo's
 *     published* queries name their columns for exactly this reason, and
 *     `publicVacancy` below narrows them again on the way out.
 *
 *   * AN APPLICATION IS WRITE-ONLY. Applying returns an acknowledgement and an
 *     opaque reference, never the created row — a candidate must not be able to
 *     read back their own AI score, and an endpoint that echoes its insert is
 *     how that happens by accident.
 *
 *   * NOTHING SAYS WHY IT SAID NO. A closed vacancy, an unpublished one and a
 *     token that never existed all return the same 404. Distinguishing them
 *     would let anyone enumerate which roles exist and when they close.
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../../utils/errors");
const vacancyRepo = require("../vacancy/vacancy.repo");
const vacancyService = require("../vacancy/vacancy.service");
const vacancyEvents = require("../vacancy/vacancy.events");
const repo = require("./careers.repo");
const vault = require("../../vault/document_vault/document_vault.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

/** A CV is a document, not a media library. */
const CV_MAX_BYTES = 8 * 1024 * 1024;
const CV_TYPES = ["application/pdf", "image/png", "image/jpeg"];

/**
 * The public shape of a vacancy.
 *
 * Explicitly constructed rather than deleted-from: a denylist has to be updated
 * every time the table grows and fails OPEN when somebody forgets, which on an
 * unauthenticated endpoint means a column leaks to the internet. This fails
 * closed — a new column is invisible here until somebody adds it deliberately.
 */
function publicVacancy(v) {
  return {
    token: v.public_token,
    title: v.title,
    department: v.department,
    // The written line if there is one, otherwise the structured parts — so a
    // recruiter who filled in city/state/country is not asked to type the
    // address a second time for the sake of a display string (0684).
    location:
      v.location ||
      [v.location_city, v.location_state, v.location_country].filter(Boolean).join(", ") ||
      null,
    location_city: v.location_city,
    location_state: v.location_state,
    location_country: v.location_country,
    work_mode: v.work_mode,
    working_hours: v.working_hours,
    days_on_site: v.days_on_site,
    days_off_site: v.days_off_site,
    days_off: v.days_off,
    probation_months: v.probation_months,
    target_start_date: v.target_start_date,
    employment_type: v.employment_type,
    description: v.description,
    experience_years_min: v.experience_years_min,
    skills_required: v.skills_required || [],
    // A hidden band is OMITTED, not nulled-in-place and not merely unrendered by
    // the storefront: the row keeps the numbers for payroll and for scoring a
    // candidate's expectation, and this JSON is what the internet sees. A flag
    // the payload ignored would read as a promise (0684).
    ...(v.salary_hidden
      ? { salary_hidden: true }
      : {
          salary_min: v.salary_min,
          salary_max: v.salary_max,
          salary_currency: v.salary_currency,
        }),
    // What the form must insist on, so the page can mark the fields required
    // before the candidate spends ten minutes writing.
    apply_config: v.apply_config || {},
    closes_on: v.closes_on,
    published_at: v.published_at,
  };
}

/** Every role currently open to the public, for the careers index. */
async function list(client) {
  const rows = await vacancyRepo.publishedList(client);
  return rows.map(publicVacancy);
}

/**
 * Find which environment a careers token belongs to, and return it with the row.
 *
 * ── WHY A PUBLIC PAGE LOOKS IN TWO SCHEMAS ─────────────────────────────────
 *
 * A candidate has no session and sends no `X-Praxis-Env`, so tenant-context
 * resolves them to LIVE. That made whether a careers link worked depend on a
 * value in the VIEWER's localStorage: it opened for the recruiter who had just
 * been in Test, and 404'd for the candidate they sent it to. A public URL must
 * mean the same thing to everyone who holds it.
 *
 * So the token — which is minted per vacancy and is the only way in — decides.
 * LIVE is tried first, so a live role can never be shadowed by a rehearsal, and
 * the environment travels with the answer: the page badges a sandbox role as
 * TEST, and an application lands in the schema the role lives in rather than
 * somewhere the recruiter would never look for it.
 *
 * The INDEX (`list`) stays live-only on purpose. It is the shop window, and a
 * rehearsal posting has no business in it — nobody is given a link to a test
 * role by accident, but everybody sees the index.
 */
async function findByToken(req, token) {
  const live = await req.tenantDbIn("live", (c) => vacancyRepo.publishedByToken(c, token));
  if (live) return { env: "live", row: live };
  // Only when the tenant actually has one; a live-only workspace should not pay
  // for a second lookup on every miss.
  if (!req.tenant || !req.tenant.sandbox_schema) return null;
  const sandbox = await req.tenantDbIn("sandbox", (c) => vacancyRepo.publishedByToken(c, token));
  return sandbox ? { env: "sandbox", row: sandbox } : null;
}

/** One role by token. 404 for closed, unpublished and non-existent alike. */
async function get(req, token) {
  const found = await findByToken(req, token);
  if (!found) throw new AppError("NOT_FOUND", "This role is no longer accepting applications", 404);
  return { ...publicVacancy(found.row), environment: found.env };
}

/**
 * Receive an application.
 *
 * The CV upload is best-effort AND separate from the applicant insert, in that
 * order, deliberately: a candidate who has typed out a covering letter and
 * attached a file must not lose the application because object storage had a
 * bad moment. A failed upload is logged, the application is still recorded, and
 * the recruiter sees an applicant with no CV attached — which is recoverable.
 * The alternative loses the candidate entirely, and they do not come back.
 */
async function applyToToken(req, { token, data, slug }) {
  const found = await findByToken(req, token);
  if (!found) throw new AppError("NOT_FOUND", "This role is no longer accepting applications", 404);
  // Written where the role lives. An application to a Test posting that landed
  // in live would be a candidate nobody is expecting, in a pipeline nobody is
  // working — and the recruiter rehearsing in Test would see nothing at all.
  return req.tenantDbIn(found.env, (c) => apply(c, { vacancy: found.row, data, slug }));
}

async function apply(client, { vacancy, data, slug }) {

  // What the recruiter marked as required (0684). Enforced HERE and not only in
  // the page's own markup, because the endpoint is public: a toggle a curl can
  // walk past is a lie told to whoever set it. Named fields, so the storefront
  // can mark the box rather than showing a bare 422.
  const requires = vacancy.apply_config || {};
  const missing = {};
  if (requires.require_cover_letter && !String(data.cover_note || "").trim())
    missing.cover_note = ["This role asks every applicant for a covering note."];
  if (requires.require_portfolio && !String(data.portfolio_url || "").trim())
    missing.portfolio_url = ["This role asks every applicant for a portfolio link."];
  if (Object.keys(missing).length)
    throw new AppError("INCOMPLETE_APPLICATION", "Some answers are still needed", 422, missing);

  let cvVaultId = null;
  if (data.cv_data_url) {
    try {
      const doc = await vault.createDocument(client, {
        dataUrl: data.cv_data_url,
        docType: "CV",
        entityRef: `vacancy:${vacancy.vacancy_id}`,
        originalName: data.cv_filename || null,
        maxBytes: CV_MAX_BYTES,
        allowedTypes: CV_TYPES,
        // Sniffed, not trusted. This is the one upload path on the product that
        // an unauthenticated stranger can reach, so a .exe declaring itself a
        // PDF is refused on its bytes rather than on its label.
        sniff: true,
        slug,
        actor: {},
      });
      cvVaultId = doc.doc_id;
    } catch (err) {
      // A rejected file is the CANDIDATE's problem to fix and they must be told
      // — silently dropping a 20 MB CV and confirming the application leaves
      // them believing a recruiter has a file nobody received. A storage
      // failure is OURS, and the application is kept.
      // `status`, not `httpStatus` — AppError has never had the latter, so this
      // read `undefined < 500`, which is false, and EVERY rejected file was
      // swallowed as though it were our storage failing. The candidate was told
      // "we couldn't attach your CV, email it to us" when the truth was "that
      // file is 20 MB" or "that isn't a PDF" — the one thing they could have
      // fixed in ten seconds, and exactly what the comment above says must
      // reach them.
      if (err instanceof AppError && err.status < 500) throw err;
      logger.error({ err, vacancyId: vacancy.vacancy_id }, "[careers] CV upload failed — recording the application without it");
    }
  }

  const applicant = await vacancyService.addApplicant(client, {
    vacancyId: vacancy.vacancy_id,
    data: {
      full_name: data.full_name,
      email: data.email,
      phone: data.phone,
      address: data.address,
      skills: data.skills || [],
      experience_years: data.experience_years,
      expected_salary: data.expected_salary,
      portfolio_url: data.portfolio_url,
      cover_note: data.cover_note,
      cv_vault_id: cvVaultId,
      source: "careers",
    },
    // No user to attribute it to. The audit trail records an application that
    // arrived from the public page, which is the truth.
    actor: { user_id: null },
  });

  /*
   * WHAT COMES BACK, AND WHAT DOES NOT.
   *
   * A reference the candidate can quote and nothing else. Not the applicant
   * row: it now carries `ai_score`, `ai_breakdown` and `ai_summary`, all
   * written by the provisional scorer during `addApplicant` — echoing the
   * insert would hand every applicant the machine's opinion of them, on the
   * public internet, seconds after they applied.
   *
   * The reference is a truncated id: enough to match a support query against a
   * row, not enough to address one.
   */
  return {
    received: true,
    reference: String(applicant.applicant_id).slice(0, 8).toUpperCase(),
    cv_attached: !!cvVaultId,
  };
}

/* ── The page when nothing is open (13792) ─────────────────────────────────*/

/**
 * What the careers page is allowed to offer, as the public may see it.
 *
 * Two booleans and a tag — never the row. `updated_by` is a `app_user` id and
 * `updated_at` is when a member of staff last touched the settings; neither is
 * any of a visitor's business, and this surface's whole discipline is that a
 * response is an allow-list rather than a row (see the header).
 *
 * Live-only, and it never throws. This is read on the FIRST paint of a public
 * page, so a tenant restored from a partial backup, or one whose `website`
 * package is off, must get "nothing on offer" rather than an error — the page
 * then renders the not-hiring band with a contact link, which is exactly the
 * state the defaults describe.
 */
async function publicSettings(req) {
  const row = await req
    .tenantDbIn("live", (c) => repo.getSettings(c))
    .catch((err) => {
      logger.warn({ err }, "[careers] settings read failed — falling back to closed");
      return null;
    });
  return {
    open_applications: !!(row && row.open_applications),
    alerts_enabled: !!(row && row.alerts_enabled),
    culture_tag: (row && row.culture_tag) || null,
  };
}

/**
 * Receive an application with no role attached.
 *
 * ── WHERE IT LANDS, AND WHY THAT IS NOT A NEW PLACE ───────────────────────
 *
 * `job_applicant`, with `vacancy_id` NULL and `status` TALENT_POOL. Both were
 * already legal in 0360, and 0525's `searchPool` — the Past applicants panel —
 * is a LEFT JOIN over `status IN ('TALENT_POOL','REJECTED')`, so this candidate
 * appears in a screen a recruiter already opens, and 0703's `considerForVacancy`
 * can already put them in front of a real role with the provenance stamped.
 *
 * NOT the `talent_pool` table, which is the HAND-ENTERED bench (0703's words).
 * A public endpoint writing into a curated shortlist is the "can it be used to
 * fill the database?" question this module's routes file opens with, answered
 * the wrong way.
 *
 * ── WHY THERE IS NO SCORE ─────────────────────────────────────────────────
 *
 * `scoring.estimate` reads a vacancy's criteria, and there is no vacancy. A
 * number derived from nothing, sitting in the same column as one derived from a
 * role's requirements, would make `ai_score` mean two different things
 * depending on how the candidate happened to arrive — which is the exact defect
 * `addApplicant`'s own comment says the CV path was written to avoid. It stays
 * NULL until somebody is considered for a real role, which scores them properly.
 *
 * ── WHY LIVE-ONLY ─────────────────────────────────────────────────────────
 *
 * `applyToToken` can choose a schema because the token tells it which one the
 * role lives in. There is no token here, so there is nothing to choose with —
 * the same reason the index is live-only. A rehearsal workspace does not
 * receive real people's CVs.
 */
async function applyOpen(req, { data, slug }) {
  const settings = await publicSettings(req);
  // The same 404 a closed role gets. A tenant who has not opened this door has
  // not published one, and saying "this exists but is switched off" is the kind
  // of detail this surface refuses everywhere else.
  if (!settings.open_applications)
    throw new AppError("NOT_FOUND", "This page is not accepting open applications", 404);
  return req.tenantDbIn("live", (c) => insertOpenApplication(c, { data, slug }));
}

async function insertOpenApplication(client, { data, slug }) {
  let cvVaultId = null;
  if (data.cv_data_url) {
    try {
      const doc = await vault.createDocument(client, {
        dataUrl: data.cv_data_url,
        docType: "CV",
        // A constant, because there is no vacancy to name and the applicant row
        // does not exist yet — it cannot, since a file the CANDIDATE can fix
        // must throw before anything is written rather than leave an orphan.
        entityRef: "careers:open-application",
        originalName: data.cv_filename || null,
        maxBytes: CV_MAX_BYTES,
        allowedTypes: CV_TYPES,
        sniff: true,
        slug,
        actor: {},
      });
      cvVaultId = doc.doc_id;
    } catch (err) {
      // Identical asymmetry to `apply` above, for the identical reason: what the
      // candidate can fix reaches them, what we broke never costs them the
      // application.
      if (err instanceof AppError && err.status < 500) throw err;
      logger.error({ err }, "[careers] open-application CV upload failed — recording without it");
    }
  }

  const row = await vacancyRepo.insertApplicant(client, {
    vacancy_id: null,
    status: "TALENT_POOL",
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    skills: data.skills || [],
    experience_years: data.experience_years,
    expected_salary: data.expected_salary,
    portfolio_url: data.portfolio_url,
    cover_note: data.cover_note,
    cv_vault_id: cvVaultId,
    // Distinct from the token path's "careers", so a recruiter can tell a CV
    // sent for a role from one sent for the company, and so the two can be
    // counted apart later.
    source: "careers_open",
    applied_at: new Date(),
  });

  // `job_applicant:` rather than `vacancy:` — there is no vacancy, and an
  // entityRef naming one that does not exist is worse than none.
  const entityRef = `job_applicant:${row.applicant_id}`;
  await emitEvent(client, {
    eventTypeKey: vacancyEvents.APPLICANT_ADDED,
    moduleKey: vacancyEvents.MODULE,
    entityRef,
    actorUserId: null,
  });
  await audit(client, {
    actorUserId: null,
    action: vacancyEvents.APPLICANT_ADDED,
    moduleKey: vacancyEvents.MODULE,
    entityRef,
    after: row,
  });

  // The same receipt the token path returns, and for the same reason: a
  // reference the candidate can quote, and nothing they could read themselves
  // back out of.
  return {
    received: true,
    reference: String(row.applicant_id).slice(0, 8).toUpperCase(),
    cv_attached: !!cvVaultId,
  };
}

/**
 * Put an address on the job-alert list.
 *
 * ── WHY THE ANSWER IS THE SAME WHETHER OR NOT THEY WERE ALREADY ON IT ─────
 *
 * `subscribeAlert` upserts, and the receipt says only "received". Reporting
 * "you were already subscribed" would turn this into an oracle: anybody could
 * test whether a given person is on a given company's list, one address at a
 * time, from a form with no login.
 */
async function subscribeAlert(req, { data }) {
  const settings = await publicSettings(req);
  if (!settings.alerts_enabled)
    throw new AppError("NOT_FOUND", "This page is not offering job alerts", 404);
  // 32 bytes of CSPRNG, the same strength as a vacancy's public token, because
  // it is the same kind of thing: the only credential on an unauthenticated
  // action. Minted here so the repo's ON CONFLICT can decline to overwrite one
  // that is already in somebody's inbox.
  const token = crypto.randomBytes(32).toString("base64url");
  await req.tenantDbIn("live", (c) =>
    repo.subscribeAlert(c, {
      email: data.email,
      name: data.name || null,
      locale: data.locale === "en" ? "en" : "fr",
      token,
    }));
  return { received: true };
}

/**
 * Take an address off it.
 *
 * Answers `{ unsubscribed: true }` whether or not the token matched, for the
 * reason above turned around: a token that 404s is a token that can be probed.
 * The only caller is a link in an email, which has nothing to do with a miss
 * anyway.
 */
async function unsubscribeAlert(req, token) {
  await req.tenantDbIn("live", (c) => repo.unsubscribeAlert(c, token));
  return { unsubscribed: true };
}

module.exports = {
  list, get, applyToToken, findByToken,
  publicSettings, applyOpen, subscribeAlert, unsubscribeAlert,
  CV_MAX_BYTES, CV_TYPES,
};
