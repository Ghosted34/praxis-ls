/**
 * Binding suggestions. Ingest NEVER writes email_thread.entity_ref while
 * auto-accept is off (Q18, ships null). Accepting is a human act and is audited.
 */
"use strict";

const extract = require("./binding.extract");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");

async function lookupWorld(client, fromAddress) {
  const domain = String(fromAddress || "").split("@")[1] || "";
  const [dossiers, invoices, contacts, domains] = await Promise.all([
    client.query(`SELECT dossier_id, ref FROM dossier_visible LIMIT 500`).then((r) => r.rows).catch(() => []),
    client.query(`SELECT invoice_id, doc_number FROM invoice LIMIT 500`).then((r) => r.rows).catch(() => []),
    client.query(
      `SELECT email, 'client:' || client_id AS entity_ref, name AS label
         FROM client_master WHERE lower(email) = lower($1)
       UNION ALL
       SELECT email, 'client:' || client_id, name FROM client_contact WHERE lower(email) = lower($1)`,
      [fromAddress],
    ).then((r) => r.rows).catch(() => []),
    domain
      ? client.query(
        `SELECT lower(split_part(email,'@',2)) AS domain, 'client:' || client_id AS entity_ref, name AS label
           FROM client_master WHERE email LIKE '%@%' LIMIT 200`,
      ).then((r) => r.rows.filter((x) => x.domain === domain.toLowerCase())).catch(() => [])
      : [],
  ]);
  return { dossiers, invoices, contacts, domains, pos: [], quotes: [] };
}

async function suggestOnIngest(client, { threadId, messageId, fromAddress, subject, bodyText, filenames, existingBinding }) {
  const world = await lookupWorld(client, fromAddress);
  world.existingBinding = existingBinding || null;
  if (!existingBinding) {
    const { rows } = await client.query(
      `SELECT entity_ref FROM email_thread WHERE email_thread_id = $1`,
      [threadId],
    );
    if (rows[0] && rows[0].entity_ref) {
      world.existingBinding = { entity_ref: rows[0].entity_ref };
    }
  }
  const suggestions = extract.extract(
    { subject, body_text: bodyText, from_address: fromAddress, filenames },
    world,
  );

  const setting = (await getSetting(client, "mail", "binding", {})) || {};
  const threshold = setting.auto_accept_threshold;
  const autoAccept = typeof threshold === "number" && threshold > 0;

  for (const s of suggestions) {
    await client.query(
      `INSERT INTO email_binding_suggestion (
         email_thread_id, email_message_id, entity_ref, entity_label, signal, matched_text, confidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email_thread_id, entity_ref, signal) DO NOTHING`,
      [threadId, messageId || null, s.entity_ref, s.entity_label, s.signal, s.matched_text, s.confidence],
    );
    // THREAD_HISTORY is not a new binding — it is the same one. Apply it so
    // later messages inherit without a chip. Auto-accept otherwise stays OFF.
    if (s.signal === "THREAD_HISTORY" && world.existingBinding) {
      await client.query(
        `UPDATE email_thread SET entity_ref = $2 WHERE email_thread_id = $1 AND entity_ref IS NULL`,
        [threadId, s.entity_ref],
      );
    } else if (autoAccept && s.confidence >= threshold) {
      await accept(client, { threadId, suggestionId: null, entityRef: s.entity_ref, actor: { user_id: null }, auto: true });
    }
  }
  return suggestions;
}

const list = (client, threadId) =>
  client.query(
    `SELECT * FROM email_binding_suggestion WHERE email_thread_id = $1 ORDER BY confidence DESC, created_at`,
    [threadId],
  ).then((r) => r.rows);

