"use client";

import React from "react";
import { useParams } from "next/navigation";
import MarketDesk from "@/components/backoffice/MarketDesk";

export default function MarketDeskPage() {
  const params = useParams<{ path?: string[] }>();
  const path = (params.path ?? []).join("/");
  return <MarketDesk path={path} />;
}
