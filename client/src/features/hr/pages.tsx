/** HR (Phase 3) screens — read skeletons over the + HR endpoints. */
import { ResourceList } from "@/components/resource-list";

export const EmployeesPage = () => (
  <ResourceList
    title="Employees"
    description="Human capital master: staff, CNPS, salary, bank details — the record HR, payroll and fleet build on."
    endpoint="/employees"
    columns={[
      { key: "full_name", label: "Name" },
      { key: "entity_name", label: "Entity" },
      { key: "department", label: "Department" },
      { key: "job_title", label: "Job title" },
      { key: "employment_type", label: "Type" },
      { key: "is_active", label: "Active" },
    ]}
  />
);

export const PayrollPage = () => (
  <ResourceList
    title="Payroll"
    description="Monthly payroll runs — compute CNPS/IRPP/CAC/CFC/FNE, approve, post to the ledger."
    endpoint="/payroll"
    columns={[
      { key: "period_code", label: "Period" },
      { key: "status", label: "Status" },
      { key: "entity_id", label: "Entity" },
      { key: "created_at", label: "Created" },
    ]}
  />
);

export const VacanciesPage = () => (
  <ResourceList
    title="Vacancies"
    description="Recruitment: job vacancies and applicant pipeline."
    endpoint="/vacancies"
    columns={[
      { key: "title", label: "Title" },
      { key: "department", label: "Department" },
      { key: "status", label: "Status" },
      { key: "posted_to_website", label: "Posted" },
      { key: "created_at", label: "Created" },
    ]}
  />
);

export const ContractsPage = () => (
  <ResourceList
    title="Contracts"
    description="HR contracts: offer, employment, confirmation, termination."
    endpoint="/contracts"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "effective_on", label: "Effective" },
      { key: "end_on", label: "Ends" },
    ]}
  />
);

export const AppraisalsPage = () => (
  <ResourceList
    title="Appraisals"
    description="Performance appraisals against KPI targets."
    endpoint="/appraisals"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "period_code", label: "Period" },
      { key: "actual_value", label: "Actual" },
      { key: "rating", label: "Rating" },
    ]}
  />
);

export const AttendancePage = () => (
  <ResourceList
    title="Attendance"
    description="Clock-in / clock-out logs with optional GPS."
    endpoint="/attendance"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "clock_in_at", label: "Clock in" },
      { key: "clock_out_at", label: "Clock out" },
    ]}
  />
);

export const LeavePage = () => (
  <ResourceList
    title="Leave & allowances"
    description="Leave, salary-advance and mission requests."
    endpoint="/leave"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "kind", label: "Kind" },
      { key: "starts_on", label: "From" },
      { key: "ends_on", label: "To" },
      { key: "status", label: "Status" },
    ]}
  />
);

export const SopsPage = () => (
  <ResourceList
    title="SOPs"
    description="Standard operating procedure documents with versioning."
    endpoint="/sops"
    columns={[
      { key: "title", label: "Title" },
      { key: "category", label: "Category" },
      { key: "version_no", label: "Version" },
      { key: "is_active", label: "Active" },
    ]}
  />
);

export const TrainingsPage = () => (
  <ResourceList
    title="Trainings"
    description="Training sessions and attendance roster."
    endpoint="/trainings"
    columns={[
      { key: "title", label: "Title" },
      { key: "scheduled_on", label: "Scheduled" },
      { key: "facilitator", label: "Facilitator" },
      { key: "status", label: "Status" },
    ]}
  />
);

export const TalentPoolPage = () => (
  <ResourceList
    title="Talent pool"
    description="Candidate talent pool."
    endpoint="/talent-pool"
    columns={[
      { key: "full_name", label: "Name" },
      { key: "skills", label: "Skills" },
      { key: "created_at", label: "Added" },
    ]}
  />
);
