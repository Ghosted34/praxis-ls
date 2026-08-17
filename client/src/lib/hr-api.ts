/**
 * HR API helpers (typed) — attendance time-clock + worksite geofences.
 * Routes mirror src/modules/hr/attendance.
 */
import { tenant } from "./api-client";
import { tokenStore } from "./token-store";

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
  hr_device_id?: string | null;
  /** Was the punching device trusted AT PUNCH TIME. null = none presented. */
  device_trusted?: boolean | null;
  /** TRANSIENT, on the clock-in response only: this punch registered a device
   *  nobody has met before, so the clock offers to name it — once. */
  device_new?: boolean;
  is_late?: boolean;
  minutes_late?: number;
  department?: string | null;
};

export type AbsenceResult = {
  date: string;
  /** false = the day has not been reconciled yet (it is still running), so the
   *  list is the provisional "has not arrived" one, not a settled answer. */
  reconciled?: boolean;
  count: number;
  absent: {
    employee_id: string;
    full_name: string;
    department?: string | null;
    status?: string;
    deduction_amount?: number | string | null;
    justified?: boolean;
  }[];
};

export type Fix = { latitude: number; longitude: number; accuracy?: number };

function qs(params?: Record<string, string | undefined>) {
  if (!params) return "";
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) q.set(k, v);
  });
  const s = q.toString();
  return s ? "?" + s : "";
}

/* ── Registered devices (0524) ────────────────────────────────────────────────
 *
 * WHAT THIS IS NOT. The fingerprint below is a random id this browser generated
 * once and kept — it is not a hardware identifier and it is not an
 * authentication factor. Anyone who wants to copy it can. Its value is that a
 * SECOND device showing up against one employee becomes a dated row a manager
 * can see, which is what turns casual buddy-punching into something deliberate
 * that leaves a trace.
 *
 * NOT a browser-signal fingerprint (canvas, fonts, screen metrics) on purpose:
 * those identify the person across sites whether or not they consented, which is
 * a far larger thing to do to an employee than the problem warrants. A random
 * value in this app's own storage identifies the device only to this app, and
 * clearing site data resets it — the cost of which is one re-registration.
 */
const DEVICE_KEY = "praxis.device.id";

/** This browser's device id, minted on first read. Empty string when storage is
 *  unavailable (private mode, embedded webview) — the server treats a missing
 *  fingerprint as "no device presented" rather than failing the punch. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (
        crypto.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      ).replace(/-/g, "");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export type DeviceInfo = {
  fingerprint: string;
  label?: string;
  platform?: string;
};
/** The device block sent with a punch, or null when this browser can't keep an
 *  id. `user_agent` is deliberately absent — the server reads the real header. */
export function deviceInfo(): DeviceInfo | null {
  const fingerprint = deviceId();
  if (!fingerprint) return null;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    undefined;
  return { fingerprint, platform };
}

export type HrDevice = {
  hr_device_id: string;
  employee_id: string;
  employee_name?: string | null;
  label: string;
  platform?: string | null;
  user_agent?: string | null;
  status: "PENDING" | "TRUSTED" | "REVOKED";
  first_seen_at?: string | null;
  last_seen_at?: string | null;
};
export const listDevices = (params?: { employee_id?: string }) =>
  tenant<HrDevice[]>("/attendance/devices" + qs(params));
export const registerDevice = (body: {
  employee_id?: string;
  device: DeviceInfo;
}) => tenant<HrDevice>("/attendance/devices", { method: "POST", body });
export const setDeviceStatus = (
  id: string,
  patch: { status?: "TRUSTED" | "REVOKED"; label?: string },
) =>
  tenant<HrDevice>(`/attendance/devices/${id}`, {
    method: "PATCH",
    body: patch,
  });

/**
 * Rename your OWN device — the grant that lets you punch, not the one that
 * approves devices. `setDeviceStatus` above is the manager's endpoint and needs
 * MOD-14 `edit`, which an ordinary employee does not have; without this pair an
 * employee could never name their own phone.
 */
export const renameOwnDevice = (id: string, label: string) =>
  tenant<HrDevice>(`/attendance/devices/${id}/name`, { method: "PATCH", body: { label } });

export const openPunch = () => tenant<AttendanceRow | null>("/attendance/open");
export const clockIn = (
  body: Partial<Fix> & { employee_id?: string; device?: DeviceInfo | null },
) => tenant<AttendanceRow>("/attendance/clock-in", { method: "POST", body });
export const clockOut = (
  body: { latitude?: number; longitude?: number; id?: string } = {},
) => tenant<AttendanceRow>("/attendance/clock-out", { method: "POST", body });
export const listAttendance = (params?: {
  date?: string;
  employee_id?: string;
}) => tenant<AttendanceRow[]>("/attendance" + qs(params));
export const absence = (date?: string) =>
  tenant<AbsenceResult>("/attendance/absence" + qs({ date }));

/* ── Reconciled days + house rules (0697) ──────────────────────────────────
 *
 * A reconciled day is what `attendance_log` never was: one row per employee per
 * date, with approved leave, holidays and non-working days as first-class
 * states rather than as a missing punch — and with the money at stake frozen
 * onto it. It is what payroll reads and what an employee disputes.
 */
export type AttendanceDay = {
  attendance_day_id: string;
  employee_id: string;
  employee_name?: string | null;
  work_date: string;
  status: "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE" | "OFF" | "WEEKEND" | "HOLIDAY";
  expected_start_time?: string | null;
  first_clock_in_at?: string | null;
  last_clock_out_at?: string | null;
  minutes_late: number;
  daily_rate: number | string;
  deduction_pct: number | string;
  deduction_amount: number | string;
  justified: boolean;
  justification?: string | null;
  hr_query_id?: string | null;
  leave_request_id?: string | null;
  /** The rule that charged this day, and the SOP clause behind it. */
  rule_name?: string | null;
  rule_code?: string | null;
  sop_document_id?: string | null;
  sop_title?: string | null;
};

export type HrRule = {
  hr_rule_id: string;
  code: string;
  name: string;
  description?: string | null;
  kind: "LATENESS" | "ABSENCE" | "REWARD" | "CONDUCT";
  metric?: string | null;
  comparator?: "gte" | "lte" | null;
  threshold?: number | string | null;
  tiers: { after_minutes: number; deduction_pct: number }[];
  effect:
    | "DEDUCT_PCT_DAY"
    | "DEDUCT_FIXED"
    | "BONUS_FIXED"
    | "BONUS_PCT_SALARY"
    | "SALARY_INCREASE_PCT"
    | "QUERY_ONLY";
  effect_value?: number | string | null;
  auto_query: boolean;
  query_severity: "INFO" | "WARNING" | "SERIOUS";
  query_due_days: number;
  sop_document_id?: string | null;
  sop_title?: string | null;
  is_active: boolean;
  is_system: boolean;
};

export const attendanceDays = (p: { from: string; to: string; employee_id?: string }) =>
  tenant<AttendanceDay[]>("/attendance/days" + qs(p));
export const myAttendanceDays = (p: { from: string; to: string }) =>
  tenant<AttendanceDay[]>("/attendance/days/mine" + qs(p));
