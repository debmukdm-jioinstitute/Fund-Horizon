// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "light" | "dark";
  layout?: "horizontal" | "stacked" | "emblem";
  showText?: boolean;
  showSubtitle?: boolean;
  showBadge?: boolean;
  href?: string;
  className?: string;
}

export default function Logo({
  size = "md",
  variant = "light",
  layout = "horizontal",
  showBadge = false,
  href = "/",
  className = "",
}: LogoProps) {
  // Height mapping based on size
  const heightClasses = {
    sm: layout === "stacked" ? "h-14" : "h-10",
    md: layout === "stacked" ? "h-20" : "h-12",
    lg: layout === "stacked" ? "h-28" : "h-16",
    xl: layout === "stacked" ? "h-36" : "h-20",
  }[size];

  // Asset selection
  let src = "/images/logo-horizontal.png";
  if (layout === "emblem") {
    src = "/images/logo-emblem.png";
  } else if (layout === "stacked") {
    src = "/images/logo.png";
  } else if (variant === "dark") {
    src = "/images/logo-horizontal-dark.png";
  }

  const content = (
    <div className={`inline-flex items-center gap-3 ${variant === "dark" ? "rounded-md bg-white px-2 py-1" : ""} ${className}`}>
      {/* Official Brand Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Fund Horizon - Your Future Our Focus"
        className={`${heightClasses} w-auto object-contain transition-transform duration-200 group-hover:scale-[1.02]`}
        loading="eager"
      />

      {showBadge && (
        <span className="rounded-full bg-teal-50 border border-teal-200/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-800">
          ARN 345439
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="group inline-flex items-center transition-opacity hover:opacity-95">
        {content}
      </Link>
    );
  }

  return content;
}
