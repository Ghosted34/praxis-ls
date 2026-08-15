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
  hr_device_id?: string | null;
  /** Was the punching device trusted AT PUNCH TIME. null = none presented. */
  device_trusted?: boolean | null;
  is_late?: boolean;
  minutes_late?: number;
  department?: string | null;
};

export type AbsenceResult = {
  date: string;
  count: number;
  absent: {
    employee_id: string;
    full_name: string;
    department?: string | null;
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
    totals: { gross: number; net: number; employer_charges: number };
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
  starts_on?: string | null;
  ends_on?: string | null;
  amount?: number | string | null;
  status: string; // REQUESTED | APPROVED | REJECTED
  created_at?: string | null;
};
export const listLeave = (params?: { status?: string; employee_id?: string }) =>
  tenant<LeaveRequest[]>("/leave" + qs(params));
export const createLeave = (body: {
  employee_id: string;
  kind: string;
  starts_on?: string;
  ends_on?: string;
  amount?: number;
}) => tenant<LeaveRequest>("/leave", { method: "POST", body });
export const decideLeave = (id: string, status: "APPROVED" | "REJECTED") =>
  tenant<LeaveRequest>(`/leave/${id}/decision`, {
    method: "POST",
    body: { status },
  });

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
export const createTraining = (body: {
  title: string;
  scheduled_on?: string;
  facilitator?: string;
}) => tenant<Training>("/trainings", { method: "POST", body });
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
  attended: boolean,
) =>
  tenant<TrainingAttendee>(`/trainings/${trainingId}/attendees/${attendeeId}`, {
    method: "PATCH",
    body: { attended },
  });

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
