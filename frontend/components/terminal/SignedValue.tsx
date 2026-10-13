"use client";

import React from "react";
import { formatNumber } from "@/lib/terminal-format";

interface SignedValueProps {
  value?: number | null;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  unit?: string;
  isPercent?: boolean;
  isBps?: boolean;
  showPlus?: boolean;
  neutral?: boolean; // When true, value is rendered in neutral color even if non-zero
  className?: string;
}

export const SignedValue: React.FC<SignedValueProps> = ({
  value,
  decimals = 2,
  suffix = "",
  prefix = "",
  unit = "",
  isPercent = false,
  isBps = false,
  showPlus = true,
  neutral = false,
  className = "",
}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return (
      <span className={`text-[#536176] dark:text-[#A8B4C4] font-normal ${className}`} title="Data not available">
        —
      </span>
    );
  }

  const resolvedSuffix = isPercent
    ? "%"
    : isBps
    ? " bps"
    : unit
    ? unit === "%" || unit.startsWith(" ")
      ? unit
      : ` ${unit}`
    : suffix;

  const isZero = Math.abs(value) < 1e-7;

  let colorClass = "text-[#172033] dark:text-[#EDF2F7]";
  if (!neutral && !isZero) {
    if (value > 0) {
      colorClass = "text-[#087744] dark:text-[#58D6A0]";
    } else {
      colorClass = "text-[#B42332] dark:text-[#FF7D86]";
    }
  }

  const signChar = !isZero && value > 0 && showPlus ? "+" : !isZero && value < 0 ? "−" : "";
  const formattedAbs = formatNumber(Math.abs(value), decimals);

  return (
    <span className={`font-medium tabular-nums ${colorClass} ${className}`}>
      {prefix}
      {signChar}
      {formattedAbs}
      {resolvedSuffix}
    </span>
  );
};

export default SignedValue;
