/**
 * Tenant-side Support & Feedback controller — thin. Tickets are scoped to the
 *  caller's tenant (req.tenant.tenant_id) and stamped with their email.
 */
const service = require("./support.service");
const { asyncHandler } = require("../../../utils/errors");

const tenantId = (req) => req.tenant.tenant_id;
const email = (req) => (req.user ? req.user.email : null);

module.exports = {
  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await service.create(tenantId(req), email(req), req.body) }),
  ),
  list: asyncHandler(async (req, res) =>
    res.json({ data: await service.list(tenantId(req), { status: req.query.status }) }),
  ),
  get: asyncHandler(async (req, res) =>
    res.json({ data: await service.get(tenantId(req), req.params.id) }),
  ),
  reply: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await service.reply(tenantId(req), email(req), req.params.id, req.body),
    }),
  ),
  csat: asyncHandler(async (req, res) =>
    res.json({ data: await service.submitCsat(tenantId(req), req.params.id, req.body.csat) }),
  ),
  // `singleFile("file")` runs before this handler — req.file is the multer
  // shape ({ buffer, mimetype, originalname }).
  uploadAttachment: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await service.upload(tenantId(req), email(req), req.file) }),
  ),
  attachmentBytes: asyncHandler(async (req, res) => {
    const { buffer, mime, name } = await service.attachmentBytes(
      tenantId(req),
      email(req),
      req.params.id,
    );
    res.set("Content-Type", mime);
    // Inline, not attachment: a screenshot in a support thread is looked at,
    // not archived. The filename stays on the header for the rare save-as.
    res.set("Content-Disposition", `inline; filename="${String(name).replace(/"/g, "")}"`);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }),
};
