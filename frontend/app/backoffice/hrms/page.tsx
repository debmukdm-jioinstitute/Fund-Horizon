"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Employee,
  type HrmsStats,
  type LetterRecord,
  type LetterTemplate,
  type PayrollRun,
  type Payslip,
  type AttendanceRecord,
  type LeaveRecord,
  type IdCardRecord,
  fetchHrmsStats,
  fetchEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  fetchLetterTemplates,
  fetchLetters,
  generateLetter,
  getLetterPdfUrl,
  fetchPayrollRuns,
  createPayrollRun,
  fetchPayslips,
  getPayslipPdfUrl,
  dispatchPayslip,
  dispatchAllPayslips,
  fetchAttendance,
  punchAttendance,
  markBulkAttendance,
  fetchLeaves,
  submitLeave,
  updateLeaveStatus,
  formatInr,
  fetchIdCards,
  issueIdCard,
  bulkIssueIdCards,
  dispatchIdCard,
  getIdCardPdfUrl,
} from "@/lib/hrmsApi";

type HrmsTab = "overview" | "employees" | "letters" | "payroll" | "attendance" | "id_cards";

const CARD_CLS = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const SOFT_CLS = "bg-[#F8FAFB] dark:bg-[#1B2432]";
const MUTED_CLS = "text-[#667085] dark:text-[#9AA6B8]";
const INK_CLS = "text-[#172033] dark:text-[#EDF1F6]";
const TEAL_BTN = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40 transition-colors";
const SEC_BTN = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3.5 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64] hover:text-[#006F64] disabled:opacity-40 transition-colors";

const getErrMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export default function HrmsPage() {
  const [tab, setTab] = useState<HrmsTab>("overview");
  const [stats, setStats] = useState<HrmsStats | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [letters, setLetters] = useState<LetterRecord[]>([]);
  const [templates, setTemplates] = useState<Record<string, LetterTemplate>>({});
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [idCards, setIdCards] = useState<IdCardRecord[]>([]);
  const [actionMsg, setActionMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Filter & modal states
  const [empSearch, setEmpSearch] = useState("");
  const [empDeptFilter, setEmpDeptFilter] = useState("all");
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Partial<Employee> | null>(null);

  // ID Cards state
  const [idCardFilter, setIdCardFilter] = useState<string>("all");
  const [idCardSearch, setIdCardSearch] = useState<string>("");
  const [issueCardModalOpen, setIssueCardModalOpen] = useState(false);
  const [issuingEmpId, setIssuingEmpId] = useState<string>("");
  const [cardBloodGroup, setCardBloodGroup] = useState<string>("O+");
  const [cardEmergencyContact, setCardEmergencyContact] = useState<string>("");
  const [cardValidityYears, setCardValidityYears] = useState<number>(3);
  const [issuingCard, setIssuingCard] = useState(false);

  // Dispatch modal
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [dispatchingCard, setDispatchingCard] = useState<IdCardRecord | null>(null);
  const [dispatchTrackingNo, setDispatchTrackingNo] = useState<string>("");
  const [dispatchNotes, setDispatchNotes] = useState<string>("");
  const [submittingDispatch, setSubmittingDispatch] = useState(false);

  // Preview modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewCard, setPreviewCard] = useState<IdCardRecord | null>(null);
  const [previewSide, setPreviewSide] = useState<"front" | "back">("front");

  // Letter generator states
  const [selectedLetterType, setSelectedLetterType] = useState<string>("internship_offer");
  const [selectedEmpIdForLetter, setSelectedEmpIdForLetter] = useState<string>("");
  const [letterPlaceholders, setLetterPlaceholders] = useState<Record<string, string>>({});
  const [letterContent, setLetterContent] = useState<string>("");
  const [generatingLetter, setGeneratingLetter] = useState(false);

  // Payroll run states
  const now = new Date();
  const [payMonth, setPayMonth] = useState<number>(now.getMonth() + 1);
  const [payYear, setPayYear] = useState<number>(now.getFullYear());
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runningPayroll, setRunningPayroll] = useState(false);

  // Attendance states
  const [attDate, setAttDate] = useState<string>(now.toISOString().split("T")[0]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [newLeave, setNewLeave] = useState({
    employee_id: "",
    leave_type: "casual",
    start_date: now.toISOString().split("T")[0],
    end_date: now.toISOString().split("T")[0],
    days: 1,
    reason: "",
  });

  const showToast = (text: string, isError = false) => {
    setActionMsg({ text, isError });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      const [s, emps, tmpls, lets, runs, atts, lvs, cards] = await Promise.all([
        fetchHrmsStats().catch(() => null),
        fetchEmployees(),
        fetchLetterTemplates(),
        fetchLetters(),
        fetchPayrollRuns(),
        fetchAttendance({ date: attDate }),
        fetchLeaves(),
        fetchIdCards(),
      ]);
      if (s) setStats(s);
      setEmployees(emps);
      setTemplates(tmpls);
      setLetters(lets);
      setPayrollRuns(runs);
      setAttendance(atts);
      setLeaves(lvs);
      setIdCards(cards);

      if (runs.length > 0) {
        const targetRun = selectedRunId || runs[0].id;
        if (!selectedRunId) setSelectedRunId(targetRun);
        const sls = await fetchPayslips({ run_id: targetRun });
        setPayslips(sls);
      }
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  }, [attDate, selectedRunId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When templates load or type changes, update letter defaults
  useEffect(() => {
    if (templates[selectedLetterType]) {
      const t = templates[selectedLetterType];
      setLetterPlaceholders({ ...t.default_placeholders });
      setLetterContent(t.content);
    }
  }, [selectedLetterType, templates]);

  // When selected employee for letter changes, populate placeholders
  useEffect(() => {
    if (selectedEmpIdForLetter) {
      const emp = employees.find((e) => e.id === selectedEmpIdForLetter);
      if (emp) {
        setLetterPlaceholders((prev) => ({
          ...prev,
          employee_name: emp.name,
          designation: emp.designation,
          department: emp.department,
          ctc: new Intl.NumberFormat("en-IN").format(emp.ctc),
          joining_date: emp.joining_date,
          manager: emp.manager_name || "Executive Leadership",
        }));
      }
    }
  }, [selectedEmpIdForLetter, employees]);

  // When selected payroll run changes
  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    try {
      const sls = await fetchPayslips({ run_id: runId });
      setPayslips(sls);
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Salary real-time preview in Employee modal
  const computedSalary = useMemo(() => {
    const ctc = editingEmp?.ctc || 0;
    const monthly_gross = Math.floor(ctc / 12);
    const basic = Math.floor(monthly_gross * 0.5);
    const hra = Math.floor(basic * 0.5);
    const sa = Math.max(0, monthly_gross - basic - hra);
    const pf = Math.floor(basic * 0.12);
    const pt = monthly_gross > 15000 ? 200 : 0;
    let tds = 0;
    if (ctc > 1200000) tds = Math.floor(monthly_gross * 0.1);
    else if (ctc > 700000) tds = Math.floor(monthly_gross * 0.05);
    const deductions = pf + pt + tds;
    const net = Math.max(0, monthly_gross - deductions);
    return { monthly_gross, basic, hra, sa, pf, pt, tds, deductions, net };
  }, [editingEmp?.ctc]);

  const getNextEmpCode = () => {
    const nums = employees
      .map((e) => {
        const m = (e.emp_code || "").match(/FH-(\d+)/i);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !isNaN(n) && n > 0);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `FH-${String(max + 1).padStart(3, "0")}`;
  };

  // Save employee
  const handleSaveEmployee = async () => {
    if (!editingEmp) return;
    if (!editingEmp.name || !editingEmp.emp_code || !editingEmp.designation) {
      showToast("Name, Employee Code, and Designation are required", true);
      return;
    }
    try {
      if (editingEmp.id) {
        await updateEmployee(editingEmp.id, editingEmp);
        showToast("Employee record updated successfully");
      } else {
        await createEmployee(editingEmp);
        showToast("Employee created successfully");
      }
      setEmpModalOpen(false);
      setEditingEmp(null);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Delete employee
  const handleDeleteEmployee = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove employee ${name}?`)) return;
    try {
      await deleteEmployee(id);
      showToast(`Removed employee ${name}`);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Generate Letter
  const handleGenerateLetter = async () => {
    if (!letterContent) return;
    setGeneratingLetter(true);
    try {
      const tmpl = templates[selectedLetterType];
      const created = await generateLetter({
        employee_id: selectedEmpIdForLetter || undefined,
        letter_type: selectedLetterType,
        title: tmpl?.title || "Official Communication",
        placeholders: letterPlaceholders,
        content: letterContent,
      });
      showToast(`Generated ${created.title} successfully!`);
      const updatedLets = await fetchLetters();
      setLetters(updatedLets);
      // Auto open PDF in new tab
      window.open(getLetterPdfUrl(created.id), "_blank");
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    } finally {
      setGeneratingLetter(false);
    }
  };

  // Run payroll
  const handleExecutePayroll = async () => {
    setRunningPayroll(true);
    try {
      const run = await createPayrollRun(payMonth, payYear);
      showToast(`Payroll for ${payMonth}/${payYear} generated with ${run.employee_count} payslips!`);
      const updatedRuns = await fetchPayrollRuns();
      setPayrollRuns(updatedRuns);
      setSelectedRunId(run.id);
      const sls = await fetchPayslips({ run_id: run.id });
      setPayslips(sls);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    } finally {
      setRunningPayroll(false);
    }
  };

  // Dispatch single payslip
  const handleDispatchSlip = async (slipId: string) => {
    try {
      await dispatchPayslip(slipId);
      showToast("Salary slip marked as dispatched to employee!");
      if (selectedRunId) {
        const sls = await fetchPayslips({ run_id: selectedRunId });
        setPayslips(sls);
      }
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Dispatch all payslips
  const handleDispatchAll = async (runId: string) => {
    if (!window.confirm("Confirm bulk dispatch of all payslips in this payroll run?")) return;
    try {
      await dispatchAllPayslips(runId);
      showToast("All salary slips dispatched successfully!");
      const updatedRuns = await fetchPayrollRuns();
      setPayrollRuns(updatedRuns);
      const sls = await fetchPayslips({ run_id: runId });
      setPayslips(sls);
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Punch attendance
  const handlePunch = async (empId: string, status: string) => {
    try {
      await punchAttendance({
        employee_id: empId,
        date: attDate,
        status,
        punch_in: status === "present" ? "09:30 AM" : undefined,
        punch_out: status === "present" ? "06:30 PM" : undefined,
      });
      const atts = await fetchAttendance({ date: attDate });
      setAttendance(atts);
      showToast("Attendance updated");
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Bulk attendance
  const handleBulkAttendance = async () => {
    try {
      await markBulkAttendance(attDate, "present");
      showToast(`Marked all active staff Present for ${attDate}`);
      const atts = await fetchAttendance({ date: attDate });
      setAttendance(atts);
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Submit leave
  const handleSubmitLeave = async () => {
    if (!newLeave.employee_id || !newLeave.reason) {
      showToast("Employee and reason are required", true);
      return;
    }
    try {
      await submitLeave(newLeave);
      showToast("Leave request submitted for review");
      setLeaveModalOpen(false);
      const lvs = await fetchLeaves();
      setLeaves(lvs);
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // Approve / Reject Leave
  const handleReviewLeave = async (leaveId: string, status: "approved" | "rejected") => {
    try {
      await updateLeaveStatus(leaveId, status);
      showToast(`Leave request ${status}`);
      const lvs = await fetchLeaves();
      setLeaves(lvs);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  // ID Card handlers
  const handleIssueCard = async () => {
    if (!issuingEmpId) {
      showToast("Please select an employee", true);
      return;
    }
    setIssuingCard(true);
    try {
      const card = await issueIdCard({
        employee_id: issuingEmpId,
        blood_group: cardBloodGroup,
        emergency_contact: cardEmergencyContact,
        validity_years: cardValidityYears,
      });
      showToast(`ID Card ${card.card_number} issued successfully!`);
      setIssueCardModalOpen(false);
      const updatedCards = await fetchIdCards();
      setIdCards(updatedCards);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    } finally {
      setIssuingCard(false);
    }
  };

  const handleBulkIssueCards = async () => {
    if (!window.confirm("Generate and issue official ID cards for all active staff who do not have an active card yet?")) return;
    try {
      const res = await bulkIssueIdCards();
      showToast(`Bulk ID cards issued: ${res.issued_count} new cards generated!`);
      const updatedCards = await fetchIdCards();
      setIdCards(updatedCards);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    }
  };

  const handleConfirmDispatch = async () => {
    if (!dispatchingCard) return;
    setSubmittingDispatch(true);
    try {
      await dispatchIdCard(dispatchingCard.id, {
        tracking_number: dispatchTrackingNo || undefined,
        notes: dispatchNotes || undefined,
      });
      showToast(`ID Card ${dispatchingCard.card_number} marked as dispatched!`);
      setDispatchModalOpen(false);
      setDispatchingCard(null);
      setDispatchTrackingNo("");
      setDispatchNotes("");
      const updatedCards = await fetchIdCards();
      setIdCards(updatedCards);
      loadData();
    } catch (err: unknown) {
      showToast(getErrMsg(err), true);
    } finally {
      setSubmittingDispatch(false);
    }
  };

  const filteredCards = useMemo(() => {
    return idCards.filter((c) => {
      if (idCardFilter !== "all" && c.status !== idCardFilter) return false;
      if (idCardSearch) {
        const s = idCardSearch.toLowerCase();
        return (
          c.card_number.toLowerCase().includes(s) ||
          c.emp_name.toLowerCase().includes(s) ||
          c.emp_code.toLowerCase().includes(s) ||
          c.department.toLowerCase().includes(s) ||
          c.qr_verification_code.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [idCards, idCardFilter, idCardSearch]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (empDeptFilter !== "all" && e.department !== empDeptFilter) return false;
      if (empSearch) {
        const s = empSearch.toLowerCase();
        return (
          e.name.toLowerCase().includes(s) ||
          e.emp_code.toLowerCase().includes(s) ||
          e.designation.toLowerCase().includes(s) ||
          e.email.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [employees, empSearch, empDeptFilter]);

  const uniqueDepartments = useMemo(() => {
    const set = new Set(employees.map((e) => e.department).filter(Boolean));
    return Array.from(set);
  }, [employees]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Toast banner */}
      {actionMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
            actionMsg.isError ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className={`text-2xl font-bold tracking-tight ${INK_CLS}`}>Human Resources & Payroll</h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              Automated HRMS
            </span>
          </div>
          <p className={`mt-1 text-sm ${MUTED_CLS}`}>
            Official letters with dynamic placeholders, Indian payroll & CTC breakdown, one-click payslip dispatch, and attendance.
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setEditingEmp({
                emp_code: getNextEmpCode(),
                name: "",
                email: "",
                phone: "",
                designation: "",
                department: "Wealth Advisory",
                joining_date: now.toISOString().split("T")[0],
                status: "active",
                manager_name: "Debabrata Mukherjee",
                pan: "",
                uan: "",
                bank_name: "HDFC Bank",
                bank_account: "",
                bank_ifsc: "",
                ctc: 1200000,
              });
              setEmpModalOpen(true);
            }}
            className={TEAL_BTN}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Employee
          </button>
          <button onClick={() => setTab("letters")} className={SEC_BTN}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Letter Generator
          </button>
          <button
            onClick={() => {
              if (employees.length > 0) setIssuingEmpId(employees[0].id);
              setIssueCardModalOpen(true);
            }}
            className={SEC_BTN}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
            </svg>
            Issue ID Card
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex border-b border-[#E4E9EF] dark:border-[#2B3644] overflow-x-auto">
        {[
          { id: "overview", label: "Overview & KPIs" },
          { id: "employees", label: `Employees (${employees.length})` },
          { id: "id_cards", label: `ID Cards & QR (${idCards.length})` },
          { id: "letters", label: "Document & Letter Generator" },
          { id: "payroll", label: "Indian Payroll & Payslips" },
          { id: "attendance", label: "Attendance & Leaves" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as HrmsTab)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-[2px] ${
              tab === t.id
                ? "border-[#006F64] text-[#006F64] dark:text-[#75E1CE] dark:border-[#75E1CE]"
                : `border-transparent ${MUTED_CLS} hover:text-[#172033] dark:hover:text-[#EDF1F6]`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TAB 1: OVERVIEW */}
      {/* ------------------------------------------------------------- */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className={`${CARD_CLS} p-5`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>Total Headcount</span>
                <span className="rounded-full bg-blue-50 p-2 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6M3 10a3 3 0 106 0" />
                  </svg>
                </span>
              </div>
              <div className={`mt-2 text-3xl font-bold ${INK_CLS}`}>{stats?.total_employees ?? employees.length}</div>
              <div className={`mt-1 text-xs ${MUTED_CLS}`}>
                {stats?.active_count ?? employees.length} Active · {stats?.probation_count ?? 0} Probation
              </div>
            </div>

            <div className={`${CARD_CLS} p-5`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>Monthly Payroll Outflow</span>
                <span className="rounded-full bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
              </div>
              <div className={`mt-2 text-3xl font-bold ${INK_CLS}`}>
                {formatInr(stats?.total_monthly_payroll || 0)}
              </div>
              <div className={`mt-1 text-xs ${MUTED_CLS}`}>Statutory PF 12% & PT ₹200 Compliant</div>
            </div>

            <div className={`${CARD_CLS} p-5`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>Today&apos;s Attendance</span>
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
              </div>
              <div className={`mt-2 text-3xl font-bold ${INK_CLS}`}>
                {stats?.today_attendance.present ?? 0} / {stats?.total_employees ?? employees.length}
              </div>
              <div className={`mt-1 text-xs ${MUTED_CLS}`}>
                {stats?.today_attendance.wfh ?? 0} WFH · {stats?.today_attendance.absent ?? 0} Absent
              </div>
            </div>

            <div className={`${CARD_CLS} p-5`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>Pending Leave Approvals</span>
                <span className="rounded-full bg-amber-50 p-2 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </span>
              </div>
              <div className={`mt-2 text-3xl font-bold ${INK_CLS}`}>{stats?.pending_leaves ?? 0}</div>
              <div className={`mt-1 text-xs ${MUTED_CLS}`}>Requires managerial review</div>
            </div>

            <div className={`${CARD_CLS} p-5 cursor-pointer hover:border-[#006F64] transition-colors`} onClick={() => setTab("id_cards")}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>ID Cards & Badges</span>
                <span className="rounded-full bg-teal-50 p-2 text-[#006F64] dark:bg-teal-950 dark:text-[#75E1CE]">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                  </svg>
                </span>
              </div>
              <div className={`mt-2 text-3xl font-bold ${INK_CLS}`}>{stats?.id_cards_total ?? idCards.length}</div>
              <div className={`mt-1 text-xs ${MUTED_CLS}`}>
                {stats?.id_cards_dispatched ?? idCards.filter((c) => c.status === "dispatched").length} Dispatched · QR Verified
              </div>
            </div>
          </div>

          {/* Quick Actions & Recent Runs */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Department Breakdown */}
            <div className={`${CARD_CLS} p-5`}>
              <h3 className={`text-base font-semibold ${INK_CLS}`}>Department Distribution</h3>
              <p className={`text-xs ${MUTED_CLS} mb-4`}>Headcount by operational division</p>
              <div className="space-y-3">
                {Object.entries(stats?.departments || {}).map(([dept, count]) => {
                  const pct = Math.round((count / (employees.length || 1)) * 100);
                  return (
                    <div key={dept}>
                      <div className="flex justify-between text-xs font-medium">
                        <span className={INK_CLS}>{dept}</span>
                        <span className={MUTED_CLS}>
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-1.5 rounded-full bg-[#006F64]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Payroll Runs */}
            <div className={`${CARD_CLS} p-5 lg:col-span-2`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className={`text-base font-semibold ${INK_CLS}`}>Monthly Payroll Runs</h3>
                  <p className={`text-xs ${MUTED_CLS}`}>Status of monthly disbursements</p>
                </div>
                <button onClick={() => setTab("payroll")} className={SEC_BTN}>
                  View All Runs
                </button>
              </div>

              {payrollRuns.length === 0 ? (
                <div className={`rounded-lg border border-dashed border-[#E4E9EF] dark:border-[#2B3644] p-8 text-center text-sm ${MUTED_CLS}`}>
                  No payroll runs executed yet. Click &quot;Execute Monthly Payroll Run&quot; under Payroll tab.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}>
                        <th className="py-2.5 px-3 font-semibold">Period</th>
                        <th className="py-2.5 px-3 font-semibold">Staff Count</th>
                        <th className="py-2.5 px-3 font-semibold">Gross Pay</th>
                        <th className="py-2.5 px-3 font-semibold">Deductions</th>
                        <th className="py-2.5 px-3 font-semibold">Net Payout</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                      {payrollRuns.slice(0, 5).map((r) => (
                        <tr key={r.id}>
                          <td className={`py-2.5 px-3 font-semibold ${INK_CLS}`}>
                            {new Date(r.year, r.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" })}
                          </td>
                          <td className="py-2.5 px-3">{r.employee_count}</td>
                          <td className="py-2.5 px-3">{formatInr(r.total_gross)}</td>
                          <td className="py-2.5 px-3 text-red-600">{formatInr(r.total_deductions)}</td>
                          <td className="py-2.5 px-3 font-bold text-emerald-600">{formatInr(r.total_net)}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                r.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                              }`}
                            >
                              {r.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 2: EMPLOYEES DIRECTORY */}
      {/* ------------------------------------------------------------- */}
      {tab === "employees" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                type="text"
                placeholder="Search by name, code, designation or email..."
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className={`w-full max-w-sm rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-xs ${INK_CLS} placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#006F64]`}
              />
              <select
                value={empDeptFilter}
                onChange={(e) => setEmpDeptFilter(e.target.value)}
                className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-xs ${INK_CLS} focus:outline-none`}
              >
                <option value="all">All Departments</option>
                {uniqueDepartments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setEditingEmp({
                  emp_code: getNextEmpCode(),
                  name: "",
                  email: "",
                  phone: "",
                  designation: "",
                  department: "Wealth Advisory",
                  joining_date: now.toISOString().split("T")[0],
                  status: "active",
                  manager_name: "Debabrata Mukherjee",
                  pan: "",
                  uan: "",
                  bank_name: "HDFC Bank",
                  bank_account: "",
                  bank_ifsc: "",
                  ctc: 1200000,
                });
                setEmpModalOpen(true);
              }}
              className={TEAL_BTN}
            >
              Add New Employee
            </button>
          </div>

          {/* Employees Table */}
          <div className={`${CARD_CLS} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}>
                    <th className="py-3 px-4 font-semibold">Emp Code</th>
                    <th className="py-3 px-4 font-semibold">Employee Details</th>
                    <th className="py-3 px-4 font-semibold">Department & Role</th>
                    <th className="py-3 px-4 font-semibold">Joining Date</th>
                    <th className="py-3 px-4 font-semibold">Annual CTC</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-[#1B2432]/50">
                      <td className={`py-3 px-4 font-mono font-bold ${INK_CLS}`}>{emp.emp_code}</td>
                      <td className="py-3 px-4">
                        <div className={`font-semibold ${INK_CLS}`}>{emp.name}</div>
                        <div className={`text-[11px] ${MUTED_CLS}`}>{emp.email} · {emp.phone || "No phone"}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className={`font-medium ${INK_CLS}`}>{emp.designation}</div>
                        <div className={`text-[11px] ${MUTED_CLS}`}>{emp.department}</div>
                      </td>
                      <td className={`py-3 px-4 ${MUTED_CLS}`}>{emp.joining_date}</td>
                      <td className="py-3 px-4">
                        <div className={`font-semibold ${INK_CLS}`}>{formatInr(emp.ctc)}</div>
                        <div className={`text-[11px] ${MUTED_CLS}`}>~{formatInr(Math.floor(emp.ctc / 12))}/mo</div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            emp.status === "active"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : emp.status === "probation"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {emp.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingEmp(emp);
                            setEmpModalOpen(true);
                          }}
                          className="font-medium text-[#006F64] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setIssuingEmpId(emp.id);
                            setCardBloodGroup(emp.blood_group || "O+");
                            setCardEmergencyContact(emp.emergency_contact || emp.phone || "");
                            setIssueCardModalOpen(true);
                          }}
                          className="font-medium text-emerald-600 hover:underline"
                        >
                          ID Card
                        </button>
                        <button
                          onClick={() => {
                            setSelectedEmpIdForLetter(emp.id);
                            setTab("letters");
                          }}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          Letter
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                          className="font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 3: DOCUMENT & LETTER GENERATOR */}
      {/* ------------------------------------------------------------- */}
      {tab === "letters" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Column: Form & Placeholders (5 cols) */}
            <div className={`lg:col-span-5 ${CARD_CLS} p-5 space-y-4`}>
              <div>
                <h3 className={`text-base font-semibold ${INK_CLS}`}>Official Letter Generator</h3>
                <p className={`text-xs ${MUTED_CLS}`}>
                  Creates official branded PDF letters with ARN 345439, letterhead, Annexure A salary breakdown, and authorized signature.
                </p>
              </div>

              {/* Template selector */}
              <div>
                <label className={`block text-xs font-semibold ${INK_CLS} mb-1`}>Document Type</label>
                <select
                  value={selectedLetterType}
                  onChange={(e) => setSelectedLetterType(e.target.value)}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 text-xs ${INK_CLS}`}
                >
                  <option value="internship_offer">Internship Offer Letter (Sample Paper - Mr. Manohar)</option>
                  <option value="offer">Full-Time Offer of Employment (CTC Annexure A)</option>
                  <option value="promotion">Promotion & Compensation Revision</option>
                  <option value="termination">Termination Notice & Settlement Terms</option>
                  <option value="relieving">Relieving & Experience Certificate</option>
                </select>
              </div>

              {/* Populate from existing employee */}
              <div>
                <label className={`block text-xs font-semibold ${INK_CLS} mb-1`}>
                  Auto-fill from Employee Directory (Optional)
                </label>
                <select
                  value={selectedEmpIdForLetter}
                  onChange={(e) => setSelectedEmpIdForLetter(e.target.value)}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 text-xs ${INK_CLS}`}
                >
                  <option value="">-- Choose Employee or Fill Below --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.emp_code} - {e.name} ({e.designation})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic Placeholders */}
              <div className="border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3 space-y-3">
                <span className={`text-xs font-semibold uppercase tracking-wider ${MUTED_CLS}`}>
                  Template Dynamic Placeholders
                </span>
                {Object.entries(letterPlaceholders).map(([key, val]) => (
                  <div key={key}>
                    <label className={`block text-[11px] font-medium ${MUTED_CLS} uppercase`}>
                      {`{{${key}}}`}
                    </label>
                    <input
                      type="text"
                      value={val}
                      onChange={(e) =>
                        setLetterPlaceholders((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className={`mt-1 w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-xs ${INK_CLS}`}
                    />
                  </div>
                ))}
              </div>

              {/* Generate button */}
              <button
                disabled={generatingLetter}
                onClick={handleGenerateLetter}
                className={`w-full ${TEAL_BTN} justify-center py-2.5 text-sm`}
              >
                {generatingLetter ? "Generating Official PDF..." : "Generate & Download Official PDF"}
              </button>
            </div>

            {/* Right Column: Live Letter Preview (7 cols) */}
            <div className={`lg:col-span-7 ${CARD_CLS} p-6 flex flex-col justify-between`}>
              <div>
                <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-4 mb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#006F64]">Fund Horizon Official</span>
                    <h4 className={`text-base font-bold ${INK_CLS}`}>
                      {templates[selectedLetterType]?.title || "Official Document"}
                    </h4>
                  </div>
                  <span className={`text-xs ${MUTED_CLS}`}>ARN 345439 · AMFI Registered MFD</span>
                </div>

                <div className="space-y-3 text-xs leading-relaxed">
                  <div className={`p-4 rounded-lg ${SOFT_CLS} border border-[#E4E9EF] dark:border-[#2B3644] font-mono text-[11px]`}>
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      To: {letterPlaceholders.employee_name || "Recipient Name"}
                    </p>
                    <p className={MUTED_CLS}>
                      Designation: {letterPlaceholders.designation || "Designation"}
                    </p>
                    <p className={MUTED_CLS}>Date: {letterPlaceholders.date || now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                  </div>

                  {/* Body Editor */}
                  <textarea
                    rows={12}
                    value={letterContent}
                    onChange={(e) => setLetterContent(e.target.value)}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-3 text-xs ${INK_CLS} leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#006F64]`}
                  />

                  {/* Annexure note if offer/promotion */}
                  {(selectedLetterType === "offer" || selectedLetterType === "promotion") && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                      <strong>Automatic Annexure A:</strong> The generated PDF will automatically append the official Indian Compensation Schedule table detailing Basic Pay (50%), HRA (25%), Special Allowance, EPF (12%), Professional Tax, and Net In-Hand salary based on CTC of ₹{letterPlaceholders.ctc || "0"}.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-[#E4E9EF] dark:border-[#2B3644] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Signatory Authority: <b>Mr. Manohar Hemdev (Partner)</b> · Official Stamp & Signature Auto-Placed</span>
                <span>Format: ISO A4 High-Resolution Vector PDF</span>
              </div>
            </div>
          </div>

          {/* Generated Letters Archive Table */}
          <div className={`${CARD_CLS} p-5`}>
            <h4 className={`text-base font-semibold ${INK_CLS} mb-1`}>Generated Letters Archive</h4>
            <p className={`text-xs ${MUTED_CLS} mb-4`}>History of all generated official letters with instant PDF download links</p>

            {letters.length === 0 ? (
              <div className={`p-6 text-center text-xs ${MUTED_CLS}`}>No letters generated yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}>
                      <th className="py-2.5 px-3 font-semibold">Date</th>
                      <th className="py-2.5 px-3 font-semibold">Recipient</th>
                      <th className="py-2.5 px-3 font-semibold">Document Title</th>
                      <th className="py-2.5 px-3 font-semibold">Type</th>
                      <th className="py-2.5 px-3 font-semibold">Generated By</th>
                      <th className="py-2.5 px-3 font-semibold text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                    {letters.map((letRec) => (
                      <tr key={letRec.id}>
                        <td className="py-2.5 px-3">{new Date(letRec.created_at).toLocaleDateString()}</td>
                        <td className={`py-2.5 px-3 font-semibold ${INK_CLS}`}>
                          {letRec.placeholders?.employee_name || letRec.emp_name || "Recipient"}
                        </td>
                        <td className="py-2.5 px-3">{letRec.title}</td>
                        <td className="py-2.5 px-3 uppercase text-[11px] font-mono">{letRec.letter_type}</td>
                        <td className="py-2.5 px-3 text-slate-500">{letRec.generated_by}</td>
                        <td className="py-2.5 px-3 text-right">
                          <a
                            href={getLetterPdfUrl(letRec.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-[#006F64] hover:underline"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 4: INDIAN PAYROLL & PAYSLIPS */}
      {/* ------------------------------------------------------------- */}
      {tab === "payroll" && (
        <div className="space-y-6">
          {/* Payroll Execution Bar */}
          <div className={`${CARD_CLS} p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
            <div>
              <h3 className={`text-base font-semibold ${INK_CLS}`}>Monthly Payroll Runs</h3>
              <p className={`text-xs ${MUTED_CLS}`}>
                Calculates monthly earnings, statutory EPF (12%), Professional Tax (₹200), TDS, and generates individual payslips.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={payMonth}
                onChange={(e) => setPayMonth(Number(e.target.value))}
                className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-xs ${INK_CLS}`}
              >
                {[
                  "January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"
                ].map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={payYear}
                onChange={(e) => setPayYear(Number(e.target.value))}
                className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-xs ${INK_CLS}`}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <button
                disabled={runningPayroll}
                onClick={handleExecutePayroll}
                className={TEAL_BTN}
              >
                {runningPayroll ? "Computing Payroll..." : "Execute Monthly Payroll Run"}
              </button>
            </div>
          </div>

          {/* Payroll Run Selector & Bulk Dispatch */}
          {payrollRuns.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${INK_CLS}`}>Select Run:</span>
                <select
                  value={selectedRunId}
                  onChange={(e) => handleSelectRun(e.target.value)}
                  className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-xs font-semibold ${INK_CLS}`}
                >
                  {payrollRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.year, r.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" })} · {r.employee_count} Staff ({formatInr(r.total_net)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedRunId && (
                <button
                  onClick={() => handleDispatchAll(selectedRunId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Bulk Dispatch All Payslips
                </button>
              )}
            </div>
          )}

          {/* Payslips Table */}
          <div className={`${CARD_CLS} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}>
                    <th className="py-3 px-4 font-semibold">Employee</th>
                    <th className="py-3 px-4 font-semibold">Worked</th>
                    <th className="py-3 px-4 font-semibold">Basic (50%)</th>
                    <th className="py-3 px-4 font-semibold">HRA</th>
                    <th className="py-3 px-4 font-semibold">Special All.</th>
                    <th className="py-3 px-4 font-semibold">Gross Pay</th>
                    <th className="py-3 px-4 font-semibold">PF (12%)</th>
                    <th className="py-3 px-4 font-semibold">PT / TDS</th>
                    <th className="py-3 px-4 font-semibold">Net Pay</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                  {payslips.map((slip) => (
                    <tr key={slip.id} className="hover:bg-slate-50/50 dark:hover:bg-[#1B2432]/50">
                      <td className="py-3 px-4">
                        <div className={`font-semibold ${INK_CLS}`}>{slip.emp_name}</div>
                        <div className={`text-[11px] ${MUTED_CLS}`}>{slip.emp_code} · {slip.designation}</div>
                      </td>
                      <td className="py-3 px-4">
                        {slip.days_worked}/{slip.days_in_month}d
                      </td>
                      <td className="py-3 px-4">{formatInr(slip.basic)}</td>
                      <td className="py-3 px-4">{formatInr(slip.hra)}</td>
                      <td className="py-3 px-4">{formatInr(slip.special_allowance)}</td>
                      <td className={`py-3 px-4 font-semibold ${INK_CLS}`}>{formatInr(slip.gross_pay)}</td>
                      <td className="py-3 px-4 text-red-600">{formatInr(slip.pf_deduction)}</td>
                      <td className="py-3 px-4 text-red-600">
                        {formatInr(slip.pt_deduction + slip.tds_deduction)}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-600">{formatInr(slip.net_pay)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            slip.status === "dispatched"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {slip.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <a
                          href={getPayslipPdfUrl(slip.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[#006F64] hover:underline"
                        >
                          PDF
                        </a>
                        {slip.status !== "dispatched" && (
                          <button
                            onClick={() => handleDispatchSlip(slip.id)}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            Dispatch
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 5: ATTENDANCE & LEAVES */}
      {/* ------------------------------------------------------------- */}
      {tab === "attendance" && (
        <div className="space-y-6">
          {/* Attendance Controls */}
          <div className={`${CARD_CLS} p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
            <div className="flex items-center gap-3">
              <div>
                <label className={`block text-[11px] font-semibold uppercase ${MUTED_CLS}`}>Date</label>
                <input
                  type="date"
                  value={attDate}
                  onChange={(e) => setAttDate(e.target.value)}
                  className={`mt-1 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-xs ${INK_CLS}`}
                />
              </div>
              <div className="self-end">
                <button onClick={handleBulkAttendance} className={SEC_BTN}>
                  Mark All Present Today
                </button>
              </div>
            </div>

            <button onClick={() => setLeaveModalOpen(true)} className={TEAL_BTN}>
              Apply Leave Request
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Daily Attendance Grid (7 cols) */}
            <div className={`lg:col-span-7 ${CARD_CLS} p-5`}>
              <h3 className={`text-base font-semibold ${INK_CLS} mb-1`}>Daily Punch Register</h3>
              <p className={`text-xs ${MUTED_CLS} mb-4`}>Attendance records for {attDate}</p>

              <div className="space-y-2">
                {employees.map((emp) => {
                  const record = attendance.find((a) => a.employee_id === emp.id);
                  const status = record?.status || "unmarked";
                  return (
                    <div
                      key={emp.id}
                      className={`flex items-center justify-between p-3 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}
                    >
                      <div>
                        <div className={`text-xs font-semibold ${INK_CLS}`}>{emp.name}</div>
                        <div className={`text-[11px] ${MUTED_CLS}`}>{emp.emp_code} · {emp.department}</div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {["present", "wfh", "half_day", "absent"].map((st) => (
                          <button
                            key={st}
                            onClick={() => handlePunch(emp.id, st)}
                            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              status === st
                                ? st === "present"
                                  ? "bg-emerald-600 text-white"
                                  : st === "wfh"
                                  ? "bg-blue-600 text-white"
                                  : st === "half_day"
                                  ? "bg-amber-600 text-white"
                                  : "bg-red-600 text-white"
                                : "bg-white dark:bg-[#171E2A] text-slate-600 dark:text-slate-400 border border-[#E4E9EF] dark:border-[#2B3644] hover:bg-slate-100"
                            }`}
                          >
                            {st === "half_day" ? "Half Day" : st.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Leave Requests Pipeline (5 cols) */}
            <div className={`lg:col-span-5 ${CARD_CLS} p-5`}>
              <h3 className={`text-base font-semibold ${INK_CLS} mb-1`}>Leave Requests</h3>
              <p className={`text-xs ${MUTED_CLS} mb-4`}>Approve or reject leave applications</p>

              {leaves.length === 0 ? (
                <div className={`p-8 text-center text-xs ${MUTED_CLS}`}>No leave requests submitted.</div>
              ) : (
                <div className="space-y-3">
                  {leaves.map((l) => (
                    <div
                      key={l.id}
                      className={`p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${INK_CLS}`}>{l.emp_name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            l.status === "approved"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : l.status === "rejected"
                              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {l.status.toUpperCase()}
                        </span>
                      </div>
                      <div className={`mt-1 text-[11px] ${MUTED_CLS}`}>
                        {l.leave_type.toUpperCase()} · {l.start_date} to {l.end_date} ({l.days} days)
                      </div>
                      <p className={`mt-2 text-xs italic ${INK_CLS}`}>&ldquo;{l.reason}&rdquo;</p>

                      {l.status === "pending" && (
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-2">
                          <button
                            onClick={() => handleReviewLeave(l.id, "approved")}
                            className="rounded px-2.5 py-1 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReviewLeave(l.id, "rejected")}
                            className="rounded px-2.5 py-1 text-xs font-semibold bg-red-600 text-white hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 6: ID CARDS & QR VERIFICATION */}
      {/* ------------------------------------------------------------- */}
      {tab === "id_cards" && (
        <div className="space-y-6">
          {/* Header & Action Bar */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className={`text-lg font-bold ${INK_CLS}`}>Employee ID Cards & Verification QR</h2>
              <p className={`text-xs ${MUTED_CLS}`}>
                CR80 vertical PVC badges with authorized signatory Mr. Manohar Hemdev and tamper-proof QR credentials.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleBulkIssueCards} className={SEC_BTN}>
                <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Bulk Issue for Active Staff
              </button>
              <button
                onClick={() => {
                  if (employees.length > 0) setIssuingEmpId(employees[0].id);
                  setIssueCardModalOpen(true);
                }}
                className={TEAL_BTN}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Issue Single ID Card
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                type="text"
                placeholder="Search by card #, employee name, code, dept or QR code..."
                value={idCardSearch}
                onChange={(e) => setIdCardSearch(e.target.value)}
                className={`w-full max-w-md rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-xs ${INK_CLS} placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#006F64]`}
              />
              <select
                value={idCardFilter}
                onChange={(e) => setIdCardFilter(e.target.value)}
                className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-xs ${INK_CLS} focus:outline-none`}
              >
                <option value="all">All Statuses</option>
                <option value="issued">Pending Dispatch (Issued)</option>
                <option value="dispatched">Dispatched</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
            <span className={`text-xs ${MUTED_CLS}`}>Showing {filteredCards.length} ID cards</span>
          </div>

          {/* ID Cards Table */}
          <div className={`${CARD_CLS} overflow-hidden`}>
            {filteredCards.length === 0 ? (
              <div className="p-12 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                  </svg>
                </div>
                <h3 className={`text-sm font-semibold ${INK_CLS}`}>No ID Cards Found</h3>
                <p className={`mt-1 text-xs ${MUTED_CLS}`}>
                  Generate individual or bulk ID cards for staff with scannable QR verification.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button onClick={handleBulkIssueCards} className={SEC_BTN}>
                    Bulk Issue for Active Staff
                  </button>
                  <button
                    onClick={() => {
                      if (employees.length > 0) setIssuingEmpId(employees[0].id);
                      setIssueCardModalOpen(true);
                    }}
                    className={TEAL_BTN}
                  >
                    Issue First ID Card
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${SOFT_CLS}`}>
                      <th className="py-3 px-4 font-semibold">Card #</th>
                      <th className="py-3 px-4 font-semibold">Employee</th>
                      <th className="py-3 px-4 font-semibold">Blood / Emergency</th>
                      <th className="py-3 px-4 font-semibold">Validity</th>
                      <th className="py-3 px-4 font-semibold">Status & Dispatch</th>
                      <th className="py-3 px-4 font-semibold">Verification QR</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                    {filteredCards.map((card) => (
                      <tr key={card.id} className="hover:bg-slate-50/50 dark:hover:bg-[#1B2432]/50">
                        <td className="py-3 px-4">
                          <span className={`font-mono font-bold ${INK_CLS}`}>{card.card_number}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className={`font-semibold ${INK_CLS}`}>{card.emp_name}</div>
                          <div className={`text-[11px] ${MUTED_CLS}`}>
                            {card.emp_code} · {card.designation} ({card.department})
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800 dark:bg-red-950 dark:text-red-300">
                              {card.blood_group || "O+"}
                            </span>
                            <span className={`text-[11px] ${MUTED_CLS}`}>
                              {card.emergency_contact || "Emergency: N/A"}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className={INK_CLS}>{card.issue_date}</div>
                          <div className={`text-[11px] ${MUTED_CLS}`}>Valid to: {card.valid_until}</div>
                        </td>
                        <td className="py-3 px-4">
                          {card.status === "dispatched" ? (
                            <div>
                              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                DISPATCHED
                              </span>
                              {card.dispatch_tracking_number && (
                                <div className={`mt-0.5 text-[10px] font-mono ${MUTED_CLS}`}>
                                  Track: {card.dispatch_tracking_number}
                                </div>
                              )}
                            </div>
                          ) : card.status === "issued" ? (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              PENDING DISPATCH
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                              REVOKED
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <a
                            href={`/verify/employee?code=${card.qr_verification_code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-[#EBF6F4] dark:bg-[#163330] px-2 py-1 font-mono text-[11px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline"
                            title="Open public verification page"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {card.qr_verification_code}
                          </a>
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => {
                              setPreviewCard(card);
                              setPreviewSide("front");
                              setPreviewModalOpen(true);
                            }}
                            className="font-medium text-[#006F64] hover:underline"
                          >
                            Preview
                          </button>
                          <a
                            href={getIdCardPdfUrl(card.id, "cr80")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-blue-600 hover:underline"
                            title="Standard 54x85.6mm PVC Badge PDF"
                          >
                            CR80 PDF
                          </a>
                          <a
                            href={getIdCardPdfUrl(card.id, "a4_sheet")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-slate-600 dark:text-slate-300 hover:underline"
                            title="A4 Printable Sheet with Front & Back"
                          >
                            Print Sheet
                          </a>
                          {card.status === "issued" && (
                            <button
                              onClick={() => {
                                setDispatchingCard(card);
                                setDispatchTrackingNo("");
                                setDispatchNotes("");
                                setDispatchModalOpen(true);
                              }}
                              className="font-medium text-emerald-600 hover:underline"
                            >
                              Dispatch
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: ADD / EDIT EMPLOYEE */}
      {/* ------------------------------------------------------------- */}
      {empModalOpen && editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto ${CARD_CLS} p-6 shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-3 mb-4">
              <h3 className={`text-lg font-bold ${INK_CLS}`}>
                {editingEmp.id ? "Edit Employee Profile" : "Add New Employee"}
              </h3>
              <button
                onClick={() => setEmpModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Row 1: Code, Name, Email */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Emp Code *</label>
                  <input
                    type="text"
                    value={editingEmp.emp_code || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, emp_code: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Full Name *</label>
                  <input
                    type="text"
                    value={editingEmp.name || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, name: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Email *</label>
                  <input
                    type="email"
                    value={editingEmp.email || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, email: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
              </div>

              {/* Row 2: Phone, Designation, Department */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Mobile Phone</label>
                  <input
                    type="text"
                    value={editingEmp.phone || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, phone: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Designation *</label>
                  <input
                    type="text"
                    value={editingEmp.designation || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, designation: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Department</label>
                  <select
                    value={editingEmp.department || "Wealth Advisory"}
                    onChange={(e) => setEditingEmp({ ...editingEmp, department: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  >
                    <option value="Wealth Advisory">Wealth Advisory</option>
                    <option value="Research & Analytics">Research & Analytics</option>
                    <option value="Operations">Operations</option>
                    <option value="Client Services">Client Services</option>
                    <option value="Compliance">Compliance</option>
                    <option value="Information Technology">Information Technology</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Joining Date, Status, Manager */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Joining Date</label>
                  <input
                    type="date"
                    value={editingEmp.joining_date || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, joining_date: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Employment Status</label>
                  <select
                    value={editingEmp.status || "active"}
                    onChange={(e) => setEditingEmp({ ...editingEmp, status: e.target.value as Employee["status"] })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  >
                    <option value="active">Active</option>
                    <option value="probation">Probation</option>
                    <option value="notice_period">Notice Period</option>
                    <option value="resigned">Resigned</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Reporting Manager</label>
                  <input
                    type="text"
                    value={editingEmp.manager_name || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, manager_name: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
              </div>

              {/* Row 4: Statutory & Banking: PAN, UAN, Bank A/C, IFSC */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>PAN Card</label>
                  <input
                    type="text"
                    value={editingEmp.pan || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, pan: e.target.value.toUpperCase() })}
                    placeholder="ABCDE1234F"
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 font-mono ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>UAN / EPF Number</label>
                  <input
                    type="text"
                    value={editingEmp.uan || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, uan: e.target.value })}
                    placeholder="100XXXXXXXXX"
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 font-mono ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Bank Account No.</label>
                  <input
                    type="text"
                    value={editingEmp.bank_account || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, bank_account: e.target.value })}
                    placeholder="50100XXXXXXX"
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 font-mono ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Bank IFSC</label>
                  <input
                    type="text"
                    value={editingEmp.bank_ifsc || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, bank_ifsc: e.target.value.toUpperCase() })}
                    placeholder="HDFC0000123"
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 font-mono ${INK_CLS}`}
                  />
                </div>
              </div>

              {/* Row 5: Emergency & Medical: Blood Group, Emergency Contact */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Blood Group</label>
                  <select
                    value={editingEmp.blood_group || "O+"}
                    onChange={(e) => setEditingEmp({ ...editingEmp, blood_group: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  >
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Emergency Contact Phone</label>
                  <input
                    type="text"
                    value={editingEmp.emergency_contact || ""}
                    onChange={(e) => setEditingEmp({ ...editingEmp, emergency_contact: e.target.value })}
                    placeholder="+91 98765 43210"
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
              </div>

              {/* Annual CTC Input & Live Calculator */}
              <div className="border-t border-[#E4E9EF] dark:border-[#2B3644] pt-4">
                <label className={`block font-bold text-sm ${INK_CLS} mb-1`}>Annual CTC (INR)</label>
                <input
                  type="number"
                  step={50000}
                  value={editingEmp.ctc || 0}
                  onChange={(e) => setEditingEmp({ ...editingEmp, ctc: Number(e.target.value) })}
                  className={`w-full max-w-xs rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 text-sm font-bold ${INK_CLS}`}
                />

                {/* Salary Breakdown Card */}
                <div className="mt-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Auto-Computed Indian Monthly Payroll Schedule
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className={MUTED_CLS}>Monthly Gross:</span>
                      <span className="font-semibold">{formatInr(computedSalary.monthly_gross)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={MUTED_CLS}>Basic Pay (50%):</span>
                      <span className="font-semibold">{formatInr(computedSalary.basic)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={MUTED_CLS}>HRA (50% of Basic):</span>
                      <span className="font-semibold">{formatInr(computedSalary.hra)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={MUTED_CLS}>Special Allowance:</span>
                      <span className="font-semibold">{formatInr(computedSalary.sa)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>Provident Fund (12%):</span>
                      <span>-{formatInr(computedSalary.pf)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>Professional Tax:</span>
                      <span>-{formatInr(computedSalary.pt)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>Estimated Monthly TDS:</span>
                      <span>-{formatInr(computedSalary.tds)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-300 dark:border-slate-600 pt-1 text-emerald-600 font-bold">
                      <span>Estimated Net Take-Home:</span>
                      <span>{formatInr(computedSalary.net)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-4">
              <button onClick={() => setEmpModalOpen(false)} className={SEC_BTN}>
                Cancel
              </button>
              <button onClick={handleSaveEmployee} className={TEAL_BTN}>
                Save Employee Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: SUBMIT LEAVE REQUEST */}
      {/* ------------------------------------------------------------- */}
      {leaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`w-full max-w-md ${CARD_CLS} p-6 shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-3 mb-4">
              <h3 className={`text-base font-bold ${INK_CLS}`}>Submit Leave Request</h3>
              <button
                onClick={() => setLeaveModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Employee *</label>
                <select
                  value={newLeave.employee_id}
                  onChange={(e) => setNewLeave({ ...newLeave, employee_id: e.target.value })}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.emp_code} - {e.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Leave Type</label>
                <select
                  value={newLeave.leave_type}
                  onChange={(e) => setNewLeave({ ...newLeave, leave_type: e.target.value })}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                >
                  <option value="casual">Casual Leave (CL)</option>
                  <option value="sick">Sick Leave (SL)</option>
                  <option value="earned">Earned / Privilege Leave (EL)</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Start Date</label>
                  <input
                    type="date"
                    value={newLeave.start_date}
                    onChange={(e) => setNewLeave({ ...newLeave, start_date: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>End Date</label>
                  <input
                    type="date"
                    value={newLeave.end_date}
                    onChange={(e) => setNewLeave({ ...newLeave, end_date: e.target.value })}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  />
                </div>
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Total Days</label>
                <input
                  type="number"
                  min={1}
                  value={newLeave.days}
                  onChange={(e) => setNewLeave({ ...newLeave, days: Number(e.target.value) })}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                />
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Reason *</label>
                <textarea
                  rows={3}
                  value={newLeave.reason}
                  onChange={(e) => setNewLeave({ ...newLeave, reason: e.target.value })}
                  placeholder="State reason for absence..."
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
              <button onClick={() => setLeaveModalOpen(false)} className={SEC_BTN}>
                Cancel
              </button>
              <button onClick={handleSubmitLeave} className={TEAL_BTN}>
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: ISSUE ID CARD */}
      {/* ------------------------------------------------------------- */}
      {issueCardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`w-full max-w-md ${CARD_CLS} p-6 shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-3 mb-4">
              <div>
                <h3 className={`text-base font-bold ${INK_CLS}`}>Issue Official ID Card</h3>
                <p className={`text-[11px] ${MUTED_CLS}`}>
                  Generates tamper-proof QR code & vertical CR80 badge
                </p>
              </div>
              <button
                onClick={() => setIssueCardModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Select Employee *</label>
                <select
                  value={issuingEmpId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setIssuingEmpId(id);
                    const emp = employees.find((x) => x.id === id);
                    if (emp) {
                      setCardBloodGroup(emp.blood_group || "O+");
                      setCardEmergencyContact(emp.emergency_contact || emp.phone || "");
                    }
                  }}
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.emp_code} - {e.name} ({e.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Blood Group</label>
                  <select
                    value={cardBloodGroup}
                    onChange={(e) => setCardBloodGroup(e.target.value)}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  >
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block font-semibold ${INK_CLS} mb-1`}>Validity Period</label>
                  <select
                    value={cardValidityYears}
                    onChange={(e) => setCardValidityYears(Number(e.target.value))}
                    className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                  >
                    <option value={1}>1 Year</option>
                    <option value={2}>2 Years</option>
                    <option value={3}>3 Years (Recommended)</option>
                    <option value={5}>5 Years</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Emergency Contact Phone</label>
                <input
                  type="text"
                  value={cardEmergencyContact}
                  onChange={(e) => setCardEmergencyContact(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                />
              </div>

              <div className="rounded-lg bg-teal-50 dark:bg-teal-950/40 p-3 border border-teal-200 dark:border-teal-900/60 text-[11px] text-[#006F64] dark:text-[#75E1CE]">
                <div className="font-semibold mb-1">Standard Issue Specifications:</div>
                <ul className="list-disc list-inside space-y-0.5 text-[10.5px]">
                  <li>Vertical CR80 54mm × 85.6mm PVC layout</li>
                  <li>Tamper-proof online verification QR integration</li>
                  <li>Authorized Signatory: Mr. Manohar Hemdev (Partner)</li>
                </ul>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
              <button onClick={() => setIssueCardModalOpen(false)} className={SEC_BTN}>
                Cancel
              </button>
              <button onClick={handleIssueCard} disabled={issuingCard || !issuingEmpId} className={TEAL_BTN}>
                {issuingCard ? "Generating..." : "Issue ID Card"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: DISPATCH ID CARD */}
      {/* ------------------------------------------------------------- */}
      {dispatchModalOpen && dispatchingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`w-full max-w-md ${CARD_CLS} p-6 shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-3 mb-4">
              <div>
                <h3 className={`text-base font-bold ${INK_CLS}`}>Dispatch Employee ID Card</h3>
                <p className={`text-[11px] ${MUTED_CLS}`}>
                  Record courier tracking or physical handover details
                </p>
              </div>
              <button
                onClick={() => setDispatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between">
                  <span className={MUTED_CLS}>Card Number:</span>
                  <span className={`font-mono font-bold ${INK_CLS}`}>{dispatchingCard.card_number}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className={MUTED_CLS}>Employee:</span>
                  <span className={`font-semibold ${INK_CLS}`}>{dispatchingCard.emp_name} ({dispatchingCard.emp_code})</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className={MUTED_CLS}>Department:</span>
                  <span className={INK_CLS}>{dispatchingCard.department}</span>
                </div>
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>
                  Courier Tracking # / Handover Receipt
                </label>
                <input
                  type="text"
                  value={dispatchTrackingNo}
                  onChange={(e) => setDispatchTrackingNo(e.target.value)}
                  placeholder="e.g. DTDC-884920492 / In-Hand Handover"
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 font-mono ${INK_CLS}`}
                />
              </div>

              <div>
                <label className={`block font-semibold ${INK_CLS} mb-1`}>Handover / Courier Notes</label>
                <textarea
                  rows={3}
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  placeholder="e.g. Dispatched via BlueDart Air to Bangalore office or handed over at Mumbai HQ"
                  className={`w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-2 ${INK_CLS}`}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
              <button onClick={() => setDispatchModalOpen(false)} className={SEC_BTN}>
                Cancel
              </button>
              <button onClick={handleConfirmDispatch} disabled={submittingDispatch} className={TEAL_BTN}>
                {submittingDispatch ? "Saving..." : "Confirm Dispatch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: INTERACTIVE CARD PREVIEW */}
      {/* ------------------------------------------------------------- */}
      {previewModalOpen && previewCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className={`w-full max-w-lg ${CARD_CLS} p-6 shadow-2xl my-auto`}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-3 mb-4">
              <div>
                <h3 className={`text-base font-bold ${INK_CLS}`}>ID Badge Preview</h3>
                <p className={`text-[11px] ${MUTED_CLS}`}>
                  {previewCard.card_number} · {previewCard.emp_name}
                </p>
              </div>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* Front / Back Switch */}
            <div className="mb-4 flex justify-center">
              <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  onClick={() => setPreviewSide("front")}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                    previewSide === "front"
                      ? "bg-white text-[#006F64] shadow dark:bg-[#171E2A] dark:text-[#75E1CE]"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Front Side (Identity)
                </button>
                <button
                  onClick={() => setPreviewSide("back")}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                    previewSide === "back"
                      ? "bg-white text-[#006F64] shadow dark:bg-[#171E2A] dark:text-[#75E1CE]"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Back Side (QR & Verification)
                </button>
              </div>
            </div>

            {/* Simulated CR80 Card */}
            <div className="flex justify-center py-2">
              <div className="relative w-[280px] h-[440px] rounded-2xl bg-white border border-slate-300 shadow-2xl overflow-hidden flex flex-col justify-between text-slate-900 select-none">
                {previewSide === "front" ? (
                  <>
                    {/* Top Navy Header */}
                    <div className="bg-[#0B2545] p-3 text-white text-center border-b-2 border-[#BA791A]">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="h-4 w-4 rounded-full bg-[#006F64] flex items-center justify-center text-[10px] font-bold text-white">
                          FH
                        </div>
                        <div className="font-bold tracking-tight text-sm">FUND HORIZON</div>
                      </div>
                      <div className="text-[9px] tracking-wider text-slate-300 mt-0.5">
                        AMFI REG NO: ARN-345439
                      </div>
                    </div>

                    {/* Photo + Identity */}
                    <div className="flex-1 flex flex-col items-center justify-center p-3 text-center">
                      <div className="w-20 h-24 rounded-lg bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 mb-2">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-[8px] font-semibold mt-1">STAFF PHOTO</span>
                      </div>

                      <div className="font-bold text-base text-[#0B2545]">{previewCard.emp_name}</div>
                      <div className="text-[11px] font-semibold text-[#006F64]">{previewCard.designation}</div>
                      <div className="text-[10px] text-slate-500">{previewCard.department}</div>

                      {/* Detail Pill Box */}
                      <div className="w-full mt-3 grid grid-cols-2 gap-1.5 text-left bg-slate-50 rounded-lg p-2 border border-slate-200 text-[9.5px]">
                        <div>
                          <span className="text-slate-400 block text-[8px] font-semibold">EMP ID</span>
                          <span className="font-mono font-bold text-[#0B2545]">{previewCard.emp_code}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[8px] font-semibold">BLOOD GROUP</span>
                          <span className="font-bold text-red-600">{previewCard.blood_group || "O+"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[8px] font-semibold">ISSUED</span>
                          <span className="text-slate-700">{previewCard.issue_date}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[8px] font-semibold">VALID UNTIL</span>
                          <span className="text-slate-700 font-semibold">{previewCard.valid_until}</span>
                        </div>
                      </div>
                    </div>

                    {/* Authorized Signatory Footer */}
                    <div className="border-t border-slate-200 bg-slate-50 p-2 text-center">
                      <div className="text-[10px] font-serif italic text-slate-800 font-bold">
                        Manohar Hemdev
                      </div>
                      <div className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                        Authorized Signatory · Partner
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Back Header */}
                    <div className="bg-[#0B2545] p-2 text-white text-center border-b-2 border-[#BA791A]">
                      <div className="font-bold tracking-wider text-xs">SECURITY & VERIFICATION</div>
                      <div className="text-[8px] text-slate-300">GOVERNMENT & REGULATORY COMPLIANT</div>
                    </div>

                    {/* Instructions + QR */}
                    <div className="flex-1 flex flex-col items-center justify-between p-3 text-center">
                      <div className="text-[8px] text-slate-500 leading-tight">
                        This card is official property of Fund Horizon. Loss must be reported immediately. If found, please return to:
                      </div>

                      <div className="text-[8.5px] font-medium text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-200 w-full text-left leading-tight">
                        <div className="font-bold text-[#0B2545]">FUND HORIZON</div>
                        <div>104, 1st Floor, Chirag Infotech, Plot A-201, Road No 16, Wagle Estate, Thane - 400604</div>
                        <div className="mt-0.5 text-[#006F64] font-semibold">Web: www.fundhorizon.website</div>
                        <div>Emergency: {previewCard.emergency_contact || "+91 98765 43210"}</div>
                      </div>

                      {/* QR Box */}
                      <div className="flex flex-col items-center my-1">
                        <div className="w-24 h-24 bg-white border-2 border-slate-800 rounded-lg p-1.5 flex flex-col items-center justify-center shadow-inner">
                          {/* Mini QR representation */}
                          <div className="w-20 h-20 bg-slate-900 rounded grid grid-cols-5 gap-0.5 p-1">
                            {Array.from({ length: 25 }).map((_, i) => (
                              <div
                                key={i}
                                className={`rounded-sm ${
                                  [0, 1, 3, 4, 5, 9, 12, 15, 19, 20, 21, 23, 24].includes(i)
                                    ? "bg-white"
                                    : "bg-slate-900"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="mt-1 font-mono text-[9px] font-bold text-[#006F64] bg-[#EBF6F4] px-1.5 py-0.5 rounded">
                          {previewCard.qr_verification_code}
                        </div>
                        <div className="text-[7.5px] text-slate-400 mt-0.5">
                          Scan to verify online credential
                        </div>
                      </div>
                    </div>

                    {/* Back Footer */}
                    <div className="border-t border-slate-200 bg-slate-50 p-1.5 text-center text-[7.5px] text-slate-400">
                      CARD NO: {previewCard.card_number} · TAMPER-PROOF RFID/NFC READY
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
              <a
                href={`/verify/employee?code=${previewCard.qr_verification_code}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline"
              >
                <span>Verify Online Page ↗</span>
              </a>

              <div className="flex items-center gap-2">
                <a
                  href={getIdCardPdfUrl(previewCard.id, "cr80")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={SEC_BTN}
                >
                  CR80 Badge (PDF)
                </a>
                <a
                  href={getIdCardPdfUrl(previewCard.id, "a4_sheet")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={TEAL_BTN}
                >
                  A4 Print Sheet (PDF)
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
