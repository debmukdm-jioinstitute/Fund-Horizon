import { redirect } from "next/navigation";

export default function BriefingsRedirectPage() {
  redirect("/backoffice/research?tab=briefing");
}
