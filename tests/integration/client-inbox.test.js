"use strict";

/**
 * The Client inbox and the account manager against a real schema (client
 * portal PR 3: 14200, seeds 90997/9136).
 *
 * The unit suites prove the service's decisions over mocked rows. This proves
 * the SQL those rows come from, and it exists because the first version of the
 * routing read `app_user.is_ceo`, a column that has never existed: the CEO is
 * a ROLE, and auth derives `is_ceo` from user_role. Postgres refused the query
 * on every client message, the alert's catch logged a warning, and nobody on
 * the team was ever told a client wrote. A mocked repo cannot see that; a real
 * schema refuses it on the first line.
 *
 *   1. Who a message reaches: the account manager and the file's owners while
 *      their login is ACTIVE, and the MD (the CEO role) always — end to end,
 *      from a client's message to the team's notification rows.
 *   2. The inbox: one row per conversation, waiting first, with its unread
 *      count and the manager's name; an unanswered question older than six
 *      months is still listed, an answered one is not.
 *   3. The account manager: named, audited, the new manager told; a login that
 *      is not active refused; someone who left shown as unreachable.
 *   4. MOD-64C is granted to the people who answer clients.
 *
 * One transaction, rolled back at the end: the audit ledger refuses deletes,
 * so nothing here may commit. Skipped unless DATABASE_URL is set, like every
 * suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Client inbox and account manager (real Postgres)", () => {
  let pool;
  let c;
  const repo = require("../../src/modules/portal/portal_chat.repo");
  const chat = require("../../src/modules/portal/portal_chat.service");
  const accountManager = require("../../src/modules/master/client_master/account_manager.service");
  const tag = `inbox${process.pid}x${Math.floor(Math.random() * 1e6)}`;
  const u = {};
  const cl = {};

  async function user(key, { status = "ACTIVE", role = null, employee = null } = {}) {
    let employeeId = null;
    if (employee) {
      const { rows } = await c.query(
        "INSERT INTO employee (full_name, job_title) VALUES ($1, $2) RETURNING employee_id",
        [employee.name, employee.title],
      );
      employeeId = rows[0].employee_id;
    }
    const { rows } = await c.query(
      `INSERT INTO app_user (email, full_name, password_hash, status, employee_id)
       VALUES ($1, $2, 'not-a-hash', $3, $4) RETURNING user_id`,
      [`${key}.${tag}@example.test`, `Login ${key}`, status, employeeId],
    );
    if (role) {
      await c.query("INSERT INTO user_role (user_id, role_id) SELECT $1, role_id FROM role WHERE code = $2", [rows[0].user_id, role]);
    }
    u[key] = rows[0].user_id;
  }

  async function client(key, managerKey = null) {
    const { rows } = await c.query(
      "INSERT INTO client_master (name, relationship_manager_user_id) VALUES ($1, $2) RETURNING client_id",
      [`${key} ${tag}`, managerKey ? u[managerKey] : null],
    );
    cl[key] = rows[0].client_id;
  }

  // Minutes, not days: now() is the transaction's start, so two messages
  // written "now" would tie, and a conversation's last word would be a coin toss.
  async function message(clientKey, { direction, body, ageMin = 0, read = false }) {
    await c.query(
      `INSERT INTO client_message (client_id, direction, body, author_email, author_user_id, created_at, staff_read_at)
       VALUES ($1, $2, $3, $4, $5, now() - make_interval(mins => $6), CASE WHEN $7 THEN now() END)`,
      [cl[clientKey], direction, body, direction === "CLIENT" ? `buyer@${tag}.test` : null,
        direction === "STAFF" ? u.boss : null, ageMin, read],
    );
  }

  const notificationsFor = async (key, like) =>
    (await c.query(
      "SELECT title, body, category, link_url FROM notification WHERE user_id = $1 AND link_url LIKE $2 ORDER BY created_at",
      [u[key], like],
    )).rows;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");

    await user("am", { employee: { name: "Awa Ndiaye", title: "Key account manager" } });
    await user("ops");
    await user("leaver", { status: "SUSPENDED", employee: { name: `Léon Parti ${tag}`, title: "Former key account manager" } });
    await user("md", { role: "CEO" });
    await user("oldMd", { role: "CEO", status: "LOCKED" });
    await user("boss");

    await client("Acme", "am");
    await client("Bois"); // nobody looks after it
    await client("Cacao"); // answered long ago
    await client("Delta"); // answered today
  });

  afterAll(async () => {
    if (!c) return;
    await c.query("ROLLBACK");
    c.release();
    await pool.end();
  });

  describe("who a client's message reaches", () => {
    it("the account manager and the active owners, and the MD by the CEO role", async () => {
      const out = await repo.staffAudience(c, {
        clientId: cl.Acme,
        dossier: { owner_ops_id: u.ops, owner_sales_id: u.leaver },
      });
      expect(out.manager).toEqual([u.am]);
      // Someone who left is not a destination, so they cannot count as "held".
      expect(out.owners).toEqual([u.ops]);
      expect(out.md).toContain(u.md);
      expect(out.md).not.toContain(u.oldMd);
    });

    it("nobody for a client without a manager, so the service falls back to the inbox", async () => {
      const out = await repo.staffAudience(c, { clientId: cl.Bois, dossier: null });
      expect(out.manager).toEqual([]);
      expect(out.owners).toEqual([]);
      expect(out.md).toContain(u.md);
    });

    it("tells the manager and the MD, end to end, with a link to the conversation", async () => {
      await chat.send(c, {
        clientId: cl.Acme,
        me: { portal_user_id: "5f0e8a47-1c1b-4d7e-9a57-6b2f3c1d9e01", email: `buyer@${tag}.test` },
        scope: "ALL",
        thread: "general",
        body: "Can you quote Douala to Bangui?",
      });
      const link = `/comms/clients?client=${cl.Acme}&thread=general`;
      const [toManager] = await notificationsFor("am", link);
      expect(toManager).toMatchObject({ category: "comms", body: "Can you quote Douala to Bangui?", link_url: link });
      expect(await notificationsFor("md", link)).toHaveLength(1);
      // The client has a manager: the inbox holders are not woken for it.
      expect(await notificationsFor("ops", link)).toHaveLength(0);
    });
  });

  describe("the inbox", () => {
    beforeAll(async () => {
      const DAY = 24 * 60;
      await message("Bois", { direction: "CLIENT", body: "Still waiting on our refund", ageMin: 200 * DAY });
      await message("Cacao", { direction: "CLIENT", body: "Thanks", ageMin: 200 * DAY, read: true });
      await message("Cacao", { direction: "STAFF", body: "You're welcome", ageMin: 199 * DAY });
      await message("Delta", { direction: "CLIENT", body: "Received, thank you", ageMin: 10, read: true });
      await message("Delta", { direction: "STAFF", body: "Invoice attached", ageMin: 5 });
    });

    const mine = (rows) => rows.filter((r) => Object.values(cl).includes(r.client_id));

    it("lists a waiting question however old, and drops an old answered one", async () => {
      const rows = mine(await repo.inbox(c));
      const names = rows.map((r) => r.client_name);
      expect(names).toEqual(expect.arrayContaining([`Acme ${tag}`, `Bois ${tag}`, `Delta ${tag}`]));
      expect(names).not.toContain(`Cacao ${tag}`);
    });

    it("puts what is waiting first, with its count and the manager's name", async () => {
      const rows = mine(await repo.inbox(c));
      expect(rows.map((r) => r.client_id)).toEqual([cl.Acme, cl.Bois, cl.Delta]);
      expect(rows[0]).toMatchObject({ unread: 1, direction: "CLIENT", manager_user_id: u.am, manager_name: "Awa Ndiaye", dossier_id: null });
      expect(rows[1]).toMatchObject({ unread: 1, manager_user_id: null });
      expect(new Date(rows[1].waiting_since).getTime()).toBeLessThan(Date.now() - 190 * 86400e3);
      expect(rows[2]).toMatchObject({ unread: 0, direction: "STAFF", body: "Invoice attached" });
    });

    it("makes the manager's clients theirs in the service's Mine", async () => {
      const out = await chat.staffInbox(c, { filter: "mine", actor: { user_id: u.am } });
      expect(out.items.filter((i) => Object.values(cl).includes(i.client_id)).map((i) => i.client_id)).toEqual([cl.Acme]);
    });
  });

  describe("the account manager", () => {
    it("is chosen from people with an active login, by name or job", async () => {
      await c.query("INSERT INTO employee (full_name, job_title) VALUES ($1, 'Key account manager')", [`Inès Fouda ${tag}`]);
      const byName = await accountManager.candidates(c, { q: "Awa Ndiaye" });
      expect(byName).toEqual(expect.arrayContaining([
        expect.objectContaining({ full_name: "Awa Ndiaye", job_title: "Key account manager", account_user_id: u.am }),
      ]));
      const byJob = (await accountManager.candidates(c, { q: "key account", limit: 50 })).map((r) => r.full_name);
      expect(byJob).toContain("Awa Ndiaye");
      // No login, or only one that can no longer be reached: not offered.
      expect(byJob).not.toContain(`Inès Fouda ${tag}`);
      expect(byJob).not.toContain(`Léon Parti ${tag}`);
    });

    it("refuses a login that is not active", async () => {
      await expect(accountManager.set(c, { clientId: cl.Delta, userId: u.leaver, actor: { user_id: u.boss } }))
        .rejects.toMatchObject({ code: "ACCOUNT_MANAGER_INACTIVE", status: 422 });
      const { rows } = await c.query("SELECT relationship_manager_user_id FROM client_master WHERE client_id = $1", [cl.Delta]);
      expect(rows[0].relationship_manager_user_id).toBeNull();
    });

    it("names one, audits it, and tells them", async () => {
      const out = await accountManager.set(c, { clientId: cl.Delta, userId: u.am, actor: { user_id: u.boss } });
      expect(out.manager).toMatchObject({ user_id: u.am, name: "Awa Ndiaye", job_title: "Key account manager", reachable: true });

      const { rows: ledger } = await c.query(
        "SELECT actor_user_id, module_key::text AS module_key, before_json, after_json FROM immutable_ledger WHERE action = 'client.account_manager_set' AND entity_ref = $1",
        [`client:${cl.Delta}`],
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ actor_user_id: u.boss, module_key: "MOD-03", before_json: { user_id: null }, after_json: { user_id: u.am } });

      const told = await notificationsFor("am", `/comms/clients?client=${cl.Delta}`);
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ category: "comms", title: `You look after Delta ${tag}` });
    });

    it("does nothing when nothing changes", async () => {
      await accountManager.set(c, { clientId: cl.Delta, userId: u.am, actor: { user_id: u.boss } });
      const { rows } = await c.query("SELECT count(*)::int AS n FROM immutable_ledger WHERE action = 'client.account_manager_set' AND entity_ref = $1", [`client:${cl.Delta}`]);
      expect(rows[0].n).toBe(1);
    });

    it("does not tell someone who named themselves", async () => {
      await accountManager.set(c, { clientId: cl.Bois, userId: u.boss, actor: { user_id: u.boss } });
      expect(await notificationsFor("boss", `/comms/clients?client=${cl.Bois}`)).toHaveLength(0);
    });

    it("shows a manager who has left as unreachable, and routing stops counting them", async () => {
      await c.query("UPDATE app_user SET status = 'SUSPENDED' WHERE user_id = $1", [u.am]);
      const out = await accountManager.get(c, { clientId: cl.Delta });
      expect(out.manager).toMatchObject({ user_id: u.am, reachable: false });
      const audience = await repo.staffAudience(c, { clientId: cl.Delta, dossier: null });
      expect(audience.manager).toEqual([]);
    });

    it("clears it", async () => {
      const out = await accountManager.set(c, { clientId: cl.Delta, userId: null, actor: { user_id: u.boss } });
      expect(out.manager).toBeNull();
    });
  });

  describe("the client record's own create and edit", () => {
    // `relationship_manager_user_id` is part of the shared client schema, so
    // the master's create/update (and the AI's update_client) accept it. They
    // must not be a way round the check, the audit and the notice.
    const clientMaster = require("../../src/modules/master/client_master/client_master.service");

    it("refuses a login that is not active", async () => {
      await expect(clientMaster.update(c, { id: cl.Cacao, patch: { relationship_manager_user_id: u.leaver }, actor: { user_id: u.boss } }))
        .rejects.toMatchObject({ code: "ACCOUNT_MANAGER_INACTIVE" });
      const { rows } = await c.query("SELECT relationship_manager_user_id FROM client_master WHERE client_id = $1", [cl.Cacao]);
      expect(rows[0].relationship_manager_user_id).toBeNull();
    });

    it("names one through an edit, audited, and tells them", async () => {
      const out = await clientMaster.update(c, { id: cl.Cacao, patch: { relationship_manager_user_id: u.ops, notes: "Seasonal" }, actor: { user_id: u.boss } });
      expect(out).toMatchObject({ relationship_manager_user_id: u.ops, notes: "Seasonal" });
      const { rows } = await c.query("SELECT count(*)::int AS n FROM immutable_ledger WHERE action = 'client.account_manager_set' AND entity_ref = $1", [`client:${cl.Cacao}`]);
      expect(rows[0].n).toBe(1);
      expect(await notificationsFor("ops", `/comms/clients?client=${cl.Cacao}`)).toHaveLength(1);
    });

    it("names one on a new client", async () => {
      const row = await clientMaster.create(c, { data: { name: `Epsilon ${tag}`, phone: "+237 600 000 001", relationship_manager_user_id: u.ops }, actor: { user_id: u.boss } });
      expect(row.relationship_manager_user_id).toBe(u.ops);
      expect(await notificationsFor("ops", `/comms/clients?client=${row.client_id}`)).toHaveLength(1);
      await expect(clientMaster.create(c, { data: { name: `Zeta ${tag}`, phone: "+237 600 000 002", relationship_manager_user_id: u.leaver }, actor: { user_id: u.boss } }))
        .rejects.toMatchObject({ code: "ACCOUNT_MANAGER_INACTIVE" });
    });
  });

  it("grants the Client inbox to the people who answer clients", async () => {
    const { rows } = await c.query(
      `SELECT r.code, p.can_read, p.can_update
         FROM permission p JOIN role r ON r.role_id = p.role_id
        WHERE p.module_key = 'MOD-64C' ORDER BY r.code`,
    );
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["MANAGEMENT", "OPERATIONS", "SALES", "SUPER_ADMIN"]));
    expect(rows.every((r) => r.can_read && r.can_update)).toBe(true);
  });
});
