/**
 * The equipment on an operations file — "2 flat racks and 3 × 40' HC".
 *
 * WHAT WAS MISSING. The container TYPE registry has existed since 0630/0632 and
 * is priced per carrier per type by `expense_rate` (0634). What never existed
 * was any link from a FILE to the boxes on it, so the question "how many 40' HC
 * are on this job" had no answer anywhere in the system and anything charged
 * per container could only ever be estimated.
 *
 * WHOLE-COLLECTION REPLACE, deliberately.
 *
 * The UI for this is a small modal with a handful of rows — add a row, change a
 * quantity, delete a row, save. Modelling that as per-row POST/PATCH/DELETE
 * means the client tracks ids for rows the user may never keep, a half-applied
 * save leaves the file in a state nobody asked for, and "3 × 40HC" briefly
 * becomes "0 × 40HC" between two requests. One PUT of the whole list, in one
 * transaction, is simpler on both sides and cannot half-apply.
 *
 * PER-BOX DETAIL SURVIVES A RE-SAVE. A replace that dropped the container
 * numbers every time somebody corrected a quantity would make PER_BOX mode
 * useless. Units are therefore re-attached by container number where the line's
 * type is unchanged — so editing "3 × 40HC" to "4 × 40HC" keeps the three boxes
 * already identified and simply leaves room for the fourth.
 */
"use strict";

const repo = require("./dossier_container.repo");
const detailRepo = require("../shipment_details/shipment_details.repo");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { marks } = require("@praxis/shared");

const MODULE = "MOD-29";
const REPLACED = "dossier.containers_replaced";

/**
 * Regenerate `dossier.marks_numbers` from the file's equipment.
 *
 * THE SERVER IS THE AUTHORITY, and this is where it exercises that: marks are
 * recomputed on every container write, so the string cannot drift from the boxes
 * however the write arrived — the modal, the creation wizard, an import, or a
 * future API caller none of us has written yet. The browser previews the same
 * answer using the same module (`@praxis/shared` rules/marks), which is why
 * there is one implementation of a format five printed documents depend on.
 *
 * A file whose marks were deliberately overridden is left alone. That is the
 * whole point of the flag: the alternative is a system that quietly discards a
 * human's correction the next time somebody fixes a quantity.
 */
async function regenerateMarks(client, dossierId) {
  const { rows } = await client.query(
    "SELECT marks_numbers, marks_numbers_is_manual FROM dossier WHERE dossier_id = $1",
    [dossierId],
  );
  if (!rows[0] || rows[0].marks_numbers_is_manual === true) return null;

  const lines = await detailRepo.containersFor(client, dossierId);
  // `containersFor` already joins the registry and rides `extra` along, so the
  // token comes from the same row the picker showed and needs no second query.
  const typesById = new Map(
    lines
      .filter((l) => l.container_type_ref_id)
      .map((l) => [l.container_type_ref_id, { code: l.container_type_code, extra: l.container_type_extra || {} }]),
  );
  const next = marks.marksFromContainers(lines, typesById);
  if (next === rows[0].marks_numbers) return next;
  await client.query("UPDATE dossier SET marks_numbers = $2 WHERE dossier_id = $1", [dossierId, next || null]);
  return next;
}

/** The file must exist, and its service type must actually capture equipment —
 *  otherwise a caller could quietly attach containers to a representation
 *  mandate and the panel would have nowhere to show them. */
