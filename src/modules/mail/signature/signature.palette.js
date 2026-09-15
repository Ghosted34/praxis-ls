/**
 * Signature card palette — PURE.
 *
 * THE WHITE-LABEL PROBLEM THIS SOLVES. The card layout came from a standalone
 * generator that hard-coded one tenant's three brand colours: #0D5C8A deep
 * blue, #1FA2E1 cyan, #FF8C00 orange. Shipping those literals would put one
 * customer's brand on every tenant's outbound mail, which is the opposite of
 * what this product sells. So the card names ROLES, and the roles resolve from
 * the tenant's own appearance settings.
 *
 * THE MAPPING, and why it is these three fields. The card needs a dark hue for
 * text, a light hue for edges and fills, and a warm accent for the two small
 * marks that stop the card being monochrome. Praxis LS's own fallback palette
 * (declared in client/src/features/settings/appearance-page.tsx and repeated
 * below, because the server cannot import from the client app) already happens
 * to carry exactly that shape:
 *
 *   ink   ← branding.accentDeep   #0C4A7A   name, website, motto, divider core
 *   glow  ← branding.accentGlow   #34AAE2   card border, pill border, gradients
 *   warm  ← branding.primary      #F5821F   top-bar tail, the title dash
 *
 * Mapping ink to `primary` instead — the more obvious reading of "the brand
 * colour" — would put the Praxis fallback orange on the person's NAME and the
 * blue on the title dash, i.e. the card with two colours transposed. A tenant
 * who has set no branding at all still gets a coherent card this way, which is
 * the case that has to work without anyone configuring anything.
 *
 * THE SURFACES ARE DERIVED, NOT CONFIGURED. The original's #f0f8fd and #e0f2fe
 * are the cyan mixed into white at roughly 6.5% and 13.5%. Deriving them from
 * `glow` rather than storing them means a tenant who changes their cyan gets a
 * card whose background still belongs to it — two more colour pickers would
 * only let them break that relationship.
 */
"use strict";

/**
 * Praxis LS's fallback palette — what a tenant with no appearance settings
 * renders. These are the same values client/src/features/settings/
 * appearance-page.tsx shows in its colour inputs as placeholders, duplicated
 * here because the API cannot import the client bundle. If those change, change
 * these: `tests/unit/mail-signature-card.test.js` asserts the pairs match.
 */
const PRAXIS_FALLBACK = {
  ink: "#0C4A7A",
  glow: "#34AAE2",
  warm: "#F5821F",
};

/**
 * THE BRAND COLOURS A CARD ROLE MAY BE POINTED AT.
 *
 * These are exactly the five colour fields Appearance stores and
 * `signature.repo.loadBranding` reads — no more. A role may be RE-POINTED at
 * another one of them; it may never be given a colour of its own. That is the
 * difference between "choose which of your brand colours paints the name" and
 * "type a hex here", and it is the whole reason this list is a closed set: the
 * second is a second place to set the brand, and a first place for the brand and
 * the signature to disagree.
 *
 * The fallbacks mirror client/src/features/settings/appearance-page.tsx's
 * `COLORS`, for the same reason PRAXIS_FALLBACK above does — the API cannot
 * import the client bundle — and are what a tenant who has set no appearance
 * rows actually renders. `mail-signature-card.test.js` pins the three that
 * overlap PRAXIS_FALLBACK against each other so the two cannot drift apart.
 */
const BRAND_FALLBACK = {
  primary: "#F5821F",
  secondary: "#1C9BD7",
  accent: "#1C9BD7",
  accentDeep: "#0C4A7A",
  accentGlow: "#34AAE2",
};

const BRAND_KEYS = Object.keys(BRAND_FALLBACK);

/**
 * The three roles the card paints with, and the brand colour each takes when
 * nobody has said otherwise. The mapping is the one in this file's header —
 * `ink` is deliberately NOT `primary`.
 *
 * `paints` is the sentence the editor shows under each swatch row. It lives
 * here, next to the CSS those parts are actually drawn by (signature.card.js),
 * because a description of what a colour touches that is written somewhere else
 * is a description that stops being true on the first layout change.
 */
const CARD_ROLES = [
  { role: "ink", source: "accentDeep", paints: "name, website, motto, divider" },
  { role: "glow", source: "accentGlow", paints: "card edge, background tint, accent bar" },
  { role: "warm", source: "primary", paints: "title dash, phone and website icons" },
];

const DEFAULT_SOURCE = Object.fromEntries(CARD_ROLES.map((r) => [r.role, r.source]));

/** The layout key carrying a role's re-point. `ink` → `ink_from`. */
const sourceKey = (role) => `${role}_from`;

