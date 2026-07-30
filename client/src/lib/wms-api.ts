/**
 * Warehouse (WMS) API helpers — inventory ledger + movements, locations,
 * cycle counts, outbound pick/pack. Routes mirror src/modules/wms/*.
 */
import { tenant } from "./api-client";

export type WarehouseLocation = {
  location_id: string;
  code?: string | null;
  label?: string | null;
  name?: string | null;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bin?: string | null;
  yard?: string | null;
  capacity_units?: number | string | null;
};

export type InventoryItem = {
  inventory_item_id: string;
  sku?: string | null;
  description: string;
  qty_on_hand: number | string;
  uom?: string | null;
  state: string; // AVAILABLE | QA_HOLD | ALLOCATED | DISPATCHED | DAMAGED
  location_id?: string | null;
  owner_client_id?: string | null;
  dossier_id?: string | null;
};

export type StockMovement = {
  stock_movement_id: string;
  movement_kind: string; // INBOUND | PUTAWAY | PICK | PACK | DISPATCH | ADJUST | COUNT
  qty: number | string;
  from_location?: string | null;
  to_location?: string | null;
  moved_at?: string | null;
  moved_by?: string | null;
};

export const listInventory = () => tenant<InventoryItem[]>("/inventory");
export const createInventory = (body: { description: string; sku?: string; qty_on_hand?: number; uom?: string; location_id?: string; state?: string }) =>
  tenant<InventoryItem>("/inventory", { method: "POST", body });
export const getMovements = (id: string) => tenant<StockMovement[]>(`/inventory/${id}/movements`);
export const moveStock = (id: string, body: { movement_kind: string; qty: number; from_location?: string; to_location?: string }) =>
  tenant<InventoryItem>(`/inventory/${id}/move`, { method: "POST", body });
export const setStockState = (id: string, state: string) =>
  tenant<InventoryItem>(`/inventory/${id}/state`, { method: "POST", body: { state } });

/* ── Cycle counts ── */
export type DiscrepancySummary = { lines: number; off_lines: number; net_variance: number; absolute_variance: number; has_discrepancy: boolean };
export type CycleCount = {
  cycle_count_id: string;
  location_id?: string | null;
  counted_by?: string | null;
  created_at?: string | null;
  discrepancy_summary?: DiscrepancySummary;
};
export const listCycleCounts = () => tenant<CycleCount[]>("/cycle-counts");
export const createCycleCount = (body: { location_id: string; discrepancy: { inventory_item_id: string; expected: number; counted: number }[] }) =>
  tenant<CycleCount>("/cycle-counts", { method: "POST", body });

/* ── Inbound / GRN (receiving + QA) ── */
export type GrnInbound = {
  grn_inbound_id: string;
  dossier_id?: string | null;
  qa_status: string; // HOLD | PASSED | REJECTED
  putaway_location?: string | null;
  created_at?: string | null;
};
export const listInbound = () => tenant<GrnInbound[]>("/inbound");
export const createInbound = (body?: { dossier_id?: string; lines?: { inventory_item_id: string; item?: string; ordered?: number; received?: number; condition?: string }[] }) => tenant<GrnInbound>("/inbound", { method: "POST", body: body || {} });
export const setInboundQa = (id: string, qa_status: "PASSED" | "REJECTED", putaway_location?: string) =>
  tenant<GrnInbound>(`/inbound/${id}/qa`, { method: "POST", body: { qa_status, putaway_location } });

/* ── Equipment (allocation board) ── */
export type Equipment = {
  wms_equipment_id: string;
  label: string;
  status: string; // AVAILABLE | IN_USE | MAINTENANCE | OUT_OF_SERVICE
  assigned_to?: string | null;
  location_id?: string | null;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bin?: string | null;
};
export const listEquipment = () => tenant<Equipment[]>("/equipment");
export const createEquipment = (body: { label: string; location_id?: string }) =>
  tenant<Equipment>("/equipment", { method: "POST", body });
export const setEquipmentStatus = (id: string, status: string, assigned_to?: string | null) =>
  tenant<Equipment>(`/equipment/${id}/status`, { method: "POST", body: { status, assigned_to } });

export const listLocations = () => tenant<WarehouseLocation[]>("/locations");
export const createLocation = (body: { zone?: string; aisle?: string; rack?: string; bin?: string; yard?: string; capacity_units?: number }) =>
  tenant<WarehouseLocation>("/locations", { method: "POST", body });
export const locationLabel = (l?: WarehouseLocation) =>
  l ? l.code || l.label || l.name || [l.zone, l.aisle, l.rack, l.bin, l.yard].filter(Boolean).join(" · ") || l.location_id.slice(0, 8) : "—";

/* ── Outbound (pick / pack / dispatch) ── */
export type OutboundOrder = {
  outbound_order_id: string;
  dossier_id?: string | null;
  client_id?: string | null;
  status: string; // CREATED | PICKING | PACKED | DISPATCHED | CANCELLED
  dispatched_at?: string | null;
  created_at?: string | null;
};
export type OutboundLine = {
  outbound_line_id: string;
  outbound_order_id: string;
  inventory_item_id?: string | null;
  qty: number | string;
  picked: boolean;
  packed: boolean;
};
export const listOutbound = () => tenant<OutboundOrder[]>("/outbound");
export const createOutbound = (body?: { dossier_id?: string; client_id?: string }) => tenant<OutboundOrder>("/outbound", { method: "POST", body: body || {} });
export const getOutboundLines = (id: string) => tenant<OutboundLine[]>(`/outbound/${id}/lines`);
export const addOutboundLine = (id: string, body: { inventory_item_id: string; qty: number }) => tenant<OutboundLine>(`/outbound/${id}/lines`, { method: "POST", body });
export const setOutboundLineFlags = (id: string, lineId: string, body: { picked?: boolean; packed?: boolean }) => tenant<OutboundLine>(`/outbound/${id}/lines/${lineId}`, { method: "PATCH", body });
export const setOutboundStatus = (id: string, status: string) => tenant<OutboundOrder>(`/outbound/${id}/status`, { method: "POST", body: { status } });
