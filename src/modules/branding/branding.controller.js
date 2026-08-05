/**
 * BRANDING RESOLUTION: LIVE IS THE BASE, SANDBOX MAY OVERRIDE — 2026-08-01.
 *
 * These handlers used `req.tenantDb` alone, which is env-scoped, so appearance
 * was stored TWICE — `live.setting` and `sandbox.setting` — with neither aware
 * of the other. Two consequences, both bad:
 *
 *   1. `wipeSandbox` does `DROP SCHEMA sandbox CASCADE` (provisioning.service
 *      :210), so branding configured in TEST was destroyed on every wipe — and
 *      that wipe is meant to run on a cron.
 *   2. Configuring it in LIVE did NOT show in TEST: getBranding reads only its
 *      own schema and nulls anything missing, so TEST fell back to defaults and
 *      the editor rendered every colour as #000000.
 *
 * The model now: **live is canonical and shows in both environments; sandbox can
 * override it, and that override is disposable.** Reads take live as the base
 * and overlay any value the sandbox schema actually sets. Writes still go to the
 * CURRENT env, so editing in TEST changes only TEST.
 *
 * That keeps a real use for the sandbox — try a palette against test data
 * without touching what customers see — while making the wipe non-destructive in
 * the way that matters: it only ever discards a deliberate experiment, and the
 * tenant's real branding, held in live, is untouched and reappears immediately.
 *
 * NOTE the uploads below are unaffected — they key off `req.tenant.slug` and
 * write to storage, never to a schema, so they were never env-scoped.
 */
"use strict";
const { asyncHandler } = require("../../utils/errors");
const service = require("./branding.service");

/**
 * Read live, then overlay whatever this environment explicitly sets.
 * Only non-null overrides win, so a sandbox row that was never configured
 * can't blank out a live value. Costs a second round trip in TEST only.
 */
async function resolveEnvOverlay(req, read) {
  const base = await (req.identityDb || req.tenantDb)(read);
  if (!req.env || req.env === "live") return base;
  let override = {};
  try {
    override = (await req.tenantDb(read)) || {};
  } catch {
    return base; // sandbox schema missing/mid-rebuild → live is still correct
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

module.exports = {
  // Public — no auth. Falls the display name back to the tenant slug so the
  // login always has *something* to show even before appearance is configured.
  get: asyncHandler(async (req, res) => {
    const b = await resolveEnvOverlay(req, (c) => service.getBranding(c));
    res.json({ data: { ...b, name: b.name || req.tenant.slug } });
  }),

  // Gated (see routes) — upserts only the provided appearance fields. The
  // service picks the known token fields out of the body (unknown keys are
  // ignored), so the full appearance token set flows through here.
  //
  // Writes to the CURRENT env: saving in TEST creates a sandbox-only override,
  // saving in LIVE sets the value every environment inherits.
  put: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      service.setBranding(c, { ...(req.body || {}), actorId: req.user.user_id }),
    );
    res.json({ data });
  }),

  // Gated — stores an uploaded logo (base64 data URL) via the file storage
  // service and returns its /media URL. Client then sets it and saves.
  uploadLogo: asyncHandler(async (req, res) => {
    const data = await service.uploadLogo({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),

  // Login screen editor (3.2). GET is PUBLIC (the login page reads it pre-auth);
  // PUT + background upload are gated (see routes).
  // Same live-base/sandbox-override model as appearance. Note the login page
  // itself is read PRE-AUTH with no env header, so it always renders the LIVE
  // config — a sandbox override is only ever visible to someone already signed
  // in and switched to TEST, which is the right blast radius for an experiment.
  getLogin: asyncHandler(async (req, res) => {
    res.json({ data: await resolveEnvOverlay(req, (c) => service.getLogin(c)) });
  }),
  putLogin: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.setLogin(c, { ...(req.body || {}), actorId: req.user.user_id }));
    res.json({ data });
  }),
  uploadLoginBackground: asyncHandler(async (req, res) => {
    const data = await service.uploadLoginBackground({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),

  /**
   * Installed-app (PWA) design. GET is PUBLIC for the same reason branding is:
   * the boot splash renders BEFORE anyone signs in, so it needs the tenant's
   * splash preset and colours pre-auth.
   *
   * ENVIRONMENT-INDEPENDENT — LIVE ALWAYS, READ AND WRITE. Unlike appearance,
   * this section deliberately has no sandbox override, and that is not an
   * oversight:
   *
   *   - There is exactly ONE installed app per tenant origin. You cannot
   *     install a sandbox copy of it; the manifest is per-origin, and a device
   *     fetching one sends no `X-Praxis-Env` header to select with.
   *   - `src/routes/pwa.js` therefore reads `live` unconditionally, which it
   *     must: an installed app's identity should not be changeable from a
   *     disposable experiment.
   *   - So a sandbox-scoped write here produced a configuration that could
   *     NEVER take effect — and the editor, overlaying sandbox on top of live,
   *     showed it back as if it had saved. Someone could upload an icon in
   *     TEST, watch the preview render it, save, and reasonably conclude the
   *     feature was broken when no device ever showed it. It was stored exactly
   *     as asked, somewhere nothing reads, and then destroyed by the next
   *     sandbox wipe.
   *
   * Trying a palette against test data (which is what the appearance override
   * is for, see the header of this file) has no equivalent here. The screen
   * says so at the top, so "I am in TEST" never implies "this is not real".
   *
   * `identityDb` is the same live binding auth/sessions/RBAC already use — the
   * existing precedent for "this is the same in both environments".
   */
  getPwa: asyncHandler(async (req, res) => {
    res.json({ data: await (req.identityDb || req.tenantDb)((c) => service.getPwa(c)) });
  }),
  putPwa: asyncHandler(async (req, res) => {
    const data = await (req.identityDb || req.tenantDb)((c) =>
      service.setPwa(c, { ...(req.body || {}), actorId: req.user.user_id }),
    );
    res.json({ data });
  }),
  uploadAppIcon: asyncHandler(async (req, res) => {
    const data = await service.uploadAppIcon({ dataUrl: req.body.dataUrl, slug: req.tenant.slug });
    res.json({ data });
  }),
};
