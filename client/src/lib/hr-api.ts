/**
 * HR API helpers (typed) — attendance time-clock + worksite geofences.
 * Routes mirror src/modules/hr/attendance.
 */
import { tenant } from "./api-client";

export type WorkSite = {
  work_site_id: string;
  entity_id?: string | null;
  name: string;
  latitude: number | string;
  longitude: number | string;
  radius_m: number;
  is_active: boolean;
};

export type AttendanceRow = {
  attendance_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  work_site_id?: string | null;
  distance_m?: number | string | null;
  within_geofence?: boolean | null;
  geo_label?: string | null;
  is_late?: boolean;
  minutes_late?: number;
  department?: string | null;
};

export type AbsenceResult = { date: string; count: number; absent: { employee_id: string; full_name: string; department?: string | null }[] };

export type Fix = { latitude: number; longitude: number; accuracy?: number };

function qs(params?: Record<string, string | undefined>) {
  if (!params) return "";
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  const s = q.toString();
  return s ? "?" + s : "";
}

export const openPunch = () => tenant<AttendanceRow | null>("/attendance/open");
export const clockIn = (body: Partial<Fix> & { employee_id?: string }) =>
  tenant<AttendanceRow>("/attendance/clock-in", { method: "POST", body });
export const clockOut = (body: { latitude?: number; longitude?: number; id?: string } = {}) =>
  tenant<AttendanceRow>("/attendance/clock-out", { method: "POST", body });
export const listAttendance = (params?: { date?: string; employee_id?: string }) =>
  tenant<AttendanceRow[]>("/attendance" + qs(params));
export const absence = (date?: string) => tenant<AbsenceResult>("/attendance/absence" + qs({ date }));

/* ── Payroll runs ── */
export type PayrollRun = {
  payroll_run_id: string;
  entity_id?: string | null;
  period_code: string;
  status: string;
  entry_id?: string | null;
  created_at?: string | null;
};
export type Slip = {
  gross?: number;
  base?: number;
  earnings?: number;
  earning_lines?: { label?: string; kind?: string; amount?: number }[];
  net_pay?: number;
  total_employer_charges?: number;
  employee?: Record<string, number>;
  employer?: Record<string, number>;
};

/* ── Appraisals + performance rewards ── */
export type Appraisal = {
  appraisal_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  period_code: string;
  metric?: string | null;
  target_value?: number | string | null;
  actual_value?: number | string | null;
  rating?: number | string | null;
  weight?: number | string | null;
  weighted_score?: number | null;
  comments?: string | null;
  reward_amount?: number | null;
  reward_status?: string | null; // PENDING | APPLIED
};
export const listAppraisals = (params?: { employee_id?: string }) => tenant<Appraisal[]>("/appraisals" + qs(params));
export const recommendReward = (id: string, body: { amount: number; label?: string }) =>
  tenant(`/appraisals/${id}/reward`, { method: "POST", body });
export type PayrollItem = {
  payroll_run_item_id?: string;
  employee_id: string;
  employee_name?: string | null;
  cnps_number?: string | null;
  gross: number | string;
  net_pay: number | string;
  breakdown?: Slip | null;
};
export type PayrollRunDetail = PayrollRun & { items: PayrollItem[] };

export const listPayrollRuns = () => tenant<PayrollRun[]>("/payroll");
export const getPayrollRun = (id: string) => tenant<PayrollRunDetail>(`/payroll/${id}`);
export const createPayrollRun = (body: { entity_id: string; period_code: string }) => tenant<PayrollRun>("/payroll", { method: "POST", body });
export const computePayroll = (id: string) =>
  tenant<{ run: PayrollRun; item_count: number; totals: { gross: number; net: number; employer_charges: number } }>(`/payroll/${id}/compute`, { method: "POST", body: {} });
export const setPayrollStatus = (id: string, status: string) => tenant<PayrollRun>(`/payroll/${id}/status`, { method: "POST", body: { status } });

/* ── Leave / allowance requests ── */
export type LeaveRequest = {
  leave_request_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  kind?: string | null; // leave | salary_advance | mission
  starts_on?: string | null;
  ends_on?: string | null;
  amount?: number | string | null;
  status: string; // REQUESTED | APPROVED | REJECTED
  created_at?: string | null;
};
export const listLeave = (params?: { status?: string; employee_id?: string }) => tenant<LeaveRequest[]>("/leave" + qs(params));
export const createLeave = (body: { employee_id: string; kind: string; starts_on?: string; ends_on?: string; amount?: number }) =>
  tenant<LeaveRequest>("/leave", { method: "POST", body });
export const decideLeave = (id: string, status: "APPROVED" | "REJECTED") =>
  tenant<LeaveRequest>(`/leave/${id}/decision`, { method: "POST", body: { status } });

