/** Sales & CRM — one hub, deep-linkable tabs (old /sales/<screen> paths resolve
 *  as sections). Leads keeps its own internal intake tab. */
import { TabbedHub } from "@/components/tabbed-hub";
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
      tabs={[
        { key: "leads", label: "Leads & intake", Component: LeadsPage },
        { key: "opportunities", label: "Opportunities", Component: OpportunitiesPage },
        { key: "proposals", label: "Proposals", Component: ProposalsPage },
        { key: "meetings", label: "Meetings", Component: MeetingsPage },
        { key: "campaigns", label: "Campaigns", Component: CampaignsPage },
        { key: "success-stories", label: "Success stories", Component: SuccessStoriesPage },
      ]}
    />
  );
}
