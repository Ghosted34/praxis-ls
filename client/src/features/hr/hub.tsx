/** People & HR — one hub, deep-linkable tabs (the old /hr/<screen> paths resolve
 *  as sections). Mirrors FleetHub / WarehouseHub. */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { EmployeesPage } from "./employee-360";
import { QueriesPage, SanctionsPage } from "./discipline";
import { PayrollPage } from "./payroll";
import { VacanciesPage } from "./vacancy";
import { ContractsPage } from "./contracts";
import { AppraisalsPage } from "./appraisal";
import { AttendancePage } from "./attendance";
import { LeavePage } from "./leave";
import { TrainingsPage } from "./trainings";
import { SopsPage } from "./sops";
import { TalentPoolPage } from "./talent-pool";

export function HrHub() {
  return (
    <TabbedHub
      eyebrow="People & HR"
      basePath="/hr"
      tabs={hubTabs("/hr", {
        employees: EmployeesPage,
        payroll: PayrollPage,
        vacancies: VacanciesPage,
        contracts: ContractsPage,
        appraisals: AppraisalsPage,
        queries: QueriesPage,
        sanctions: SanctionsPage,
        attendance: AttendancePage,
        leave: LeavePage,
        trainings: TrainingsPage,
        sops: SopsPage,
        "talent-pool": TalentPoolPage,
      })}
    />
  );
}
