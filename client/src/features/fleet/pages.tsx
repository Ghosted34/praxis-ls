/** Fleet (Phase 3) screens — read skeletons over the fleet endpoints. */
import { ResourceList } from "@/components/resource-list";

export const VehiclesPage = () => (
  <ResourceList
    title="Vehicles"
    description="Fleet registry. Trucks, low-beds, company cars."
    endpoint="/vehicles"
    columns={[
      { key: "registration", label: "Registration" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "entity_id", label: "Entity" },
      { key: "created_at", label: "Added" },
    ]}
  />
);

export const VehicleCompliancePage = () => (
  <ResourceList
    title="Vehicle compliance"
    description="Insurance & visite-technique expiry. Renewal alerts fire off the expiry date."
    endpoint="/vehicle-compliance"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "kind", label: "Kind" },
      { key: "expires_on", label: "Expires" },
      { key: "document_vault_id", label: "Document" },
    ]}
  />
);

export const WorkOrdersPage = () => (
  <ResourceList
    title="Work orders"
    description="Preventive & corrective maintenance."
    endpoint="/work-orders"
    columns={[
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "description", label: "Description" },
      { key: "cost", label: "Cost" },
      { key: "opened_on", label: "Opened" },
    ]}
  />
);

export const DispatchPage = () => (
  <ResourceList
    title="Dispatch"
    description="Vehicle assignments & check-in/out."
    endpoint="/dispatch"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "driver_employee_id", label: "Driver" },
      { key: "status", label: "Status" },
      { key: "check_out_at", label: "Checked out" },
      { key: "check_in_at", label: "Checked in" },
    ]}
  />
);

export const FuelLogPage = () => (
  <ResourceList
    title="Fuel log"
    description="Fuel purchases per vehicle."
    endpoint="/fuel"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "odometer", label: "Odometer" },
      { key: "litres", label: "Litres" },
      { key: "cost", label: "Cost" },
      { key: "created_at", label: "When" },
    ]}
  />
);

export const DriversPage = () => (
  <ResourceList
    title="Driver licences"
    description="Driver licences & expiry."
    endpoint="/drivers"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "license_class", label: "Class" },
      { key: "license_number", label: "Number" },
      { key: "expires_on", label: "Expires" },
    ]}
  />
);

export const IncidentsPage = () => (
  <ResourceList
    title="Incidents"
    description="Fleet incidents & claims."
    endpoint="/incidents"
    columns={[
      { key: "vehicle_id", label: "Vehicle" },
      { key: "severity", label: "Severity" },
      { key: "status", label: "Status" },
      { key: "occurred_at", label: "Occurred" },
    ]}
  />
);
