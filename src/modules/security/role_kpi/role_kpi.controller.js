/**
 * role_kpi handlers. Thin, like every controller here — and like `iam_role`'s,
 * pinned to the IDENTITY handle: the row configures a role that lives in the
 * live schema and resolves for a user in both environments. A config written
 * under TEST would otherwise edit the sandbox copy of the role (a row the
 * band never reads) and vanish on the next wipe — the exact nesting bug
 * `tenant-context.js` documents for `/vacancies`.
 */
"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./role_kpi.service");

module.exports = {
  get: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.getForRole(c, req.params.id));
    res.json({ data });
  }),
  put: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) =>
      // `config`'s presence is the validator's contract (it rejects a body
      // without it), so the handler must NOT reinterpret absence as a clear —
      // that mapping is what an unguarded route would turn a `{}` typo into.
      service.put(c, { roleId: req.params.id, config: req.body.config, actor: req.user }),
    );
    res.json({ data });
  }),
};
