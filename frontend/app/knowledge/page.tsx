import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Knowledge base",
  description: "Guides for using Fund Horizon: connecting it to Claude (MCP) and reading the data correctly.",
};

const ARTICLES = [
  { href: "/knowledge/mcp-setup", title: "Connect Fund Horizon to Claude (MCP)", body: "Create a personal token, connect Claude, and use PMS, mutual fund, valuation and form tools from a chat. Step by step." },
  { href: "/knowledge/my-money", title: "My money: your personal finance in Fund Horizon", body: "Enter your income, spending, loans and savings, see where your money goes, and ask questions. Nothing is linked to your bank." },
  { href: "/knowledge/data-guide", title: "Reading the data: why a value is empty", body: "What 'Not launched', 'Part year', '< 5Y record' and 'No data' mean, which source each number comes from, and how fresh it is." },
];

export default function KnowledgeBase() {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-[#181818] dark:text-[#EDF2F7]">Knowledge base</h1>
      <p className="mt-1 text-[14px] text-[#536176] dark:text-[#A8B4C4]">How to get the most out of Fund Horizon, in plain steps.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {ARTICLES.map((a) => (
          <Link key={a.href} href={a.href} className="rounded-lg border border-[#E5E5E5] bg-white p-4 transition hover:border-[#006F64] dark:border-[#2B3644] dark:bg-[#10151C]">
            <h2 className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7]">{a.title}</h2>
            <p className="mt-1 text-[13px] text-[#536176] dark:text-[#A8B4C4]">{a.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
