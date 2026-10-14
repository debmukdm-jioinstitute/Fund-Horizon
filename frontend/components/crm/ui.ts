// Shared class strings for the Phase 3 CRM components (light + dark, same palette as the rest of the terminal).
export const cardCls = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4";
export const mutedCls = "text-[#536176] dark:text-[#A8B4C4]";
export const inputCls =
  "w-full px-2.5 py-1.5 text-xs rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]";
export const btnCls = "px-3 py-1.5 text-xs font-bold rounded bg-[#006F64] text-white hover:opacity-90 disabled:opacity-50";
export const ghostBtnCls =
  "px-3 py-1.5 text-xs font-semibold rounded border border-[#E4E9EF] dark:border-[#2B3644] text-[#172033] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733] disabled:opacity-50";
export const errCls = "text-xs font-medium text-rose-700 dark:text-rose-300";
export const headCls = "text-sm font-bold text-[#172033] dark:text-[#EDF2F7]";
export const thCls = "px-2 py-1.5 font-semibold text-left whitespace-nowrap text-[#536176] dark:text-[#A8B4C4]";
export const tdCls = "px-2 py-1.5 text-[#172033] dark:text-[#EDF2F7]";

export const rupees = (paise: number | null | undefined): string =>
  paise == null ? "—" : "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: paise % 100 === 0 ? 0 : 2 });

/** ₹ typed by a person → integer paise (null for blank/invalid). */
export const toPaise = (v: string): number | null => {
  const n = Number(v.replace(/[,₹\s]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
};

export const tierTone: Record<string, string> = {
  platinum: "bg-[#E8E4F8] text-[#40307A] dark:bg-[#2C2750] dark:text-[#CFC7FF]",
  gold: "bg-[#FFF1D6] text-[#8A5A00] dark:bg-[#40300E] dark:text-[#FFD27A]",
  silver: "bg-[#EEF2F6] text-[#3A4658] dark:bg-[#24303E] dark:text-[#CBD5E1]",
  standard: "bg-[#EEF2F6] text-[#536176] dark:bg-[#1B2430] dark:text-[#A8B4C4]",
};
