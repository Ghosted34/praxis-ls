import { TabbedHub } from "@/components/tabbed-hub";
import { tr } from "@/lib/i18n";
import { hubTabs } from "@/app/layout/areas";
import {
  CostingPage,
  CostTrackingPage,
  CashRequestsPage,
  RegiePage,
} from "./pages";
import { ReconciliationPage } from "./reconciliation";

export function CostingHub() {
  return (
    <TabbedHub
      eyebrow={tr("Costing")}
      basePath="/costing"
      tabs={hubTabs("/costing", {
        costing: CostingPage,
        "cost-tracking": CostTrackingPage,
        reconciliation: ReconciliationPage,
        "cash-requests": CashRequestsPage,
        regie: RegiePage,
      })}
    />
  );
}
