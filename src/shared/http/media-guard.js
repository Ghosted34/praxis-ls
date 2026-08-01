/**
 * Allow-list for the flat `/media` static mount (local storage driver).
 *
 * THE BUG THIS CLOSES. `storage.service` writes every artefact under one root
 * (STORAGE_LOCAL_PATH, default ./data/vault) namespaced per tenant, and
 * `server.js` mounted express.static over the whole of it. That is correct for
 * logos — they must load pre-auth, on the login screen, before any token exists
 * — but the SAME root holds `tenant_<slug>/vault/doc_*.ext`: contracts,
 * payslips, signed PDFs. So the auth-gated download route
 * (`GET /documents/:id/download`, requirePermission) could be bypassed entirely
 * by anyone who knew or guessed a vault key.
 *
 * THE RULE. A key looks like `tenant_<slug>/<segment>/…`. Only the segments
 * below are served flat; everything else 404s and must go through its module's
 * gated route. Deny-by-default: a new artefact type is private until someone
 * deliberately adds it here.
 *
 * NOTE ON avatars. Kept public because the client renders them as a plain <img>
 * from `app_user.avatar_ref`; gating them would need an auth'd blob fetch at
 * every render site. They are low-sensitivity and the filename carries 10 hex
 * chars of entropy, but this IS a judgement call, not a non-issue — revisit if
 * profile photos are ever considered personal data under a tenant's policy.
 *
 * NOTE ON S3. This guard is local-driver only. Under STORAGE_DRIVER=s3 the same
 * separation must be enforced by bucket policy — the vault prefix must not be
 * public-read, and vault objects should be handed out via `storage.signedUrl`.
 */
"use strict";

const PUBLIC_SEGMENTS = new Set([
  "branding", // tenant logo (pre-auth, login screen)
  "login", // login background image (pre-auth)
  "entity", // corporate-entity letterhead logos
  "avatars", // user profile pictures
]);

/**
 * @param {string} urlPath path relative to the /media mount, e.g.
 *   "/tenant_acme/branding/logo_ab12.png"
 * @returns {boolean} true if this may be served by the flat static mount
 */
function isPublicMediaPath(urlPath) {
  if (typeof urlPath !== "string" || !urlPath) return false;

  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // Malformed percent-encoding — refuse rather than guess.
    return false;
  }

  // Null byte truncation, and backslashes (Windows path separators) which would
  // sidestep a check that only splits on "/".
  if (decoded.includes("\0") || decoded.includes("\\")) return false;

  const parts = decoded.split("/").filter(Boolean);

  // Reject traversal outright. express.static blocks escaping the root, but
  // "tenant_x/branding/../vault/doc.pdf" stays INSIDE the root and would
  // otherwise pass a naive check on the second segment alone.
  if (parts.some((p) => p === "." || p === "..")) return false;

  // Need at least tenant / segment / filename.
  if (parts.length < 3) return false;
  if (!/^tenant_[a-z0-9_-]+$/i.test(parts[0])) return false;

  return PUBLIC_SEGMENTS.has(parts[1]);
}

module.exports = { isPublicMediaPath, PUBLIC_SEGMENTS };
