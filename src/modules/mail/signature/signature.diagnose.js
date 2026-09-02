/**
 * WHY IS MY SIGNATURE CARD NOT SHOWING?
 *
 * WHY THIS EXISTS. The card reaches a recipient through a chain of six steps,
 * and when it fails the symptom is identical every time: the email arrives with
 * the text fallback and no image. Nothing on the screen distinguishes "the
 * template is not the card" from "Chromium would not launch" from "the storage
 * key is not servable" — and the send SUCCEEDS in all of them, by design,
 * because a signature must never fail a message.
 *
 * That cost three rounds of guessing. Twice the answer was a one-line
 * difference from code that already worked elsewhere in the repo: the storage
 * key was shaped unlike every other caller's, and Chromium was resolved unlike
 * pdf.service's. Both were invisible from the outside and obvious from the
 * inside.
 *
 * So this runs the chain and reports which step fails, in order, with the
 * actual error. It is a read-only probe: it renders and, if asked, writes one
 * throwaway object to prove storage works, but it changes no signature, no
 * template and no cache.
 *
 * NOT A HEALTH CHECK. It launches Chromium and does real I/O, so it sits behind
 * the same MOD-70 grant as template administration rather than being something
 * anything can poll.
 */
"use strict";

const repo = require("./signature.repo");
const pngMod = require("./signature.png");
const cardMod = require("./signature.card");
const fontsMod = require("./signature.fonts");
const { chromiumReport } = require("../../../services/chromium");
const { isPublicStorageKey } = require("../../../shared/http/media-guard");
const storage = require("../../../services/storage.service");
const { config } = require("../../../config/env");

const ok = (step, detail) => ({ step, ok: true, ...detail });
const bad = (step, why, detail) => ({ step, ok: false, why, ...detail });

/**
 * @param {object} client
 * @param {object} opts
 * @param {string} opts.userId   whose signature to probe
 * @param {boolean} [opts.write] also store a throwaway object, proving the
 *   storage leg end to end. Off by default so a probe leaves nothing behind.
 */
async function diagnose(client, { userId, write = false } = {}) {
  const steps = [];
  const service = require("./signature.service");

  // 1. Is the feature even on? A tenant with mail.signatures off gets no
  //    signature at all, which looks identical to a broken renderer.
  try {
    const { rows } = await client.query(
      `SELECT state FROM feature_state WHERE feature_key = 'mail.signatures'`,
    );
    const state = rows[0] && rows[0].state;
    steps.push(state === "on"
      ? ok("feature_flag", { state })
      : bad("feature_flag", "mail.signatures is not on — no signature is attached to any mail", { state: state || "unset" }));
  } catch (err) {
    steps.push(bad("feature_flag", err.message));
  }

  // 2. Which template resolves, and is it the card? A tenant still on
  //    `smartls_classic` gets a table and never enters the card path at all.
  let model = null;
  try {
    const r = await service.resolveFor(client, { userId, format: "PREVIEW" });
    model = r.model;
    if (!model) {
      steps.push(bad("template", "no signature resolves for this user — check the profile is enabled and a template is default"));
    } else if (model.kind !== "card") {
      steps.push(bad("template", `the active template renders "${model.kind}", not the card — migration 12758 may not have run on this tenant`, { kind: model.kind }));
    } else {
      steps.push(ok("template", { kind: model.kind, language: r.language }));
    }
  } catch (err) {
    steps.push(bad("template", err.message));
  }

  // 3. Chromium. The one that broke it in production: the renderer resolved the
  //    binary differently from pdf.service, so PDFs worked and cards did not.
  const chromium = chromiumReport();
  steps.push(chromium.resolved
    ? ok("chromium_found", { path: chromium.resolved })
    : bad("chromium_found", "no Chromium executable found — Puppeteer will try its own download, which the image does not ship", chromium));

  // 4. Fonts. A missing face degrades rather than fails, so this is a warning
  //    the report carries rather than a step that can stop the chain.
  const families = fontsMod.loadedFamilies();
  steps.push(families.length === 2
    ? ok("fonts", { loaded: families })
    : bad("fonts", "a card face did not load — the render will substitute", { loaded: families }));

  // 5. The actual render. Everything above can pass and this still throw.
  let png = null;
  if (model && model.kind === "card" && chromium.resolved) {
    try {
      png = await pngMod.render(model, 2);
      steps.push(ok("render", {
        bytes: png.buffer.length,
        dimensions: `${png.width}x${png.height}`,
        is_buffer: Buffer.isBuffer(png.buffer),
      }));
    } catch (err) {
      steps.push(bad("render", err.message));
    }
  } else {
    steps.push(bad("render", "skipped — an earlier step failed"));
  }

  // 6. The storage key, and whether /media would serve it. This is the leg that
  //    shipped broken: a key that stores fine and 404s on every fetch.
  try {
    const slug = await service.tenantNamespace(client, null);
    const key = `tenant_${slug}/signatures/diagnose-probe.png`;
    const servable = isPublicStorageKey(key);
    const detail = { key, servable, driver: config.STORAGE_DRIVER, url: `https://${config.APP_BASE_DOMAIN}/media/${key}` };

    if (!servable) {
      steps.push(bad("storage_key", "this key is NOT in the public allow-list — /media will 404 it and every recipient sees a broken image", detail));
    } else if (write && png) {
      const stored = await storage.put(png.buffer, { key, contentType: "image/png" });
      steps.push(ok("storage_write", { ...detail, stored: stored.key }));
    } else {
      steps.push(ok("storage_key", detail));
    }
  } catch (err) {
    steps.push(bad("storage_write", err.message));
  }

  const failed = steps.filter((s) => !s.ok);
  return {
    ok: failed.length === 0,
    // The FIRST failure is the one to fix; the rest are usually consequences.
    first_failure: failed.length ? failed[0].step : null,
    renderer_version: service.RENDERER_VERSION,
    steps,
  };
}

module.exports = { diagnose };
