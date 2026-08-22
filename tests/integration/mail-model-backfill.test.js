"use strict";
/**
 * 10731's BACKFILL, against a real Postgres — §5.9's `mail-model-backfill.test.js`.
 *
 * ── WHY THIS WAS THE LAST ONE MISSING ───────────────────────────────────────
 *
 * §5.9 names this file and it did not exist. The fifth sweep triaged ten
 * named-but-absent test files and nine turned out to be naming mismatches
 * covered in substance elsewhere; this was the one real gap, and it is the
 * least testable of the ten, which is presumably why. It needs a database, and
 * CI's `migrations` job provisions a tenant FROM NOTHING — where the backfill's
 * own `legacy_exists` guard makes it a no-op. A tenant with no legacy mail
 * cannot exercise the code that moves legacy mail.
 *
 * ── HOW IT GETS A LEGACY WORLD TO MIGRATE ───────────────────────────────────
 *
 * It rebuilds one, inside a transaction it never commits. Two renames put the
 * schema back the way it stood the moment 10731 ran:
 *
 *   · `email_attachment.email_message_id` → `email_inbound_id` (10737 renamed
 *     it AFTER 10731, and 10731's backfill reads the old name — which is
 *     incidentally why re-applying that file on a modern tenant would fail if
 *     the guard ever let it through);
 *   · `email_inbound_legacy` → `email_inbound` (the table 10731 renames away;
 *     it is empty on a provisioned tenant, so nothing real moves).
 *
 * Then it inserts the four shapes of legacy row that matter, re-applies the
 * migration file verbatim, asserts, and ROLLS BACK. DDL is transactional in
 * Postgres, so the tenant database is byte-identical afterwards — which is what
 * makes this safe to run in the same `--runInBand` pass as every other
 * integration suite.
 *
 * ── WHAT IT IS ACTUALLY FOR ─────────────────────────────────────────────────
 *
 * Not "does the SQL parse". The backfill makes five claims a reader has to take
 * on trust, each of which quietly breaks something specific if it is wrong:
 *
 *   1. ids are PRESERVED — the whole reason `email_attachment` needed a
 *      re-pointed foreign key rather than a data migration, and the reason an
 *      id a client was holding still resolves;
 *   2. messages sharing a thread key become ONE conversation, with the
 *      timestamps and the count that implies;
 *   3. a message with no thread key is its own conversation, keyed so it
 *      cannot collide;
 *   4. read state, which belonged to nobody in particular, becomes the
 *      connection OWNER's;
 *   5. `entity_ref` survives, taken from the most recent message that had one.
 *
 * It found a sixth thing that is not a claim but a defect — see the
 * participants block below and `migrations/tenant/11743`.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const fs = require("fs");
const path = require("path");

const MIGRATION_10731 = path.resolve(
  __dirname, "..", "..", "migrations", "tenant", "10731_mail_thread_message.sql",
);
const MIGRATION_11743 = path.resolve(
  __dirname, "..", "..", "migrations", "tenant", "11743_email_thread_participants_repair.sql",
);

/* Fixed ids so an assertion can name the row it is talking about. */
const OWNER = "11111111-1111-1111-1111-111111111111";
const CONN = "22222222-2222-2222-2222-222222222222";
const M1 = "aaaaaaaa-0000-0000-0000-000000000001"; // inbound, read, attachment
const M2 = "aaaaaaaa-0000-0000-0000-000000000002"; // outbound reply, two recipients
const M3 = "aaaaaaaa-0000-0000-0000-000000000003"; // no thread key, has a Message-Id
const M4 = "aaaaaaaa-0000-0000-0000-000000000004"; // no thread key, no Message-Id

