"use strict";

/**
 * The routes whose JSON body is allowed to be bigger than the global 2 MB, and
 * exactly how much bigger.
 *
 * ── WHY A LIST AND NOT A NUMBER ────────────────────────────────────────────
 *
 * This app has no multipart upload path. Every file a user sends — a CV, an ID
 * card, a photograph for the website — is base64-encoded into an ordinary JSON
 * body by the browser and decoded by `document_vault`, which is where the cap
 * that actually decides what gets STORED lives (`maxBytes`, re-checked against
 * the DECODED bytes). None of that is reachable if the body parser has already
 * refused the request: body-parser raises its 413 before any of our code runs,
 * so the screen gets no field to blame, no message it can show, and the upload
 * simply does not happen.
 *
 * Base64 inflates by a third. That one fact is the whole bug, and it has now
 * been found three separate times in three separate features:
 *
 *   1. A job applicant's CV. The careers form advertised 8 MB and
 *      `careers.service.CV_MAX_BYTES` enforced it; on the wire that is ~10.7 MB,
 *      so against the 2 MB global limit anything over roughly 1.4 MB was a 413
 *      AFTER the applicant had waited through the whole upload — which is most
 *      phone-scanned CVs. The form promised 8 MB and the server had never once
 *      been able to take it.
 *
 *   2. The staff file. Hiring somebody submits the person, their papers and
 *      their standing pay lines in ONE call, and "their papers" is a
 *      photographed ID card, a CV and a passport photograph — three files a
 *      phone camera produces at 2-4 MB each, plus a third again for base64.
 *      That POST was a 413 before any of our code ran, which surfaced as a hire
 *      that silently refused to save and no field to blame.
 *
 *   3. The website's pictures. Every image a tenant puts on their public site
 *      goes the same way: a cover on the service-type Website tab, an article
 *      cover or gallery frame, a leader's portrait or a partner's mark, a
 *      success-story image. Each screen advertises 8 MB or 10 MB, each
 *      validator repeats it, and the real ceiling was about 1.5 MB of image. A
 *      photograph is 2-5 MB, so this was not an edge case: the feature did not
 *      work for the files it exists to carry.
 *
 * Three times is a pattern, so the knowledge lives in one greppable place
 * rather than as a fourth block of prose in `server.js`. When a new route takes
 * a base64 body, it belongs here — and `tests/unit/body-limits.test.js` fails if
 * one of these limits stops covering the cap its feature advertises.
 *
 * ── WHY NOT JUST RAISE THE GLOBAL LIMIT ────────────────────────────────────
 *
 * Because that hands a 15 MB buffer to all ~600 routes to fix four. A closed
 * list keeps the blast radius at the paths that genuinely carry a file, and
 * every one of them still re-checks the decoded bytes against its own cap.
 *
 * ── ORDER AND MOUNTING ─────────────────────────────────────────────────────
 *
 * These must be mounted BEFORE the global parser, not after. body-parser sets
 * `req._body` once it has parsed, and every downstream body parser bails on
 * that flag — so a larger parser registered later never runs at all. That is
 * not a preference about ordering; it is the difference between this working
 * and this being dead code.
 */

/** Global default, for anything not listed here. Exported so the test can state
 *  the contrast rather than hard-coding "2mb" a second time. */
const DEFAULT_LIMIT = "2mb";

/**
 * How many characters of JSON a file of `bytes` becomes.
 *
 * base64 is 4 characters per 3 bytes, rounded up to a 4-character group, and
 * then the `data:<mime>;base64,` prefix and the JSON envelope around it (the
 * field names, the quotes, the braces, a sibling `original_name`) sit on top.
 * `OVERHEAD` is deliberately generous — it is guarding an inequality, and being
 * a kilobyte pessimistic costs nothing while being a byte optimistic
 * reintroduces the bug.
 */
const OVERHEAD = 4096;
const encodedSize = (bytes) => Math.ceil(bytes / 3) * 4 + OVERHEAD;

/** "15mb" → 15728640. The only forms used here are whole megabytes. */
const parseLimit = (limit) => Number(String(limit).replace(/mb$/i, "")) * 1024 * 1024;

/**
 * Each entry is one group of routes and the limit they need.
 *
 * `advertises` is the largest per-file cap any screen in that group promises the
 * user — the number the test measures the limit against. It is documentation
 * with teeth: if someone raises a form's cap without raising the limit here,
 * the test says so instead of a tenant discovering it.
 */
const RAISED = [
  {
    name: "careers-cv",
    /* POST /api/tenant/careers/:slug/apply */
    path: /^\/api\/(v\d+\/)?tenant\/careers\/[^/]+\/apply\/?$/,
    limit: "12mb",
    advertises: 8 * 1024 * 1024,
    why: "A job applicant's CV, base64'd by careers-api.fileToDataUrl.",
  },
  {
    name: "employee-documents",
    /* POST /api/tenant/employees and POST /api/tenant/employees/:id/documents */
    path: /^\/api\/(v\d+\/)?tenant\/employees(\/[^/]+\/documents)?\/?$/,
    limit: "12mb",
    advertises: 6 * 1024 * 1024,
    why: "Hiring submits ID card, CV and passport photograph in one call.",
  },
  {
    name: "website-images",
    /* POST /api/tenant/service-types/:id/web/media
       POST /api/tenant/insights/:id/cover  and  /:id/gallery
       POST /api/tenant/site-settings/media
       POST /api/tenant/success-stories/:id/media

       The DELETE that removes one image is `…/web/media/:docId` and carries no
       body, so the trailing `$` correctly leaves it on the global parser. */
    path: /^\/api\/(v\d+\/)?tenant\/(service-types\/[^/]+\/web\/media|insights\/[^/]+\/(cover|gallery)|site-settings\/media|success-stories\/[^/]+\/media)\/?$/,
    limit: "15mb",
    advertises: 10 * 1024 * 1024,
    why: "Every picture on the tenant's public website.",
  },
];

module.exports = { RAISED, DEFAULT_LIMIT, encodedSize, parseLimit };
