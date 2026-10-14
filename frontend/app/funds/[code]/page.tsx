// TODO(owner-compliance-review): this file contains user-facing copy.
import { AmcName } from "@/components/BrandLogo";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundAnalyticsServer, getFundDetailServer } from "@/lib/api";
import { CATEGORY_LABELS, pct } from "@/lib/format";
import ExplainModal from "@/components/ExplainModal";
import {
  CaptureRatioBarChart,
  NavChart,
  RollingDistributionCard,
} from "@/components/FundCharts";
import InfoTip from "@/components/InfoTip";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const detail = await getFundDetailServer(code);
  if (!detail) {
    return { title: "Scheme Not Found · Fund Horizon" };
  }
  return {
    title: `${detail.scheme_name} · Scheme Analytics · Fund Horizon`,
    description: `Historical metrics, rolling returns, risk indicators, and capture ratios for ${detail.scheme_name}. Regular plan distributed under ARN 345439.`,
  };
}

export default async function FundDetailPage({ params }: PageProps) {
  const { code } = await params;
  const [detail, analytics] = await Promise.all([
    getFundDetailServer(code),
    getFundAnalyticsServer(code),
  ]);

  if (!detail || !analytics) {
    notFound();
  }

  const ret = analytics.returns;
  const risk = analytics.risk;
  const rolling = analytics.rolling_returns;
  const dd = risk.drawdown_duration;
  const mfMeta = {
    source: "AMFI / MFAPI",
    fetched_at: analytics.last_nav_date,
    source_url: "https://www.amfiindia.com",
  };

  return (
    <div className="w-full space-y-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-xs text-navy-700">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <span className="text-navy-900 font-medium">{detail.scheme_name}</span>
          </li>
        </ol>
      </nav>

      {/* Scheme Header */}
      <header className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
                {CATEGORY_LABELS[detail.cat] ?? detail.category}
              </span>
              <span className="rounded bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-800">
                Regular Plan · Growth
              </span>
              <span className="text-xs text-navy-700">Code: {detail.scheme_code}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
              {detail.scheme_name}
            </h1>
            <p className="mt-1 text-sm text-navy-700">
              AMC: <AmcName amc={detail.amc} className="h-10 min-w-10" /> · Data as of{" "}
              {analytics.last_nav_date}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExplainModal
              buttonLabel="Explain Metrics"
              kind="fund"
              schemeCode={detail.scheme_code}
            />
            <Link
              href={`/funds/compare?codes=${detail.scheme_code}`}
              className="rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-navy-800 transition-colors"
            >
              Compare Scheme →
            </Link>
          </div>
        </div>

        {/* Quick Returns Grid */}
        <div className="grid grid-cols-2 gap-3 border-t border-navy-100 pt-3 sm:grid-cols-4">
          <div className="rounded-lg bg-navy-50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-700">1Y Return</p>
              <InfoTip metric="ret_1y" meta={mfMeta} />
            </div>
            <p className="text-lg font-bold text-navy-950 mt-1" data-testid="analytics-cagr-1y">
              {ret.cagr_1y !== null ? pct(ret.cagr_1y) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-navy-50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-700">3Y CAGR</p>
              <InfoTip metric="cagr_3y" meta={mfMeta} />
            </div>
            <p className="text-lg font-bold text-navy-950 mt-1" data-testid="analytics-cagr-3y">
              {ret.cagr_3y !== null ? pct(ret.cagr_3y) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-navy-50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-navy-700">5Y CAGR</p>
              <InfoTip metric="cagr_5y" meta={mfMeta} />
            </div>
            <p className="text-lg font-bold text-navy-950 mt-1" data-testid="analytics-cagr-5y">
              {ret.cagr_5y !== null ? pct(ret.cagr_5y) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-teal-50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-teal-800">SIP XIRR</p>
              <InfoTip metric="sip_xirr" meta={mfMeta} />
            </div>
            <p className="text-lg font-bold text-teal-900 mt-1" data-testid="analytics-sip-xirr">
              {ret.sip_xirr !== null ? pct(ret.sip_xirr) : "—"}
            </p>
          </div>
        </div>
      </header>

      {/* NAV History Chart */}
      <section className="card space-y-4">
        <div className="flex items-center gap-1.5">
          <h2 className="text-lg font-bold text-navy-950">NAV History</h2>
          <InfoTip metric="nav" meta={mfMeta} />
        </div>
        <NavChart navs={detail.nav_monthly} />
      </section>

      {/* Rolling Returns Analysis */}
      <section className="card space-y-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-bold text-navy-950">Rolling Returns Consistency</h2>
            <InfoTip metric="rolling_returns" meta={mfMeta} />
          </div>
          <p className="text-xs text-navy-700 mt-1">
            Rolling returns evaluate real holding period performance across all historical entry dates, avoiding point-to-point end-date bias.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <RollingDistributionCard stats={rolling["1y"]} title="1-Year Rolling" metric="rolling_1y" meta={mfMeta} />
          <RollingDistributionCard stats={rolling["3y"]} title="3-Year Rolling" metric="rolling_3y" meta={mfMeta} />
          <RollingDistributionCard stats={rolling["5y"]} title="5-Year Rolling" metric="rolling_5y" meta={mfMeta} />
        </div>
      </section>

      {/* Risk & Drawdown Profile */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="text-lg font-bold text-navy-950">Risk & Volatility Profile</h2>
          <p className="text-xs text-navy-700">
            Computed over 3-year trailing monthly observations with risk-free rate of 6.5%.
          </p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-navy-100 py-1.5">
              <dt className="text-navy-700 inline-flex items-center gap-1">
                <span>Annualized Volatility (3Y)</span>
                <InfoTip metric="vol_3y" meta={mfMeta} />
              </dt>
              <dd className="font-semibold text-navy-950" data-testid="analytics-vol-3y">
                {risk.annualized_volatility_3y !== null ? pct(risk.annualized_volatility_3y) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-navy-100 py-1.5">
              <dt className="text-navy-700 inline-flex items-center gap-1">
                <span>Sharpe Ratio (3Y)</span>
                <InfoTip metric="sharpe_3y" meta={mfMeta} />
              </dt>
              <dd className="font-semibold text-navy-950">
                {risk.sharpe_3y !== null ? risk.sharpe_3y.toFixed(2) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-navy-100 py-1.5">
              <dt className="text-navy-700 inline-flex items-center gap-1">
                <span>Sortino Ratio (3Y)</span>
                <InfoTip metric="sortino_3y" meta={mfMeta} />
              </dt>
              <dd className="font-semibold text-navy-950">
                {risk.sortino_3y !== null ? risk.sortino_3y.toFixed(2) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-navy-100 py-1.5">
              <dt className="text-navy-700 inline-flex items-center gap-1">
                <span>Max Historical Drawdown</span>
                <InfoTip metric="max_drawdown" meta={mfMeta} />
              </dt>
              <dd className="font-semibold text-rose-700">
                {risk.max_drawdown !== null ? pct(risk.max_drawdown) : "—"}
              </dd>
            </div>
            {dd && (
              <div className="flex justify-between py-1.5">
                <dt className="text-navy-700 inline-flex items-center gap-1">
                  <span>Longest underwater period</span>
                  <InfoTip metric="underwater_period" meta={mfMeta} />
                </dt>
                <dd className="font-medium text-navy-900" data-testid="analytics-underwater">
                  {dd.longest_underwater_months} months
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Capture Ratios */}
        <section className="card space-y-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-bold text-navy-950">Market Capture vs Category</h2>
            <InfoTip metric="up_capture" meta={mfMeta} />
          </div>
          <p className="text-xs text-navy-700">
            Measures participation in up vs down months relative to the category median.
          </p>
          <CaptureRatioBarChart
            upCapture={analytics.capture_ratios.upside_capture}
            downCapture={analytics.capture_ratios.downside_capture}
          />
        </section>
      </div>

      {/* Statutory Disclaimers */}
      <footer className="card bg-navy-50 text-xs text-navy-700 space-y-2">
        <p className="font-semibold text-navy-900">Compliance & Regulatory Disclosures</p>
        <p>{analytics.disclaimer}</p>
        <p>
          Fund Horizon operates as an AMFI-registered Mutual Fund Distributor under ARN 345439. All analytics and metrics are computed deterministically from historical published NAV data and do not represent a guarantee of future outcomes.
        </p>
      </footer>
    </div>
  );
}
