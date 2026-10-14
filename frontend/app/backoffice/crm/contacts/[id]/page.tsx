"use client";

import { useParams } from "next/navigation";
import RecordPage from "@/components/crm/RecordPage";

export default function ContactRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage kind="contacts" id={id} />;
}
