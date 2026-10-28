// Original hand-drawn-style SVG illustrations for the Varsity modules.
// Every shape here is drawn in this file; nothing is copied, traced or
// hotlinked from Zerodha or any other site, and no stock photos are used.
// Module level only: there is deliberately no per-chapter artwork.

import React from "react";

function Svg(props: { label: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 200 120"
      width="200"
      height="120"
      role="img"
      aria-label={props.label}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      {props.children}
    </svg>
  );
}

const INK = "#334155";
const BLUE = "#2563eb";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED = "#dc2626";

export const VARSITY_ILLUSTRATIONS: Record<string, React.ReactNode> = {
  "introduction-to-stock-markets": (
    <Svg label="Sketch: rising bars and a sun, for a first look at markets">
      <rect x="30" y="70" width="22" height="30" fill={BLUE} opacity="0.7" />
      <rect x="60" y="55" width="22" height="45" fill={BLUE} opacity="0.7" />
      <rect x="90" y="40" width="22" height="60" fill={GREEN} opacity="0.8" />
      <rect x="120" y="25" width="22" height="75" fill={GREEN} />
      <polyline points="20,100 60,78 95,60 130,42 175,18" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="168" cy="20" r="10" fill={AMBER} opacity="0.6" />
    </Svg>
  ),  "fundamental-analysis": (
    <Svg label="Sketch: a balance scale">
      <line x1="100" y1="10" x2="100" y2="95" stroke={INK} strokeWidth="3" />
      <line x1="45" y1="35" x2="155" y2="35" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M45 35 Q60 85 75 85 Q90 85 75 35" fill="none" stroke={BLUE} strokeWidth="2" />
      <path d="M125 35 Q140 85 155 85 Q170 85 155 35" fill="none" stroke={BLUE} strokeWidth="2" transform="translate(-30,0)" />
      <line x1="60" y1="95" x2="140" y2="95" stroke={INK} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  ),  "markets-and-taxation": (
    <Svg label="Sketch: a calculator">
      <rect x="55" y="10" width="90" height="100" rx="8" fill="none" stroke={INK} strokeWidth="3" />
      <rect x="67" y="22" width="66" height="22" fill={BLUE} opacity="0.2" />
      <rect x="67" y="54" width="16" height="14" fill={INK} opacity="0.5" />
      <rect x="89" y="54" width="16" height="14" fill={INK} opacity="0.5" />
      <rect x="111" y="54" width="16" height="14" fill={INK} opacity="0.5" />
      <rect x="67" y="76" width="16" height="14" fill={INK} opacity="0.5" />
      <rect x="89" y="76" width="16" height="14" fill={INK} opacity="0.5" />
      <rect x="111" y="76" width="16" height="14" fill={GREEN} />
    </Svg>
  ),  "personal-finance-mutual-funds": (
    <Svg label="Sketch: a pie chart for a fund portfolio">
      <path d="M100 60 L100 15 A45 45 0 0 1 139 83 Z" fill={BLUE} opacity="0.8" />
      <path d="M100 60 L139 83 A45 45 0 0 1 75 98 Z" fill={GREEN} opacity="0.8" />
      <path d="M100 60 L75 98 A45 45 0 0 1 100 15 Z" fill={AMBER} opacity="0.8" />
      <circle cx="100" cy="60" r="8" fill="#fff" stroke={INK} strokeWidth="2" />
    </Svg>
  ),  "integrated-financial-modelling": (
    <Svg label="Sketch: a spreadsheet grid with a rising line">
      <rect x="20" y="15" width="160" height="90" fill="none" stroke={INK} strokeWidth="2" />
      <line x1="73" y1="15" x2="73" y2="105" stroke={INK} strokeWidth="1" opacity="0.5" />
      <line x1="126" y1="15" x2="126" y2="105" stroke={INK} strokeWidth="1" opacity="0.5" />
      <line x1="20" y1="45" x2="180" y2="45" stroke={INK} strokeWidth="1" opacity="0.5" />
      <line x1="20" y1="75" x2="180" y2="75" stroke={INK} strokeWidth="1" opacity="0.5" />
      <polyline points="25,95 70,80 115,65 175,30" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  ),  "personal-finance-insurance": (
    <Svg label="Sketch: an umbrella, for insurance cover">
      <path d="M30 70 Q30 20 100 20 Q170 20 170 70 Q135 55 100 70 Q65 55 30 70 Z" fill={BLUE} opacity="0.75" />
      <path d="M100 70 L100 105 Q100 112 92 112" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="70" x2="170" y2="70" stroke={INK} strokeWidth="2" />
    </Svg>
  ),  "sector-analysis": (
    <Svg label="Sketch: buildings of different heights, for sectors">
      <rect x="25" y="60" width="26" height="45" fill={BLUE} opacity="0.7" />
      <rect x="60" y="40" width="26" height="65" fill={GREEN} opacity="0.7" />
      <rect x="95" y="55" width="26" height="50" fill={AMBER} opacity="0.7" />
      <rect x="130" y="30" width="26" height="75" fill={BLUE} opacity="0.7" />
      <rect x="165" y="70" width="10" height="35" fill={INK} opacity="0.5" />
      <line x1="15" y1="105" x2="185" y2="105" stroke={INK} strokeWidth="2" />
    </Svg>
  ),  "nps-national-pension-system": (
    <Svg label="Sketch: a clock with a timeline, for retirement saving">
      <circle cx="70" cy="60" r="34" fill="none" stroke={INK} strokeWidth="3" />
      <line x1="70" y1="60" x2="70" y2="34" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <line x1="70" y1="60" x2="90" y2="72" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <line x1="125" y1="90" x2="185" y2="90" stroke={INK} strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="130" cy="90" r="4" fill={BLUE} />
      <circle cx="155" cy="90" r="4" fill={BLUE} />
      <circle cx="180" cy="90" r="4" fill={GREEN} />
    </Svg>
  ),
};