d("10731 · the message-model backfill (real Postgres)", () => {
  let pool;
  let c;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    c = await pool.connect();
    await c.query("BEGIN");

    // ── Put the schema back to the eve of 10731 ────────────────────────────
    await c.query(`
      ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS email_attachment_message_fk;
      ALTER TABLE email_attachment RENAME COLUMN email_message_id TO email_inbound_id;
      ALTER TABLE email_inbound_legacy RENAME TO email_inbound;
    `);

    // ── A mailbox with an owner, which is what read state attaches to ──────
    await c.query(
      `INSERT INTO app_user (user_id, email, full_name, password_hash)
       VALUES ($1, 'owner@smartls.cm', 'Marie Owner', 'not-a-hash')`,
      [OWNER],
    );
    await c.query(
      `INSERT INTO email_connection (email_connection_id, email_address, owner_user_id, status)
       VALUES ($1, 'billing@smartls.cm', $2, 'CONNECTED')`,
      [CONN, OWNER],
    );

    // ── The four shapes of legacy row ──────────────────────────────────────
    //
    // M1/M2 share a thread key: the merge case. M2 carries TWO recipients in
    // the single comma-joined citext the old table used, which is the shape the
    // participants defect lives on. M3 has no thread key but a Message-Id; M4
    // has neither and must fall back to its own id.
    await c.query(
      `INSERT INTO email_inbound
         (email_inbound_id, email_connection_id, thread_key, external_message_id,
          message_id_header, direction, from_address, to_address, subject, body_text,
          is_read, received_at, entity_ref, sent_via, origin_user_id)
       VALUES
         ($1, $5, 'T-1', 'X-1', '<m1@maersk.cm>', 'IN',
          'client@maersk.cm', 'billing@smartls.cm', 'Bill of lading', 'Please find attached.',
          true,  now() - interval '3 hours', NULL, NULL, NULL),
         ($2, $5, 'T-1', 'X-2', '<m2@smartls.cm>', 'OUT',
          'billing@smartls.cm', 'client@maersk.cm, ops@maersk.cm', 'Re: Bill of lading', 'Received.',
          false, now() - interval '1 hour', 'client:123', 'PRAXIS', $6),
         ($3, $5, NULL, 'X-3', '<m3@new.cm>', 'IN',
          'lead@new.cm', 'billing@smartls.cm', 'Quote request', 'What would this cost?',
          false, now() - interval '2 hours', NULL, NULL, NULL),
         ($4, $5, NULL, NULL, NULL, 'IN',
          'odd@nowhere.cm', 'billing@smartls.cm', 'No identifiers at all', NULL,
          false, now() - interval '30 minutes', NULL, NULL, NULL)`,
      [M1, M2, M3, M4, CONN, OWNER],
    );

    // An attachment on M1, so `has_attachment` has something to be true about.
    // The FK was dropped above, deliberately: the backfill re-points it, and it
    // cannot reference a message row that the backfill has not created yet.
    await c.query(
      `INSERT INTO email_attachment (email_inbound_id, filename, content_type, size_bytes)
       VALUES ($1, 'bl-2026-0311.pdf', 'application/pdf', 88123)`,
      [M1],
    );

    // ── Run the migration under test, verbatim ─────────────────────────────
    await c.query(fs.readFileSync(MIGRATION_10731, "utf8"));
  }, 60_000);

  afterAll(async () => {
    if (c) {
      await c.query("ROLLBACK");
      c.release();
    }
    if (pool) await pool.end();
  });

  const threads = async () =>
    (await c.query(
      `SELECT thread_key, subject, message_count, has_attachment, entity_ref,
              first_message_at, last_message_at, participants::text[] AS participants
         FROM email_thread WHERE email_connection_id = $1
        ORDER BY first_message_at`,
      [CONN],
    )).rows;

  const messages = async () =>
    (await c.query(
      `SELECT email_message_id, folder, direction, to_address::text[] AS to_address,
              subject, origin_user_id, email_thread_id, received_at
         FROM email_message WHERE email_connection_id = $1
        ORDER BY received_at`,
      [CONN],
    )).rows;

  /* ── Claim 1 · ids are preserved ───────────────────────────────────────── */

  it("KEEPS EVERY MESSAGE ID — the claim the attachment re-point rests on", async () => {
    // 10731: "Every existing message keeps its id ... which means
    // email_attachment needs no data change (only a re-pointed foreign key),
    // entity_refs already recorded on the AI timeline stay valid, and any id a
    // client happens to be holding still resolves."
    const ids = (await messages()).map((m) => m.email_message_id).sort();
    expect(ids).toEqual([M1, M2, M3, M4].sort());
  });

  it("re-points the attachment rather than moving it", async () => {
    const { rows } = await c.query(
      `SELECT a.filename, m.subject
         FROM email_attachment a
         JOIN email_message m ON m.email_message_id = a.email_inbound_id
        WHERE a.email_inbound_id = $1`,
      [M1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Bill of lading");
  });

  /* ── Claim 2 · one thread key, one conversation ────────────────────────── */

  it("folds two messages on one thread key into a single conversation", async () => {
    const t = (await threads()).find((x) => x.thread_key === "T-1");
    expect(t).toBeTruthy();
    expect(t.message_count).toBe(2);
    expect(t.has_attachment).toBe(true);
    // The subject is the EARLIEST message's, not the last writer's — otherwise
    // every conversation is eventually called "Re: Re: Re:".
    expect(t.subject).toBe("Bill of lading");
    expect(new Date(t.first_message_at).getTime())
      .toBeLessThan(new Date(t.last_message_at).getTime());
  });

  it("carries the most recent entity_ref across, and does not invent one", async () => {
    const all = await threads();
    expect(all.find((x) => x.thread_key === "T-1").entity_ref).toBe("client:123");
    expect(all.find((x) => x.thread_key === "X-3").entity_ref).toBeNull();
  });

  /* ── Claim 3 · no thread key means its own conversation ────────────────── */

  it("gives an unthreaded message its own conversation, keyed so it cannot collide", async () => {
    const keys = (await threads()).map((t) => t.thread_key).sort();
    // Message-Id where there is one, the row's own id where there is not.
    expect(keys).toEqual(["T-1", "X-3", M4].sort());
    expect(await threads()).toHaveLength(3);
  });

  /* ── Claim 4 · read state becomes the owner's ──────────────────────────── */

  it("ATTACHES READ STATE TO THE MAILBOX OWNER — it belonged to nobody before", async () => {
    const { rows } = await c.query(
      `SELECT email_message_id, user_id, is_read, read_at
         FROM email_message_state WHERE user_id = $1 ORDER BY email_message_id`,
      [OWNER],
    );
    expect(rows).toHaveLength(4);
    const read = rows.find((r) => r.email_message_id === M1);
    expect(read.is_read).toBe(true);
    // read_at is the receipt time — the old table had no separate one, and
    // inventing `now()` would date every historic message to the migration.
    expect(read.read_at).not.toBeNull();
    expect(rows.filter((r) => r.is_read)).toHaveLength(1);
    expect(rows.find((r) => r.email_message_id === M2).read_at).toBeNull();
  });

  /* ── Direction becomes a folder ────────────────────────────────────────── */

  it("files outbound as SENT and everything else as INBOX", async () => {
    const byId = Object.fromEntries((await messages()).map((m) => [m.email_message_id, m]));
    expect(byId[M2].folder).toBe("SENT");
    expect(byId[M1].folder).toBe("INBOX");
    // origin_user_id survives, or every shared-mailbox send becomes anonymous
    // retroactively — 10731's own comment on that column.
    expect(byId[M2].origin_user_id).toBe(OWNER);
    expect(byId[M1].origin_user_id).toBeNull();
  });

  it("splits the comma-joined recipients into a real array on the message", async () => {
    const byId = Object.fromEntries((await messages()).map((m) => [m.email_message_id, m]));
    expect(byId[M2].to_address).toEqual(["client@maersk.cm", "ops@maersk.cm"]);
    expect(byId[M1].to_address).toEqual(["billing@smartls.cm"]);
  });

  /* ── The defect this test found ────────────────────────────────────────── */

  describe("participants — the one the message path got right and the thread path did not", () => {
    it("10731 LEAVES A PARTICIPANT THAT IS TWO ADDRESSES AND NEITHER", async () => {
      // Pinned as it is, not as it should be, because this is the state every
      // tenant that had mail before 10731 is now carrying. `string_to_array`
      // appears in the message INSERT four lines below the thread INSERT that
      // does not use it.
      const t = (await threads()).find((x) => x.thread_key === "T-1");
      expect(t.participants).toContain("client@maersk.cm, ops@maersk.cm");
      expect(t.participants).not.toContain("ops@maersk.cm");
    });

    it("11743 REPAIRS IT, and a second run changes nothing", async () => {
      const repair = fs.readFileSync(MIGRATION_11743, "utf8");
      await c.query(repair);

      const after = (await threads()).find((x) => x.thread_key === "T-1");
      expect([...after.participants].sort())
        .toEqual(["billing@smartls.cm", "client@maersk.cm", "ops@maersk.cm"]);

      // Idempotent by construction: nothing contains a comma any more, so the
      // WHERE matches nothing. A repair that is not re-runnable is a repair
      // nobody dares run twice.
      await c.query(repair);
      const again = (await threads()).find((x) => x.thread_key === "T-1");
      expect([...again.participants].sort()).toEqual([...after.participants].sort());
    });

    it("leaves a thread whose participants were already clean alone", async () => {
      const t = (await threads()).find((x) => x.thread_key === "X-3");
      expect([...t.participants].sort()).toEqual(["billing@smartls.cm", "lead@new.cm"]);
    });
  });

  /* ── Re-running the backfill ───────────────────────────────────────────── */

  it("RE-APPLYING THE MIGRATION MOVES NOTHING — the guard, not luck", async () => {
    // The rename at the end of the block means `email_inbound` no longer
    // exists, so `legacy_exists` is false and the whole body returns early.
    // That is also the only reason the file is safe to re-apply at all: its
    // backfill still reads `email_attachment.email_inbound_id`, a column 10737
    // renamed away, and those statements are never planned because the RETURN
    // happens first.
    const before = await threads();
    await c.query(fs.readFileSync(MIGRATION_10731, "utf8"));
    const after = await threads();
    expect(after).toHaveLength(before.length);
    expect((await messages())).toHaveLength(4);
  });

  it("renames the old table away rather than dropping it", async () => {
    const { rows } = await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('email_inbound', 'email_inbound_legacy')`,
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toContain("email_inbound_legacy");
    expect(names).not.toContain("email_inbound");
  });
});