export const justifyDay = (dayId: string, body: { justified: boolean; justification?: string }) =>
  tenant<AttendanceDay>(`/attendance/days/${dayId}/justify`, { method: "POST", body });
export const runReconcile = (date?: string) =>
  tenant<{ work_date: string; employees: number; written: number; chargeable: number }>(
    "/attendance/reconcile",
    { method: "POST", body: date ? { date } : {} },
  );

export const listHrRules = (p?: { kind?: string; active?: string }) =>
  tenant<HrRule[]>("/sops/rules" + qs(p));
export const createHrRule = (body: Partial<HrRule> & { code: string; name: string; kind: string }) =>
  tenant<HrRule>("/sops/rules", { method: "POST", body });
export const updateHrRule = (id: string, body: Partial<HrRule>) =>
  tenant<HrRule>(`/sops/rules/${id}`, { method: "PATCH", body });

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
  /* ── What the month did to this payslip (0697/0698) ─────────────────────
   *
   * The two sides go to different places and the payslip has to show both, or
   * "why is this less than last month?" is unanswerable. Time not worked came
   * off GROSS (so the tax is lower too); the advance came off NET.
   */
  attendance_deduction?: number;
  unpaid_leave_deduction?: number;
  attendance?: {
    /** false = the month was never reconciled, so a zero here means "nobody
     *  looked", not "nobody was late". */
    reconciled: boolean;
    late_days: number;
    absent_days: number;
    unpaid_leave_days: number;
    waived_days: number;
  };
  net_before_recovery?: number;
  post_tax_deductions?: { label: string; amount: number; requested?: number }[];
  total_post_tax_deductions?: number;
  advance?: {
    salary_advance_id: string;
    due: number;
    recovered: number;
    outstanding_after: number;
  };
  net_pay?: number;
  total_employer_charges?: number;
  employee?: Record<string, number>;
  employer?: Record<string, number>;
};

/* ── Salary advances (0698) ── */
export type SalaryAdvance = {
  salary_advance_id: string;
  employee_id: string;
  employee_name?: string | null;
  leave_request_id?: string | null;
  amount: number | string;
  instalments: number;
  instalment_amount: number | string;
  first_period_code: string;
  status: "ACTIVE" | "SETTLED" | "SUSPENDED" | "WRITTEN_OFF";
  note?: string | null;
  /** Derived, never stored — amount less the APPLIED instalments. */
  recovered: number | string;
  outstanding: number | string;
  repayments?: {
    repayment_id: string;
    period_code: string;
    amount: number | string;
    status: "PENDING" | "APPLIED" | "REVERSED";
    run_status?: string | null;
  }[];
};

export const listAdvances = (p?: { employee_id?: string; status?: string }) =>
  tenant<SalaryAdvance[]>("/payroll/advances" + qs(p));
export const myAdvances = () => tenant<SalaryAdvance[]>("/payroll/advances/mine");
export const getAdvance = (id: string) => tenant<SalaryAdvance>(`/payroll/advances/${id}`);
export const createAdvance = (body: {
  employee_id: string;
  amount: number;
  instalments?: number;
  instalment_amount?: number;
  first_period_code: string;
  entity_id?: string;
  leave_request_id?: string;
  status?: "ACTIVE" | "SUSPENDED";
  note?: string;
}) => tenant<SalaryAdvance>("/payroll/advances", { method: "POST", body });
export const updateAdvance = (
  id: string,
  body: {
    instalments?: number;
    instalment_amount?: number;
    first_period_code?: string;
    status?: "ACTIVE" | "SUSPENDED" | "WRITTEN_OFF";
    note?: string;
  },
) => tenant<SalaryAdvance>(`/payroll/advances/${id}`, { method: "PATCH", body });

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
/* ── Appraisal cycles + two-sided reviews (0701) ───────────────────────────
 *
 * An `Appraisal` is one KPI. A `Review` is the conversation about a person over
 * a cycle — the overall figure, the manager's narrative, and the employee's
 * answer to it. The second did not exist: an appraisal had `rated_by` and
 * nothing else, so a performance record that may later justify a dismissal had
 * only ever been seen by the person who wrote it.
 */
export type AppraisalCycle = {
  appraisal_cycle_id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: "DRAFT" | "OPEN" | "SCORING" | "CALIBRATION" | "RELEASED" | "CLOSED";
  review_count?: number;
  settled_count?: number;
};

export type ReviewLine = {
  appraisal_id: string;
  metric?: string | null;
  target_value?: number | string | null;
  actual_value?: number | string | null;
  weight?: number | string | null;
  scale_max?: number | string | null;
  auto_source?: string | null;
  /** The human's decision. */
  rating?: number | string | null;
  /** The evidence-derived suggestion. NEVER merged into `rating` — the value of
   *  the number is that a manager can disagree with it. */
  ai_rating?: number | string | null;
  ai_evidence?: Record<string, unknown> | null;
  is_calibrated: boolean;
  comments?: string | null;
};

export type AppraisalReview = {
  appraisal_review_id: string;
  appraisal_cycle_id: string;
  employee_id: string;
  employee_name?: string | null;
  cycle_code?: string | null;
  cycle_name?: string | null;
  cycle_status?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  overall_score?: number | string | null;
  band?: string | null;
  manager_comment?: string | null;
  ai_summary?: string | null;
  ai_model?: string | null;
  status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | "DISPUTED" | "FINALISED";
  submitted_at?: string | null;
  employee_comment?: string | null;
  responded_at?: string | null;
  lines?: ReviewLine[];
  weights?: { total: number; target: number; balanced: boolean };
};

export const appraisalCycles = () => tenant<AppraisalCycle[]>("/appraisals/cycles");
export const createAppraisalCycle = (body: {
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status?: "DRAFT" | "OPEN";
}) => tenant<AppraisalCycle>("/appraisals/cycles", { method: "POST", body });
export const setCycleStatus = (id: string, status: string) =>
  tenant<AppraisalCycle>(`/appraisals/cycles/${id}/status`, { method: "POST", body: { status } });
/** Score from the evidence the system already holds. Calibrated rows — the ones
 *  a human has decided — are never touched, which is what makes this safe to
 *  press twice. */
export const scoreCycle = (id: string, employee_id?: string) =>
  tenant<{ employees: number; scored: number; skipped: number }>(
    `/appraisals/cycles/${id}/score`,
    { method: "POST", body: employee_id ? { employee_id } : {} },
  );
export const openReview = (cycleId: string, employee_id: string) =>
  tenant<AppraisalReview>(`/appraisals/cycles/${cycleId}/reviews`, { method: "POST", body: { employee_id } });

export const listReviews = (params?: { cycle_id?: string; employee_id?: string; status?: string }) =>
  tenant<AppraisalReview[]>("/appraisals/reviews" + qs(params));
export const getReview = (id: string) => tenant<AppraisalReview>(`/appraisals/reviews/${id}`);
export const submitReview = (id: string, manager_comment?: string) =>
  tenant<AppraisalReview>(`/appraisals/reviews/${id}/submit`, { method: "POST", body: { manager_comment } });
export const narrateReview = (id: string) =>
  tenant<AppraisalReview>(`/appraisals/reviews/${id}/narrate`, { method: "POST", body: {} });
