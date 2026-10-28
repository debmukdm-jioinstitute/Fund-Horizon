"use client";

import { Suspense, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import FundDetailPage from "@/components/backoffice/FundDetailPage";
import type { MutualFundItem } from "@/lib/backoffice";

function Detail() {
  const { code } = useParams<{ code: string }>();
  const sp = useSearchParams();
  // The screener sends the row in ?s= so the page opens with name, NAV and fees at once; a bare code still works.
  const scheme = useMemo(() => {
    try {
      return JSON.parse(sp.get("s") ?? "") as MutualFundItem;
    } catch {
      return { scheme_code: code, scheme_name: code } as MutualFundItem;
    }
  }, [sp, code]);
  return <FundDetailPage scheme={scheme} />;
}

export default function MutualFundDetailPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}
