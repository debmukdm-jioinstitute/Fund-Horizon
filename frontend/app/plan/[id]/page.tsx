// TODO(owner-compliance-review): this file contains user-facing copy.

import { notFound } from "next/navigation";
import { getPlanServer } from "@/lib/api";
import PlanView from "./PlanView";

export default async function PlanPage({ params }: { params: { id: string } }) {
  const plan = await getPlanServer(params.id);
  if (!plan) {
    notFound();
  }

  return <PlanView initialPlan={plan} id={params.id} />;
}
