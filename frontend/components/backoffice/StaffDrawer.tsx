"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createStaffMember,
  updateStaffMember,
  type StaffMemberItem,
} from "@/lib/backoffice";
import {
  PAGE_GROUPS,
  ROLE_META,
  hasAllPages,
  normaliseMobile,
  roleDescription,
  roleLabel,
} from "./staffGroups";

interface StaffDrawerProps {
  mode: "create" | "edit";
  member?: StaffMemberItem;
  onClose: () => void;
  /** Parent reloads the list and shows this notice. For a create, this fires on Done, after the one-time password panel. */
  onDone: (notice: string) => void;
}

const inputCls =
  "w-full rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-2.5 py-2 text-[13px] text-[#181818] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#0176D3]";
const labelCls = "block text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1";
const mutedCls = "text-[#706E6B] dark:text-[#A8B4C4]";

/** The wizard from the Staff & permissions screenshot: Details → Access → Review, in a right-side drawer. */
export default function StaffDrawer({ mode, member, onClose, onDone }: StaffDrawerProps) {
  const isEdit = mode === "edit";
  const [step, setStep] = useState<1 | 2 | 3>(isEdit ? 2 : 1);
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(member?.role ?? "analyst");
  const [pages, setPages] = useState<string[]>(member?.pages ?? []);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["research"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<{ login: string; temporaryPassword: string | null; promoted: boolean } | null>(null);
  const firstRef = useRef<HTMLElement | null>(null);

  const initialRole = member?.role ?? "analyst";
  const initialPages = member?.pages ?? [];
  const memberWasUnrestricted = !!member && hasAllPages(member.role, member.pages);
  const dirty = isEdit
    ? role !== initialRole || pages.slice().sort().join() !== initialPages.slice().sort().join()
    : !!(name.trim() || email.trim() || mobile.trim() || password || role !== "analyst" || pages.length);
  const needsPages = role !== "admin" && pages.length === 0;
  const editUnchanged = isEdit && !dirty;

  useEffect(() => {
    firstRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, created]);

  function close() {
    if (created) {
      onDone(created.promoted ? `Existing account promoted for ${created.login}.` : `Account created for ${created.login}.`);
      onClose();
      return;
    }
    if (dirty && !window.confirm("Discard this draft?")) return;
    onClose();
  }

  const toggleGroup = (key: string) => {
    const group = PAGE_GROUPS.find((g) => g.key === key);
    if (!group) return;
    const hrefs = group.pages.map((p) => p.href);
    const all = hrefs.every((h) => pages.includes(h));
    setPages((cur) => (all ? cur.filter((h) => !hrefs.includes(h)) : [...cur, ...hrefs.filter((h) => !cur.includes(h))]));
  };

  const togglePage = (href: string) =>
    setPages((cur) => (cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href]));

  const toggleExpanded = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!q) return PAGE_GROUPS;
    return PAGE_GROUPS.map((g) => ({
      ...g,
      pages: g.pages.filter((p) => p.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)),
    })).filter((g) => g.pages.length > 0);
  }, [q]);

  function goDetailsNext() {
    if (!name.trim()) return setError("Enter the staff member's full name.");
    if (!email.trim()) return setError("Enter an email address or username.");
    const norm = normaliseMobile(mobile);
    if (norm === null) return setError("Enter a 10-digit Indian mobile number starting with 6–9, or leave it blank.");
    setError(null);
    setStep(2);
  }

  async function submitCreate() {
    const norm = normaliseMobile(mobile) ?? "";
    setBusy(true);
    setError(null);
    try {
      const res = await createStaffMember({
        name: name.trim(),
        email: email.trim(),
        mobile: norm,
        role,
        password: password || undefined,
        pages: role === "admin" ? [] : pages,
      });
      setCreated({
        login: email.trim().toLowerCase(),
        temporaryPassword: res.temporary_password,
        promoted: res.action === "promoted",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await updateStaffMember(member.id, { role, pages: role === "admin" ? [] : pages });
      onDone(`Access updated for ${member.name}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update access.");
    } finally {
      setBusy(false);
    }
  }

  const steps = ["Details", "Access", "Review"] as const;
  const stepIndicator = (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of 3: ${steps[step - 1]}`}>
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step || (isEdit && n === 1);
        const current = n === step;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="h-px w-8 bg-[#E5E5E5] dark:bg-[#2B3644]" />}
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
                done || current ? "bg-[#0176D3] text-white" : "bg-[#F3F3F3] dark:bg-[#171E27] text-[#706E6B] dark:text-[#A8B4C4]"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-[13px] ${current ? "font-semibold text-[#0176D3] dark:text-[#1B96FF]" : mutedCls}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );

  const accessSection = (
    <div className="space-y-4">
      <h3 className="text-[15px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Choose role &amp; access</h3>
      <div>
        <label className={labelCls} htmlFor="staff-role">Role</label>
        <select
          id="staff-role"
          ref={(el) => {
            if (step === 2) firstRef.current = el;
          }}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputCls}
        >
          {ROLE_META.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className={`mt-1 text-[12px] ${mutedCls}`}>{roleDescription(role)}</p>
        <p className={`mt-1 text-[12px] ${mutedCls}`}>
          Pages control what this account can open. Admin is unrestricted; every other role needs at least one page.
        </p>
      </div>
      {role === "admin" ? (
        <p className="rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27] px-3 py-2 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
          Admins have access to all pages.
        </p>
      ) : (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className={labelCls} htmlFor="staff-page-search">
              Allowed pages
            </label>
            <span className={`text-[12px] ${mutedCls}`}>{pages.length} selected</span>
          </div>
          <p className={`mb-2 text-[12px] ${mutedCls}`}>Select at least one page for this account.</p>
          {isEdit && memberWasUnrestricted && member?.role !== "admin" && (
            <p className="mb-2 rounded border border-[#F5C97B] bg-[#FFF8E6] dark:bg-[#2A2110] px-3 py-2 text-[12px] text-[#181818] dark:text-[#EDF2F7]">
              This account currently has access to all pages. Choosing pages below will restrict it to those pages.
            </p>
          )}
          <div className="relative mb-2">
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#706E6B]">⌕</span>
            <input
              id="staff-page-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page"
              autoComplete="off"
              className={`${inputCls} pl-8`}
            />
          </div>
          {visibleGroups.length === 0 && <p className={`text-[13px] ${mutedCls}`}>No pages match “{query.trim()}”.</p>}
          <div className="space-y-2">
            {visibleGroups.map((g) => {
              const hrefs = g.pages.map((p) => p.href);
              const selected = hrefs.filter((h) => pages.includes(h)).length;
              const all = selected === hrefs.length && hrefs.length > 0;
              const some = selected > 0 && !all;
              const open = !!q || expanded.has(g.key);
              return (
                <div key={g.key} className="rounded border border-[#E5E5E5] dark:border-[#2B3644] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${g.label} pages`}
                      checked={all}
                      ref={(el) => {
                        if (el) el.indeterminate = some;
                      }}
                      onChange={() => toggleGroup(g.key)}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(g.key)}
                      aria-expanded={open}
                      className="flex flex-1 items-center justify-between gap-2 text-left"
                    >
                      <span className="text-[13px] font-semibold text-[#181818] dark:text-[#EDF2F7]">{g.label}</span>
                      <span className={`text-[12px] ${mutedCls}`}>
                        {selected}/{hrefs.length} {open ? "▴" : "▾"}
                      </span>
                    </button>
                  </div>
                  {open && (
                    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 border-l border-dashed border-[#E5E5E5] dark:border-[#2B3644] pl-4 sm:grid-cols-2">
                      {g.pages.map((p) => (
                        <label key={p.href} className="flex items-center gap-2 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                          <input type="checkbox" checked={pages.includes(p.href)} onChange={() => togglePage(p.href)} />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const reviewPages =
    role === "admin" ? (
      <p>All pages</p>
    ) : (
      <div className="space-y-1">
        {PAGE_GROUPS.filter((g) => g.pages.some((p) => pages.includes(p.href))).map((g) => (
          <p key={g.key}>
            <span className="font-semibold">{g.label}: </span>
            {g.pages.filter((p) => pages.includes(p.href)).map((p) => p.label).join(", ")}
          </p>
        ))}
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-drawer-title"
        className="flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-white dark:bg-[#10151C] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E5E5] dark:border-[#2B3644] px-5 py-4">
          <div>
            <h2 id="staff-drawer-title" className="text-[20px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
              {isEdit ? "Edit access" : "Add staff"}
            </h2>
            <p className={`mt-0.5 text-[13px] ${mutedCls}`}>
              {isEdit
                ? `Change the role and page access for ${member?.name ?? "this staff member"}.`
                : "Set up an account and choose page access."}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded p-1 text-[18px] text-[#706E6B] hover:bg-[#F3F3F3] dark:hover:bg-[#171E27]">
            ✕
          </button>
        </div>

        {created ? (
          <div className="space-y-3 px-5 py-4">
            <p className="text-[14px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
              {created.promoted ? "Existing account promoted." : "Account created."}
            </p>
            <p className="text-[13px] text-[#181818] dark:text-[#EDF2F7]">
              Login: <span className="font-mono break-all">{created.login}</span>
            </p>
            {created.temporaryPassword ? (
              <div className="rounded border border-[#C5DDF7] bg-[#EAF5FE] dark:border-[#1F4A74] dark:bg-[#0F2A45] px-3 py-2">
                <p className="text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                  Temporary password: <span className="font-mono break-all font-semibold">{created.temporaryPassword}</span>
                </p>
                <p className={`mt-1 text-[12px] ${mutedCls}`}>Shown once, share securely. They will be asked to change it on sign-in.</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(created.temporaryPassword ?? "");
                      setCopied(true);
                    } catch {
                      /* clipboard unavailable: the password is visible above */
                    }
                  }}
                  className="terminal-btn mt-2 text-[12px]"
                >
                  {copied ? "Copied" : "Copy password"}
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-[#181818] dark:text-[#EDF2F7]">They can sign in with the password you set.</p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={close} className="terminal-btn-accent">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4">{stepIndicator}</div>
            <div className="flex-1 px-5 py-4">
              {step === 1 &&
                (isEdit ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                      <span className="font-semibold">{member?.name}</span> · <span className="break-all">{member?.email}</span>
                    </p>
                    <p className={`text-[13px] ${mutedCls}`}>
                      Name and email cannot be changed here — the staff API does not support name or email changes.
                    </p>
                    <p className={`text-[13px] ${mutedCls}`}>Current role: {roleLabel(member?.role ?? "")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls} htmlFor="staff-name">Full name</label>
                      <input
                        id="staff-name"
                        ref={(el) => {
                          if (step === 1) firstRef.current = el;
                        }}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputCls}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="staff-email">Email / username</label>
                      <input
                        id="staff-email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputCls}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="staff-mobile">Mobile (optional)</label>
                      <input
                        id="staff-mobile"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="9876543210"
                        inputMode="tel"
                        autoComplete="off"
                        className={inputCls}
                      />
                      <p className={`mt-1 text-[12px] ${mutedCls}`}>10-digit Indian mobile number, if given.</p>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="staff-password">Password (optional)</label>
                      <input
                        id="staff-password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Blank = a temporary password is generated"
                        className={inputCls}
                      />
                    </div>
                  </div>
                ))}
              {step === 2 && accessSection}
              {step === 3 && (
                <div className="space-y-3 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                  <h3 className="text-[15px] font-semibold">Review account</h3>
                  {isEdit ? (
                    <p>
                      <span className="font-semibold">{member?.name}</span> · <span className="break-all">{member?.email}</span>
                    </p>
                  ) : (
                    <>
                      <p>
                        <span className="font-semibold">Name: </span>
                        {name.trim()}
                      </p>
                      <p>
                        <span className="font-semibold">Email / username: </span>
                        <span className="break-all">{email.trim().toLowerCase()}</span>
                      </p>
                      <p>
                        <span className="font-semibold">Mobile: </span>
                        {normaliseMobile(mobile) || "Not given"}
                      </p>
                      <p>
                        <span className="font-semibold">Password: </span>
                        {password ? "Password you set" : "Temporary password will be generated"}
                      </p>
                    </>
                  )}
                  <p>
                    <span className="font-semibold">Role: </span>
                    {roleLabel(role)} — {roleDescription(role)}
                  </p>
                  <div>
                    <span className="font-semibold">Allowed pages: </span>
                    {reviewPages}
                  </div>
                  {isEdit && memberWasUnrestricted && member?.role !== "admin" && role !== "admin" && (
                    <p className="rounded border border-[#F5C97B] bg-[#FFF8E6] dark:bg-[#2A2110] px-3 py-2 text-[12px]">
                      This will change this account from access to all pages to only the pages listed above.
                    </p>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="mt-3 text-[13px] font-medium text-rose-700 dark:text-rose-300">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-[#E5E5E5] dark:border-[#2B3644] px-5 py-3">
              <button type="button" onClick={close} className="text-[13px] font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline">
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                  disabled={step === 1}
                  className="terminal-btn disabled:opacity-50"
                >
                  Back
                </button>
                {step === 1 && (
                  <button type="button" onClick={goDetailsNext} className="terminal-btn-accent">
                    Continue
                  </button>
                )}
                {step === 2 && (
                  <button type="button" onClick={() => setStep(3)} disabled={needsPages} className="terminal-btn-accent disabled:opacity-50">
                    Review account
                  </button>
                )}
                {step === 3 && (
                  <button
                    type="button"
                    onClick={isEdit ? submitEdit : submitCreate}
                    disabled={busy || (isEdit && editUnchanged)}
                    className="terminal-btn-accent disabled:opacity-50"
                  >
                    {busy ? "Saving…" : isEdit ? "Save changes" : "Create account"}
                  </button>
                )}
              </div>
            </div>
            {step === 2 && needsPages && (
              <p className="border-t border-[#E5E5E5] dark:border-[#2B3644] px-5 py-2 text-right text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                Choose at least one page to continue.
              </p>
            )}
            {step === 3 && isEdit && editUnchanged && (
              <p className="border-t border-[#E5E5E5] dark:border-[#2B3644] px-5 py-2 text-right text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                No changes to save yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A member's pages as grouped labels, or "All pages". */
export function accessSummary(member: StaffMemberItem): string {
  if (hasAllPages(member.role, member.pages)) return "All pages";
  return (member.pages ?? []).map((h) => {
    for (const g of PAGE_GROUPS) {
      const f = g.pages.find((p) => p.href === h);
      if (f) return f.label;
    }
    return h;
  }).join(", ");
}
