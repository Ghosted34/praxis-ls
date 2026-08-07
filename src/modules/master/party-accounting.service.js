/**
 * Party auxiliary accounting (spec §3) — shared by client_master and
 * supplier_master.
 *
 * Every active client gets a postable sub-account under the SYSCOHADA control
 * account 4111 (e.g. 41110001); every active supplier under 4011. Adding the
 * first child DEMOTES the control account to non-postable (a postable account
 * must be a leaf — the same invariant chart_of_accounts.service enforces), so
 * the parent keeps rolling up its children instead of taking postings itself.
 *
 * Mirror accounts — customer advances received (4191), advances paid to a
 * supplier (4091), supplier WHT (4474) — are created LAZILY the first time one
 * is needed, and are linked back to the party by SHARING THE AUX SUFFIX: a
 * client whose aux account is 41110007 has its advances-received account at
 * 41910007. No extra column is needed to find the pair — the suffix is the link.
 *
 * On archive the aux account is DEACTIVATED, never deleted: journal lines
 * reference it, and the roll-up must stay reconstructable.
 *
 * This file has no routes of its own (it is not a mounted module); it is called
 * from the two master services inside their existing transaction, so it never
 * opens one of its own.
 */
"use strict";
const coaRepo = require("./chart_of_accounts/chart_of_accounts.repo");
const { AppError } = require("../../utils/errors");

/**
 * Per-party wiring. `table`/`pk` are code-provided literals (never request
 * input), so interpolating them into the two SQL statements below is safe.
 */
const PARTY = {
  client: {
    table: "client_master", pk: "client_id", parent: "4111",
    labelFr: "Client", labelEn: "Client",
    mirrors: { ADVANCE: "4191" },
    // The master column that records each mirror account's code — the explicit
    // link that replaces the fragile "shared suffix" positional link.
    mirrorColumns: { ADVANCE: "coa_advance_account" },
  },
  supplier: {
    table: "supplier_master", pk: "supplier_id", parent: "4011",
    labelFr: "Fournisseur", labelEn: "Supplier",
    mirrors: { ADVANCE: "4091", WHT: "4474" },
    mirrorColumns: { ADVANCE: "coa_advance_account", WHT: "coa_wht_account" },
  },
};

const MIRROR_LABEL = {
  ADVANCE: { fr: "Avances", en: "Advances" },
  WHT: { fr: "Retenue à la source", en: "Withholding" },
};

// ── Pure helpers (unit-tested directly) ─────────────────────────────────────

/**
 * The next 8-digit child code under a 4-digit control account. Starts the
 * sequence at `<parent>0001` and otherwise increments the current maximum by
 * one. Codes are numeric OHADA strings, so `Number(...) + 1` is the increment
 * and never loses a leading digit (a class-4 code never starts with 0).
 */
function nextAuxCode(parent, maxChild) {
  if (!maxChild) return `${parent}0001`;
  return String(Number(maxChild) + 1);
}

/**
 * The suffix-shared mirror code — 41110007 → (4191) → 41910007. This is the
 * PREFERRED code (it keeps the aux/mirror pair legible), but it is no longer
 * trusted blindly: sharing a 4-digit suffix collides once a control account has
 * more than 9999 children (the aux code overflows and the suffix wraps), at
 * which point two parties map to the same mirror code. `chooseMirrorCode` adds
 * the collision check.
 */
function mirrorCodeFor(auxCode, mirrorParent) {
  return `${mirrorParent}${String(auxCode).slice(-4)}`;
}

/**
 * Pick a mirror account code that is guaranteed free (PR3 §12, mirror-collision
 * fix). Prefer the suffix-shared code; if it is already taken — another party's
 * mirror after a suffix wrap — allocate the next child from the mirror parent's
 * OWN sequence instead, exactly as an aux account is allocated. Pure, so both
 * branches are unit-tested directly.
 *
 * @param {object} a
 * @param {string} a.auxCode        the party's aux account code.
 * @param {string} a.mirrorParent   the mirror control account (4191/4091/4474).
 * @param {boolean} a.suffixTaken   is the suffix-shared code already in the COA?
 * @param {?string} a.maxMirrorChild highest existing child under `mirrorParent`.
 */
function chooseMirrorCode({ auxCode, mirrorParent, suffixTaken, maxMirrorChild }) {
  const preferred = mirrorCodeFor(auxCode, mirrorParent);
  if (!suffixTaken) return preferred;
  return nextAuxCode(mirrorParent, maxMirrorChild);
}

// ── DB operations (run inside the caller's transaction) ─────────────────────

async function partyRow(client, cfg, id) {
  const { rows } = await client.query(`SELECT * FROM ${cfg.table} WHERE ${cfg.pk} = $1`, [id]);
  return rows[0] || null;
}