export const myReviews = () => tenant<AppraisalReview[]>("/appraisals/reviews/mine");
export const respondToReview = (id: string, agree: boolean, comment?: string) =>
  tenant<AppraisalReview>(`/appraisals/reviews/${id}/respond`, { method: "POST", body: { agree, comment } });

export const listAppraisals = (params?: { employee_id?: string }) =>
  tenant<Appraisal[]>("/appraisals" + qs(params));
export const recommendReward = (
  id: string,
  body: { amount: number; label?: string },
) => tenant(`/appraisals/${id}/reward`, { method: "POST", body });
export type PayrollItem = {
  payroll_run_item_id?: string;
  employee_id: string;
  employee_name?: string | null;
  cnps_number?: string | null;
  gross: number | string;
  net_pay: number | string;
  attendance_deduction?: number | string;
  unpaid_leave_deduction?: number | string;
  advance_recovery?: number | string;
  breakdown?: Slip | null;
};
export type PayrollRunDetail = PayrollRun & { items: PayrollItem[] };

export const listPayrollRuns = () => tenant<PayrollRun[]>("/payroll");
export const getPayrollRun = (id: string) =>
  tenant<PayrollRunDetail>(`/payroll/${id}`);
export const createPayrollRun = (body: {
  entity_id: string;
  period_code: string;
}) => tenant<PayrollRun>("/payroll", { method: "POST", body });
export const computePayroll = (id: string) =>
  tenant<{
    run: PayrollRun;
    item_count: number;
    /** false = no day in this period was reconciled, so the deductions are zero
     *  because nobody looked — not because nobody was late. */
    attendance_reconciled?: boolean;
    totals: {
      gross: number;
      net: number;
      employer_charges: number;
      attendance_deduction?: number;
      unpaid_leave_deduction?: number;
      advance_recovery?: number;
    };
  }>(`/payroll/${id}/compute`, { method: "POST", body: {} });
export const setPayrollStatus = (id: string, status: string) =>
  tenant<PayrollRun>(`/payroll/${id}/status`, {
    method: "POST",
    body: { status },
  });

/* ── Leave / allowance requests ── */
export type LeaveRequest = {
  leave_request_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  kind?: string | null; // leave | salary_advance | mission
  leave_type_id?: string | null;
  leave_type_code?: string | null;
  leave_type_name?: string | null;
  leave_type_is_paid?: boolean | null;
  starts_on?: string | null;
  ends_on?: string | null;
  // Working (or calendar) days the request consumes, half days included.
  // Frozen when the request is raised — see migration 0696.
  days?: number | string | null;
  half_day_start?: boolean | null;
  half_day_end?: boolean | null;
  reason?: string | null;
  amount?: number | string | null;
  status: string; // REQUESTED | APPROVED | REJECTED | CANCELLED | TAKEN
  created_at?: string | null;
};

/** What one employee has left, per leave type, for a year. The number that did
 *  not exist anywhere in the product before 0696. */
export type LeaveBalance = {
  leave_type_id: string;
  code: string;
  name: string;
  is_paid: boolean;
  allow_negative: boolean;
  requires_document: boolean;
  max_days_per_year?: number | string | null;
  period_year: number;
  accrued: number;
  carried: number;
  taken: number;
  returned: number;
  adjustments: number;
  forfeited: number;
  balance: number;
};

export type LeaveType = {
  leave_type_id: string;
  code: string;
  name: string;
  is_paid: boolean;
  accrual_days_per_month?: number | string | null;
  max_days_per_year?: number | string | null;
  max_carryover_days?: number | string | null;
  requires_document: boolean;
  counts_working_days: boolean;
  allow_negative: boolean;
  is_active: boolean;
  is_system: boolean;
};

export type PublicHoliday = {
  public_holiday_id: string;
  holiday_on: string;
  name: string;
  is_recurring: boolean;
};

/** `exclude_kind` keeps salary advances off the Leave screen — they have had
 *  their own tab since 0698, and an advance shown in both places is decided
 *  differently in each. Filtered SERVER-side: the list is capped at 50 rows, so
 *  dropping them in the browser would show fewer than fifty leave requests and
 *  present that as the whole set. */
export const listLeave = (params?: {
  status?: string;
  employee_id?: string;
  kind?: string;
  exclude_kind?: string;
}) => tenant<LeaveRequest[]>("/leave" + qs(params));
export const createLeave = (body: {
  employee_id: string;
  kind: string;
  leave_type_id?: string;
  starts_on?: string;
  ends_on?: string;
  half_day_start?: boolean;
  half_day_end?: boolean;
  reason?: string;
  amount?: number;
}) => tenant<LeaveRequest>("/leave", { method: "POST", body });
export const decideLeave = (id: string, status: "APPROVED" | "REJECTED") =>
  tenant<LeaveRequest>(`/leave/${id}/decision`, {
    method: "POST",
    body: { status },
  });
/** Give approved days back. Posts the opposite ledger entry rather than
 *  deleting the consumption. */
export const cancelLeave = (id: string) =>
  tenant<LeaveRequest>(`/leave/${id}/cancel`, { method: "POST" });

export const leaveTypes = () => tenant<LeaveType[]>("/leave/types");
export const publicHolidays = () => tenant<PublicHoliday[]>("/leave/holidays");
export const leaveBalances = (employeeId: string, year?: number) =>
  tenant<LeaveBalance[]>(`/leave/balances/${employeeId}` + qs({ year: year ? String(year) : undefined }));
export const myLeaveBalances = (year?: number) =>
  tenant<LeaveBalance[]>("/leave/mine/balances" + qs({ year: year ? String(year) : undefined }));

/* ── Employees (profile 360) ── */
export type Employee = {
  employee_id: string;
  full_name?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  // scope_id is the department reference (0490); department is the snapshot.
  scope_id?: string | null;
  // Line manager (0493) — the reporting line `is_line_manager` always needed.
  reports_to?: string | null;
  department?: string | null;
  job_title?: string | null;
  email?: string | null;
  employment_type?: string | null;
  cnps_number?: string | null;
  base_salary?: number | string | null;
  is_active?: boolean | null;
  is_driver?: boolean | null;
};
export const listEmployees = () => tenant<Employee[]>("/employees");
export const getEmployee = (id: string) => tenant<Employee>(`/employees/${id}`);
// `scope_id` is the department reference (0490); `department` is the display
// snapshot the API keeps in step with it.
export const createEmployee = (body: {
  full_name: string;
  entity_id?: string;
  scope_id?: string;
  reports_to?: string;
  department?: string;
  job_title?: string;
  email?: string;
  employment_type?: string;
}) => tenant<Employee>("/employees", { method: "POST", body });
export const setEmployeeActive = (id: string, is_active: boolean) =>
  tenant<Employee>(`/employees/${id}/active`, {
    method: "POST",
    body: { is_active },
  });
