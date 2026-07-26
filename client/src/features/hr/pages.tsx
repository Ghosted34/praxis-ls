/** HR (Phase 3) screens — full CRUD over the HR endpoints via CrudResource. */
import { CrudResource } from "@/components/crud-resource";
import { HubCrumb } from "@/components/tabbed-hub";

const eyebrow = <HubCrumb area="Human capital" />;

// Employees is now a profile 360 (record + HR history + suspend/activate).
export { EmployeesPage } from "./employee-360";

// Payroll is now a run workstation (compute → approve → post → disburse), not a
// CRUD table — see ./payroll.
export { PayrollPage } from "./payroll";

// Vacancies is now a recruitment kanban (applicant pipeline across stages).
export { VacanciesPage } from "./vacancy";

// Contracts is now a lifecycle workstation (DRAFT → ISSUED → SIGNED → ENDED).
export { ContractsPage } from "./contracts";

// Appraisals now surface performance rewards that feed payroll — see ./appraisal.
export { AppraisalsPage } from "./appraisal";

// Attendance is now a geofenced Time Clock, not a CRUD table — see ./attendance.
export { AttendancePage } from "./attendance";

// Leave is now an approve/reject request queue, not a CRUD table — see ./leave.
export { LeavePage } from "./leave";

export const SopsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="SOPs"
    description="Standard operating procedure documents with versioning."
    endpoint="/sops"
    idKey="sop_document_id"
    columns={[
      { key: "title", label: "Title" },
      { key: "category", label: "Category" },
      { key: "version_no", label: "Version" },
      { key: "is_active", label: "Active" },
    ]}
    fields={[
      { name: "title", label: "Title", required: true },
      { name: "category", label: "Category" },
      { name: "version_no", label: "Version", type: "number" },
      { name: "is_active", label: "Active", type: "checkbox" },
    ]}
  />
);

export const TrainingsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Trainings"
    description="Training sessions and attendance roster."
    endpoint="/trainings"
    idKey="training_id"
    columns={[
      { key: "title", label: "Title" },
      { key: "scheduled_on", label: "Scheduled" },
      { key: "facilitator", label: "Facilitator" },
      { key: "status", label: "Status" },
    ]}
    fields={[
      { name: "title", label: "Title", required: true },
      { name: "scheduled_on", label: "Scheduled on", type: "date" },
      { name: "facilitator", label: "Facilitator" },
      { name: "status", label: "Status", type: "select", options: [
        { value: "SCHEDULED", label: "Scheduled" }, { value: "DONE", label: "Done" }, { value: "CANCELLED", label: "Cancelled" },
      ] },
    ]}
  />
);

export const TalentPoolPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Talent pool"
    description="Candidate talent pool."
    endpoint="/talent-pool"
    idKey="talent_pool_id"
    columns={[
      { key: "full_name", label: "Name" },
      { key: "skills", label: "Skills" },
      { key: "created_at", label: "Added" },
    ]}
    fields={[
      { name: "full_name", label: "Full name", required: true },
      { name: "skills", label: "Skills" },
      { name: "notes", label: "Notes", type: "textarea" },
    ]}
  />
);
