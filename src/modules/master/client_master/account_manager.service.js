/**
 * A client's account manager (client portal PR 3, 14200).
 *
 * The person on the team who looks after a client: the first one a client's
 * portal message reaches, with the owners of the shipment it is about
 * (portal_chat.service alertTeam), and whose clients are "Mine" in the Client
 * inbox. Stored in `client_master.relationship_manager_user_id` — the column
 * 0511 added for exactly this and nothing ever set.
 *
 * A LOGIN, chosen from the employee picker (people with a login only), because
 * that is what an alert reaches. The service refuses a login that is not
 * ACTIVE: an account manager who cannot be told is a message that goes
 * nowhere, and the routing would silently fall back while the screen said the
 * client was looked after. A manager who later LEAVES is shown as such
 * (`reachable: false`) and the routing falls back to the inbox until someone
 * is named in their place.
 *
 * Assigning is audited, and the new manager is told — "you look after Acme
 * now" — unless they assigned themselves.
 */
"use strict";

const notifications = require("../../notification/notification.service");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const { logger } = require("../../../config/logger");

const MODULE = "MOD-03";

async function read(c, clientId) {
  const { rows } = await c.query(
    `SELECT cm.client_id, COALESCE(cm.name, cm.legal_name) AS client_name,
            cm.relationship_manager_user_id AS user_id,
            u.full_name AS user_name, u.email, u.status,
            e.employee_id, e.full_name AS employee_name, e.job_title
       FROM client_master cm
       LEFT JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE cm.client_id = $1`,
    [clientId],
  );
  return rows[0] || null;
}

function view(row) {
  if (!row.user_id) return { client_id: row.client_id, manager: null };
  return {
    client_id: row.client_id,
    manager: {
      user_id: row.user_id,
      // The employee's name is the one the team knows; the login's is the
      // fallback for a login with no employee record behind it.
      name: row.employee_name || row.user_name || row.email || null,
      job_title: row.job_title || null,
      email: row.email || null,
      employee_id: row.employee_id || null,
      reachable: row.status === "ACTIVE",
    },
  };
}

/** Who looks after this client, if anyone. */
async function get(c, { clientId }) {
  const row = await read(c, clientId);
  if (!row) throw new AppError("NOT_FOUND", "Client not found", 404);
  return view(row);
}

/** Name the account manager (a login), or clear it with null. */
async function set(c, { clientId, userId = null, actor = {} }) {
  const before = await read(c, clientId);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  const next = userId || null;
  if ((before.user_id || null) === next) return view(before);

  let person = null;
  if (next) {
    const { rows } = await c.query("SELECT user_id, full_name, status FROM app_user WHERE user_id = $1", [next]);
    person = rows[0] || null;
    if (!person || person.status !== "ACTIVE") {
      throw new AppError(
        "ACCOUNT_MANAGER_INACTIVE",
        "Choose someone with an active login — client messages could not reach anyone else.",
        422,
      );
    }
  }

  // The change and its audit row land together, or neither does.
  await atomically(c, async () => {
    await c.query(
      "UPDATE client_master SET relationship_manager_user_id = $2, updated_at = now() WHERE client_id = $1",
      [clientId, next],
    );
    const actorId = await resolveActorId(c, actor.user_id);
    await audit(c, {
      actorUserId: actorId,
      action: "client.account_manager_set",
      moduleKey: MODULE,
      entityRef: `client:${clientId}`,
      before: { user_id: before.user_id || null },
      after: { user_id: next },
    });
  });

  // Told, unless they named themselves. Best-effort: the assignment stands
  // whether or not the notification can be written.
  if (next && next !== actor.user_id) {
    try {
      await notifications.notify(c, {
        userId: next,
        eventTypeKey: "client.account_manager_assigned",
        category: "comms",
        title: `You look after ${before.client_name || "a client"}`,
        body: "Their portal messages now reach you first.",
        entityRef: `client:${clientId}`,
        url: `/comms/clients?client=${clientId}`,
      });
    } catch (err) {
      logger.warn({ err, clientId }, "account manager: assignment notice not sent");
    }
  }
  return get(c, { clientId });
}

/**
 * Who can be named: people with an ACTIVE login, searched by name or job — the
 * employee picker's rows, cut to what a picker shows.
 *
 * Its own read rather than `/employees`, because the people who assign
 * account managers (sales and operations, through the Client inbox's MOD-64C)
 * do not hold the employee master (MOD-02), and that endpoint answers with the
 * whole staff record. A person with two logins is offered with the oldest
 * ACTIVE one — the same "oldest" the employee list picks, minus the logins an
 * alert could not reach.
 */
async function candidates(c, { q = "", limit = 15 } = {}) {
  const term = String(q || "").trim().slice(0, 80);
  const n = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const { rows } = await c.query(
    `SELECT e.employee_id, e.full_name, e.job_title, e.department, u.user_id AS account_user_id
       FROM employee e
       JOIN LATERAL (
         SELECT au.user_id
           FROM app_user au
          WHERE au.employee_id = e.employee_id AND au.status = 'ACTIVE'
          ORDER BY au.created_at ASC
          LIMIT 1
       ) u ON true
      WHERE e.is_active = true
        AND ($1 = '' OR e.full_name ILIKE '%' || $1 || '%' OR e.job_title ILIKE '%' || $1 || '%')
      ORDER BY e.full_name ASC
      LIMIT $2`,
    [term, n],
  );
  return rows;
}

module.exports = { get, set, candidates };
