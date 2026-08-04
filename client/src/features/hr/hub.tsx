/** People & HR — one hub, deep-linkable tabs (the old /hr/<screen> paths resolve
 *  as sections). Mirrors FleetHub / WarehouseHub. */
import { TabbedHub } from "@/components/tabbed-hub";
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
      tabs={[
        { key: "employees", label: "Employees", Component: EmployeesPage },
        { key: "payroll", label: "Payroll", Component: PayrollPage },
        { key: "vacancies", label: "Vacancies", Component: VacanciesPage },
        { key: "contracts", label: "Contracts", Component: ContractsPage },
        { key: "appraisals", label: "Appraisals", Component: AppraisalsPage },
        { key: "queries", label: "Queries", Component: QueriesPage },
        { key: "sanctions", label: "Sanctions", Component: SanctionsPage },
        { key: "attendance", label: "Attendance", Component: AttendancePage },
        { key: "leave", label: "Leave", Component: LeavePage },
        { key: "trainings", label: "Trainings", Component: TrainingsPage },
        { key: "sops", label: "SOPs", Component: SopsPage },
        { key: "talent-pool", label: "Talent pool", Component: TalentPoolPage },
      ]}
    />
  );
}
