/** People & HR — one hub, deep-linkable tabs (the old /hr/<screen> paths resolve
 *  as sections). Mirrors FleetHub / WarehouseHub. */
import { TabbedHub } from "@/components/tabbed-hub";
import {
  EmployeesPage, PayrollPage, VacanciesPage, ContractsPage, AppraisalsPage,
  AttendancePage, LeavePage, TrainingsPage, SopsPage, TalentPoolPage,
} from "./pages";

export function HrHub() {
  return (
    <TabbedHub
      eyebrow="People & HR"
      basePath="/hr"
      inlineTabs
      tabs={[
        { key: "employees", label: "Employees", Component: EmployeesPage },
        { key: "payroll", label: "Payroll", Component: PayrollPage },
        { key: "vacancies", label: "Vacancies", Component: VacanciesPage },
        { key: "contracts", label: "Contracts", Component: ContractsPage },
        { key: "appraisals", label: "Appraisals", Component: AppraisalsPage },
        { key: "attendance", label: "Attendance", Component: AttendancePage },
        { key: "leave", label: "Leave", Component: LeavePage },
        { key: "trainings", label: "Trainings", Component: TrainingsPage },
        { key: "sops", label: "SOPs", Component: SopsPage },
        { key: "talent-pool", label: "Talent pool", Component: TalentPoolPage },
      ]}
    />
  );
}
