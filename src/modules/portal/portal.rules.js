/** Portals — pure rules. A portal_access grant is usable only while active and
 *  before its expiry (auditor grants are time-boxed). */
"use strict";
function isGrantUsable(grant, now = Date.now()) {
  if (!grant || grant.is_active !== true) return false;
  if (grant.expires_at && Date.parse(grant.expires_at) < now) return false;
  return true;
}
module.exports = { isGrantUsable };
