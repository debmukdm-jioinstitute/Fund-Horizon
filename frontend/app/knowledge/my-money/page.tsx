import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My money: personal finance in Fund Horizon",
  description: "Enter your income, spending, loans and savings, see where your money goes, and ask questions. Nothing is linked to your bank.",
};

const h2 = "mt-10 text-[20px] font-semibold text-[#181818] dark:text-[#EDF2F7]";
const p = "mt-2 text-[16px] leading-relaxed text-[#374151] dark:text-[#C7D0DC]";

export default function MyMoney() {
  return (
    <article className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Link href="/knowledge" className="text-[13px] text-[#536176] underline dark:text-[#A8B4C4]">Knowledge base</Link>
      <h1 className="mt-2 text-3xl font-bold text-[#181818] dark:text-[#EDF2F7]">My money</h1>
      <p className={p}>
        <Link className="underline" href="/account/finance">My money</Link> (in your account) is a private money notebook. You type in what you earn, spend, owe and save.
        Fund Horizon adds it up and answers your questions. It does not connect to your bank and never asks for a bank password.
      </p>

      <h2 className={h2}>Get your numbers in</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li><b>Upload a bank statement (CSV).</b> It needs Date, Description and Debit/Credit (or one signed Amount) columns. Fund Horizon sorts spending into categories and saves monthly averages. A new upload replaces the last one. Check the lines and remove any that look wrong. PDF statements are not read yet.</li>
        <li><b>Or type entries in:</b> income, expense (with an optional due day), loan or card due (balance, EMI, yearly rate), savings (tick cash or savings account for your emergency fund), goal (target, years left, amount already saved), monthly limit for a category, and insurance cover (life or health).</li>
        <li>Anything you already hold with Fund Horizon (mutual fund cost and running SIPs) is added to your net worth automatically.</li>
      </ul>

      <h2 className={h2}>What you see</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>Monthly income, spending, EMIs and what is left over; net worth; and the change since last month.</li>
        <li>Interest you pay in a year (simple: balance times rate) and how many months of outgo your emergency fund covers.</li>
        <li><b>Clearing your loans:</b> months to clear each loan and total interest, highest rate first, plus what paying 10% more each month saves.</li>
        <li><b>Goals:</b> the monthly SIP each goal needs at an illustrative 10% a year, and whether your left-over covers all goals together.</li>
        <li><b>Monthly limits:</b> spent against each limit, with a warning from 80%.</li>
        <li>Warnings: spending above income, EMIs over 40% of income, debt at 18% or more, emergency fund under 3 months, life cover under 10 times yearly income, health cover under ₹5,00,000.</li>
        <li>&quot;Tell us more&quot; (what is still missing) and &quot;Coming up&quot; (next payments by due day).</li>
      </ul>

      <h2 className={h2}>Tools</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li><b>Can I afford a loan?</b> Enter amount, rate and years. You get the EMI, the share of income all EMIs would take, what is left, and a verdict: comfortable (up to 30%), stretch (up to 40%) or too high.</li>
        <li><b>Old or new tax regime?</b> Uses the same tax engine as the <Link className="underline" href="/tax">tax planner</Link> on your yearly gross income.</li>
        <li><b>Ask about your money.</b> Type a question such as &quot;Where is my money going?&quot; or &quot;Which loan should I clear first?&quot;. The answer uses only the numbers above. If the AI quotes a figure we did not calculate, Fund Horizon shows the plain calculated summary instead. If something needed is missing, you are asked for it first.</li>
        <li><b>Monthly report (PDF)</b> with where the money goes, goals and what changed since last month.</li>
        <li><b>Bill calendar (.ics)</b> that repeats every month in Google, Apple or Outlook calendar. Bills due on the 29th to 31st show on the 28th.</li>
        <li><b>Share summary with my advisor</b> sends a short summary to the Fund Horizon team in Messages. Nothing is shared unless you press it.</li>
      </ul>

      <h2 className={h2}>Privacy and limits</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>Only you and Fund Horizon staff serving your account can see your entries. You can remove any entry at any time. Up to 100 entries. Not built yet: automatic bank sync, PDF statements, reminders by email or WhatsApp, and a joint family view.</li>
        <li>Staff using Claude can read a summary of your entries (the <code>finance_summary</code> tool) to help you; see <Link className="underline" href="/knowledge/mcp-setup">Fund Horizon inside Claude</Link>.</li>
        <li>This is education, not investment advice, and the figures are only as good as what you enter.</li>
      </ul>
    </article>
  );
}
