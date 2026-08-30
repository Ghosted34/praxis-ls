"use strict";

/**
 * The block library — one schema per type, and the only definition of what a
 * block's `content` may contain.
 *
 * Migration 12753 stores `content` as jsonb because fourteen types with
 * different fields would otherwise be fourteen tables and fourteen joins to
 * render one page. Postgres therefore cannot enforce the shape, and this file
 * is what does instead. Both the write path and the renderer read it, so they
 * cannot drift: a field the editor can save is by construction a field the
 * renderer knows about.
 *
 * Two rules hold across every type:
 *
 *   1. NO MARKUP. Every string here reaches a public page. Tenant-editable HTML
 *      is stored XSS on a domain a client's customers visit. Rich text is
 *      carried as constrained plain text and rendered as paragraphs; where real
 *      formatting is genuinely needed the answer is a new block type with named
 *      fields, not a field that accepts tags.
 *   2. NO COLOURS OR URLS TO ASSETS. Images are vault document ids, resolved
 *      through the public media route with its allowlist re-check; accents are
 *      brand TOKEN names. A hex or an absolute URL in tenant content would bake
 *      one tenant's brand, or one deploy's hostname, into another's data.
 */

const { z } = require("zod");
const { isMetricKey, metricKeys } = require("./site_content.metrics");

/* ── shared field shapes ─────────────────────────────────────────────────── */

const TITLE_MAX = 160;
const TEXT_MAX = 1200;
const RICH_MAX = 6000;
const ITEMS_MAX = 24;

/** Bilingual text. FR is the fallback every renderer reads, so it is required. */
const bi = (max) => z.object({
  fr: z.string().trim().min(1).max(max),
  en: z.string().trim().max(max).nullable().optional(),
}).strict();

/** Bilingual and optional in full — a block may simply not have a subtitle. */
const biOpt = (max) => bi(max).nullable().optional();

/** An image is a vault document id, never a URL. */
const image = z.string().uuid().nullable().optional();

/** Icon NAME, resolved by the renderer against its own set. Never markup. */
const icon = z.string().trim().max(60).nullable().optional();

/** Brand token, never a hex — the palette is tenant config. */
const accent = z.enum(["PRIMARY", "ACCENT", "SUCCESS"]).optional();

const link = z.object({
  label: bi(80),
  // Internal path or a mailto/tel/https URL. Relative paths are resolved
  // against the site's base so a link keeps working when the tenant moves
  // from /public to their own domain.
  href: z.string().trim().min(1).max(500),
}).strict().nullable().optional();

const list = (item) => z.array(item).max(ITEMS_MAX);

/* ── the library ─────────────────────────────────────────────────────────── */

