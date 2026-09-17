"use strict";

/**
 * The mail composer sends bytes as multipart, not as a base64 string in JSON.
 *
 * This is the production regression in transport terms: a 2 MiB Word document
 * used to become ~2.7 MiB of JSON and die in the global 2 MiB body parser before
 * mail saw it. Multer now receives the original bytes and exposes the ordinary
 * fields before the validator runs.
 */

const express = require("express");
const request = require("supertest");
const { singleFile } = require("../../src/shared/http/upload.middleware");
const validator = require("../../src/modules/mail/mail/mail.validator");

const DRAFT_ID = "00000000-0000-4000-8000-000000000001";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function app() {
  const server = express();
  // The global JSON parser ignores multipart requests.
  server.use(express.json({ limit: "2mb" }));
  // The route ordering: Multer first, multipart-field validation second.
  server.post(
    "/api/tenant/mail/attachments/upload",
    singleFile("file"),
    validator.attachmentUpload,
    (req, res) => res.json({
      bytes: req.file.buffer.length,
      filename: req.file.originalname,
      draft: req.body.email_draft_id,
    }),
  );
  server.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ code: err.code, message: err.message }));
  return server;
}

describe("mail multipart upload", () => {
  test("accepts the reported 2 MiB Word document without base64 inflation", async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 1);
    const res = await request(app())
      .post("/api/tenant/mail/attachments/upload")
      .field("email_draft_id", DRAFT_ID)
      .attach("file", bytes, { filename: "shipping-instructions.docx", contentType: DOCX });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bytes: bytes.length,
      filename: "shipping-instructions.docx",
      draft: DRAFT_ID,
    });
  });

  test("requires a multipart file rather than accepting a base64 JSON field", async () => {
    const res = await request(app())
      .post("/api/tenant/mail/attachments/upload")
      .send({ email_draft_id: DRAFT_ID, data_url: "data:application/msword;base64,AAAA" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "BAD_FILE" });
  });
});
