/**
 * Fleet API helpers — dispatch board, work orders (+ parts), vehicles.
 * Routes mirror src/modules/fleet/*.
 */
import { tenant } from "./api-client";

/** `?vehicle_id=` filter (server-side) — omitted when no vehicle is given. */
const byVehicle = (vehicleId?: string) => (vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : "");

export type Vehicle = {
  vehicle_id: string;
  registration?: string | null;
  category?: string | null;
  status?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  created_at?: string | null;
};

export type Dispatch = {
  fleet_dispatch_id: string;
  vehicle_id?: string | null;
  registration?: string | null;
  driver_employee_id?: string | null;
  driver_name?: string | null;
  dossier_id?: string | null;
  status: string; // ASSIGNED | OUT | RETURNED | CANCELLED
  check_out_at?: string | null;
  check_in_at?: string | null;
  odometer_out?: number | null;
  odometer_in?: number | null;
};

export const listDispatch = (vehicleId?: string) => tenant<Dispatch[]>(`/dispatch${byVehicle(vehicleId)}`);
export const createDispatch = (body: { vehicle_id: string; driver_employee_id?: string; dossier_id?: string }) =>
  tenant<Dispatch>("/dispatch", { method: "POST", body });
export const setDispatchStatus = (id: string, status: string, odometer?: number) =>
  tenant<Dispatch>(`/dispatch/${id}/status`, { method: "POST", body: { status, odometer: odometer ?? null } });

/* ── Work orders (+ parts) ── */
export type WorkOrder = {
  work_order_id: string;
  vehicle_id?: string | null;
  registration?: string | null;
  wms_equipment_id?: string | null;
  kind: string; // PREVENTIVE | CORRECTIVE
  description?: string | null;
  status: string; // OPEN | IN_PROGRESS | DONE | CANCELLED
  cost?: number | string | null;
  dossier_id?: string | null;
  opened_on?: string | null;
  closed_on?: string | null;
};
export type WorkOrderPart = {
  work_order_part_id: string;
  work_order_id: string;
  inventory_item_id?: string | null;
  label: string;
  qty: number | string;
  unit_cost: number | string;
};
export const listWorkOrders = (vehicleId?: string) => tenant<WorkOrder[]>(`/work-orders${byVehicle(vehicleId)}`);
export const createWorkOrder = (body: { vehicle_id?: string; kind: string; description?: string; dossier_id?: string }) =>
  tenant<WorkOrder>("/work-orders", { method: "POST", body });
export const setWorkOrderStatus = (id: string, status: string) =>
  tenant<WorkOrder>(`/work-orders/${id}/status`, { method: "POST", body: { status } });
export const getWorkOrderParts = (id: string) => tenant<WorkOrderPart[]>(`/work-orders/${id}/parts`);
export const addWorkOrderPart = (id: string, body: { label: string; qty: number; unit_cost: number; inventory_item_id?: string }) =>
  tenant<WorkOrder & { parts: WorkOrderPart[] }>(`/work-orders/${id}/parts`, { method: "POST", body });

/* ── Vehicle 360 ── */
export type VehicleCompliance = { compliance_id: string; vehicle_id?: string | null; registration?: string | null; kind?: string | null; expires_on?: string | null };
export type FuelLog = { fuel_log_id: string; vehicle_id?: string | null; registration?: string | null; odometer?: number | null; litres?: number | string | null; cost?: number | string | null; created_at?: string | null };
export type Incident = { fleet_incident_id: string; vehicle_id?: string | null; registration?: string | null; driver_employee_id?: string | null; driver_name?: string | null; severity?: string | null; status?: string | null; occurred_at?: string | null; description?: string | null };
export const createIncident = (body: { vehicle_id?: string; driver_employee_id?: string; occurred_at?: string; description?: string; severity?: string }) =>
  tenant<Incident>("/incidents", { method: "POST", body });
export const setIncidentStatus = (id: string, status: string) =>
  tenant<Incident>(`/incidents/${id}/status`, { method: "POST", body: { status } });

export const listVehicles = () => tenant<Vehicle[]>("/vehicles");
export const createVehicle = (body: { registration: string; category?: string; status?: string }) =>
  tenant<Vehicle>("/vehicles", { method: "POST", body });
export const getVehicle = (id: string) => tenant<Vehicle>(`/vehicles/${id}`);
export const setVehicleStatus = (id: string, status: string) => tenant<Vehicle>(`/vehicles/${id}`, { method: "PATCH", body: { status } });
export const listDrivers = () => tenant<{ employee_id: string; full_name?: string | null }[]>("/employees");

export const listVehicleCompliance = (vehicleId?: string) => tenant<VehicleCompliance[]>(`/vehicle-compliance${byVehicle(vehicleId)}`);
export const createCompliance = (body: { vehicle_id: string; kind: string; expires_on?: string }) =>
  tenant<VehicleCompliance>("/vehicle-compliance", { method: "POST", body });
export const renewCompliance = (id: string, expires_on: string) =>
  tenant<VehicleCompliance>(`/vehicle-compliance/${id}`, { method: "PATCH", body: { expires_on } });

export const listFuel = (vehicleId?: string) => tenant<FuelLog[]>(`/fuel${byVehicle(vehicleId)}`);
export const createFuel = (body: { vehicle_id: string; odometer?: number; litres?: number; cost?: number; dossier_id?: string }) =>
  tenant<FuelLog>("/fuel", { method: "POST", body });

export const listIncidents = (vehicleId?: string) => tenant<Incident[]>(`/incidents${byVehicle(vehicleId)}`);

/* ── Driver licences (expiry board) ── */
export type DriverLicense = {
  driver_license_id: string;
  employee_id?: string | null;
  driver_name?: string | null;
  license_class?: string | null;
  license_number?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  certification?: string | null;
};
export const listLicenses = () => tenant<DriverLicense[]>("/drivers");
export const createLicense = (body: { employee_id: string; license_class: string; license_number?: string; issued_on?: string; expires_on?: string; certification?: string }) =>
  tenant<DriverLicense>("/drivers", { method: "POST", body });
export const renewLicense = (id: string, expires_on: string) =>
  tenant<DriverLicense>(`/drivers/${id}`, { method: "PATCH", body: { expires_on } });