/**
 * Which brand colour a role is pointed at, or null for the default mapping.
 *
 * Anything that is not one of the five keys reads as "not set" rather than as an
 * error: `layout` is a JSON blob an administrator can PATCH, and a typo there
 * must degrade to the tenant's own default palette, never to an empty colour
 * reaching the CSS.
 */
function sourceOf(layout, role) {
  const v = String(((layout || {})[sourceKey(role)]) || "").trim();
  return BRAND_KEYS.includes(v) ? v : null;
}

/**
 * The hex a brand key resolves to, with the same fallback the app itself
 * renders when the tenant has set nothing.
 *
 * Falling back HERE rather than letting an unset key fall through to the role's
 * default source is what keeps the editor honest: the swatch a person picks and
 * the colour the card paints are read from one function, so a tenant who has
 * never opened Appearance can still re-point a role and get the colour they
 * were shown.
 */
function brandHex(branding, key) {
  if (!BRAND_KEYS.includes(key)) return null;
  return hex((branding || {})[key]) || BRAND_FALLBACK[key];
}

/**
 * Every brand colour, resolved, in the order Appearance lists them — what the
 * editor draws its swatches from.
 */
function swatches(branding = {}) {
  return BRAND_KEYS.map((key) => ({
    key,
    hex: brandHex(branding, key),
    // Whether the tenant actually set it, or is rendering the Praxis default.
    // The editor says so rather than presenting a borrowed colour as theirs.
    is_set: Boolean(hex((branding || {})[key])),
  }));
}

