import { TabbedHub } from "@/components/tabbed-hub";
import { PurchaseRequestsPage } from "./purchase-requests";
import { PurchaseOrdersPage } from "./purchase-orders";
import { GoodsReceivedPage } from "./goods-received";
import { SupplierInvoicesPage } from "./supplier-invoices";

export function ProcurementHub() {
  return (
    <TabbedHub
      eyebrow="Procurement"
      basePath="/procurement"
      tabs={[
        { key: "purchase-requests", label: "Requests", Component: PurchaseRequestsPage },
        { key: "purchase-orders", label: "Purchase orders", Component: PurchaseOrdersPage },
        { key: "goods-received", label: "Goods received", Component: GoodsReceivedPage },
        { key: "supplier-invoices", label: "Supplier invoices", Component: SupplierInvoicesPage },
      ]}
    />
  );
}
