/** Finance (Phase 3 asset register) screens — read skeleton over the MOD-54 endpoint. */
import { ResourceList } from "@/components/resource-list";

export const AssetsPage = () => (
  <ResourceList
    title="Assets"
    description="Fixed-asset register with depreciation schedule, period posting and disposal (MOD-54)."
    endpoint="/assets"
    columns={[
      { key: "label", label: "Asset" },
      { key: "tag", label: "Tag" },
      { key: "acquisition_cost", label: "Cost" },
      { key: "method", label: "Method" },
      { key: "status", label: "Status" },
      { key: "acquired_on", label: "Acquired" },
    ]}
  />
);
