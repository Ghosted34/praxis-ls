"use strict";
/** God Mode (CEO-only, PIN-gated). Purges junk NON-accounting data and writes
 *  the full removed payload to the immutable ledger (PRD §8.5). Accounting-
 *  connected records can never be purged — only reversed. */
const repo = require("./godmode.repo");
const crypto = require("crypto");

const listPurgeable = (c) => repo.listSoftDeletes(c);

// G24 — the legacy minted a fresh token weekly and refused anything past its
// expiry; the rebuild's standing PIN was the one regression. Default lifetime
// of a minted PIN: 7 days, same as the legacy. A CEO can also rotate by hand
// via POST /god-mode/pin (setPin).
const PIN_TTL_DAYS = 7;

/** Unambiguous alphabet — no 0/O, 1/l/I, 8/B — same reasoning as the legacy
 *  cron generator. */
const PIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Mint a fresh 6-character PIN and return it PLAINTEXT once (the caller —
 *  setPin/rotate — is responsible for delivering it out of band and never
 *  storing it). */
function mintPin() {
  let out = "";
  // crypto.randomInt is rejection-sampled under the hood — no modulo bias
  // (CodeQL js/biased-crypto: `bytes[i] % len` favours the first indices
  // unless len divides 256 evenly, and 31 does not).
  for (let i = 0; i < 6; i += 1) out += PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)];
  return out;
}

/** Argon2-hash + stamp expiry for a userId. Returns { expires_at }. */
async function storePinHash(c, { userId, pin }) {
  const argon2 = require("argon2");
  const hash = await argon2.hash(String(pin), { type: argon2.argon2id });
  const expiresAt = new Date(Date.now() + PIN_TTL_DAYS * 86400000).toISOString();
  await repo.setPin(c, { userId, hash, expiresAt });
  return { expires_at: expiresAt };
}

/** Verify a PIN against the CEO's stored hash, refusing an expired one. */
async function verifyPin(c, { userId, pin }) {
  const rec = await repo.pinHash(c, userId);
  if (!rec || !rec.godmode_pin_hash) {
    const e = new Error("God Mode is restricted to the CEO (no PIN on file)");
    e.status = 403;
    throw e;
  }
  if (rec.godmode_pin_expires_at && Date.parse(rec.godmode_pin_expires_at) < Date.now()) {
    const e = new Error("God Mode PIN has expired — request a new one from the CEO rotation email");
    e.status = 403;
    throw e;
  }
  const argon2 = require("argon2");
  let ok = false;
  try { ok = await argon2.verify(rec.godmode_pin_hash, pin || ""); } catch { ok = false; }
  if (!ok) {
    const e = new Error("invalid God Mode PIN");
    e.status = 403;
    throw e;
  }
  return true;
}

/**
 * CEO sets/rotates their own PIN by hand. The plaintext PIN is returned ONCE
 * (this is the only response that will ever carry it); the caller must save
 * it out of band. The hash stored is Argon2id and the row carries an expiry.
 */
async function setPin(c, { actor, pin }) {
  if (!actor || !actor.user_id) { const e = new Error("authentication required"); e.status = 401; throw e; }
  if (!pin || String(pin).length < 6 || String(pin).length > 64) {
    const e = new Error("God Mode PIN must be 6–64 characters");
    e.status = 422;
    throw e;
  }
  const out = await storePinHash(c, { userId: actor.user_id, pin });
  return { set: true, expires_at: out.expires_at };
}

/**
 * Weekly rotation (G24). Mints a fresh PIN for the tenant's CEO, stores the
 * hash + expiry, and delivers the plaintext out of band through the
 * notification EMAIL channel with a SECURITY category — the same channel the
 * legacy used, and the one whose delivery cannot be turned off by preference.
 * Returns the PIN only to the caller (the worker logs nothing about it).
 */
