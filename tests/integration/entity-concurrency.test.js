"use strict";

/**
 * PR-10 / B.4 — the corporate-entities surfaces under CONCURRENCY, against a
 * real Postgres.
 *
 * The audit's release-evidence row said it plainly: no concurrency test was
 * ever performed. Two operators saving the same entity's working calendar at
 * once, and two cover uploads landing on the same entity at once, are not
 * exotic — they are Tuesday. What each race must not produce:
 *
 *   · a calendar that is neither of the two saved (an entity with TWO
 *     working_calendar rows, chosen between by accident);
 *   · a public website with two live covers, or a cover that dangles —
 *     VERIFIED, scoped SITE, pointed at by nobody, invisible to the sweep.
 *
 * Both fixes under test are in this PR: the calendar's per-entity advisory
 * lock (corporate_entity.calendar.js) and the pointer transaction's
 * FOR UPDATE re-read (site_settings.media.js).
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (CI sets it
 * after `provision-tenant`, plus TEST_ENTITY_ID for the fixture entity);
 * self-skips otherwise, like every other suite in this directory.
 */

const { Pool } = require("pg");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const itDb = hasDb ? it : it.skip;

let pool;

/** A 1×1 PNG data URL — the smallest buffer the pipeline will actually decode. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Mon–Fri 08:00–17:00, in the shape calendar.save expects. */
const WEEK = (opens = "08:00", closes = "17:00") =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: opens, closes_at: closes }));