async function accept(client, { threadId, suggestionId, entityRef, actor = {}, auto = false }) {
  let row = null;
  if (suggestionId) {
    const { rows } = await client.query(
      `UPDATE email_binding_suggestion SET status='ACCEPTED', decided_by=$2, decided_at=now()
        WHERE email_binding_suggestion_id = $1 AND email_thread_id = $3
        RETURNING *`,
      [suggestionId, actor.user_id || null, threadId],
    );
    row = rows[0];
    if (!row) throw new AppError("NOT_FOUND", "suggestion not found", 404);
    entityRef = row.entity_ref;
  }
  await client.query(
    `UPDATE email_thread SET entity_ref = $2, updated_at = now() WHERE email_thread_id = $1`,
    [threadId, entityRef],
  );
  await client.query(
    `UPDATE email_binding_suggestion SET status='SUPERSEDED'
      WHERE email_thread_id = $1 AND status='SUGGESTED' AND entity_ref <> $2`,
    [threadId, entityRef],
  );
  if (!auto) {
    await emitEvent(client, {
      eventTypeKey: "email.thread.bound", moduleKey: "MOD-72",
      entityRef: `email_thread:${threadId}`, actorUserId: actor.user_id || null,
      payload: { bound: entityRef, signal: row && row.signal },
    }).catch(() => { /* @silent:storage the bound row is the outcome */ });
    await audit(client, {
      actorUserId: actor.user_id || null, action: "email.thread.bound",
      moduleKey: "MOD-72", entityRef: `email_thread:${threadId}`,
      after: { entity_ref: entityRef },
    }).catch(() => { /* @silent:storage the bound row is the outcome */ });
  }
  return { email_thread_id: threadId, entity_ref: entityRef };
}

async function reject(client, { threadId, suggestionId, actor = {} }) {
  const { rows } = await client.query(
    `UPDATE email_binding_suggestion SET status='REJECTED', decided_by=$2, decided_at=now()
      WHERE email_binding_suggestion_id = $1 AND email_thread_id = $3
      RETURNING *`,
    [suggestionId, actor.user_id || null, threadId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "suggestion not found", 404);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "email.thread.suggestion.rejected",
    moduleKey: "MOD-72", entityRef: `email_thread:${threadId}`,
    after: { suggestion: suggestionId },
  }).catch(() => { /* @silent:storage the REJECTED row is the outcome */ });
  return rows[0];
}

async function bind(client, { threadId, entityRef, actor = {} }) {
  if (!entityRef) throw new AppError("VALIDATION_ERROR", "entity_ref is required", 422);
  return accept(client, { threadId, entityRef, actor });
}

async function unbind(client, { threadId, actor = {} }) {
  const before = await client.query(`SELECT entity_ref FROM email_thread WHERE email_thread_id = $1`, [threadId]);
  await client.query(`UPDATE email_thread SET entity_ref = NULL WHERE email_thread_id = $1`, [threadId]);
  await emitEvent(client, {
    eventTypeKey: "email.thread.unbound", moduleKey: "MOD-72",
    entityRef: `email_thread:${threadId}`, actorUserId: actor.user_id || null,
    payload: { was: before.rows[0] && before.rows[0].entity_ref },
  }).catch(() => { /* @silent:storage the unbound row is the outcome */ });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "email.thread.unbound",
    moduleKey: "MOD-72", entityRef: `email_thread:${threadId}`,
    before: before.rows[0], after: { entity_ref: null },
  }).catch(() => { /* @silent:storage the unbound row is the outcome */ });
  return { email_thread_id: threadId, entity_ref: null };
}

async function acceptBatch(client, { threadIds = [], minConfidence = 0.9, actor = {} }) {
  const results = [];
  for (const id of threadIds) {
    const { rows } = await client.query(
      `SELECT * FROM email_binding_suggestion
        WHERE email_thread_id = $1 AND status='SUGGESTED' AND confidence >= $2
        ORDER BY confidence DESC LIMIT 1`,
      [id, minConfidence],
    );
    if (rows[0]) results.push(await accept(client, { threadId: id, suggestionId: rows[0].email_binding_suggestion_id, actor }));
  }
  return { accepted: results.length, results };
}

module.exports = { suggestOnIngest, list, accept, reject, bind, unbind, acceptBatch };
