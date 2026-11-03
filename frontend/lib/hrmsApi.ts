import { ApiError, resolveApiUrl } from "./api";

export interface SalaryBreakdown {
  monthly_gross: number;
  basic: number;
  hra: number;
  special_allowance: number;
  pf_deduction: number;
  pt_deduction: number;
  tds_deduction: number;
  total_deductions: number;
  net_pay: number;
}

export interface Employee {
  id: string;
  emp_code: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  joining_date: string;
  status: "active" | "probation" | "notice_period" | "resigned" | "terminated";
  manager_name: string;
  pan: string;
  uan: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  ctc: number;
  basic: number;
  hra: number;
  special_allowance: number;
  blood_group?: string;
  emergency_contact?: string;
  photo_url?: string;
  created_at: string;
  updated_at: string;
  salary_breakdown?: SalaryBreakdown;
}

export interface LetterTemplate {
  title: string;
  description: string;
  default_placeholders: Record<string, string>;
  content: string;
}

export interface LetterRecord {
  id: string;
  employee_id: string | null;
  letter_type: "offer" | "promotion" | "termination" | "relieving" | string;
  title: string;
  placeholders_json: string;
  placeholders: Record<string, string | number>;
  content: string;
  created_at: string;
  generated_by: string;
  emp_name?: string;
  emp_code?: string;
}

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
  status: "draft" | "generated" | "completed";
  created_at: string;
}

export interface Payslip {
  id: string;
  run_id: string;
  employee_id: string;
  month: number;
  year: number;
  days_in_month: number;
  days_worked: number;
  gross_pay: number;
  basic: number;
  hra: number;
  special_allowance: number;
  pf_deduction: number;
  pt_deduction: number;
  tds_deduction: number;
  total_deductions: number;
  net_pay: number;
  status: "draft" | "generated" | "dispatched";
  dispatched_at: string | null;
  created_at: string;
  emp_name: string;
  emp_code: string;
  designation: string;
  department: string;
  pan: string;
  uan: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  status: "present" | "absent" | "half_day" | "wfh" | "on_leave";
  punch_in: string | null;
  punch_out: string | null;
  notes: string | null;
  emp_name?: string;
  emp_code?: string;
  designation?: string;
  department?: string;
}

export interface LeaveRecord {
  id: string;
  employee_id: string;
  leave_type: "casual" | "sick" | "earned" | "unpaid";
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  created_at: string;
  emp_name?: string;
  emp_code?: string;
  department?: string;
  designation?: string;
}

export interface HrmsStats {
  total_employees: number;
  active_count: number;
  probation_count: number;
  notice_count: number;
  total_monthly_payroll: number;
  departments: Record<string, number>;
  today_attendance: {
    date: string;
    present: number;
    absent: number;
    half_day: number;
    wfh: number;
    on_leave: number;
  };
  pending_leaves: number;
  letters_count: number;
  id_cards_total?: number;
  id_cards_dispatched?: number;
  last_payroll_run: PayrollRun | null;
}

export interface IdCardRecord {
  id: string;
  employee_id: string;
  card_number: string;
  issue_date: string;
  valid_until: string;
  blood_group: string;
  emergency_contact: string;
  status: "issued" | "dispatched" | "revoked";
  dispatched_at: string | null;
  dispatch_tracking_number: string | null;
  dispatch_notes: string | null;
  qr_verification_code: string;
  created_at: string;
  updated_at: string;
  emp_name: string;
  emp_code: string;
  designation: string;
  department: string;
  emp_status: string;
  emp_phone?: string;
  joining_date?: string;
}

export interface PublicCredentialVerification {
  verified: boolean;
  status: "valid" | "inactive" | "not_found";
  employee_name?: string;
  emp_code?: string;
  designation?: string;
  department?: string;
  joining_date?: string;
  card_number?: string;
  issue_date?: string;
  valid_until?: string;
  blood_group?: string;
  card_status?: string;
  dispatched_at?: string;
  dispatch_tracking_number?: string;
  issuing_organization?: string;
  registration?: string;
  signatory?: string;
  office_address?: string;
  contact?: string;
  verified_at?: string;
  detail?: string;
}