/** Highest existing `<parent>NNNN` child code, or null when there are none. */
async function maxChildCode(client, parent) {
  const { rows } = await client.query(
    `SELECT code FROM chart_of_accounts WHERE code ~ ('^' || $1 || '[0-9]{4}$') ORDER BY code DESC LIMIT 1`,
    [parent],
  );
  return rows[0] ? rows[0].code : null;
}

function labelName(party, id) {
  return party.ref || party.name || party.legal_name || id;
}

async function insertLeaf(client, { code, parent, labelFr, labelEn, entityId }) {
  if (parent.is_postable) await coaRepo.update(client, parent.code, { is_postable: false }); // parent now has a child
  return coaRepo.insert(client, {
    code,
    parent_code: parent.code,
    label_fr: labelFr,
    label_en: labelEn,
    class: 4,
    normal_balance: parent.normal_balance,
    requires_analytic: parent.requires_analytic,
    is_postable: true,
    is_system: false,
    is_active: true,
    entity_id: entityId || null,
  });
}

/**
 * Allocate (or return the existing) aux account for an active party. Idempotent:
 * a party that already has `coa_aux_account` is returned unchanged, so calling
 * this on every activation is safe.
 */
async function allocateAux(client, { kind, partyId }) {
  const cfg = PARTY[kind];
  if (!cfg) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  const party = await partyRow(client, cfg, partyId);
  if (!party) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  if (party.coa_aux_account) return { code: party.coa_aux_account, created: false };

  const parent = await coaRepo.get(client, cfg.parent);
  if (!parent) throw new AppError("NO_CONTROL_ACCOUNT", `control account ${cfg.parent} is missing`, 500);
  const code = nextAuxCode(cfg.parent, await maxChildCode(client, cfg.parent));
  const name = labelName(party, partyId);
  await insertLeaf(client, {
    code, parent, labelFr: `${cfg.labelFr} ${name}`, labelEn: `${cfg.labelEn} ${name}`, entityId: party.entity_id,
  });
  await client.query(
    `UPDATE ${cfg.table} SET coa_aux_account = $1, updated_at = now() WHERE ${cfg.pk} = $2`,
    [code, partyId],
  );
  return { code, created: true };
}

/**
 * Ensure the mirror account (ADVANCE for either party, WHT for suppliers)
 * exists, creating it lazily. Allocates the base aux account first if the party
 * does not have one yet, so the suffix the mirror shares is defined.
 */
async function ensureMirror(client, { kind, partyId, mirror }) {
  const cfg = PARTY[kind];
  if (!cfg) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  const mirrorParent = cfg.mirrors[mirror];
  if (!mirrorParent) throw new AppError("BAD_MIRROR", `${kind} has no ${mirror} mirror account`, 422);
  const column = cfg.mirrorColumns[mirror];

  const party = await partyRow(client, cfg, partyId);
  if (!party) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  // Idempotent on the RECORDED link: a stored code is unambiguously this party's
  // mirror account, so a re-call never risks returning another party's.
  if (column && party[column]) return { code: party[column], created: false };

  const aux = party.coa_aux_account || (await allocateAux(client, { kind, partyId })).code;

  // Prefer the suffix-shared code; on a collision fall back to the mirror
  // parent's own next child (PR3 §12). `maxChildCode` is only queried when the
  // suffix is actually taken, so the common path stays a single lookup.
  const preferred = mirrorCodeFor(aux, mirrorParent);
  const clash = await coaRepo.get(client, preferred);
  const code = chooseMirrorCode({
    auxCode: aux, mirrorParent, suffixTaken: !!clash,
    maxMirrorChild: clash ? await maxChildCode(client, mirrorParent) : null,
  });

  const parent = await coaRepo.get(client, mirrorParent);
  if (!parent) throw new AppError("NO_CONTROL_ACCOUNT", `control account ${mirrorParent} is missing`, 500);
  const name = labelName(party, partyId);
  const lbl = MIRROR_LABEL[mirror];
  await insertLeaf(client, {
    code, parent, labelFr: `${lbl.fr} ${name}`, labelEn: `${lbl.en} ${name}`, entityId: party.entity_id,
  });
  // Record the explicit link so the pair is found without relying on the suffix.
  if (column) {
    await client.query(`UPDATE ${cfg.table} SET ${column} = $1, updated_at = now() WHERE ${cfg.pk} = $2`, [code, partyId]);
  }
  return { code, created: true };
}

/** Deactivate the aux account on archive — never delete (journal lines ref it). */
async function deactivateAux(client, { kind, partyId }) {
  const cfg = PARTY[kind];
  if (!cfg) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  const party = await partyRow(client, cfg, partyId);
  if (!party || !party.coa_aux_account) return { deactivated: false };
  await coaRepo.update(client, party.coa_aux_account, { is_active: false });
  return { deactivated: true, code: party.coa_aux_account };
}

module.exports = {
  PARTY,
  nextAuxCode,
  mirrorCodeFor,
  chooseMirrorCode,
  allocateAux,
  ensureMirror,
  deactivateAux,
};