export const updateEmployee = (
  id: string,
  body: Partial<{
    full_name: string;
    entity_id: string;
    scope_id: string;
    reports_to: string;
    department: string;
    job_title: string;
    email: string;
    employment_type: string;
  }>,
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
  pdf_vault_id?: string | null; // set once a signed copy is uploaded
  created_at?: string | null;
  /* ── The document, and the terms (0700) ────────────────────────────────
   *
   * `body_md` is the agreed text and the source of truth; the PDF is a
   * rendering of it. Until this existed the renderer had no clauses to draw,
   * so every generated contract was a letterhead with two names on it.
   */
  title?: string | null;
  body_md?: string | null;
  ai_generated?: boolean;
  ai_model?: string | null;
  entity_id?: string | null;
  job_title?: string | null;
  gross_salary?: number | string | null;
  salary_currency?: string | null;
  probation_months?: number | null;
  probation_ends_on?: string | null;
  notice_days?: number | null;
  working_hours?: string | null;
  place_of_work?: string | null;
  signed_on?: string | null;
  signed_by_name?: string | null;
  vacancy_id?: string | null;
};

/** A contract whose term or probation runs out soon — the question nothing
 *  could answer before 0700, because nothing had ever read `end_on`. */
export type LapsingContract = {
  hr_contract_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  kind?: string | null;
  status: string;
  end_on?: string | null;
  probation_ends_on?: string | null;
  days_left: number;
};
export const listContracts = (params?: {
  employee_id?: string;
  status?: string;
}) => tenant<Contract[]>("/contracts" + qs(params));
export const createContract = (body: {
  employee_id?: string;
  kind: string;
  effective_on?: string;
  end_on?: string;
}) => tenant<Contract>("/contracts", { method: "POST", body });
export const setContractStatus = (id: string, status: string) =>
  tenant<Contract>(`/contracts/${id}/status`, {
    method: "POST",
    body: { status },
  });
/** Draft (or re-draft) the contract text. The terms passed here are FACTS the
 *  model must reproduce, not suggestions — see hr_contract.draft. */
export const draftContract = (
  id: string,
  body: {
    title?: string;
    job_title?: string;
    effective_on?: string;
    end_on?: string;
    gross_salary?: number;
    salary_currency?: string;
    probation_months?: number;
    notice_days?: number;
    working_hours?: string;
    place_of_work?: string;
  },
) => tenant<Contract>(`/contracts/${id}/draft`, { method: "POST", body });

export const updateContract = (id: string, body: Partial<Contract>) =>
  tenant<Contract>(`/contracts/${id}`, { method: "PATCH", body });

export const lapsingContracts = (days?: number) =>
  tenant<{ expiring: LapsingContract[]; probation: LapsingContract[] }>(
    "/contracts/lapsing" + qs({ days: days ? String(days) : undefined }),
  );

/** Email the drafted contract (rendered from the template) to a recipient. */
export const sendContract = (id: string, to: string) =>
  tenant(`/document-templates/EMPLOYMENT_CONTRACT/${id}/send`, {
    method: "POST",
    body: { to },
  });
/** Upload an already-signed contract PDF (base64 data URL): vault it and tie the
 *  vault doc to the contract row via pdf_vault_id. */
export const uploadContractSigned = async (id: string, dataUrl: string) => {
  const doc = await tenant<{ doc_id?: string; vault_id?: string }>(
    "/documents",
    {
      method: "POST",
      body: {
        data_url: dataUrl,
        doc_type: "EMPLOYMENT_CONTRACT",
        entity_ref: `hr_contract:${id}`,
      },
    },
  );
  const vaultId = doc.doc_id || doc.vault_id;
  return tenant<Contract>(`/contracts/${id}`, {
    method: "PATCH",
    body: { pdf_vault_id: vaultId },
  });
};

/* ── Vacancies + applicant pipeline (recruitment kanban) ── */
export type Vacancy = {
  vacancy_id: string;
  title?: string | null;
  department?: string | null;
  description?: string | null;
  status: string; // DRAFT | OPEN | CLOSED
  posted_to_website?: boolean | null;
  created_at?: string | null;
  // 0525 — the structured shape the scorer compares candidates against.
  employment_type?: string | null;
  location?: string | null;
  experience_years_min?: number | null;
  skills_required?: string[] | null;
  salary_min?: number | string | null;
  salary_max?: number | string | null;
  salary_currency?: string | null;
  closes_on?: string | null;
  /** The public careers credential. NULL = not published. */
  public_token?: string | null;
  published_at?: string | null;
  /** The department REFERENCE (0490); `department` is the display snapshot.
   *  The editor has to read it back or a save would clear it — see there. */
  scope_id?: string | null;
  // 0684 — the detail a candidate reads before deciding to apply.
  work_mode?: string | null;
  working_hours?: string | null;
  days_on_site?: number | null;
  days_off_site?: number | null;
  days_off?: number | null;
  probation_months?: number | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  target_start_date?: string | null;
  /** The band stays on the row; the PUBLIC payload omits it when this is set. */
  salary_hidden?: boolean | null;
  apply_config?: { require_cover_letter?: boolean; require_portfolio?: boolean } | null;
  // 0526 — who is hiring, how many, and where the advert came from.
  entity_id?: string | null;
  headcount?: number | null;
  /** The model that drafted this, or `template` when none was reachable.
   *  NULL on a hand-written vacancy. Shown in the editor, because a template
   *  draft that looks model-written is how boilerplate gets published. */
  ai_provider?: string | null;
  ai_generated?: boolean | null;
  /** The interview answers, verbatim — kept so a draft can be regenerated
   *  without re-interviewing anybody. Open by shape: the later questions are
   *  generated from the earlier answers. */
  intake_json?: Record<string, unknown> | null;
};
export type Applicant = {
  applicant_id: string;
  vacancy_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  status: string; // APPLIED | SHORTLISTED | INTERVIEWED | HIRED | REJECTED | TALENT_POOL
  // 0525
  address?: string | null;
  skills?: string[] | null;
  experience_years?: number | string | null;
  expected_salary?: number | string | null;
  portfolio_url?: string | null;
  cover_note?: string | null;
  cv_vault_id?: string | null;
  source?: string | null;
  applied_at?: string | null;
  ai_score?: number | null;
  ai_breakdown?: AiBreakdown | null;
  ai_summary?: string | null;
  /**
   * TRUE = a cheap estimate from the fields the candidate typed; THE CV HAS NOT
   * BEEN READ. FALSE = a full model read of the résumé.
   *
   * Never render `ai_score` without this. The two numbers live in one column and
   * are not comparable — showing "97% match" without saying which kind it is is
   * how somebody gets rejected on a score that never opened their CV.
   */
  ai_provisional?: boolean;
  ai_scored_at?: string | null;
  ai_model?: string | null;
  /** The interviewer's average, 0–5. Derived from the per-question ratings and
   *  deliberately NEVER folded into ai_score — the point of a scorecard is that
   *  a human may disagree with the model. */
  rating?: number | string | null;
  /** Only present on talent-pool results. */
  vacancy_title?: string | null;
};
export type AiCriterionScore = {
  label: string;
  weight?: number;
  score: number | null;
  note?: string | null;
};
export type AiBreakdown = {
  skills?: number | null;
  experience?: number | null;
  salary_fit?: number | null;
  portfolio?: number | null;
  criteria?: AiCriterionScore[];
  /** False when the CV could not be opened — the score stands, with a dimension
   *  missing, and the panel must say so rather than implying a full read. */
  cv_read?: boolean;
  /** WHY it was not read, when it was not. `no_provider` is an administrator's
   *  problem and says nothing about the candidate's file; `unreadable` is the
   *  file itself. The panel says something different for each. */
  cv_unread_reason?: "no_provider" | "unreadable";
};
export type VacancyCriterion = {
  vacancy_criterion_id: string;
  vacancy_id: string;
  label: string;
  guidance?: string | null;
  weight: number | string;
  position?: number;
};
export type VacancyQuestion = {
  vacancy_question_id: string;
  vacancy_id: string;
  position: number;
  question: string;
  rationale?: string | null;
  ai_generated: boolean;
};
export type ApplicantAnswer = {
  applicant_answer_id: string;
  applicant_id: string;
  vacancy_question_id: string;
  rating?: number | string | null;
  notes?: string | null;
};
export const listVacancies = () => tenant<Vacancy[]>("/vacancies");
// `scope_id` is the department reference (0490), carried onto the employee
// record at hire; `department` is the display snapshot stored beside it.
export const createVacancy = (body: {
  title: string;
  scope_id?: string;
  department?: string;
  description?: string;
  /** Who is hiring. Optional — a single-entity tenant is resolved server-side. */
  entity_id?: string;
}) => tenant<Vacancy>("/vacancies", { method: "POST", body });
/** Edit the advert itself. The wizard drafts straight into a saved DRAFT row,
 *  so this — not `createVacancy` — is what the editor writes through. */
