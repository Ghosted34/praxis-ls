"use strict";
module.exports = {
  MODULE: "MOD-72",
  ADMIN_MODULE: "MOD-70",
  TEMPLATE_CHANGED: "signature.template.changed",
  PROFILE_CHANGED: "signature.profile.changed",
  CACHE_INVALIDATED: "signature.cache.invalidated",
  ref: (id) => `signature_template:${id}`,
  profileRef: (userId) => `user_signature_profile:${userId}`,
};
