// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "light" | "dark";
  showText?: boolean;
  showSubtitle?: boolean;
  showBadge?: boolean;
  href?: string;
  className?: string;
}

export default function Logo({
  size = "md",
  variant = "light",
  showText = true,
  showSubtitle = false,
  showBadge = false,
  href = "/",
  className = "",
}: LogoProps) {
  const sizeMap = {
    sm: {
      emblem: "h-7 w-7 rounded-lg text-xs",
      fontTitle: "text-base",
      fontSub: "text-[9px]",
      dot: "h-1.5 w-1.5 -top-0.5 -right-0.5",
      gap: "gap-2",
    },
    md: {
      emblem: "h-9 w-9 rounded-xl text-sm",
      fontTitle: "text-lg",
      fontSub: "text-[10px]",
      dot: "h-2 w-2 -top-0.5 -right-0.5",
      gap: "gap-2.5",
    },
    lg: {
      emblem: "h-11 w-11 rounded-2xl text-base",
      fontTitle: "text-xl",
      fontSub: "text-xs",
      dot: "h-2.5 w-2.5 -top-0.5 -right-0.5",
      gap: "gap-3",
    },
    xl: {
      emblem: "h-14 w-14 rounded-2xl text-xl",
      fontTitle: "text-2xl",
      fontSub: "text-xs",
      dot: "h-3 w-3 -top-1 -right-1",
      gap: "gap-3.5",
    },
  }[size];

  const content = (
    <div className={`inline-flex items-center ${sizeMap.gap} ${className}`}>
      {/* 3D Glass Emblem with Horizon Beacon */}
      <div className="relative group/emblem shrink-0">
        {/* Ambient Gradient Glow */}
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-300 opacity-60 blur-md transition-all duration-300 group-hover/emblem:opacity-100 group-hover/emblem:blur-lg" />
        
        {/* Emblem Body */}
        <div
          className={`relative flex ${sizeMap.emblem} items-center justify-center font-extrabold tracking-tight border shadow-3d-btn transition-transform duration-200 group-hover/emblem:scale-105 active:scale-95 overflow-hidden ${
            variant === "dark"
              ? "bg-gradient-to-br from-navy-900 via-navy-950 to-[#030d1a] border-teal-500/40 text-teal-300"
              : "bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 border-teal-500/30 text-teal-400"
          }`}
        >
          {/* Subtle Horizon Arc Background */}
          <div className="absolute -bottom-2 -left-2 -right-2 h-4 rounded-full bg-teal-500/20 blur-[2px]" />
          
          {/* Monogram */}
          <span className="relative z-10 font-display font-black tracking-tighter">
            FH
          </span>

          {/* Glowing Horizon Star / Beacon */}
          <span className={`absolute ${sizeMap.dot} flex`}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-full w-full bg-teal-400 shadow-glow-teal" />
          </span>
        </div>
      </div>

      {/* Brand Text */}
      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span
              className={`font-display font-extrabold tracking-tight leading-none ${sizeMap.fontTitle} ${
                variant === "dark" ? "text-white" : "text-navy-950"
              }`}
            >
              Fund Horizon
            </span>
            {showBadge && (
              <span className="rounded-full bg-teal-50 border border-teal-200/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-800">
                ARN 345439
              </span>
            )}
          </div>
          {showSubtitle && (
            <span
              className={`font-medium tracking-wider uppercase mt-1 ${sizeMap.fontSub} ${
                variant === "dark" ? "text-teal-400" : "text-slate-500"
              }`}
            >
              Mutual Fund Distributor
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-block transition-opacity hover:opacity-95">
        {content}
      </Link>
    );
  }

  return content;
}
