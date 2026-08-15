import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import {
  CostingPage,
  CostTrackingPage,
  CashRequestsPage,
  RegiePage,
} from "./pages";

export function CostingHub() {
  return (
    <TabbedHub
      eyebrow="Costing"
      basePath="/costing"
      tabs={hubTabs("/costing", {
        costing: CostingPage,
        "cost-tracking": CostTrackingPage,
        "cash-requests": CashRequestsPage,
        regie: RegiePage,
      })}
    />
  );
}