/* ── Employees (profile 360) ── */
export type Employee = {
  employee_id: string;
  full_name?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  department?: string | null;
  job_title?: string | null;
  employment_type?: string | null;
  cnps_number?: string | null;
  base_salary?: number | string | null;
  is_active?: boolean | null;
  is_driver?: boolean | null;
};
export const listEmployees = () => tenant<Employee[]>("/employees");
export const getEmployee = (id: string) => tenant<Employee>(`/employees/${id}`);
export const createEmployee = (body: { full_name: string; entity_id?: string; department?: string; job_title?: string; employment_type?: string }) =>
  tenant<Employee>("/employees", { method: "POST", body });
export const setEmployeeActive = (id: string, is_active: boolean) =>
  tenant<Employee>(`/employees/${id}/active`, { method: "POST", body: { is_active } });
export const updateEmployee = (
  id: string,
  body: Partial<{ full_name: string; entity_id: string; department: string; job_title: string; employment_type: string }>,
) => tenant<Employee>(`/employees/${id}`, { method: "PATCH", body });

/* ── HR contracts (lifecycle) ── */
export type Contract = {
  hr_contract_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  kind?: string | null;
  status: string; // DRAFT | ISSUED | SIGNED | ENDED
  effective_on?: string | null;
  end_on?: string | null;
  created_at?: string | null;
};
export const listContracts = (params?: { employee_id?: string; status?: string }) => tenant<Contract[]>("/contracts" + qs(params));
export const createContract = (body: { employee_id?: string; kind: string; effective_on?: string; end_on?: string }) =>
  tenant<Contract>("/contracts", { method: "POST", body });
export const setContractStatus = (id: string, status: string) =>
  tenant<Contract>(`/contracts/${id}/status`, { method: "POST", body: { status } });

/* ── Vacancies + applicant pipeline (recruitment kanban) ── */
export type Vacancy = {
  vacancy_id: string;
  title?: string | null;
  department?: string | null;
  description?: string | null;
  status: string; // DRAFT | OPEN | CLOSED
  posted_to_website?: boolean | null;
  created_at?: string | null;
};
export type Applicant = {
  applicant_id: string;
  vacancy_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  status: string; // APPLIED | SHORTLISTED | INTERVIEWED | HIRED | REJECTED | TALENT_POOL
};
export const listVacancies = () => tenant<Vacancy[]>("/vacancies");
export const createVacancy = (body: { title: string; department?: string; description?: string }) =>
  tenant<Vacancy>("/vacancies", { method: "POST", body });
export const setVacancyStatus = (id: string, status: string) =>
  tenant<Vacancy>(`/vacancies/${id}/status`, { method: "POST", body: { status } });
export const listApplicants = (vacancyId: string) => tenant<Applicant[]>(`/vacancies/${vacancyId}/applicants`);
export const addApplicant = (vacancyId: string, body: { full_name: string; email?: string; phone?: string }) =>
  tenant<Applicant>(`/vacancies/${vacancyId}/applicants`, { method: "POST", body });
export const setApplicantStatus = (vacancyId: string, applicantId: string, status: string) =>
  tenant<Applicant>(`/vacancies/${vacancyId}/applicants/${applicantId}`, { method: "PATCH", body: { status } });

/* ── Trainings + attendance roster ── */
export type Training = {
  training_id: string;
  title?: string | null;
  scheduled_on?: string | null;
  facilitator?: string | null;
  status: string; // SCHEDULED | DONE | CANCELLED
};
export type TrainingAttendee = {
  training_attendance_id: string;
  training_id: string;
  employee_id?: string | null;
  attended?: boolean | null;
};
export const listTrainings = () => tenant<Training[]>("/trainings");
export const createTraining = (body: { title: string; scheduled_on?: string; facilitator?: string }) =>
  tenant<Training>("/trainings", { method: "POST", body });
export const setTrainingStatus = (id: string, status: string) =>
  tenant<Training>(`/trainings/${id}/status`, { method: "POST", body: { status } });
export const listTrainingAttendees = (trainingId: string) => tenant<TrainingAttendee[]>(`/trainings/${trainingId}/attendees`);
export const addTrainingAttendee = (trainingId: string, employee_id: string) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/attendees`, { method: "POST", body: { employee_id } });
export const setTrainingAttendee = (trainingId: string, attendeeId: string, attended: boolean) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/attendees/${attendeeId}`, { method: "PATCH", body: { attended } });

export const listSites = () => tenant<WorkSite[]>("/attendance/work-sites");
export const createSite = (body: { name: string; latitude: number; longitude: number; radius_m?: number }) =>
  tenant<WorkSite>("/attendance/work-sites", { method: "POST", body });
export const updateSite = (id: string, body: Partial<Pick<WorkSite, "name" | "latitude" | "longitude" | "radius_m" | "is_active">>) =>
  tenant<WorkSite>(`/attendance/work-sites/${id}`, { method: "PATCH", body });

/** Best-effort device GPS fix (browser Geolocation). Rejects on denial/timeout. */
export function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Location isn't available on this device"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.message || "Location permission denied")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
