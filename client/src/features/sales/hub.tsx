/** Sales & CRM — one hub, deep-linkable tabs (old /sales/<screen> paths resolve
 *  as sections). Leads keeps its own internal intake tab. */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { LeadsPage } from "./leads";
import { EnquiriesPage } from "./enquiries";
import { QuoteRequestsPage } from "./quote-requests";
import { OpportunitiesPage } from "./opportunities";
import { ProposalsPage } from "./proposals";
import { CompanyProfilePage } from "./company-profile";
import { MeetingsPage } from "./meetings";
import { CampaignsPage } from "./campaigns";
import { PartnershipsPage } from "./partnerships";
import { SuccessStoriesPage } from "./success-stories";

export function SalesHub() {
  return (
    <TabbedHub
      eyebrow="Sales & CRM"
      basePath="/sales"
      tabs={hubTabs("/sales", {
        leads: LeadsPage,
        enquiries: EnquiriesPage,
        "quote-requests": QuoteRequestsPage,
        opportunities: OpportunitiesPage,
        proposals: ProposalsPage,
        "company-profile": CompanyProfilePage,
        meetings: MeetingsPage,
        campaigns: CampaignsPage,
        partnerships: PartnershipsPage,
        "success-stories": SuccessStoriesPage,
      })}
    />
  );
}
