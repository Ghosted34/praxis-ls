import { TabbedHub } from "@/components/tabbed-hub";
import { tr } from "@/lib/i18n";
import { hubTabs } from "@/app/layout/areas";
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
      eyebrow={tr("Fleet")}
      basePath="/fleet"
      inPlace
      tabs={hubTabs("/fleet", {
        vehicles: VehiclesPage,
        compliance: VehicleCompliancePage,
        "work-orders": WorkOrdersPage,
        dispatch: DispatchPage,
        fuel: FuelLogPage,
        drivers: DriversPage,
        incidents: IncidentsPage,
      })}
    />
  );
}
