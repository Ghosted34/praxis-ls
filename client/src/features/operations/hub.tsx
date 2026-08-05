import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { OperationsFilesPage } from "./operation-files";
import { MilestonesPage } from "./milestones";
import { TransitOrdersPage } from "./transit-orders";
import { DeliveryNotesPage } from "./delivery-notes";
import { ServiceTypesPage } from "./service-types";

export function OperationsHub() {
  return (
    <TabbedHub
      eyebrow="Operations"
      basePath="/operations"
      // Service types sits last in areas.ts — configuration rather than
      // day-to-day work, but inside Operations, because a service type without a
      // milestone template yields dossiers with no chain, and that's an
      // operations problem to notice.
      tabs={hubTabs("/operations", {
        files: OperationsFilesPage,
        milestones: MilestonesPage,
        "transit-orders": TransitOrdersPage,
        "delivery-notes": DeliveryNotesPage,
        "service-types": ServiceTypesPage,
      })}
    />
  );
}
