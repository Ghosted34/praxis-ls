/**
 * Operations API helpers (typed) — dossiers (operation files), transit orders,
 * delivery notes, milestones. Routes mirror src/modules/operations/*.
 */
import { tenant } from "./api-client";

/* ── Operation files / dossiers(/operations) ── */
export type Dossier = {
  dossier_id: string;
  ref: string;
  entity_id?: string | null;
  client_id?: string | null;
  service_type_id?: string | null;
  status: string;
  incoterm?: string | null;
  bl_mawb?: string | null;
  vessel_flight?: string | null;
  pol?: string | null;
  pod?: string | null;
  customs_regime?: string | null;
  eta?: string | null;
  ata?: string | null;
  created_at?: string;
};
export type DossierInput = {
  entity_id: string;
  client_id?: string;
  service_type_id?: string;
  incoterm?: string;
  bl_mawb?: string;
  pol?: string;
  pod?: string;
  customs_regime?: string;
};
export const listDossiers = () => tenant<Dossier[]>("/operations");
export const getDossier = (id: string) => tenant<Dossier & { lines?: unknown[] }>(`/operations/${id}`);
export const dossier360 = (id: string) => tenant<Record<string, unknown>>(`/operations/${id}/360`);
export const createDossier = (body: DossierInput) => tenant<Dossier>("/operations", { method: "POST", body });
export const updateDossier = (id: string, body: Partial<DossierInput>) => tenant<Dossier>(`/operations/${id}`, { method: "PATCH", body });
export const transitionDossier = (id: string, to: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") =>
  tenant<Dossier>(`/operations/${id}/transition`, { method: "POST", body: { to } });

/* ── Transit orders(/transit-orders) ── */
export type TransitOrder = {
  transit_order_id: string;
  ref?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  customs_regime?: string | null;
  service_direction?: string | null;
  declared_value?: number | null;
  status?: string | null;
  created_at?: string;
};
export type TransitOrderInput = {
  entity_id: string;
  dossier_id?: string;
  customs_regime?: string;
  service_direction?: string;
  declared_value?: number;
  submitted_docs?: unknown[];
  date?: string;
};
export const listTransitOrders = () => tenant<TransitOrder[]>("/transit-orders");
export const createTransitOrder = (body: TransitOrderInput) => tenant<TransitOrder>("/transit-orders", { method: "POST", body });
export const updateTransitOrder = (id: string, body: Partial<TransitOrderInput>) => tenant<TransitOrder>(`/transit-orders/${id}`, { method: "PATCH", body });

/* ── Delivery notes(/delivery-notes) ── */
export type DeliveryNote = {
  delivery_note_id: string;
  ref?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  consignee?: string | null;
  city_zone?: string | null;
  contact_person?: string | null;
  status?: string | null;
  created_at?: string;
};
export type DeliveryNoteInput = {
  entity_id: string;
  dossier_id?: string;
  consignee?: string;
  city_zone?: string;
  contact_person?: string;
  date?: string;
};
export const listDeliveryNotes = () => tenant<DeliveryNote[]>("/delivery-notes");
export const createDeliveryNote = (body: DeliveryNoteInput) => tenant<DeliveryNote>("/delivery-notes", { method: "POST", body });

/* ── Milestones(/milestones) — templates + per-dossier instances ── */
export type MilestoneTemplate = {
  milestone_template_id?: string;
  code?: string;
  label_fr?: string;
  label_en?: string | null;
  stage_seq?: number;
  default_offset_days?: number | null;
  service_type_id?: string | null;
};
export type MilestoneInstance = {
  milestone_instance_id: string;
  dossier_id: string;
  code?: string;
  label_fr?: string;
  status: string;
  due_date?: string | null;
  completed_at?: string | null;
};
export const listMilestoneTemplates = () => tenant<MilestoneTemplate[]>("/milestones/templates");
export const milestonesByDossier = (dossierId: string) => tenant<MilestoneInstance[]>(`/milestones/dossier/${dossierId}`);
export const advanceMilestone = (id: string, body: { evidence_vault_id?: string } = {}) =>
  tenant<MilestoneInstance>(`/milestones/${id}/advance`, { method: "POST", body });
