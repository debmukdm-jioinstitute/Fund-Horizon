"use client";

import { useEffect, useState } from "react";
import { fetchOwners, type Owner } from "../../lib/crmListApi";

let ownersPromise: Promise<Owner[]> | null = null;

/** Owners (RMs and admins) are fetched once per page load and shared. */
export function useOwners(): Owner[] {
  const [owners, setOwners] = useState<Owner[]>([]);
  useEffect(() => {
    ownersPromise ??= fetchOwners().catch(() => {
      ownersPromise = null;
      return [];
    });
    let alive = true;
    ownersPromise.then((o) => alive && setOwners(o));
    return () => {
      alive = false;
    };
  }, []);
  return owners;
}

const SWATCHES = ["#006F64", "#1F5FBF", "#8A4FB5", "#B5651D", "#2E7D32", "#B0305C"];

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function OwnerAvatar({ ownerId, showName = true }: { ownerId: string | null | undefined; showName?: boolean }) {
  const owners = useOwners();
  if (!ownerId) return <span className="text-[#536176] dark:text-[#A8B4C4]">Unassigned</span>;
  const owner = owners.find((o) => o.id === ownerId);
  const name = owner?.name ?? "…";
  const swatch = SWATCHES[ownerId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % SWATCHES.length];
  return (
    <span className="inline-flex items-center gap-2" title={name}>
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: swatch }}
      >
        {owner ? initials(name) : ""}
      </span>
      {showName && <span className="truncate">{name}</span>}
    </span>
  );
}
