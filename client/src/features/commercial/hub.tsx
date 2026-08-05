/** Commercial — one hub, deep-linkable tabs (old /commercial/<screen> paths
 *  resolve as sections). Mirrors FinanceHub / FleetHub. */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { QuotationsPage } from "./quotations";
import { MarginSimulationsPage } from "./margin-simulations";
import { ExtraChargeSimulationsPage } from "./extra-charge-simulations";
import { PricingVariancePage } from "./pricing-variance";

export function CommercialHub() {
  return (
    <TabbedHub
      eyebrow="Commercial"
      basePath="/commercial"
      tabs={hubTabs("/commercial", {
        quotations: QuotationsPage,
        "margin-simulation": MarginSimulationsPage,
        "extra-charge-simulation": ExtraChargeSimulationsPage,
        "pricing-variance": PricingVariancePage,
      })}
    />
  );
}
