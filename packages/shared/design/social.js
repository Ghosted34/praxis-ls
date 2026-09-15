"use strict";
/**
 * The social platforms a tenant may put in their website footer.
 *
 * ── WHY A CLOSED REGISTRY AND NOT FREE TEXT ────────────────────────────────
 *
 * Three things need to agree: the settings form (which renders one row per
 * platform), the API validator (which refuses an unknown one), and the footer
 * renderer (which needs a glyph and an accessible name). A free-text platform
 * field would give the renderer a string it has no icon for and no way to
 * label, and the failure would be a nameless blank square in the footer of a
 * tenant's public site.
 *
 * ── `host` IS THE PART THAT MATTERS ────────────────────────────────────────
 *
 * Every URL is validated as https AND against the platform's own host pattern.
 * This is not pedantry about tidy data:
 *
 *   A LinkedIn glyph, in a tenant's own footer, under the tenant's branding,
 *   pointing at any URL at all, is a phishing primitive with the tenant's
 *   reputation attached to it.
 *
 * Anyone who can edit website settings can already publish copy, so this is not
 * a privilege boundary — it is a guard against a mistake (a pasted tracking
 * link, a shortener, a typo'd domain) becoming a link customers trust because
 * of the icon beside it. The rule lives here so the form and the API refuse the
 * same strings rather than the form being decorative.
 *
 * `www.` and regional subdomains are allowed; anything else is not. Patterns
 * are anchored at both ends — an unanchored one matches `evil.com/linkedin.com`.
 */

/**
 * @typedef {{ id: string, name: string, icon: string, host: RegExp,
 *             placeholder: string }} SocialPlatform
 */

/** @type {SocialPlatform[]} */
const SOCIAL_PLATFORMS = [
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: "linkedin",
    host: /^([a-z0-9-]+\.)?linkedin\.com$/i,
    placeholder: "https://www.linkedin.com/company/your-company",
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: "facebook",
    host: /^([a-z0-9-]+\.)?(facebook\.com|fb\.com)$/i,
    placeholder: "https://www.facebook.com/your-page",
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "instagram",
    host: /^([a-z0-9-]+\.)?instagram\.com$/i,
    placeholder: "https://www.instagram.com/your-account",
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "youtube",
    host: /^([a-z0-9-]+\.)?(youtube\.com|youtu\.be)$/i,
    placeholder: "https://www.youtube.com/@your-channel",
  },
  {
    id: "x",
    name: "X",
    icon: "x",
    // twitter.com still resolves and a tenant may hold either link. Both are
    // the same account; refusing the older one would be pedantry with a cost.
    host: /^([a-z0-9-]+\.)?(x\.com|twitter\.com)$/i,
    placeholder: "https://x.com/your-account",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "tiktok",
    host: /^([a-z0-9-]+\.)?tiktok\.com$/i,
    placeholder: "https://www.tiktok.com/@your-account",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "whatsapp",
    // wa.me is the canonical click-to-chat host and the one a freight desk
    // actually publishes in this region.
    host: /^([a-z0-9-]+\.)?(wa\.me|whatsapp\.com)$/i,
    placeholder: "https://wa.me/237XXXXXXXXX",
  },
];

const SOCIAL_IDS = SOCIAL_PLATFORMS.map((p) => p.id);
const socialById = (id) => SOCIAL_PLATFORMS.find((p) => p.id === id) || null;

/**
 * Is this a URL the given platform may legitimately carry?
 *
 * Uses the URL parser rather than a regex over the whole string: `new URL()`
 * gives the real host, so `https://evil.com/?u=linkedin.com` and
 * `https://linkedin.com.evil.com` are both correctly rejected — which a naive
 * `/linkedin\.com/` test accepts.
 */
function isValidSocialUrl(id, url) {
  const platform = socialById(id);
  if (!platform || typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  // http is refused outright: a footer link is a public endorsement, and this
  // product does not publish one over a channel that can be rewritten in
  // transit.
  if (parsed.protocol !== "https:") return false;
  return platform.host.test(parsed.hostname);
}

exports.SOCIAL_PLATFORMS = SOCIAL_PLATFORMS;
exports.SOCIAL_IDS = SOCIAL_IDS;
exports.socialById = socialById;
exports.isValidSocialUrl = isValidSocialUrl;
