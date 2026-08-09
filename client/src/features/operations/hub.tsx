import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { OperationsFilesPage } from "./operation-files";
import { MilestonesPage } from "./milestones";
import { TransitOrdersPage } from "./transit-orders";
import { DeliveryNotesPage } from "./delivery-notes";

export function OperationsHub() {
  return (
    <TabbedHub
      eyebrow="Operations"
      basePath="/operations"
      // Service types used to live here (the trap it makes visible — dossiers
      // with no chain — is an operations problem to notice) but it IS master
      // data (0310_operations.sql:7), so the tab moved to /master/service-types.
      // The trap-detection banner rides the 360 dossier there.
      tabs={hubTabs("/operations", {
        files: OperationsFilesPage,
        milestones: MilestonesPage,
        "transit-orders": TransitOrdersPage,
        "delivery-notes": DeliveryNotesPage,
      })}
    />
  );
}