d("corporate entities — concurrency (PR-10 / B.4)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  describe("two concurrent calendar saves", () => {
    itDb("both succeed and the final calendar is exactly one of them — never a blend, never two rows", async () => {
      const calendar = require("../../src/modules/master/corporate_entity/corporate_entity.calendar");
      const entityId = process.env.TEST_ENTITY_ID;

      // Clean slate: the race must be reproducible from "no calendar yet",
      // which is the state where the double-INSERT used to live.
      await pool.query("DELETE FROM working_calendar WHERE entity_id = $1", [entityId]);

      const run = async (opens, closes) => {
        const client = await pool.connect();
        try {
          return await calendar.save(client, entityId, {
            timezone: "Africa/Douala",
            name: `concurrency ${opens}`,
            days: WEEK(opens, closes),
            holidays: [],
            actor: {},
          });
        } finally {
          client.release();
        }
      };

      // A: Mon–Fri 08:00–17:00. B: Mon–Fri 09:30–16:00 (different hours AND
      // a different day count, so a blend is detectable in either direction).
      const [a, b] = await Promise.all([
        run("08:00", "17:00"),
        run("09:30", "14:30"),
      ]);
      expect(a.timezone).toBe("Africa/Douala");
      expect(b.timezone).toBe("Africa/Douala");

      // ONE calendar row for the entity — the invariant the advisory lock
      // exists for. Before it, both first-saves inserted.
      const rows = await pool.query(
        "SELECT working_calendar_id FROM working_calendar WHERE entity_id = $1",
        [entityId],
      );
      expect(rows.rows).toHaveLength(1);

      // The saved calendar is exactly A's or exactly B's — never five days
      // from one and hours from the other.
      const days = await pool.query(
        "SELECT weekday, opens_at, closes_at FROM working_calendar_day WHERE working_calendar_id = $1 ORDER BY weekday",
        [rows.rows[0].working_calendar_id],
      );
      expect(days.rows).toHaveLength(5);
      const allA = days.rows.every((r) => r.opens_at === "08:00:00" && r.closes_at === "17:00:00");
      const allB = days.rows.every((r) => r.opens_at === "09:30:00" && r.closes_at === "14:30:00");
      expect(allA || allB).toBe(true);
    });
  });

  describe("two concurrent calendar resets", () => {
    itDb("both succeed and leave the entity with no calendar of its own", async () => {
      const calendar = require("../../src/modules/master/corporate_entity/corporate_entity.calendar");
      const entityId = process.env.TEST_ENTITY_ID;

      // Give the entity something to reset, so the race is real.
      const setup = await pool.connect();
      try {
        await calendar.save(setup, entityId, {
          timezone: "Africa/Douala",
          days: WEEK(),
          holidays: [],
          actor: {},
        });
      } finally {
        setup.release();
      }

      const run = async () => {
        const client = await pool.connect();
        try {
          return await calendar.reset(client, entityId, { actor: {} });
        } finally {
          client.release();
        }
      };

      await Promise.all([run(), run()]);

      const rows = await pool.query(
        "SELECT working_calendar_id FROM working_calendar WHERE entity_id = $1",
        [entityId],
      );
      expect(rows.rows).toHaveLength(0);
    });
  });

  describe("two concurrent entity-cover uploads", () => {
    itDb("leave exactly one active cover, and the loser archived and sweepable — never a dangling public object", async () => {
      const media = require("../../src/modules/site/site_settings/site_settings.media");
      const entityId = process.env.TEST_ENTITY_ID;

      // Clean the slot so the race starts from a known state, and make the
      // entity publishable — the serve assertions below meet the same
      // predicates a cached public URL does (public_enabled + ACTIVE).
      await pool.query(
        "UPDATE corporate_entity SET public_cover_vault_id = NULL, public_enabled = true, registration_status = 'ACTIVE' WHERE entity_id = $1",
        [entityId],
      );
      await pool.query(
        "UPDATE document_vault SET status = 'ARCHIVED', public_media_scope = NULL " +
          "WHERE doc_id IN (SELECT doc_id FROM document_vault WHERE entity_ref = $1 AND doc_type = 'SITE_MEDIA')",
        [`corporate_entity:${entityId}`],
      );

      const upload = async (name) => {
        const client = await pool.connect();
        try {
          return await media.upload(client, {
            slot: "entity-cover",
            ownerId: entityId,
            dataUrl: PNG_1PX,
            originalName: name,
            provenance: "owned",
            actor: {},
            slug: "citenant",
          });
        } finally {
          client.release();
        }
      };

      const [first, second] = await Promise.all([upload("cover-a.png"), upload("cover-b.png")]);
      expect(first.doc_id).toBeDefined();
      expect(second.doc_id).toBeDefined();
      expect(first.doc_id).not.toBe(second.doc_id);

      // Exactly one pointer, and it is one of the two uploads — whoever
      // committed last, which is the race's own decision to make.
      const entity = await pool.query(
        "SELECT public_cover_vault_id FROM corporate_entity WHERE entity_id = $1",
        [entityId],
      );
      const pointer = entity.rows[0].public_cover_vault_id;
      expect([first.doc_id, second.doc_id]).toContain(pointer);
      const winner = pointer;
      const loser = pointer === first.doc_id ? second.doc_id : first.doc_id;

      // THE PUBLIC-SAFETY INVARIANT: exactly one non-archived SITE-scoped
      // cover remains — the winner. The loser is ARCHIVED with its public
      // scope stripped (the FOR UPDATE re-read), which is what makes it
      // inert to the serve route AND closable by the reconciliation's
      // bookkeeping — never a VERIFIED public object nobody points at.
      const live = await pool.query(
        "SELECT doc_id FROM document_vault " +
          "WHERE entity_ref = $1 AND doc_type = 'SITE_MEDIA' " +
          "  AND status <> 'ARCHIVED' AND public_media_scope = 'SITE'",
        [`corporate_entity:${entityId}`],
      );
      expect(live.rows.map((r) => r.doc_id)).toEqual([winner]);

      const loserRow = await pool.query(
        "SELECT status, public_media_scope FROM document_vault WHERE doc_id = $1",
        [loser],
      );
      expect(loserRow.rows[0]).toMatchObject({ status: "ARCHIVED", public_media_scope: null });

      // And the serve route fails closed for the loser, answers for the
      // winner — the predicates a cached URL actually meets.
      const serve = async (docId) => {
        const client = await pool.connect();
        try {
          return await media.publicMediaForServe(client, docId);
        } finally {
          client.release();
        }
      };
      expect((await serve(winner)) && (await serve(winner)).doc_id).toBe(winner);
      expect(await serve(loser)).toBeNull();
    });
  });
});
