/** HR (Phase 3) screens — full CRUD over the HR endpoints via CrudResource. */
import { CrudResource, type FieldSpec } from "@/components/crud-resource";
import { HubCrumb } from "@/components/tabbed-hub";

const eyebrow = <HubCrumb area="Human capital" />;

// Shared FK pickers ---------------------------------------------------------
const employeePicker = (name: string, label: string, required = false): FieldSpec => ({
  name, label, type: "select", required,
  optionsEndpoint: "/employees", optionValue: "employee_id", optionLabel: "full_name",
});
const entityPicker = (required = false): FieldSpec => ({
  name: "entity_id", label: "Entity", type: "select", required,
  optionsEndpoint: "/entities", optionValue: "entity_id", optionLabel: "legal_name",
});

export const EmployeesPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Employees"
    description="Human capital master: staff, CNPS, salary, bank details — the record HR, payroll and fleet build on."
    endpoint="/employees"
    idKey="employee_id"
    canDelete={false}
    columns={[
      { key: "full_name", label: "Name" },
      { key: "entity_name", label: "Entity" },
      { key: "department", label: "Department" },
      { key: "job_title", label: "Job title" },
      { key: "employment_type", label: "Type" },
      { key: "is_active", label: "Active" },
    ]}
    fields={[
      { name: "full_name", label: "Full name", required: true },
      entityPicker(),
      { name: "department", label: "Department" },
      { name: "job_title", label: "Job title" },
      { name: "employment_type", label: "Employment type", type: "select", options: [
        { value: "CDI", label: "CDI" }, { value: "CDD", label: "CDD" }, { value: "STAGE", label: "Stage" },
        { value: "INTERIM", label: "Interim" }, { value: "CONSULTANT", label: "Consultant" }, { value: "TEMPORARY", label: "Temporary" },
      ] },
      { name: "cnps_number", label: "CNPS number" },
      { name: "base_salary", label: "Base salary (XAF)", type: "number" },
      { name: "signatory_name", label: "Signatory name (for PDF signing)" },
      { name: "is_driver", label: "Is a driver", type: "checkbox" },
    ]}
  />
);

export const PayrollPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Payroll"
    description="Monthly payroll runs — open a run, then compute CNPS/IRPP/CAC/CFC/FNE, approve and post to the ledger."
    endpoint="/payroll"
    idKey="payroll_run_id"
    createLabel="Open payroll run"
    canDelete={false}
    canEdit={false}
    columns={[
      { key: "period_code", label: "Period" },
      { key: "status", label: "Status" },
      { key: "entity_id", label: "Entity" },
      { key: "created_at", label: "Created" },
    ]}
    fields={[
      entityPicker(true),
      { name: "period_code", label: "Period (YYYY-MM)", required: true, placeholder: "2026-06" },
    ]}
  />
);

export const VacanciesPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Vacancies"
    description="Recruitment: job vacancies and applicant pipeline."
    endpoint="/vacancies"
    idKey="vacancy_id"
    columns={[
      { key: "title", label: "Title" },
      { key: "department", label: "Department" },
      { key: "status", label: "Status" },
      { key: "posted_to_website", label: "Posted" },
      { key: "created_at", label: "Created" },
    ]}
    fields={[
      { name: "title", label: "Title", required: true },
      { name: "department", label: "Department" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: [
        { value: "DRAFT", label: "Draft" }, { value: "OPEN", label: "Open" }, { value: "CLOSED", label: "Closed" },
      ] },
      { name: "posted_to_website", label: "Posted to website", type: "checkbox" },
    ]}
  />
);

export const ContractsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Contracts"
    description="HR contracts: offer, employment, confirmation, termination."
    endpoint="/contracts"
    idKey="hr_contract_id"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "effective_on", label: "Effective" },
      { key: "end_on", label: "Ends" },
    ]}
    fields={[
      employeePicker("employee_id", "Employee"),
      { name: "kind", label: "Kind", type: "select", required: true, options: [
        { value: "OFFER_LETTER", label: "Offer letter" }, { value: "EMPLOYMENT", label: "Employment" },
        { value: "CONFIRMATION", label: "Confirmation" }, { value: "TERMINATION", label: "Termination" },
      ] },
      { name: "effective_on", label: "Effective on", type: "date" },
      { name: "end_on", label: "Ends on", type: "date" },
      { name: "status", label: "Status", type: "select", options: [
        { value: "DRAFT", label: "Draft" }, { value: "ISSUED", label: "Issued" },
        { value: "SIGNED", label: "Signed" }, { value: "ENDED", label: "Ended" },
      ] },
    ]}
  />
);

export const AppraisalsPage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Appraisals"
    description="Performance appraisals against KPI targets."
    endpoint="/appraisals"
    idKey="appraisal_id"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "period_code", label: "Period" },
      { key: "actual_value", label: "Actual" },
      { key: "rating", label: "Rating" },
    ]}
    fields={[
      employeePicker("employee_id", "Employee"),
      { name: "period_code", label: "Period (YYYY-MM)", required: true, placeholder: "2026-06" },
      { name: "actual_value", label: "Actual value", type: "number" },
      { name: "rating", label: "Rating (0–5)", type: "number" },
      { name: "comments", label: "Comments", type: "textarea" },
    ]}
  />
);

export const AttendancePage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Attendance"
    description="Clock-in / clock-out logs with optional GPS."
    endpoint="/attendance"
    idKey="attendance_id"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "clock_in_at", label: "Clock in" },
      { key: "clock_out_at", label: "Clock out" },
    ]}
    fields={[
      employeePicker("employee_id", "Employee"),
      { name: "clock_in_at", label: "Clock in", type: "datetime" },
      { name: "clock_out_at", label: "Clock out", type: "datetime" },
    ]}
  />
);

export const LeavePage = () => (
  <CrudResource
    eyebrow={eyebrow}
    title="Leave & allowances"
    description="Leave, salary-advance and mission requests."
    endpoint="/leave"
    idKey="leave_request_id"
    columns={[
      { key: "employee_id", label: "Employee" },
      { key: "kind", label: "Kind" },
      { key: "starts_on", label: "From" },
      { key: "ends_on", label: "To" },
      { key: "status", label: "Status" },
    ]}
    fields={[
      employeePicker("employee_id", "Employee"),
      { name: "kind", label: "Kind", type: "select", options: [
        { value: "leave", label: "Leave" }, { value: "salary_advance", label: "Salary advance" }, { value: "mission", label: "Mission" },
      ] },
      { name: "starts_on", label: "From", type: "date" },
      { name: "ends_on", label: "To", type: "date" },
      { name: "amount", label: "Amount (salary advance, XAF)", type: "number" },
      { name: "status", label: "Status", type: "select", options: [
        { value: "REQUESTED", label: "Requested" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" },
      ] },
    ]}
  />
);

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