/** Text colours. Not brand-derived: they are the card's neutral ramp. */
const NEUTRAL = {
  title: "#334155",
  body: "#1E293B",
  paper: "#FFFFFF",
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` → `#aabbcc`; anything that is not a hex colour → null. */
function hex(value) {
  const s = String(value === null || value === undefined ? "" : value).trim();
  if (!HEX_RE.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return s.toLowerCase();
}

function rgb(hexColor) {
  const h = hex(hexColor) || "#000000";
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

/**
 * `hexColor` mixed into white at `ratio` (0 = white, 1 = the colour itself).
 * The card's two surface tints and nothing else.
 */
function tint(hexColor, ratio) {
  const { r, g, b } = rgb(hexColor);
  const f = (c) => Math.round(255 - (255 - c) * ratio);
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(f(r))}${to2(f(g))}${to2(f(b))}`;
}

/** `hexColor` mixed toward black at `ratio`. The default second stop of the
 *  card's two warm gradients when a template has not pinned one. */
function shade(hexColor, ratio) {
  const { r, g, b } = rgb(hexColor);
  const f = (c) => Math.round(c * (1 - ratio));
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(f(r))}${to2(f(g))}${to2(f(b))}`;
}

/** `rgba()` string at `alpha`, for the borders and shadows that need to sit on
 *  whatever the card's background gradient is doing underneath them. */
function alpha(hexColor, a) {
  const { r, g, b } = rgb(hexColor);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Resolve the card's palette.
 *
 * Precedence is RE-POINT → layout pin → tenant branding → Praxis fallback.
 *
 * The layout pin (`ink_color` and friends) exists so a template can hold a
 * colour that must not move — a department running a deliberately different
 * look — NOT as the normal path: the seeded card template sets none of the
 * three, so the ordinary tenant gets their own branding with no configuration
 * at all.
 *
 * THE RE-POINT (`ink_from` and friends) SITS ABOVE THE PIN, and that order is
 * deliberate. A re-point is a choice somebody made on a screen, in front of a
 * live preview, out of their own brand colours; a pin is a hex in a JSON blob
 * with no surface showing it. If the pin won, picking a swatch would do nothing
 * at all and nothing would say why — the silent no-op this file's header exists
 * to keep out of the card. The pin is left in place rather than deleted, so
 * clearing the re-point is a true undo: the template renders exactly the hex it
 * carried before anybody touched a swatch.
 *
 * @param {object} [branding]  shape of branding.service.getBranding()
 * @param {object} [layout]    signature_template.layout
 */
function resolve(branding = {}, layout = {}) {
  const b = branding || {};
  const l = layout || {};

  const inkFrom = sourceOf(l, "ink");
  const glowFrom = sourceOf(l, "glow");
  const warmFrom = sourceOf(l, "warm");

  const ink = brandHex(b, inkFrom) || hex(l.ink_color) || hex(b.accentDeep) || PRAXIS_FALLBACK.ink;
  const glow = brandHex(b, glowFrom) || hex(l.glow_color) || hex(b.accentGlow) || PRAXIS_FALLBACK.glow;
  const warm = brandHex(b, warmFrom) || hex(l.warm_color) || hex(b.primary) || PRAXIS_FALLBACK.warm;

  /**
   * A pinned value that was hand-picked TO MATCH a role stands down when that
   * role is re-pointed.
   *
   * The seeded card pins #f97316 beside an orange warm and two cyan tints beside
   * a cyan glow (migration 12758). Those three numbers are not colours in their
   * own right — they are the second half of a pair. Keep them after someone
   * moves `warm` to a blue and the title dash renders blue fading into orange,
   * which is not a card anybody chose; derive instead and the pair moves
   * together. Re-pointing is the only thing that drops a pin, so a template that
   * was never re-pointed still renders the exact hexes it was seeded with.
   */
  const pinned = (value, repointed) => (repointed ? null : hex(value));

  return {
    ink,
    glow,
    warm,
    // The far stop of the two warm gradients — the title dash and the phone and
    // website icons. Pinnable for the same reason the surfaces are: the original
    // pairs #FF8C00 with #F97316, which is a hand-picked deeper orange rather
    // than a shade of the first. `shade` is a good default for a tenant who set
    // only one warm colour, and a poor substitute when the exact pair is known.
    warmDeep: pinned(l.warm_deep_color, warmFrom) || shade(warm, 0.1),

    // Text.
    title: hex(l.title_color) || NEUTRAL.title,
    body: hex(l.body_color) || NEUTRAL.body,
    paper: NEUTRAL.paper,

    // Surfaces, derived from `glow` — see the header. Pinnable because the
    // derivation lands 1–3/255 away from the two tints the original card was
    // drawn with (#f0f8fd, #e0f2fe), which are hand-picked rather than a
    // function of the cyan. That delta is invisible, but a tenant reproducing an
    // existing signature exactly should not have to accept "invisible" on faith,
    // so the seeded template pins both and everyone else derives.
    surface: pinned(l.surface_color, glowFrom) || tint(glow, 0.065),
    surfaceDeep: pinned(l.surface_deep_color, glowFrom) || tint(glow, 0.135),

    // Edges and shadows. Alpha rather than a solid tint because they sit over
    // the card's own gradient, which is not a flat colour.
    cardBorder: alpha(glow, 0.2),
    pillBorder: alpha(glow, 0.3),
    cardShadow: alpha(ink, 0.1),
    logoShadow: alpha(ink, 0.08),
    pillShadow: alpha(ink, 0.06),
    dividerTop: alpha(ink, 0.02),
    dividerTail: alpha(warm, 0.2),
  };
}

/**
 * Font stacks for the card. Parametric for the same reason the colours are: a
 * tenant whose brand is set in their own display face should not have their
 * signature set in someone else's.
 *
 * These are NAMED families rather than the CSS token strings the app uses,
 * because the renderer embeds the binaries (signature.fonts.js) and headless
 * Chromium has no token layer to read.
 */
const DEFAULT_FONTS = {
  body: "Montserrat",
  motto: "Brittany Signature",
};

function fonts(layout = {}) {
  const l = layout || {};
  const clean = (v, fallback) => {
    const s = String(v === null || v === undefined ? "" : v).trim();
    // Only a bare family name. A full CSS stack here would let a template smuggle
    // a font the library never vetted past `check:fonts`, which only reads source.
    return /^[\w][\w .-]{0,48}$/.test(s) ? s : fallback;
  };
  return {
    body: clean(l.font_body, DEFAULT_FONTS.body),
    motto: clean(l.font_motto, DEFAULT_FONTS.motto),
  };
}

/**
 * How each role currently resolves, for the editor: the brand colour it is
 * pointed at, whether that is a deliberate re-point or the default mapping, and
 * the hex that produces. Everything the screen needs to draw a row, computed by
 * the same functions the card is painted with rather than re-derived client-side.
 */
function roles(branding = {}, layout = {}) {
  const p = resolve(branding, layout);
  return CARD_ROLES.map(({ role, source, paints }) => {
    const from = sourceOf(layout, role);
    return {
      role,
      paints,
      source: from || source,
      default_source: source,
      is_repointed: Boolean(from),
      hex: p[role],
    };
  });
}

module.exports = {
  resolve, fonts, hex, tint, shade, alpha, rgb,
  roles, swatches, sourceOf, sourceKey, brandHex,
  PRAXIS_FALLBACK, BRAND_FALLBACK, BRAND_KEYS, CARD_ROLES, DEFAULT_SOURCE,
  NEUTRAL, DEFAULT_FONTS,
};