async function hrmsRequest<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const targetUrl = resolveApiUrl(`/api/hrms${endpoint}`);
  const res = await fetch(targetUrl, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HRMS request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      // keep fallback
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export async function fetchHrmsStats(): Promise<HrmsStats> {
  return hrmsRequest<HrmsStats>("/stats");
}

export async function fetchEmployees(params?: {
  department?: string;
  status?: string;
  q?: string;
}): Promise<Employee[]> {
  const query = new URLSearchParams();
  if (params?.department) query.set("department", params.department);
  if (params?.status) query.set("status", params.status);
  if (params?.q) query.set("q", params.q);
  const qs = query.toString();
  return hrmsRequest<Employee[]>(`/employees${qs ? `?${qs}` : ""}`);
}

export async function createEmployee(data: Partial<Employee>): Promise<Employee> {
  return hrmsRequest<Employee>("/employees", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateEmployee(id: string, data: Partial<Employee>): Promise<Employee> {
  return hrmsRequest<Employee>(`/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteEmployee(id: string): Promise<{ status: string }> {
  return hrmsRequest<{ status: string }>(`/employees/${id}`, {
    method: "DELETE",
  });
}

export async function fetchLetterTemplates(): Promise<Record<string, LetterTemplate>> {
  return hrmsRequest<Record<string, LetterTemplate>>("/letters/templates");
}

export async function fetchLetters(params?: {
  letter_type?: string;
  employee_id?: string;
}): Promise<LetterRecord[]> {
  const query = new URLSearchParams();
  if (params?.letter_type) query.set("letter_type", params.letter_type);
  if (params?.employee_id) query.set("employee_id", params.employee_id);
  const qs = query.toString();
  return hrmsRequest<LetterRecord[]>(`/letters${qs ? `?${qs}` : ""}`);
}

export async function generateLetter(payload: {
  employee_id?: string;
  letter_type: string;
  title: string;
  placeholders: Record<string, string | number>;
  content: string;
}): Promise<LetterRecord> {
  return hrmsRequest<LetterRecord>("/letters/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getLetterPdfUrl(letterId: string): string {
  return resolveApiUrl(`/api/hrms/letters/${letterId}/pdf`);
}

export async function fetchPayrollRuns(): Promise<PayrollRun[]> {
  return hrmsRequest<PayrollRun[]>("/payroll/runs");
}

export async function createPayrollRun(month: number, year: number): Promise<PayrollRun> {
  return hrmsRequest<PayrollRun>("/payroll/run", {
    method: "POST",
    body: JSON.stringify({ month, year }),
  });
}

export async function fetchPayslips(params?: {
  run_id?: string;
  month?: number;
  year?: number;
  employee_id?: string;
}): Promise<Payslip[]> {
  const query = new URLSearchParams();
  if (params?.run_id) query.set("run_id", params.run_id);
  if (params?.month) query.set("month", String(params.month));
  if (params?.year) query.set("year", String(params.year));
  if (params?.employee_id) query.set("employee_id", params.employee_id);
  const qs = query.toString();
  return hrmsRequest<Payslip[]>(`/payslips${qs ? `?${qs}` : ""}`);
}

export function getPayslipPdfUrl(slipId: string): string {
  return resolveApiUrl(`/api/hrms/payslips/${slipId}/pdf`);
}

export async function dispatchPayslip(slipId: string): Promise<{ status: string; slip_id: string; dispatched_at: string }> {
  return hrmsRequest(`/payslips/${slipId}/dispatch`, { method: "POST" });
}

export async function dispatchAllPayslips(runId: string): Promise<{ status: string; run_id: string; dispatched_at: string }> {
  return hrmsRequest(`/payroll/runs/${runId}/dispatch-all`, { method: "POST" });
}

export async function fetchAttendance(params?: {
  date?: string;
  month?: string;
  employee_id?: string;
}): Promise<AttendanceRecord[]> {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  if (params?.month) query.set("month", params.month);
  if (params?.employee_id) query.set("employee_id", params.employee_id);
  const qs = query.toString();
  return hrmsRequest<AttendanceRecord[]>(`/attendance${qs ? `?${qs}` : ""}`);
}

export async function punchAttendance(payload: {
  employee_id: string;
  date: string;
  status: string;
  punch_in?: string;
  punch_out?: string;
  notes?: string;
}): Promise<AttendanceRecord> {
  return hrmsRequest<AttendanceRecord>("/attendance/punch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function markBulkAttendance(dateStr: string, status = "present"): Promise<{ status: string; marked_count: number; date: string }> {
  return hrmsRequest("/attendance/bulk", {
    method: "POST",
    body: JSON.stringify({ date: dateStr, status }),
  });
}

export async function fetchLeaves(params?: {
  status?: string;
  employee_id?: string;
}): Promise<LeaveRecord[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.employee_id) query.set("employee_id", params.employee_id);
  const qs = query.toString();
  return hrmsRequest<LeaveRecord[]>(`/leaves${qs ? `?${qs}` : ""}`);
}

export async function submitLeave(payload: {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
}): Promise<LeaveRecord> {
  return hrmsRequest<LeaveRecord>("/leaves", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLeaveStatus(
  leaveId: string,
  status: "approved" | "rejected"
): Promise<LeaveRecord> {
  return hrmsRequest<LeaveRecord>(`/leaves/${leaveId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function formatInr(val: number | null | undefined): string {
  if (val === null || val === undefined) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

// -------------------------------------------------------------------------
// ID Cards & Verification API
// -------------------------------------------------------------------------

export async function fetchIdCards(params?: {
  status?: string;
  employee_id?: string;
}): Promise<IdCardRecord[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.employee_id) query.set("employee_id", params.employee_id);
  const qs = query.toString();
  return hrmsRequest<IdCardRecord[]>(`/id-cards${qs ? `?${qs}` : ""}`);
}

export async function issueIdCard(payload: {
  employee_id: string;
  blood_group?: string;
  emergency_contact?: string;
  validity_years?: number;
}): Promise<IdCardRecord> {
  return hrmsRequest<IdCardRecord>("/id-cards/issue", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bulkIssueIdCards(): Promise<{ status: string; issued_count: number }> {
  return hrmsRequest("/id-cards/bulk-issue", {
    method: "POST",
  });
}

export async function dispatchIdCard(
  cardId: string,
  payload: { tracking_number?: string; notes?: string }
): Promise<IdCardRecord> {
  return hrmsRequest<IdCardRecord>(`/id-cards/${cardId}/dispatch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bulkDispatchIdCards(
  cardIds: string[],
  notes?: string
): Promise<{ status: string; dispatched_count: number }> {
  return hrmsRequest("/id-cards/bulk-dispatch", {
    method: "POST",
    body: JSON.stringify({ card_ids: cardIds, notes: notes || "" }),
  });
}

export function getIdCardPdfUrl(cardId: string, layout: "cr80" | "a4_sheet" = "cr80"): string {
  return resolveApiUrl(`/api/hrms/id-cards/${cardId}/pdf?layout=${layout}`);
}

export async function fetchPublicVerification(code: string): Promise<PublicCredentialVerification> {
  const targetUrl = resolveApiUrl(`/api/hrms/public/verify/${encodeURIComponent(code)}`);
  const res = await fetch(targetUrl);
  if (!res.ok) {
    throw new ApiError(`Verification lookup failed (${res.status})`, res.status);
  }
  return res.json() as Promise<PublicCredentialVerification>;
}