async function rotatePin(c, { deliver = true } = {}) {
  const ceo = await repo.ceoUser(c);
  if (!ceo) return { rotated: false, reason: "no CEO on file" };
  const pin = mintPin();
  const { expires_at } = await storePinHash(c, { userId: ceo.user_id, pin });
  if (deliver) {
    const notify = require("../../notification/notification.service");
    await notify.notify(c, {
      userId: ceo.user_id,
      eventTypeKey: "godmode.pin_rotated",
      title: "Your new God Mode PIN",
      body: `Your God Mode PIN for the next ${PIN_TTL_DAYS} days is: ${pin}`,
      category: "security",
      priority: "HIGH",
    });
  }
  return { rotated: true, expires_at, pin: deliver ? pin : undefined };
}

/**
 * Everything connected to a soft-deleted record, for the dependency preview
 * (meeting §11.2: "It shows every file connected to the record and asks
 * whether to delete across everything"):
 *   - ledger_refs — immutable-ledger rows keyed to this record; > 0 means it
 *     has touched the books and is unpurgeable (G5).
 *   - children — every table holding an FK to the record's table, with the
 *     count of rows pointing at this record, discovered from pg_constraint.
 */
async function dependencies(c, { softDeleteId }) {
  const row = await repo.getSoftDelete(c, softDeleteId);
  if (!row) {
    const e = new Error("record not found or already purged");
    e.status = 404;
    throw e;
  }
  const parsed = repo.parseEntityRef(row.entity_ref);
  const ledgerRefs = await repo.ledgerRefs(c, row.entity_ref);
  const children = [];
  if (parsed) {
    const pk = await repo.tablePk(c, parsed.table);
    if (pk) {
      const fks = await repo.referencingForeignKeys(c, parsed.table, pk);
      for (const fk of fks) {
        const n = await repo.childCount(c, fk.child_table, fk.child_col, parsed.id);
        if (n > 0) children.push({ table: fk.child_table, column: fk.child_col, count: n });
      }
    }
  }
  return {
    soft_delete: row,
    entity_ref: row.entity_ref,
    ledger_refs: ledgerRefs,
    purgeable: ledgerRefs === 0,
    children,
  };
}

async function purge(c, { actor, softDeleteId, pin, ip }) {
  if (!actor || !actor.user_id) { const e = new Error("authentication required"); e.status = 401; throw e; }
  // G24 — expiry is enforced inside verifyPin, so a stale PIN cannot purge.
  await verifyPin(c, { userId: actor.user_id, pin });

  const row = await repo.getSoftDelete(c, softDeleteId);
  if (!row) { const e = new Error("record not found or already purged"); e.status = 404; throw e; }

  // G5 — referential guard, not a naming convention. Any immutable-ledger row
  // keyed to this record means it has posted (or been part of a posted flow),
  // and a posted record can only be reversed, never purged. This covers every
  // posting module — invoice, journal, receipt, payment, asset, payroll,
  // credit_note, supplier_invoice, cash_request, regie, depreciation — with no
  // prefix list to keep in sync, because the ledger is written by every one.
  const ledgerRefs = await repo.ledgerRefs(c, row.entity_ref);
  if (ledgerRefs > 0) {
    const e = new Error(
      `accounting-connected records can never be purged — reverse instead (${ledgerRefs} immutable-ledger reference(s))`,
    );
    e.status = 422;
    throw e;
  }

  await repo.recordPurge(c, {
    actorUserId: actor.user_id,
    // Snapshot actor identity (0510) so the reader can render a card without a
    // cross-schema join. `actor` is `req.user` from the controller.
    actorName: actor.display_name || actor.email || null,
    actorEmail: actor.email || null,
    entityRef: row.entity_ref,
    payload: row.payload_json,
    ip,
  });
  return { purged: true, entity_ref: row.entity_ref };
}
module.exports = { listPurgeable, purge, dependencies, setPin, rotatePin, verifyPin, mintPin, PIN_TTL_DAYS };
