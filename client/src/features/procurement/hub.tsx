import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { PurchaseRequestsPage } from "./purchase-requests";
import { PurchaseOrdersPage } from "./purchase-orders";
import { GoodsReceivedPage } from "./goods-received";
import { SupplierInvoicesPage } from "./supplier-invoices";

export function ProcurementHub() {
  return (
    <TabbedHub
      eyebrow="Procurement"
      basePath="/procurement"
      tabs={hubTabs("/procurement", {
        "purchase-requests": PurchaseRequestsPage,
        "purchase-orders": PurchaseOrdersPage,
        "goods-received": GoodsReceivedPage,
        "supplier-invoices": SupplierInvoicesPage,
      })}
    />
  );
}
