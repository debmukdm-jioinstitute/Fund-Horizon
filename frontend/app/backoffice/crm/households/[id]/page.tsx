"use client";

import { useParams } from "next/navigation";
import RecordPage from "@/components/crm/RecordPage";

export default function HouseholdsRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage kind="households" id={id} />;
}
