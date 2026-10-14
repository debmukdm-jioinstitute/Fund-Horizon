"use client";

import { useParams } from "next/navigation";
import RecordPage from "@/components/crm/RecordPage";

export default function CasesRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage kind="cases" id={id} />;
}
