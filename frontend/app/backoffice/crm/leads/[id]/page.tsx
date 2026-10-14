"use client";

import { useParams } from "next/navigation";
import RecordPage from "@/components/crm/RecordPage";

export default function LeadsRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage kind="leads" id={id} />;
}
