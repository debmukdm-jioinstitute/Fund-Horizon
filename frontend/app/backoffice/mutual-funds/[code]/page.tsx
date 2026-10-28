"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import FundDetailPage from "@/components/backoffice/FundDetailPage";
import { getMfScreener, mfRowToItem, type MutualFundItem } from "@/lib/backoffice";

function Detail() {
  const { code } = useParams<{ code: string }>();
  const sp = useSearchParams();
  // The screener sends the row in ?s= so the page opens at once; a bare link (e.g. from a manager's fund list) looks the fund up by code.
  const passed = useMemo(() => {
    try {
      return JSON.parse(sp.get("s") ?? "") as MutualFundItem;
    } catch {
      return null;
    }
  }, [sp]);
  const [looked, setLooked] = useState<MutualFundItem | null | undefined>(passed ? null : undefined);
  useEffect(() => {
    if (passed) return;
    let off = false;
    getMfScreener({ category: [], plan: [], search: code, sort: "fh_score", order: "desc", ranges: {}, limit: 5 })
      .then((r) => { const row = r.data.find((x) => x.code === code); if (!off) setLooked(row ? { ...mfRowToItem(row), fh_status: row.fh_status } as MutualFundItem : null); })
      .catch(() => !off && setLooked(null));
    return () => { off = true; };
  }, [passed, code]);

  const scheme = passed ?? looked;
  if (scheme === undefined) return <p className="p-6 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Loading fund…</p>;
  return <FundDetailPage scheme={scheme ?? ({ scheme_code: code, scheme_name: code } as MutualFundItem)} />;
}

export default function MutualFundDetailPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}
