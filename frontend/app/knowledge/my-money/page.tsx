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

      <h2 className={h2}>What you can add</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li><b>Income:</b> salary, business, rent, anything monthly.</li>
        <li><b>Expense:</b> each monthly cost with a category (Food, Home, Travel). Add the due day to see it under &quot;Coming up&quot;.</li>
        <li><b>Loan / card due:</b> balance, EMI, yearly interest rate and due day.</li>
        <li><b>Savings:</b> tick &quot;Cash or savings account&quot; for your emergency fund.</li>
        <li><b>Goal:</b> a target amount, such as a house or education.</li>
      </ul>

      <h2 className={h2}>What you see</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>Monthly income, spending, EMIs and what is left over.</li>
        <li>Interest you pay in a year (simple: balance times rate, not a repayment schedule).</li>
        <li>How many months of outgo your emergency fund covers.</li>
        <li>Warnings: spending above income, EMIs over 40% of income, debt at 18% or more, an emergency fund under 3 months.</li>
        <li>&quot;Tell us more&quot;: the facts still missing, so answers get better as you add them.</li>
        <li>&quot;Coming up&quot;: the next payments by due day.</li>
      </ul>

      <h2 className={h2}>Ask about your money</h2>
      <p className={p}>
        Type a question such as &quot;Where is my money going?&quot; or &quot;Can I afford a bigger EMI?&quot;. The answer uses only the numbers you entered.
        If the AI quotes a figure we did not calculate, Fund Horizon shows the plain calculated summary instead. If something needed is missing, you are asked for it first.
      </p>

      <h2 className={h2}>Privacy and limits</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>Only you and Fund Horizon staff serving your account can see your entries. You can remove any entry at any time. Up to 100 entries.</li>
        <li>Staff using Claude can read a summary of your entries (the <code>finance_summary</code> tool) to help you; see <Link className="underline" href="/knowledge/mcp-setup">Fund Horizon inside Claude</Link>.</li>
        <li>This is education, not investment advice, and the figures are only as good as what you enter.</li>
      </ul>
    </article>
  );
}
