import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Reading the data", description: "Why a value is empty, and where each Fund Horizon number comes from." };

const h2 = "mt-8 text-[18px] font-semibold text-[#181818] dark:text-[#EDF2F7]";
const p = "mt-2 text-[14px] leading-relaxed text-[#374151] dark:text-[#C7D0DC]";

export default function DataGuide() {
  return (
    <article className="mx-auto max-w-[800px] px-4 py-10 sm:px-6">
      <Link href="/knowledge" className="text-[12px] text-[#536176] underline dark:text-[#A8B4C4]">Knowledge base</Link>
      <h1 className="mt-2 text-2xl font-bold text-[#181818] dark:text-[#EDF2F7]">Reading the data: why a value is empty</h1>
      <p className={p}>Fund Horizon never fills a gap with an estimate. An empty value always has a reason, and the reason is shown on the cell (hover it).</p>

      <h2 className={h2}>Empty labels</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li><b>&lt; 1Y / 3Y / 5Y / 10Y record</b>: the fund is younger than the period the metric needs.</li>
        <li><b>Not launched</b> (quartile table): the fund launched after that calendar year.</li>
        <li><b>Part year</b>: the fund launched during that year. Advisorkhoj ranks full calendar years only.</li>
        <li><b>No data</b>: the fund existed, but the source did not publish a value (renamed or merged scheme, too few peers, or not reported).</li>
        <li><b>Direct plan quartiles</b>: Advisorkhoj publishes none. Quartiles are Regular-plan only.</li>
        <li><b>PMS returns</b>: shown only when the manager disclosed them to APMI in the monthly filing.</li>
      </ul>

      <h2 className={h2}>Where numbers come from</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li>Mutual fund NAV, AUM and expense ratios: AMFI.</li>
        <li>PMS strategies, returns and AUM: APMI monthly disclosures. The page shows the newest complete month; a partly loaded month is skipped until it fills.</li>
        <li>Quartile rankings: Advisorkhoj, cached for 24 hours.</li>
        <li>FH score, rating and signal: computed by Fund Horizon from those sources. The breakdown of every score is available on the fund.</li>
      </ul>

      <h2 className={h2}>Freshness</h2>
      <p className={p}>Every table shows its as-on date. The Data health page in the backoffice lists the last successful refresh of every source.</p>
      <p className={p}>Fund Horizon data is for research and distribution operations. It is not investment advice, and past performance does not indicate future returns.</p>
    </article>
  );
}
