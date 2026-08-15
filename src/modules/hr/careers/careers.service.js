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

const { AppError } = require("../../../utils/errors");
const vacancyRepo = require("../vacancy/vacancy.repo");
const vacancyService = require("../vacancy/vacancy.service");
const vault = require("../../vault/document_vault/document_vault.service");
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
    // address a second time for the sake of a display string (0683).
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
    // the payload ignored would read as a promise (0683).
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

/** One role by token. 404 for closed, unpublished and non-existent alike. */
async function get(client, token) {
  const row = await vacancyRepo.publishedByToken(client, token);
  if (!row) throw new AppError("NOT_FOUND", "This role is no longer accepting applications", 404);
  return publicVacancy(row);
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
async function apply(client, { token, data, slug }) {
  const vacancy = await vacancyRepo.publishedByToken(client, token);
  if (!vacancy) throw new AppError("NOT_FOUND", "This role is no longer accepting applications", 404);

  // What the recruiter marked as required (0683). Enforced HERE and not only in
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
      if (err instanceof AppError && err.httpStatus < 500) throw err;
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

module.exports = { list, get, apply, CV_MAX_BYTES, CV_TYPES };