export const updateVacancy = (
  id: string,
  patch: {
    title?: string;
    scope_id?: string | null;
    department?: string;
    description?: string;
    employment_type?: string;
    location?: string;
    headcount?: number;
    experience_years_min?: number;
    salary_min?: number;
    salary_max?: number;
    skills_required?: string[];
    closes_on?: string;
    // 0684. Nullable, not just optional: clearing a working pattern is as real
    // an edit as setting one, and `undefined` would leave the old value.
    work_mode?: string | null;
    working_hours?: string | null;
    days_on_site?: number | null;
    days_off_site?: number | null;
    days_off?: number | null;
    probation_months?: number | null;
    location_city?: string | null;
    location_state?: string | null;
    location_country?: string | null;
    target_start_date?: string | null;
    salary_hidden?: boolean;
    apply_config?: { require_cover_letter?: boolean; require_portfolio?: boolean };
  },
) => tenant<Vacancy>(`/vacancies/${id}`, { method: "PATCH", body: patch });
export const setVacancyStatus = (id: string, status: string) =>
  tenant<Vacancy>(`/vacancies/${id}/status`, {
    method: "POST",
    body: { status },
  });
export const listApplicants = (vacancyId: string) =>
  tenant<Applicant[]>(`/vacancies/${vacancyId}/applicants`);
/**
 * Add a candidate by hand.
 *
 * The same shape the public careers form posts, minus the CV upload: somebody
 * who arrived by referral or walked in should end up as the same KIND of record
 * as somebody who applied online — the AI scorer reads `skills`,
 * `expected_salary` and `cover_note`, and a hand-entered applicant that carries
 * only a name and a phone number is one it can say almost nothing about.
 */
export const addApplicant = (
  vacancyId: string,
  body: {
    full_name: string;
    email?: string;
    phone?: string;
    address?: string;
    skills?: string[];
    experience_years?: number;
    expected_salary?: number;
    portfolio_url?: string;
    cover_note?: string;
    source?: string;
    /** A CV read into a base64 data URL — the same road the careers form uses. */
    cv_data_url?: string;
    cv_filename?: string;
  },
) =>
  tenant<Applicant>(`/vacancies/${vacancyId}/applicants`, {
    method: "POST",
    body,
  });
export const setApplicantStatus = (
  vacancyId: string,
  applicantId: string,
  status: string,
) =>
  tenant<Applicant>(`/vacancies/${vacancyId}/applicants/${applicantId}`, {
    method: "PATCH",
    body: { status },
  });

/* ── The drafting interview (0526) ───────────────────────────────────────────
 *
 * "New vacancy" is an interview, not a form: the recruiter answers questions in
 * their own words and the model writes the advert. Two calls rather than one,
 * because the later questions are generated FROM the earlier answers — that is
 * what makes them specific to the role rather than generic. */
export type IntakeQuestion = {
  key: string;
  /** text | number | textarea | salary | entity — drives which control is
   *  rendered. Unknown kinds fall back to a text box rather than to nothing. */
  type: string;
  question: string;
  hint?: string | null;
  optional?: boolean;
  min?: number;
  max?: number;
  /** `entity` questions only: who could be hiring, and in which currency. The
   *  currency rides along so picking one relabels the salary question without
   *  another round trip. */
  options?: { value: string; label: string; currency?: string | null }[];
};
/** One company a vacancy can be opened under. */
export type HiringEntity = { entity_id: string; name: string; currency?: string | null };
export type IntakeStart = {
  questions: IntakeQuestion[];
  /** Fixed + generated + the entity question when there is a choice to make, so
   *  the wizard's "Question 1 of N" is whatever the server says it is. */
  total: number;
  /** The salary label BEFORE anything is answered. On a tenant with several
   *  entities it is a fallback: the entity question's options carry the real
   *  one, and the wizard relabels once that question is answered. */
  currency: string;
  /** Already settled — a single-entity tenant, or an `entity_id` that was
   *  passed in. Null when the interview is going to ask. */
  entity: { entity_id: string; name?: string | null } | null;
};
/** Answers are open by shape: the generated questions bring their own keys. */
export type IntakeAnswers = Record<string, string | number | boolean | null>;

export const intakeQuestions = (entityId?: string) =>
  tenant<IntakeStart>("/vacancies/intake/questions" + qs({ entity_id: entityId }));
/** The choosable employers. Served by the recruitment module, not master data,
 *  so posting a role does not require the grant to browse the group structure. */
export const hiringEntities = () =>
  tenant<HiringEntity[]>("/vacancies/hiring-entities");
/** City lookup for the advert's address. Same Geoapify provider as the worksite
 *  picker, mounted on the recruitment grant — see the route's comment. Reuses
 *  `PlaceSearch` / `PLACE_SEARCH_MESSAGE` below, including the reason a search
 *  came back empty. */
export const vacancyPlaceSearch = (q: string, limit = 6) =>
  tenant<PlaceSearch>(
    "/vacancies/place-search" + qs({ q, limit: String(limit) }),
  );
export const intakeFollowUps = (body: { entity_id?: string | null; answers: IntakeAnswers }) =>
  tenant<{ questions: IntakeQuestion[] }>("/vacancies/intake/follow-ups", { method: "POST", body });
/** Drafts AND saves, as a DRAFT vacancy — four minutes of answers must survive
 *  a closed tab, and DRAFT is invisible to the careers page. */
export const draftVacancy = (body: { entity_id?: string | null; answers: IntakeAnswers }) =>
  tenant<Vacancy>("/vacancies/draft", { method: "POST", body });
export const transcribeAnswer = (audioDataUrl: string) =>
  tenant<{ text: string }>("/vacancies/intake/transcribe", { method: "POST", body: { audio_data_url: audioDataUrl } });

/* ── AI scoring, criteria, questions, scorecard, publishing (0525) ── */