const BLOCKS = {
  hero: z.object({
    kicker: biOpt(80),
    title: bi(TITLE_MAX),
    lead: biOpt(TEXT_MAX),
    background_image: image,
    cta: link,
    // The one interactive hero on a logistics site: a shipment reference input
    // that hands off to the tracking page. Off by default; a tenant without
    // client-visible milestones should not advertise tracking.
    show_tracking_input: z.boolean().optional(),
  }).strict(),

  stat_chips: z.object({
    items: list(z.object({ label: bi(60), value: bi(60) }).strict()),
  }).strict(),

  stat_counters: z.object({
    items: list(z.object({
      label: bi(80),
      sublabel: biOpt(160),
      icon,
      unit: z.string().trim().max(20).nullable().optional(),
      // The literal. Always present — it is the fallback when a metric is
      // absent, unknown or fails, and the only value for a stat the ERP does
      // not compute.
      value: z.number(),
      // Optional binding to the registry. Refused if it names a metric that
      // does not exist, so a typo is a 422 at save time rather than a number
      // that silently never updates.
      metric_key: z.string().trim().max(80).nullable().optional()
        // Both null and undefined spelled out — eqeqeq is on, same as the note
        // in shared/http/public-web-paths.js.
        .refine((v) => v === null || v === undefined || v === "" || isMetricKey(v), {
          message: `unknown metric — one of: ${metricKeys().join(", ") || "(none registered)"}`,
        }),
    }).strict()),
  }).strict(),

  logo_strip: z.object({
    title: biOpt(120),
    items: list(z.object({
      // Alt text is required, not optional: a strip of unlabelled logos is
      // unreadable to a screen reader and worthless to a crawler.
      alt: z.string().trim().min(1).max(120),
      image: z.string().uuid(),
    }).strict()),
  }).strict(),

  feature_list: z.object({
    title: biOpt(TITLE_MAX),
    items: list(z.object({ icon, accent, title: bi(120), text: biOpt(TEXT_MAX) }).strict()),
  }).strict(),

  card_grid: z.object({
    title: biOpt(TITLE_MAX),
    subtitle: biOpt(TEXT_MAX),
    cta: link,
    items: list(z.object({
      icon,
      accent,
      image,
      title: bi(120),
      text: biOpt(TEXT_MAX),
      // The single emphasised line a card closes on — same idea as a service's
      // claim, and the same reason it is its own field rather than the first
      // element of a list.
      claim: biOpt(200),
      href: z.string().trim().max(500).nullable().optional(),
    }).strict()),
  }).strict(),

  text_image: z.object({
    eyebrow: biOpt(80),
    title: biOpt(TITLE_MAX),
    body: bi(RICH_MAX),
    image,
    caption: biOpt(160),
    image_side: z.enum(["LEFT", "RIGHT"]).optional(),
  }).strict(),

  two_column_values: z.object({
    icon,
    eyebrow: biOpt(80),
    columns: z.array(z.object({ label: bi(80), body: bi(RICH_MAX) }).strict()).max(4),
  }).strict(),

  leader_message: z.object({
    eyebrow: biOpt(80),
    name: z.string().trim().min(1).max(120),
    role: bi(120),
    org: z.string().trim().max(160).nullable().optional(),
    photo: image,
    // Paragraphs, as an array — so the renderer never has to split on newlines
    // and never has to accept markup to get more than one.
    paragraphs: z.array(bi(RICH_MAX)).max(12),
  }).strict(),

  pillar_framework: z.object({
    title: biOpt(TITLE_MAX),
    subtitle: biOpt(TEXT_MAX),
    items: list(z.object({
      // The big letter — E / S / G, or whatever framework the tenant uses.
      letter: z.string().trim().min(1).max(3),
      title: bi(120),
      body: biOpt(RICH_MAX),
      bullets: z.array(bi(300)).max(ITEMS_MAX).optional(),
    }).strict()),
  }).strict(),

  testimonials: z.object({
    title: biOpt(TITLE_MAX),
    items: list(z.object({
      name: z.string().trim().min(1).max(120),
      role: biOpt(200),
      quote: bi(1200),
      photo: image,
    }).strict()),
  }).strict(),

  form_block: z.object({
    title: biOpt(TITLE_MAX),
    intro: biOpt(TEXT_MAX),
    // Which public_intake form to render. The block never defines fields — the
    // endpoint's Zod schema is the contract and this only chooses between them.
    form: z.enum(["CONTACT", "QUOTE", "PARTNERSHIP", "NEWSLETTER"]),
  }).strict(),

  contact_block: z.object({
    title: biOpt(TITLE_MAX),
    address: biOpt(300),
    phone: z.string().trim().max(60).nullable().optional(),
    whatsapp: z.string().trim().max(60).nullable().optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    // Coordinates, not an embed URL: the renderer decides how to draw a map,
    // and a pasted iframe would be third-party markup on a public page.
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  }).strict(),

  cta_band: z.object({
    title: bi(TITLE_MAX),
    text: biOpt(TEXT_MAX),
    cta: link,
  }).strict(),

  policies: z.object({
    title: biOpt(TITLE_MAX),
    items: list(z.object({
      key: z.string().trim().min(1).max(60),
      title: bi(160),
      body: bi(RICH_MAX),
    }).strict()),
  }).strict(),
};

/** Every type the library defines. Must equal the CHECK in migration 12753. */
const BLOCK_TYPES = Object.keys(BLOCKS);

/**
 * Validate one block's content against its type.
 * @returns {{ok: true, data: object} | {ok: false, errors: object}}
 */
function validateBlock(type, content) {
  const schema = BLOCKS[type];
  if (!schema) return { ok: false, errors: { type: ["unknown block type"] } };
  const parsed = schema.safeParse(content ?? {});
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors };
  return { ok: true, data: parsed.data };
}

module.exports = { BLOCKS, BLOCK_TYPES, validateBlock, LIMITS: { TITLE_MAX, TEXT_MAX, RICH_MAX, ITEMS_MAX } };
