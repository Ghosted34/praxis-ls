import { TabbedHub } from "@/components/tabbed-hub";
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
      tabs={[
        { key: "files", label: "Files", Component: OperationsFilesPage },
        { key: "milestones", label: "Milestones", Component: MilestonesPage },
        { key: "transit-orders", label: "Transit orders", Component: TransitOrdersPage },
        { key: "delivery-notes", label: "Delivery notes", Component: DeliveryNotesPage },
        // Configuration rather than day-to-day work, so it sits last — but inside
        // Operations, because a service type without a milestone template yields
        // dossiers with no chain, and that's an operations problem to notice.
        { key: "service-types", label: "Service types", Component: ServiceTypesPage },
      ]}
    />
  );
}
