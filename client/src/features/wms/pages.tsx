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
const clientPicker = (name: string, label: string): FieldSpec => ({
  name, label, type: "select", optionsEndpoint: "/clients", optionValue: "client_id", optionLabel: "name",
});
const dossierPicker: FieldSpec = {
  name: "dossier_id", label: "Dossier", type: "select",
  optionsEndpoint: "/operations", optionValue: "dossier_id", optionLabel: "ref",
};
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

export const InventoryPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Inventory"
    description="Stock on hand & state. Client goods are tracked operationally, not as own stock."
    endpoint="/inventory"
    idKey="inventory_item_id"
    columns={[
      { key: "sku", label: "SKU" },
      { key: "description", label: "Description" },
      { key: "qty_on_hand", label: "Qty" },
      { key: "uom", label: "UoM" },
      { key: "state", label: "State" },
      { key: "location_id", label: "Location" },
    ]}
    fields={[
      { name: "description", label: "Description", required: true },
      { name: "sku", label: "SKU" },
      clientPicker("owner_client_id", "Owner (client)"),
      dossierPicker,
      locationPicker("location_id", "Location"),
      { name: "qty_on_hand", label: "Qty on hand", type: "number" },
      { name: "uom", label: "Unit of measure", placeholder: "unit / pallet / bag" },
      { name: "state", label: "State", type: "select", options: [
        { value: "AVAILABLE", label: "Available" },
        { value: "QA_HOLD", label: "QA hold" },
        { value: "ALLOCATED", label: "Allocated" },
        { value: "DISPATCHED", label: "Dispatched" },
        { value: "DAMAGED", label: "Damaged" },
      ] },
      { name: "is_own_stock", label: "Own stock (SmartLS consumable)", type: "checkbox" },
    ]}
  />
);

export const InboundPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Inbound / GRN"
    description="Goods received & QA gate."
    endpoint="/inbound"
    idKey="grn_inbound_id"
    columns={[
      { key: "dossier_id", label: "Dossier" },
      { key: "qa_status", label: "QA" },
      { key: "putaway_location", label: "Putaway" },
      { key: "created_at", label: "When" },
    ]}
    fields={[
      dossierPicker,
      { name: "qa_status", label: "QA status", type: "select", options: [
        { value: "HOLD", label: "Hold" },
        { value: "PASSED", label: "Passed" },
        { value: "REJECTED", label: "Rejected" },
      ] },
      locationPicker("putaway_location", "Putaway location"),
    ]}
  />
);

export const OutboundPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Outbound"
    description="Pick / pack / dispatch orders."
    endpoint="/outbound"
    idKey="outbound_order_id"
    columns={[
      { key: "client_id", label: "Client" },
      { key: "status", label: "Status" },
      { key: "dispatched_at", label: "Dispatched" },
      { key: "created_at", label: "Created" },
    ]}
    fields={[
      clientPicker("client_id", "Client"),
      dossierPicker,
      { name: "status", label: "Status", type: "select", options: [
        { value: "CREATED", label: "Created" },
        { value: "PICKING", label: "Picking" },
        { value: "PACKED", label: "Packed" },
        { value: "DISPATCHED", label: "Dispatched" },
        { value: "CANCELLED", label: "Cancelled" },
      ] },
    ]}
  />
);

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

export const CycleCountsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Cycle counts"
    description="Physical counts & discrepancies."
    endpoint="/cycle-counts"
    idKey="cycle_count_id"
    columns={[
      { key: "location_id", label: "Location" },
      { key: "counted_by", label: "Counted by" },
      { key: "discrepancy", label: "Discrepancy" },
      { key: "created_at", label: "When" },
    ]}
    fields={[
      locationPicker("location_id", "Location"),
      userPicker("counted_by", "Counted by"),
    ]}
  />
);
