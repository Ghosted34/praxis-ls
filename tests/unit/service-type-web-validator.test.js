/**
 * The service_type_web validator (guide §4.5 body shapes, §4.7 slug regex,
 * §11 video host allowlist). Each row of this file is a CI row in the
 * guide's test plan.
 */
"use strict";

const validator = require("../../src/modules/operations/service_type_web/service_type_web.validator");

/** Run a validator middleware against a fake request and collect the
 *  error it would have produced. Returns either the parsed body or the
 *  AppError it called `next` with. */
function run(mw, body) {
  let thrown = null;
  const req = { body };
  const next = (err) => { thrown = err; };
  mw(req, {}, next);
  if (thrown) return { error: thrown };
  return { data: req.body };
}

describe("service_type_web validator", () => {
  describe("upsertProfile (the one PUT)", () => {
    test("a fully-populated body passes (only known fields allowed)", () => {
      const out = run(validator.upsertProfile, {
        short_description_fr: "Fret maritime import",
        short_description_en: "Sea freight import",
        long_description_fr: "Lorem ipsum",
        long_description_en: "Lorem ipsum",
        highlights_fr: ["Door-to-door", "Customs"],
        highlights_en: ["Door-to-door", "Customs"],
        coverage_fr: "Cameroon + Chad",
        coverage_en: "Cameroon + Chad",
        slug_fr: "fret-maritime-import",
        slug_en: "sea-freight-import",
        meta_title_fr: "Fret maritime import",
        meta_title_en: "Sea freight import",
        meta_description_fr: "Fret maritime",
        meta_description_en: "Sea freight",
        cover_vault_id: "11111111-1111-4111-8111-111111111111",
        icon_vault_id: "22222222-2222-4222-8222-222222222222",
        gallery_vault_ids: ["33333333-3333-4333-8333-333333333333"],
        video_url: "https://www.youtube.com/watch?v=abc",
        sort_order: 50,
      });
      expect(out.data.slug_fr).toBe("fret-maritime-import");
    });

    test("an empty body is allowed (the first save can be a no-op write)", () => {
      const out = run(validator.upsertProfile, {});
      expect(out.data).toEqual({});
    });

    test("a slug with uppercase is refused (regex /^[a-z0-9]+(?:-[a-z0-9]+)*$/)", () => {
      const out = run(validator.upsertProfile, { slug_fr: "Fret-Maritime" });
      expect(out.error.code).toBe("VALIDATION_ERROR");
      expect(out.error.details.slug_fr).toBeDefined();
    });

    test("a slug with an accented character is refused", () => {
      const out = run(validator.upsertProfile, { slug_fr: "fret-aérien" });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("a slug with a space is refused", () => {
      const out = run(validator.upsertProfile, { slug_fr: "fret maritime" });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("> 8 highlights is refused (the cap is 8 per language)", () => {
      const nine = Array.from({ length: 9 }, (_, i) => `h${i}`);
      const out = run(validator.upsertProfile, { highlights_fr: nine });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("exactly 8 highlights is allowed", () => {
      const eight = Array.from({ length: 8 }, (_, i) => `h${i}`);
      const out = run(validator.upsertProfile, { highlights_fr: eight });
      expect(out.data.highlights_fr).toEqual(eight);
    });

    test("an unknown top-level key is refused (.strict)", () => {
      const out = run(validator.upsertProfile, { not_a_field: "x" });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("video_url outside the allowlist is refused", () => {
      const out = run(validator.upsertProfile, { video_url: "https://rumble.com/abc" });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("video_url on YouTube / Vimeo / Dailymotion / dai.ly is accepted", () => {
      for (const url of [
        "https://www.youtube.com/watch?v=abc",
        "https://youtu.be/abc",
        "https://www.youtube.com/embed/abc",
        "https://vimeo.com/12345",
        "https://player.vimeo.com/video/12345",
        "https://www.dailymotion.com/video/abc",
        "https://dai.ly/abc",
      ]) {
        const out = run(validator.upsertProfile, { video_url: url });
        expect(out.data.video_url).toBe(url);
      }
    });
  });

  describe("replaceFaq", () => {
    test("a row missing either language is refused", () => {
      const out = run(validator.replaceFaq, {
        rows: [{ question_fr: "q", question_en: "q", answer_fr: "a" /* answer_en missing */ }],
      });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("a fully bilingual row is accepted", () => {
      const out = run(validator.replaceFaq, {
        rows: [{
          question_fr: "Quel délai ?", question_en: "How long?",
          answer_fr: "2 semaines", answer_en: "2 weeks",
        }],
      });
      expect(out.data.rows).toHaveLength(1);
    });

    test("> 12 FAQ rows is refused", () => {
      const rows = Array.from({ length: 13 }, () => ({
        question_fr: "q", question_en: "q", answer_fr: "a", answer_en: "a",
      }));
      const out = run(validator.replaceFaq, { rows });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("replaceRelated", () => {
    test("duplicate ids are refused", () => {
      const id = "11111111-1111-4111-8111-111111111111";
      const out = run(validator.replaceRelated, { related_service_type_ids: [id, id] });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("a non-uuid id is refused", () => {
      const out = run(validator.replaceRelated, { related_service_type_ids: ["not-a-uuid"] });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("replaceMedia", () => {
    test("an unknown role is refused", () => {
      const out = run(validator.replaceMedia, { role: "BANNER", data_url: "data:image/png;base64," });
      expect(out.error.code).toBe("VALIDATION_ERROR");
    });

    test("COVER / ICON / GALLERY are accepted", () => {
      for (const role of ["COVER", "ICON", "GALLERY"]) {
        const out = run(validator.replaceMedia, { role, data_url: "data:image/png;base64," });
        expect(out.data.role).toBe(role);
      }
    });
  });
});
