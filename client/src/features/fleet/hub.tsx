import { TabbedHub } from "@/components/tabbed-hub";
import {
  VehiclesPage,
  VehicleCompliancePage,
  WorkOrdersPage,
  DispatchPage,
  FuelLogPage,
  DriversPage,
  IncidentsPage,
} from "./pages";

export function FleetHub() {
  return (
    <TabbedHub
      eyebrow="Fleet"
      basePath="/fleet"
      inPlace
      tabs={[
        { key: "vehicles", label: "Vehicles", Component: VehiclesPage },
        { key: "compliance", label: "Compliance", Component: VehicleCompliancePage },
        { key: "work-orders", label: "Work orders", Component: WorkOrdersPage },
        { key: "dispatch", label: "Dispatch", Component: DispatchPage },
        { key: "fuel", label: "Fuel log", Component: FuelLogPage },
        { key: "drivers", label: "Drivers", Component: DriversPage },
        { key: "incidents", label: "Incidents", Component: IncidentsPage },
      ]}
    />
  );
}
