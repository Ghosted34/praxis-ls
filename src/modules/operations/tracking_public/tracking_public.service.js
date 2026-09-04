"use strict";

const { AppError } = require("../../../utils/errors");
/**
 * The transport mode a service type moves cargo by.
 *
 * The rules moved to `operations/_shared/service-mode.js` when the public
 * services read needed the same answer — see that file for why it is derived
 * from `service_type.key` rather than stored. Re-exported here because this
 * module's payload contract (and `tests/unit/tracking-public-payload.test.js`)
 * names it, and because `routeLabels` below switches on it rather than
 * re-testing the key: the ship icon and the port-of-loading label can then never
 * disagree about what kind of shipment this is.
 */
const { serviceMode } = require("../_shared/service-mode");

const missing = () => new AppError("NOT_FOUND", "Shipment not found", 404);
const internalStatus = (row) => row.internal_status || row.status;

function routeLabels(dossier) {
  const mode = serviceMode(dossier.service_key);
  const details = dossier.details_json || {};
  if (mode === "AIR") {
    return {
      origin: details.air_origin || details.airport_origin || dossier.place_receipt || dossier.pol || null,
      destination: details.air_destination || details.airport_destination || dossier.place_delivery || dossier.pod || null,
    };
  }
  if (mode === "SEA") {
    return {
      origin: dossier.pol || details.sea_port_of_loading || details.port_of_loading || dossier.place_receipt || null,
      destination: dossier.pod || details.sea_port_of_discharge || details.port_of_discharge || dossier.place_delivery || null,
    };
  }
  return {
    origin: dossier.place_receipt || details.place_of_receipt || dossier.pol || null,
    destination: dossier.place_delivery || details.place_of_delivery || dossier.pod || null,
  };
}

/**
 * The service type, named in both languages, plus its mode.
 *
 * The name is sent as `name_fr` / `name_en` rather than resolved here, matching
 * every other public read in this repo (`service_type_web_public`): the language
 * is the visitor's, it can change without a request, and a server that picks one
 * makes the language toggle refetch the page to change a single word.
 *
 * Null where the dossier has no service type. A file can be opened before the
 * desk has classified it, and the page must render that rather than invent a
 * mode — which is why this is an object-or-null and not a bare string with a
 * default.
 */
function serviceType(dossier) {
  if (!dossier.service_key) return null;
  return {
    key: dossier.service_key,
    name_fr: dossier.service_name_fr || null,
    name_en: dossier.service_name_en || null,
    mode: serviceMode(dossier.service_key),
  };
}

/**
 * When this shipment last moved — the most recent completion, not `now()`.
 *
 * The reason it is derived rather than read from `dossier.updated_at`: that
 * column moves when anyone edits the file, so a spelling correction to an
 * internal note would tell a visitor their cargo had progressed. The latest
 * `completed_at` among the CLIENT-VISIBLE milestones is the only timestamp on
 * this page whose meaning matches what it will be read as.
 *
 * Null while nothing has completed — a file that has been opened and not yet
 * started. The page says so; it does not print the file's creation date under a
 * heading that says "last update".
 *
 * Max rather than last: `stage_seq` order is not completion order. A stage
 * finished out of sequence (documents verified after arrival, which happens
 * constantly) would otherwise report an older moment than one further up.
 */
function lastUpdate(milestones) {
  let latest = null;
  for (const row of milestones) {
    if (!row.completed_at) continue;
    const at = new Date(row.completed_at);
    if (Number.isNaN(at.getTime())) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : latest.toISOString();
}

/**
 * Anonymous allow-list response. Internal dossier/milestone status, forecast,
 * health, delay attribution and cause notes are queried only where needed to
 * compute a stable public state, and are never copied into the response.
 */
async function get(client, reference) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.pol, d.pod, d.place_receipt,
            d.place_delivery, d.details_json,
            st.key AS service_key,
            st.name_fr AS service_name_fr,
            st.name_en AS service_name_en
       FROM dossier_visible d
       LEFT JOIN service_type st USING (service_type_id)
      WHERE d.ref = $1`,
    [reference],
  );
  const dossier = rows[0];
  if (!dossier) throw missing();

  const { rows: milestones } = await client.query(
    `SELECT code, label, label_en, status AS internal_status,
            planned_due AS due_date, completed_at,
            public_location, public_stage_reference, public_progress_note
       FROM milestone_instance
      WHERE dossier_id = $1 AND is_client_visible
      ORDER BY stage_seq`,
    [dossier.dossier_id],
  );

  const done = milestones.filter((row) => internalStatus(row) === "DONE").length;
  const currentIndex = milestones.findIndex((row) => internalStatus(row) !== "DONE");
  const effectiveCurrentIndex = currentIndex >= 0 ? currentIndex : milestones.length - 1;
  const labels = routeLabels(dossier);
  const publicMilestones = milestones.map((row, index) => ({
    code: row.code,
    label: row.label_en || row.label,
    public_state: internalStatus(row) === "DONE"
      ? "COMPLETED"
      : index === effectiveCurrentIndex ? "CURRENT" : "UPCOMING",
    is_complete: internalStatus(row) === "DONE",
    is_current: index === effectiveCurrentIndex,
    due_date: row.due_date || null,
    completed_at: row.completed_at || null,
    location: row.public_location || null,
    stage_reference: row.public_stage_reference || null,
    progress_note: row.public_progress_note || null,
  }));
  const current = publicMilestones[effectiveCurrentIndex] || null;

  return {
    reference: dossier.ref,
    service_type: serviceType(dossier),
    last_update: lastUpdate(milestones),
    computed_status: milestones.length && done === milestones.length
      ? "COMPLETED"
      : done ? "IN_PROGRESS" : "PENDING",
    current_stage: current ? {
      code: current.code,
      label: current.label,
      public_state: current.public_state,
      is_complete: current.is_complete,
      is_current: current.is_current,
      due_date: current.due_date,
      completed_at: current.completed_at,
      location: current.location,
      stage_reference: current.stage_reference,
      progress_note: current.progress_note,
    } : null,
    origin: labels.origin,
    destination: labels.destination,
    progress: {
      completed: done,
      total: milestones.length,
      percent: milestones.length ? Math.round((done * 100) / milestones.length) : 0,
    },
    milestones: publicMilestones,
  };
}

module.exports = { get, missing, routeLabels, serviceMode, serviceType, lastUpdate };
