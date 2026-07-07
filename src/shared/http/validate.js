/** Passthrough validator used by CRUD modules that don't need strict schemas yet.
 *  Modules with domain rules provide their own zod validator instead. */
"use strict";
const noop = (req, _res, next) => next();
module.exports = { passthrough: { create: noop, update: noop }, noop };
