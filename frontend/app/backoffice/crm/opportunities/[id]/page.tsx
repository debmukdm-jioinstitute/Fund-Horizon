"use client";

import { useParams } from "next/navigation";
import RecordPage from "@/components/crm/RecordPage";

export default function OpportunitiesRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage kind="opportunities" id={id} />;
}
