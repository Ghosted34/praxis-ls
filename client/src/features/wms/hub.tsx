import { TabbedHub } from "@/components/tabbed-hub";
import { tr } from "@/lib/i18n";
import { hubTabs } from "@/app/layout/areas";
import {
  LocationsPage,
  InventoryPage,
  InboundPage,
  OutboundPage,
  EquipmentPage,
  CycleCountsPage,
} from "./pages";

export function WarehouseHub() {
  return (
    <TabbedHub
      eyebrow={tr("Warehouse")}
      basePath="/wms"
      inPlace
      tabs={hubTabs("/wms", {
        locations: LocationsPage,
        inventory: InventoryPage,
        inbound: InboundPage,
        outbound: OutboundPage,
        equipment: EquipmentPage,
        "cycle-counts": CycleCountsPage,
      })}
    />
  );
}
