import { TabbedHub } from "@/components/tabbed-hub";
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
      eyebrow="Warehouse"
      basePath="/wms"
      inPlace
      tabs={[
        { key: "locations", label: "Locations", Component: LocationsPage },
        { key: "inventory", label: "Inventory", Component: InventoryPage },
        { key: "inbound", label: "Inbound / GRN", Component: InboundPage },
        { key: "outbound", label: "Outbound", Component: OutboundPage },
        { key: "equipment", label: "Equipment", Component: EquipmentPage },
        { key: "cycle-counts", label: "Cycle counts", Component: CycleCountsPage },
      ]}
    />
  );
}