/** The FULL read — opens the CV and scores it against the JD and criteria.
 *  Seconds, not milliseconds, and it spends the tenant's AI budget: this is
 *  never called on render, only when somebody presses Score. */
export const scoreApplicant = (vacancyId: string, applicantId: string) =>
  tenant<Applicant>(`/vacancies/${vacancyId}/applicants/${applicantId}/score`, {
    method: "POST",
    body: {},
  });

/** Re-score everyone on the vacancy after the criteria or the advert changed.
 *  Sequential model calls server-side, so this is slow by design and capped. */
export const scoreAllApplicants = (vacancyId: string) =>
  tenant<{ scored: number; failed: number; total: number; skipped: number }>(
    `/vacancies/${vacancyId}/score-all`,
    { method: "POST", body: {} },
  );

/**
 * Open the candidate's CV in a new tab.
 *
 * Served by the recruitment module, not the vault's own download: that one
 * demands MOD-64 plus a per-document grant, so a recruiter working a pipeline
 * would have needed rights over the whole document vault to read the file a
 * candidate sent them. A plain `<a href>` cannot carry the bearer token, so the
 * bytes are fetched and handed to the tab as a blob URL — the same shape
 * `openVaultDoc` uses.
 */
export async function openApplicantCv(
  vacancyId: string,
  applicantId: string,
): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(
    `/api/tenant/vacancies/${vacancyId}/applicants/${applicantId}/cv`,
    {
      headers: {
        "X-Praxis-Env": tokenStore.getEnv(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "There is no CV on this application."
        : res.status === 409
          ? "The file is still being stored — try again in a moment."
          : "Couldn't open the CV.",
    );
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  // Revoked late: the new tab has to finish loading from it first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const listCriteria = (vacancyId: string) =>
  tenant<VacancyCriterion[]>(`/vacancies/${vacancyId}/criteria`);
export const addCriterion = (
  vacancyId: string,
  body: { label: string; guidance?: string; weight?: number },
) =>
  tenant<VacancyCriterion>(`/vacancies/${vacancyId}/criteria`, {
    method: "POST",
    body,
  });
export const removeCriterion = (vacancyId: string, criterionId: string) =>
  tenant(`/vacancies/${vacancyId}/criteria/${criterionId}`, {
    method: "DELETE",
  });

export const listQuestions = (vacancyId: string) =>
  tenant<VacancyQuestion[]>(`/vacancies/${vacancyId}/questions`);
export const addQuestion = (
  vacancyId: string,
  body: { question: string; rationale?: string },
) =>
  tenant<VacancyQuestion>(`/vacancies/${vacancyId}/questions`, {
    method: "POST",
    body,
  });
export const removeQuestion = (vacancyId: string, questionId: string) =>
  tenant(`/vacancies/${vacancyId}/questions/${questionId}`, {
    method: "DELETE",
  });
/** Redrafts the AI-written questions. Hand-written ones survive. */
export const generateQuestions = (vacancyId: string) =>
  tenant<VacancyQuestion[]>(`/vacancies/${vacancyId}/questions/generate`, {
    method: "POST",
    body: {},
  });

export const listAnswers = (vacancyId: string, applicantId: string) =>
  tenant<ApplicantAnswer[]>(
    `/vacancies/${vacancyId}/applicants/${applicantId}/answers`,
  );
export const rateAnswer = (
  vacancyId: string,
  applicantId: string,
  body: { vacancy_question_id: string; rating: number | null; notes?: string },
) =>
  tenant<ApplicantAnswer & { overall_rating?: number | null }>(
    `/vacancies/${vacancyId}/applicants/${applicantId}/answers`,
    { method: "POST", body },
  );

/** Everyone previously seen who wasn't hired — across every vacancy, which is
 *  the whole point: the right person for this role applied for another one. */
export const searchTalentPool = (params?: { q?: string; limit?: number }) =>
  tenant<Applicant[]>(
    "/vacancies/talent-pool" +
      qs({
        q: params?.q,
        limit: params?.limit ? String(params.limit) : undefined,
      }),
  );

/** Publishing MINTS a token; unpublishing DISCARDS it. Re-publishing produces a
 *  DIFFERENT link — every URL handed out under the old one stops working. */
export const setVacancyPublished = (id: string, published: boolean) =>
  tenant<Vacancy>(`/vacancies/${id}/publish`, {
    method: "POST",
    body: { published },
  });

/* ── Trainings: sessions, live capture, requirements (0702) ──────────────────
 * `scheduled_on` is the legacy date column and is still sent by the API. Read
 * `starts_at`; the server derives the other from it. */
export type Training = {
  training_id: string;
  title?: string | null;
  description?: string | null;
  /** LEGACY (0360) — the date half of starts_at. Kept for older readers. */
  scheduled_on?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  /** When the session actually opened/closed, as opposed to when it was booked. */
  opened_at?: string | null;
  closed_at?: string | null;
  mode?: "IN_PERSON" | "ONLINE" | "HYBRID" | null;
  location?: string | null;
  join_url?: string | null;
  capacity?: number | null;
  facilitator?: string | null;
  facilitator_employee_id?: string | null;
  facilitator_name?: string | null;
  training_requirement_id?: string | null;
  requirement_title?: string | null;
  requirement_valid_months?: number | null;
  ai_summary?: string | null;
  ai_model?: string | null;
  minutes_vault_id?: string | null;
  booked_count?: number | string | null;
  attended_count?: number | string | null;
  status: string; // SCHEDULED | LIVE | DONE | CANCELLED
};

/** What `GET /trainings/:id` adds on top of a list row — state the server
 *  derives so the screen and the scheduler cannot compute it differently. */
export type TrainingDetail = Training & {
  attendees: TrainingAttendee[];
  notes: TrainingNote[];
  planned_minutes?: number | null;
  actual_minutes?: number | null;
  join_state?: {
    can_join: boolean;
    reason: string;
    message: string;
    minutes_until?: number;
  };
  capacity_state?: {
    capacity: number | null;
    booked: number;
    remaining: number | null;
    is_full: boolean;
    is_over: boolean;
  };
};

export type TrainingAttendee = {
  training_attendance_id: string;
  training_id: string;
  employee_id?: string | null;
  /** Joined server-side (0702). The screen no longer holds a roster of the
   *  whole company to render five rows — see listTrainingAttendees. */
  employee_name?: string | null;
  department?: string | null;
  job_title?: string | null;
  attended?: boolean | null;
  /** True when `attended` came from an actual join rather than a tick. */
  attendance_observed?: boolean | null;
  joined_at?: string | null;
  left_at?: string | null;
  certificate_vault_id?: string | null;
  certificate_issued_on?: string | null;
  certificate_expires_on?: string | null;
  notes?: string | null;
};

export type TrainingNote = {
  training_note_id: string;
  training_id: string;
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  is_minutes?: boolean | null;
  created_at?: string | null;
};

export type TrainingRequirement = {
  training_requirement_id: string;
  title: string;
  description?: string | null;
  department?: string | null;
  job_title?: string | null;
  valid_months?: number | null;
  warn_days?: number | null;
  is_mandatory?: boolean | null;
  is_active?: boolean | null;
};

export type ComplianceStatus = "CURRENT" | "EXPIRING" | "EXPIRED" | "NEVER";

export type TrainingCompliance = {
  requirement: TrainingRequirement;
  covered: number;
  counts: Record<ComplianceStatus, number>;
  people: {
    employee_id: string;
    full_name?: string | null;
    department?: string | null;
    job_title?: string | null;
    attended_on?: string | null;
    training_id?: string | null;
    training_title?: string | null;
    certificate_vault_id?: string | null;
    status: ComplianceStatus;
    days_remaining: number | null;
    expires_on: string | null;
    is_compliant: boolean;
  }[];
};

export type TrainingInput = {
  title: string;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  mode?: "IN_PERSON" | "ONLINE" | "HYBRID";
  location?: string | null;
  join_url?: string | null;
  capacity?: number | null;
  facilitator?: string | null;
  training_requirement_id?: string | null;
};

export const listTrainings = (params?: { status?: string }) =>
  tenant<Training[]>(
    `/trainings${params?.status ? `?status=${encodeURIComponent(params.status)}` : ""}`,
  );
export const getTraining = (id: string) =>
  tenant<TrainingDetail>(`/trainings/${id}`);
export const createTraining = (body: TrainingInput) =>
  tenant<Training>("/trainings", { method: "POST", body });
export const updateTraining = (id: string, body: Partial<TrainingInput>) =>
  tenant<Training>(`/trainings/${id}`, { method: "PATCH", body });
export const setTrainingStatus = (id: string, status: string) =>
  tenant<Training>(`/trainings/${id}/status`, {
    method: "POST",
    body: { status },
  });

export const listTrainingAttendees = (trainingId: string) =>
  tenant<TrainingAttendee[]>(`/trainings/${trainingId}/attendees`);
export const addTrainingAttendee = (trainingId: string, employee_id: string) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/attendees`, {
    method: "POST",
    body: { employee_id },
  });
export const setTrainingAttendee = (
  trainingId: string,
  attendeeId: string,
  patch: Partial<
    Pick<
      TrainingAttendee,
      | "attended"
      | "certificate_vault_id"
      | "certificate_issued_on"
      | "certificate_expires_on"
      | "notes"
    >
  >,
) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/attendees/${attendeeId}`, {
    method: "PATCH",
    body: patch,
  });

/* Live session. Join is idempotent server-side — the FIRST join is the one
 * that counts, so a flaky connection does not shorten somebody's presence. */
export const joinTraining = (trainingId: string, employee_id: string) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/join`, {
    method: "POST",
    body: { employee_id },
  });
export const leaveTraining = (trainingId: string, employee_id: string) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/leave`, {
    method: "POST",
    body: { employee_id },
  });
export const addTrainingNote = (
  trainingId: string,
  body: string,
  is_minutes = false,
) =>
  tenant<TrainingNote>(`/trainings/${trainingId}/notes`, {
    method: "POST",
    body: { body, is_minutes },
  });
/** Draft and file the minutes. Files the raw notes when no model answered —
 *  `ai_model` says which, so nobody reads notes as a reviewed summary. */
export const summariseTraining = (trainingId: string) =>
  tenant<TrainingDetail>(`/trainings/${trainingId}/summarise`, {
    method: "POST",
  });

/* Requirements — the rule about a ROLE, as opposed to a session. */
export const listTrainingRequirements = () =>
  tenant<TrainingRequirement[]>("/trainings/requirements");
export const createTrainingRequirement = (
  body: Omit<TrainingRequirement, "training_requirement_id">,
) =>
  tenant<TrainingRequirement>("/trainings/requirements", {
    method: "POST",
    body,
  });
export const updateTrainingRequirement = (
  id: string,
  body: Partial<TrainingRequirement>,
) =>
  tenant<TrainingRequirement>(`/trainings/requirements/${id}`, {
    method: "PATCH",
    body,
  });
export const getTrainingCompliance = (requirementId: string) =>
  tenant<TrainingCompliance>(
    `/trainings/requirements/${requirementId}/compliance`,
  );

/* ── Onboarding: templates, dated items, and the checklist a hire raises (0703) ──
 *
 * A checklist used to be a list of strings and a tick. Nothing could be late,
 * nothing had an owner, and nothing raised one — hiring provisioned an employee
 * row and stopped. */
export type OnboardingItemState = "DONE" | "OVERDUE" | "DUE_SOON" | "PENDING" | "UNDATED";

export type OnboardingItem = {
  onboarding_item_id: string;
  onboarding_checklist_id: string;
  label: string;
  description?: string | null;
  is_done: boolean;
  done_at?: string | null;
  done_by?: string | null;
  done_by_name?: string | null;
  due_on?: string | null;
  owner_role?: string | null;
  assigned_to?: string | null;
  assignee_name?: string | null;
  sop_document_id?: string | null;
  sop_title?: string | null;
  /** Blocks completion of the whole checklist while outstanding. */
  is_mandatory?: boolean | null;
  sort_order?: number | null;
  notes?: string | null;
  /** Derived server-side so the screen and the completion guard agree. */
  state?: OnboardingItemState;
  days_remaining?: number | null;
};

export type OnboardingChecklist = {
  onboarding_checklist_id: string;
  employee_id?: string | null;
  employee_name?: string | null;
  department?: string | null;
  job_title?: string | null;
  status: string;
  starts_on?: string | null;
  completed_at?: string | null;
  onboarding_template_id?: string | null;
  template_name?: string | null;
  applicant_id?: string | null;
  created_at?: string | null;
  total_items: number;
  done_items: number;
  overdue_items?: number;
  mandatory_outstanding?: number;
};

export type OnboardingChecklistDetail = OnboardingChecklist & {
  items: OnboardingItem[];
  progress: {
    total: number; done: number; outstanding: number;
    overdue: number; due_soon: number; undated: number; percent: number;
  };
  /** What Complete will refuse on — shown BEFORE it is pressed, because a gate
   *  you discover by being rejected is a gate you work around. */
  blockers: { onboarding_item_id: string; label: string; due_on?: string | null }[];
};

export type OnboardingTemplateItem = {
  onboarding_template_item_id: string;
  onboarding_template_id: string;
  label: string;
  description?: string | null;
  /** Offset in DAYS from the hire's start date. Negative = before they start. */
  due_days: number;
  owner_role?: string | null;
  sop_document_id?: string | null;
  sop_title?: string | null;
  is_mandatory?: boolean | null;
  sort_order?: number | null;
};

export type OnboardingTemplate = {
  onboarding_template_id: string;
  name: string;
  description?: string | null;
  department?: string | null;
  job_title?: string | null;
  priority?: number | null;
  is_active?: boolean | null;
  item_count?: number;
};

export type OnboardingTemplateDetail = OnboardingTemplate & {
  items: OnboardingTemplateItem[];
};

export const listChecklists = (status?: string) =>
  tenant<OnboardingChecklist[]>(
    `/onboarding${status ? `?status=${encodeURIComponent(status)}` : ""}`,
  );
export const getChecklist = (id: string) =>
  tenant<OnboardingChecklistDetail>(`/onboarding/${id}`);
export const createChecklist = (body: {
  employee_id?: string;
  template_id?: string;
  starts_on?: string | null;
  items?: string[];
}) => tenant<OnboardingChecklistDetail>("/onboarding", { method: "POST", body });
export const addChecklistItem = (
  id: string,
  body: Partial<Omit<OnboardingItem, "onboarding_item_id" | "onboarding_checklist_id">> & {
    label: string;
    due_days?: number;
  },
) => tenant<OnboardingItem>(`/onboarding/${id}/items`, { method: "POST", body });
/** Tick, untick, reassign or re-date. Supersedes the old `{ is_done }`-only
 *  call on the same route, which still works. */
export const updateChecklistItem = (
  itemId: string,
  body: Partial<Pick<OnboardingItem,
    "label" | "due_on" | "owner_role" | "assigned_to" | "sop_document_id" |
    "is_mandatory" | "sort_order" | "notes">> & { is_done?: boolean },
) => tenant<OnboardingItem>(`/onboarding/items/${itemId}`, { method: "PATCH", body });
/** Moves every dated item that is still open. A deliberate act, never a side
 *  effect of editing a start date elsewhere. */
export const rescheduleChecklist = (id: string, starts_on: string) =>
  tenant<OnboardingChecklistDetail>(`/onboarding/${id}/reschedule`, {
    method: "POST",
    body: { starts_on },
  });
/** Refuses with MANDATORY_ITEMS_OUTSTANDING, naming the items. */
export const completeChecklist = (id: string) =>
  tenant<OnboardingChecklistDetail>(`/onboarding/${id}/complete`, { method: "POST" });
export const listOutstandingOnboarding = (days = 14) =>
  tenant<{
    onboarding_item_id: string;
    onboarding_checklist_id: string;
    label: string;
    due_on: string;
    owner_role?: string | null;
    is_mandatory?: boolean | null;
    employee_name?: string | null;
  }[]>(`/onboarding/outstanding?days=${days}`);

export const listOnboardingTemplates = (includeInactive = false) =>
  tenant<OnboardingTemplate[]>(
    `/onboarding/templates${includeInactive ? "?include_inactive=true" : ""}`,
  );
export const getOnboardingTemplate = (id: string) =>
  tenant<OnboardingTemplateDetail>(`/onboarding/templates/${id}`);
export const createOnboardingTemplate = (
  body: Omit<OnboardingTemplate, "onboarding_template_id" | "item_count">,
) => tenant<OnboardingTemplateDetail>("/onboarding/templates", { method: "POST", body });
export const updateOnboardingTemplate = (
  id: string,
  body: Partial<OnboardingTemplate>,
) => tenant<OnboardingTemplateDetail>(`/onboarding/templates/${id}`, { method: "PATCH", body });
export const addOnboardingTemplateItem = (
  templateId: string,
  body: Omit<OnboardingTemplateItem, "onboarding_template_item_id" | "onboarding_template_id" | "due_days"> & {
    due_days?: number;
  },
) => tenant<OnboardingTemplateItem>(`/onboarding/templates/${templateId}/items`, {
  method: "POST",
  body,
});
export const updateOnboardingTemplateItem = (
  itemId: string,
  body: Partial<OnboardingTemplateItem>,
) => tenant<OnboardingTemplateItem>(`/onboarding/templates/items/${itemId}`, {
  method: "PATCH",
  body,
});
export const removeOnboardingTemplateItem = (itemId: string) =>
  tenant<OnboardingTemplateItem>(`/onboarding/templates/items/${itemId}`, {
    method: "DELETE",
  });

/* ── Putting a bench candidate in front of a vacancy (0703) ──────────────────
 *
 * The action 0525's searchable pool was missing. The previous SCORE is
 * deliberately not carried across: a score is against a job description, so
 * last year's number on a different role means nothing — and it would sort. */
export const considerForVacancy = (
  vacancyId: string,
  source: { applicant_id?: string; talent_pool_id?: string },
) =>
  tenant<Applicant & { already_on_vacancy?: boolean }>(
    `/vacancies/${vacancyId}/consider`,
    { method: "POST", body: source },
  );

/* ── Worksite place search (Geoapify, via the HR endpoint) ──────────────────
 * Not /geo-places/search: that one is gated on MOD-29 + the `operations`
 * feature because it WRITES the ports catalogue. Placing a geofence pin is a
 * read, and HR admins have neither grant. */
export type PlaceHit = {
  provider_place_id?: string | null;
  name?: string | null;
  formatted?: string | null;
  country?: string | null;
  region?: string | null;
  latitude: number;
  longitude: number;
  confidence?: number | null;
};
export type PlaceSearch = {
  /** OK | QUERY_TOO_SHORT | NO_KEY | TIMEOUT | UNAUTHORISED | RATE_LIMITED | PROVIDER_ERROR */
  status: string;
  results: PlaceHit[];
  query: string;
};
/** Why the search came back empty, in words the person reading it can act on.
 *  A bare "no results" turns a missing provider key into a user who believes
 *  their own yard does not exist. */
export const PLACE_SEARCH_MESSAGE: Record<string, string> = {
  QUERY_TOO_SHORT: "Type at least 3 characters.",
  NO_KEY:
    "Location search isn't configured — ask your administrator to set the Geoapify key.",
  TIMEOUT:
    "The location provider didn't answer in time. Try again, or enter coordinates by hand.",
  UNAUTHORISED:
    "The location provider rejected our key — ask your administrator to check it.",
  RATE_LIMITED:
    "Today's location-search quota is used up. Enter coordinates by hand for now.",
  PROVIDER_ERROR:
    "The location provider failed. Enter coordinates by hand, or try again shortly.",
};
export const searchPlaces = (
  q: string,
  opts: { country?: string; limit?: number } = {},
) =>
  tenant<PlaceSearch>(
    "/attendance/place-search" +
      qs({
        q,
        country: opts.country,
        limit: opts.limit ? String(opts.limit) : undefined,
      }),
  );

export const listSites = () => tenant<WorkSite[]>("/attendance/work-sites");
export const createSite = (body: {
  name: string;
  latitude: number;
  longitude: number;
  radius_m?: number;
}) => tenant<WorkSite>("/attendance/work-sites", { method: "POST", body });
export const updateSite = (
  id: string,
  body: Partial<
    Pick<WorkSite, "name" | "latitude" | "longitude" | "radius_m" | "is_active">
  >,
) =>
  tenant<WorkSite>(`/attendance/work-sites/${id}`, { method: "PATCH", body });

/** Best-effort device GPS fix (browser Geolocation). Rejects on denial/timeout. */
export function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator))
      return reject(new Error("Location isn't available on this device"));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) => reject(new Error(e.message || "Location permission denied")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/* ── Reporting line (0493) ─────────────────────────────────────────────────
 * `role.is_line_manager` is seeded as "approves for own team"; until 0493 there
 * was no team to resolve. `managers` is nearest-first — escalation reads [0].
 */
export const employeeReports = (id: string) =>
  tenant<Employee[]>(`/employees/${id}/reports`);
export const employeeTeam = (id: string) =>
  tenant<Employee[]>(`/employees/${id}/team`);
export const employeeManagers = (id: string) =>
  tenant<Employee[]>(`/employees/${id}/managers`);
