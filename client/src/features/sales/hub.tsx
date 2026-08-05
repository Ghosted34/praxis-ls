/** Sales & CRM — one hub, deep-linkable tabs (old /sales/<screen> paths resolve
 *  as sections). Leads keeps its own internal intake tab. */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { LeadsPage } from "./leads";
import { OpportunitiesPage } from "./opportunities";
import { ProposalsPage } from "./proposals";
import { MeetingsPage } from "./meetings";
import { CampaignsPage } from "./campaigns";
import { SuccessStoriesPage } from "./success-stories";

export function SalesHub() {
  return (
    <TabbedHub
      eyebrow="Sales & CRM"
      basePath="/sales"
      tabs={hubTabs("/sales", {
        leads: LeadsPage,
        opportunities: OpportunitiesPage,
        proposals: ProposalsPage,
        meetings: MeetingsPage,
        campaigns: CampaignsPage,
        "success-stories": SuccessStoriesPage,
      })}
    />
  );
}
