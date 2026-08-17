"use strict";

const { AppError } = require("../../../utils/errors");

const missing = () => new AppError("NOT_FOUND", "Shipment not found", 404);
const internalStatus = (row) => row.internal_status || row.status;

function routeLabels(dossier) {
  const key = String(dossier.service_key || "").toUpperCase();
  const details = dossier.details_json || {};
  if (key.includes("AIR")) {
    return {
      origin: details.air_origin || details.airport_origin || dossier.place_receipt || dossier.pol || null,
      destination: details.air_destination || details.airport_destination || dossier.place_delivery || dossier.pod || null,
    };
  }
  if (key.includes("SEA")) {
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
 * Anonymous allow-list response. Internal dossier/milestone status, forecast,
 * health, delay attribution and cause notes are queried only where needed to
 * compute a stable public state, and are never copied into the response.
 */
async function get(client, reference) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.pol, d.pod, d.place_receipt,
            d.place_delivery, d.details_json, st.key AS service_key
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

module.exports = { get, missing, routeLabels };
