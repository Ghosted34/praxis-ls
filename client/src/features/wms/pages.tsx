/** WMS (Phase 3) screens — full CRUD over the warehouse endpoints via CrudResource. */
import { CrudResource, type FieldSpec } from "@/components/crud-resource";
import { HubCrumb } from "@/components/tabbed-hub";

const eyebrow = <HubCrumb area="Warehouse" />;

// Shared FK pickers ---------------------------------------------------------
const locationLabel = (r: Record<string, unknown>) =>
  [r.zone, r.aisle, r.rack, r.bin, r.yard].filter(Boolean).join(" · ") || String(r.location_id ?? "");
const locationPicker = (name: string, label: string): FieldSpec => ({
  name, label, type: "select", optionsEndpoint: "/locations", optionValue: "location_id", optionLabel: locationLabel,
});
const userPicker = (name: string, label: string): FieldSpec => ({
  name, label, type: "select", optionsEndpoint: "/users", optionValue: "user_id", optionLabel: "full_name",
});

export const LocationsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Locations"
    description="Warehouse slotting: zone / aisle / rack / bin / yard."
    endpoint="/locations"
    idKey="location_id"
    columns={[
      { key: "zone", label: "Zone" },
      { key: "aisle", label: "Aisle" },
      { key: "rack", label: "Rack" },
      { key: "bin", label: "Bin" },
      { key: "yard", label: "Yard" },
      { key: "capacity_units", label: "Capacity" },
    ]}
    fields={[
      { name: "zone", label: "Zone" },
      { name: "aisle", label: "Aisle" },
      { name: "rack", label: "Rack" },
      { name: "bin", label: "Bin" },
      { name: "yard", label: "Yard" },
      { name: "capacity_units", label: "Capacity (units)", type: "number" },
    ]}
  />
);

// Inventory is now a stock ledger with move/state actions + movement journal.
export { InventoryPage } from "./inventory";

// Inbound is now a receiving + QA workstation (Hold → Pass w/ putaway | Reject).
export { InboundPage } from "./inbound";

// Outbound is now a pick/pack/dispatch workstation with line handling.
export { OutboundPage } from "./outbound";

export const EquipmentPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Equipment"
    description="Handling equipment: forklifts, reach-stackers."
    endpoint="/equipment"
    idKey="wms_equipment_id"
    columns={[
      { key: "label", label: "Label" },
      { key: "status", label: "Status" },
      { key: "assigned_to", label: "Assigned to" },
      { key: "location_id", label: "Location" },
    ]}
    fields={[
      { name: "label", label: "Label", required: true, placeholder: "Forklift 3T" },
      { name: "status", label: "Status", type: "select", options: [
        { value: "AVAILABLE", label: "Available" },
        { value: "IN_USE", label: "In use" },
        { value: "MAINTENANCE", label: "Maintenance" },
        { value: "OUT_OF_SERVICE", label: "Out of service" },
      ] },
      userPicker("assigned_to", "Assigned to"),
      locationPicker("location_id", "Location"),
    ]}
  />
);

// Cycle counts is now a count sheet (expected vs counted, live variance).
export { CycleCountsPage } from "./cycle-count";
