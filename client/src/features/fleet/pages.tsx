/** Fleet (Phase 3) screens — full CRUD over the fleet endpoints via CrudResource. */
import { CrudResource, type FieldSpec } from "@/components/crud-resource";
import { HubCrumb } from "@/components/tabbed-hub";

const eyebrow = <HubCrumb area="Fleet" />;

// Shared FK pickers ---------------------------------------------------------
const vehiclePicker: FieldSpec = {
  name: "vehicle_id", label: "Vehicle", type: "select",
  optionsEndpoint: "/vehicles", optionValue: "vehicle_id", optionLabel: "registration",
};
const driverPicker = (name: string, label: string): FieldSpec => ({
  name, label, type: "select",
  optionsEndpoint: "/employees", optionValue: "employee_id", optionLabel: "full_name",
});
const dossierPicker: FieldSpec = {
  name: "dossier_id", label: "Dossier", type: "select",
  optionsEndpoint: "/operations", optionValue: "dossier_id", optionLabel: "ref",
};

export const VehiclesPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Vehicles"
    description="Fleet registry. Trucks, low-beds, company cars."
    endpoint="/vehicles"
    idKey="vehicle_id"
    columns={[
      { key: "registration", label: "Registration" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "created_at", label: "Added" },
    ]}
    fields={[
      { name: "registration", label: "Registration", required: true, placeholder: "LT-4471" },
      { name: "category", label: "Category", type: "select", options: [
        { value: "truck", label: "Truck" },
        { value: "low-bed", label: "Low-bed" },
        { value: "company_car", label: "Company car" },
      ] },
      { name: "status", label: "Status", type: "select", options: [
        { value: "ACTIVE", label: "Active" },
        { value: "INACTIVE", label: "Inactive" },
        { value: "DISPOSED", label: "Disposed" },
      ] },
    ]}
  />
);

export const VehicleCompliancePage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Vehicle compliance"
    description="Insurance & visite-technique expiry. Renewal alerts fire off the expiry date."
    endpoint="/vehicle-compliance"
    idKey="compliance_id"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "kind", label: "Kind" },
      { key: "expires_on", label: "Expires" },
    ]}
    fields={[
      { ...vehiclePicker, required: true },
      { name: "kind", label: "Kind", type: "select", required: true, options: [
        { value: "insurance", label: "Insurance" },
        { value: "visite_technique", label: "Visite technique" },
      ] },
      { name: "expires_on", label: "Expires on", type: "date" },
    ]}
  />
);

export const WorkOrdersPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Work orders"
    description="Preventive & corrective maintenance."
    endpoint="/work-orders"
    idKey="work_order_id"
    columns={[
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "description", label: "Description" },
      { key: "cost", label: "Cost" },
      { key: "opened_on", label: "Opened" },
    ]}
    fields={[
      { name: "kind", label: "Kind", type: "select", required: true, options: [
        { value: "PREVENTIVE", label: "Preventive" },
        { value: "CORRECTIVE", label: "Corrective" },
      ] },
      vehiclePicker,
      { name: "description", label: "Description", type: "textarea" },
      { name: "cost", label: "Cost (XAF)", type: "number" },
      { name: "opened_on", label: "Opened on", type: "date" },
      dossierPicker,
    ]}
  />
);

export const DispatchPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Dispatch"
    description="Vehicle assignments & check-in/out."
    endpoint="/dispatch"
    idKey="fleet_dispatch_id"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "driver_employee_id", label: "Driver" },
      { key: "status", label: "Status" },
      { key: "check_out_at", label: "Checked out" },
      { key: "check_in_at", label: "Checked in" },
    ]}
    fields={[
      { ...vehiclePicker, required: true },
      driverPicker("driver_employee_id", "Driver"),
      dossierPicker,
      { name: "odometer_out", label: "Odometer out", type: "number" },
      { name: "odometer_in", label: "Odometer in", type: "number" },
    ]}
  />
);

export const FuelLogPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Fuel log"
    description="Fuel purchases per vehicle."
    endpoint="/fuel"
    idKey="fuel_log_id"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "odometer", label: "Odometer" },
      { key: "litres", label: "Litres" },
      { key: "cost", label: "Cost" },
      { key: "created_at", label: "When" },
    ]}
    fields={[
      { ...vehiclePicker, required: true },
      { name: "odometer", label: "Odometer (km)", type: "number" },
      { name: "litres", label: "Litres", type: "number" },
      { name: "cost", label: "Cost (XAF)", type: "number" },
      dossierPicker,
    ]}
  />
);

export const DriversPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Driver licences"
    description="Driver licences & expiry."
    endpoint="/drivers"
    idKey="driver_license_id"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "license_class", label: "Class" },
      { key: "license_number", label: "Number" },
      { key: "expires_on", label: "Expires" },
    ]}
    fields={[
      { ...driverPicker("employee_id", "Employee"), required: true },
      { name: "license_class", label: "Licence class", required: true, placeholder: "Poids lourd C/E" },
      { name: "license_number", label: "Licence number" },
      { name: "issued_on", label: "Issued on", type: "date" },
      { name: "expires_on", label: "Expires on", type: "date" },
      { name: "certification", label: "Certification" },
    ]}
  />
);

export const IncidentsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Incidents"
    description="Fleet incidents & claims."
    endpoint="/incidents"
    idKey="fleet_incident_id"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "severity", label: "Severity" },
      { key: "status", label: "Status" },
      { key: "occurred_at", label: "Occurred" },
    ]}
    fields={[
      vehiclePicker,
      driverPicker("driver_employee_id", "Driver"),
      { name: "occurred_at", label: "Occurred at", type: "datetime" },
      { name: "severity", label: "Severity", type: "select", options: [
        { value: "MINOR", label: "Minor" },
        { value: "MAJOR", label: "Major" },
        { value: "TOTAL", label: "Total" },
      ] },
      { name: "description", label: "Description", type: "textarea" },
    ]}
  />
);
