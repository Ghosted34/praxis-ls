/** Commercial — one hub, deep-linkable tabs (old /commercial/<screen> paths
 *  resolve as sections). Mirrors FinanceHub / FleetHub. */
import { TabbedHub } from "@/components/tabbed-hub";
import { QuotationsPage, MarginSimulationsPage, ExtraChargeSimulationsPage, PricingVariancePage } from "./pages";

export function CommercialHub() {
  return (
    <TabbedHub
      eyebrow="Commercial"
      basePath="/commercial"
      inlineTabs
      tabs={[
        { key: "quotations", label: "Quotations", Component: QuotationsPage },
        { key: "margin-simulation", label: "Margin simulation", Component: MarginSimulationsPage },
        { key: "extra-charge-simulation", label: "Extra-charge simulation", Component: ExtraChargeSimulationsPage },
        { key: "pricing-variance", label: "Pricing variance", Component: PricingVariancePage },
      ]}
    />
  );
}
