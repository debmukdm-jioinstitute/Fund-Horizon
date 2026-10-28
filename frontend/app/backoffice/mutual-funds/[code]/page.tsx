"use client";

import { Suspense, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import MutualFundDrawer from "@/components/backoffice/MutualFundDrawer";
import type { MutualFundItem } from "@/lib/backoffice";

function FundDetail() {
  const { code } = useParams<{ code: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const scheme = useMemo<MutualFundItem>(() => {
    try {
      return JSON.parse(sp.get("s") ?? "") as MutualFundItem;
    } catch {
      return { scheme_code: code, scheme_name: code } as MutualFundItem;
    }
  }, [sp, code]);
  // window.close only works for script-opened tabs; fall back to the list.
  const onClose = () => {
    window.close();
    router.push("/backoffice/mutual-funds");
  };
  return <MutualFundDrawer scheme={scheme} onClose={onClose} />;
}

export default function MutualFundDetailPage() {
  return (
    <Suspense fallback={null}>
      <FundDetail />
    </Suspense>
  );
}
