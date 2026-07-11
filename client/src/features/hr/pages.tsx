/** HR (Phase 3) screens — read skeletons over the MOD-11..19 HR endpoints. */
import { ResourceList } from "@/components/resource-list";

export const VacanciesPage = () => (
  <ResourceList
    title="Vacancies"
    description="Recruitment: job vacancies and applicant pipeline (MOD-11)."
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
    description="HR contracts: offer, employment, confirmation, termination (MOD-12)."
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
    description="Performance appraisals against KPI targets (MOD-13)."
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
    description="Clock-in / clock-out logs with optional GPS (MOD-14)."
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
    description="Leave, salary-advance and mission requests (MOD-15)."
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
    description="Standard operating procedure documents with versioning (MOD-16)."
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
    description="Training sessions and attendance roster (MOD-18)."
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
    description="Candidate talent pool (MOD-19)."
    endpoint="/talent-pool"
    columns={[
      { key: "full_name", label: "Name" },
      { key: "skills", label: "Skills" },
      { key: "created_at", label: "Added" },
    ]}
  />
);