async function assertCaptures(client, dossierId) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, st.captures_containers, st.container_detail_mode, st.key AS service_key
       FROM dossier d LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
      WHERE d.dossier_id = $1`,
    [dossierId],
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (row.captures_containers !== true) {
    throw new AppError(
      "CONTAINERS_DISABLED",
      "This service type does not track containers. Turn on equipment capture under Service types → Details.",
      422,
    );
  }
  return row;
}

async function list(client, dossierId) {
  const { rows } = await client.query(
    "SELECT captures_containers, container_detail_mode FROM service_type st JOIN dossier d ON d.service_type_id = st.service_type_id WHERE d.dossier_id = $1",
    [dossierId],
  );
  const cfg = rows[0] || {};
  const lines = cfg.captures_containers ? await detailRepo.containersFor(client, dossierId) : [];
  return {
    enabled: cfg.captures_containers === true,
    mode: cfg.container_detail_mode || "GROUPED",
    lines,
  };
}

/**
 * Every container type id in the payload must be a live CONTAINER_TYPE row, and
 * every load mode a live LOAD_MODE row. Checked in ONE query rather than per
 * line: a typo'd uuid would otherwise fail on the foreign key with a 23503 that
 * names a constraint instead of the row the user was editing.
 */
async function assertRefs(client, lines) {
  const typeIds = [...new Set(lines.map((l) => l.container_type_ref_id).filter(Boolean))];
  const modeIds = [...new Set(lines.map((l) => l.load_mode_ref_id).filter(Boolean))];
  if (typeIds.length) {
    const known = await repo.refsOfKind(client, typeIds, "CONTAINER_TYPE");
    const bad = typeIds.filter((id) => !known.has(id));
    if (bad.length) {
      throw new AppError("UNKNOWN_CONTAINER_TYPE", "One or more container types are not recognised", 422, {
        container_type_ref_id: bad,
      });
    }
  }
  if (modeIds.length) {
    const known = await repo.refsOfKind(client, modeIds, "LOAD_MODE");
    const bad = modeIds.filter((id) => !known.has(id));
    if (bad.length) {
      throw new AppError("UNKNOWN_LOAD_MODE", "One or more load modes are not recognised", 422, {
        load_mode_ref_id: bad,
      });
    }
  }
}

/**
 * Replace a file's equipment with `lines`.
 *
 * Each line is `{ container_type_ref_id, qty, load_mode_ref_id?, gross_weight_kg?,
 * volume_cbm?, notes?, units?[] }`. `units` is optional at every level — a file
 * that only knows its counts is complete, and the numbers arrive later.
 */
async function replace(client, { dossierId, lines, actor = {} }) {
  const file = await assertCaptures(client, dossierId);
  await assertRefs(client, lines);

  // In PER_BOX mode a line's quantity is the number of boxes on it. Trusting
  // the client's `qty` while it sends four units would let the two disagree
  // permanently, and every count downstream would be wrong.
  const normalised = lines.map((l, i) => {
    const units = Array.isArray(l.units) ? l.units : [];
    if (units.length > (Number(l.qty) || 0)) {
      throw new AppError(
        "TOO_MANY_UNITS",
        `Line ${i + 1} lists ${units.length} container numbers but a quantity of ${l.qty}.`,
        422,
        { lines: [`line ${i + 1}: more container numbers than the quantity allows`] },
      );
    }
    const seen = new Set();
    for (const u of units) {
      if (!u.container_no) continue;
      const no = String(u.container_no).trim().toUpperCase();
      if (seen.has(no)) {
        throw new AppError("DUPLICATE_CONTAINER", `Container ${no} is listed twice on this file.`, 422, {
          lines: [`duplicate container number ${no}`],
        });
      }
      seen.add(no);
    }
    return { ...l, seq: l.seq === undefined ? (i + 1) * 10 : l.seq, units };
  });

  // A container number must be unique across the WHOLE file, not just a line —
  // the same box cannot be both a reefer and a flat rack on one job.
  const across = new Set();
  for (const l of normalised) {
    for (const u of l.units) {
      if (!u.container_no) continue;
      const no = String(u.container_no).trim().toUpperCase();
      if (across.has(no)) {
        throw new AppError("DUPLICATE_CONTAINER", `Container ${no} is listed twice on this file.`, 422, {
          lines: [`duplicate container number ${no}`],
        });
      }
      across.add(no);
    }
  }

  await client.query("BEGIN");
  try {
    const before = await detailRepo.containersFor(client, dossierId);
    // Carry forward what was already known about each box, keyed by number, so
    // a quantity correction does not discard seals and out-of-port dates.
    const carried = new Map();
    for (const l of before) {
      for (const u of l.units || []) {
        if (u.container_no) carried.set(String(u.container_no).trim().toUpperCase(), u);
      }
    }

    await repo.deleteLines(client, dossierId);
    const out = [];
    for (const l of normalised) {
      const line = await repo.insertLine(client, dossierId, l);
      for (const u of l.units) {
        const no = u.container_no ? String(u.container_no).trim().toUpperCase() : null;
        const prior = no ? carried.get(no) : null;
        await repo.insertUnit(client, dossierId, line.dossier_container_line_id, {
          // Explicit merge, prior value first: the payload wins where it says
          // something, and silence keeps what was already recorded.
          ...(prior || {}),
          ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)),
          container_no: no,
        });
      }
      out.push(line);
    }

    // Inside the transaction, deliberately: marks and equipment are one fact,
    // and a commit that saved the boxes but not the string they print as would
    // leave the file describing itself two ways.
    const marksNow = await regenerateMarks(client, dossierId);

    await audit(client, {
      actorUserId: actor.user_id || null,
      action: REPLACED,
      moduleKey: MODULE,
      entityRef: "dossier:" + dossierId,
      before: { lines: before.length },
      after: { lines: out.length, ref: file.ref, marks_numbers: marksNow },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  return list(client, dossierId);
}

/**
 * Hand marks & numbers back to the generator.
 *
 * The counterpart to typing over the field. Without it an override is a one-way
 * door: the moment somebody corrects the string once, that file stops tracking
 * its own equipment forever and nobody remembers why. Clearing the flag and
 * recomputing in one transaction means the answer on screen is the answer
 * stored.
 */
async function revertMarks(client, { dossierId, actor = {} }) {
  await assertCaptures(client, dossierId);
  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      "UPDATE dossier SET marks_numbers_is_manual = false WHERE dossier_id = $1 RETURNING marks_numbers",
      [dossierId],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", "Dossier not found", 404);
    const marksNow = await regenerateMarks(client, dossierId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "dossier.marks_reverted",
      moduleKey: MODULE,
      entityRef: "dossier:" + dossierId,
      before: { marks_numbers: rows[0].marks_numbers, is_manual: true },
      after: { marks_numbers: marksNow, is_manual: false },
    });
    await client.query("COMMIT");
    return { marks_numbers: marksNow, marks_numbers_is_manual: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

module.exports = { list, replace, regenerateMarks, revertMarks, assertCaptures, MODULE, REPLACED };
