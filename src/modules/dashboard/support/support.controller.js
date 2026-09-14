/**
 * Tenant-side Support & Feedback controller — thin. Tickets are scoped to the
 *  caller's tenant (req.tenant.tenant_id) and stamped with their email.
 */
const service = require("./support.service");
const { asyncHandler } = require("../../../utils/errors");

const tenantId = (req) => req.tenant.tenant_id;
const email = (req) => (req.user ? req.user.email : null);

/**
 * The wire says `attachment_ids`; the service reads `attachmentIds`. This
 * controller is the one seam that translates between the two, and it has to do
 * it EXPLICITLY rather than by handing `req.body` straight through.
 *
 * Zod strips unknown keys, so a service that destructures a spelling the
 * validator does not emit gets `undefined` and silently does nothing. That is
 * not hypothetical: passing `req.body` through meant `attachmentIds` was always
 * undefined, `linkAttachments` returned at its first line, and every screenshot
 * a tenant attached to a ticket or a reply uploaded fine, showed 100%, was
 * never linked to anything, and was deleted six hours later by the orphan
 * sweep. Green tests throughout — they called the service directly, in its own
 * spelling, so nothing ever crossed this seam.
 */
const attachmentIds = (req) => req.body.attachment_ids || [];

module.exports = {
  create: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await service.create(tenantId(req), email(req), {
        kind: req.body.kind,
        title: req.body.title,
        body: req.body.body,
        context: req.body.context,
        attachmentIds: attachmentIds(req),
      }),
    }),
  ),
  list: asyncHandler(async (req, res) =>
    res.json({ data: await service.list(tenantId(req), { status: req.query.status }) }),
  ),
  get: asyncHandler(async (req, res) =>
    res.json({ data: await service.get(tenantId(req), req.params.id) }),
  ),
  reply: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await service.reply(tenantId(req), email(req), req.params.id, {
        body: req.body.body,
        attachmentIds: attachmentIds(req),
      }),
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
