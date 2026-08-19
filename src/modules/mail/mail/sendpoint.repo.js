/**
 * SQL for the send-point registry — which sender each part of the product mails
 * from.
 */
"use strict";

const { insertOne } = require("../../../shared/db/query-helpers");

/** The zero uuid stands in for "no entity" so the unique index has one slot for it. */
const NO_ENTITY = "00000000-0000-0000-0000-000000000000";

/**
 * Every send point with its bindings, ready for the admin screen.
 *
 * The bindings come back as an aggregate rather than a second query because the
 * screen renders them together and an N+1 over twenty-two rows is twenty-two
 * round trips for a page that opens on every visit to the tab.
 */
async function listWithBindings(client) {
  const { rows } = await client.query(
    `SELECT sp.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'mail_send_point_binding_id', b.mail_send_point_binding_id,
                  'entity_id', b.entity_id,
                  'entity_name', ce.legal_name,
                  'email_identity_id', b.email_identity_id,
                  'identity_from', i.from_address,
                  'identity_name', i.from_name,
                  'email_connection_id', b.email_connection_id,
                  'connection_address', c.email_address,
                  'connection_status', c.status
                ) ORDER BY (b.entity_id IS NOT NULL), ce.legal_name
              ) FILTER (WHERE b.mail_send_point_binding_id IS NOT NULL),
              '[]'::json
            ) AS bindings
       FROM mail_send_point sp
       LEFT JOIN mail_send_point_binding b ON b.send_point_key = sp.send_point_key
       LEFT JOIN corporate_entity ce ON ce.entity_id = b.entity_id
       LEFT JOIN email_identity i ON i.email_identity_id = b.email_identity_id
       LEFT JOIN email_connection c ON c.email_connection_id = b.email_connection_id
      GROUP BY sp.send_point_key
      ORDER BY sp.group_key, sp.sort_order, sp.send_point_key`,
  );
  return rows;
}

const getSendPoint = (client, key) =>
  client.query("SELECT * FROM mail_send_point WHERE send_point_key = $1", [key]).then((r) => r.rows[0] || null);

/**
 * The binding that applies to a send point for a given entity: the entity's own
 * override if there is one, otherwise the tenant-wide row. Ordered so the
 * specific one wins, limited to one, so the caller cannot accidentally use both.
 */
const bindingFor = (client, sendPointKey, entityId = null) =>
  client.query(
    `SELECT b.*, i.from_address, i.from_name, i.reply_to, i.smtp_host, i.smtp_port,
            c.email_address AS connection_address, c.status AS connection_status,
            ce.legal_name AS entity_name
       FROM mail_send_point_binding b
       LEFT JOIN email_identity i ON i.email_identity_id = b.email_identity_id
       LEFT JOIN email_connection c ON c.email_connection_id = b.email_connection_id
       LEFT JOIN corporate_entity ce ON ce.entity_id = b.entity_id
      WHERE b.send_point_key = $1
        AND (b.entity_id IS NULL OR b.entity_id = $2)
      ORDER BY (b.entity_id IS NOT NULL) DESC
      LIMIT 1`,
    [sendPointKey, entityId],
  ).then((r) => r.rows[0] || null);

const upsertBinding = (client, { send_point_key, entity_id = null, email_identity_id = null, email_connection_id = null, created_by = null }) =>
  client.query(
    `INSERT INTO mail_send_point_binding
       (send_point_key, entity_id, email_identity_id, email_connection_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (send_point_key, COALESCE(entity_id, '${NO_ENTITY}'::uuid))
     DO UPDATE SET email_identity_id = EXCLUDED.email_identity_id,
                   email_connection_id = EXCLUDED.email_connection_id,
                   updated_at = now()
     RETURNING *`,
    [send_point_key, entity_id, email_identity_id, email_connection_id, created_by],
  ).then((r) => r.rows[0]);

const deleteBinding = (client, sendPointKey, entityId = null) =>
  client.query(
    `DELETE FROM mail_send_point_binding
      WHERE send_point_key = $1
        AND COALESCE(entity_id, '${NO_ENTITY}'::uuid) = COALESCE($2::uuid, '${NO_ENTITY}'::uuid)
      RETURNING *`,
    [sendPointKey, entityId],
  ).then((r) => r.rows[0] || null);

/** The legacy section binding, still the tier below a send-point binding. */
const legacyIdentityFor = (client, purpose) =>
  client.query(
    `SELECT i.* FROM email_section_binding b
       JOIN email_identity i ON i.email_identity_id = b.email_identity_id
      WHERE b.section_key = $1 AND i.is_active`,
    [purpose],
  ).then((r) => r.rows[0] || null);

const insertSendPoint = (client, data) => insertOne(client, "mail_send_point", data);

module.exports = {
  NO_ENTITY, listWithBindings, getSendPoint, bindingFor,
  upsertBinding, deleteBinding, legacyIdentityFor, insertSendPoint,
};
