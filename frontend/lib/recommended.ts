"use client";

import { useEffect, useState } from "react";

// Default seed recommendations (matched with backend fh_recommended.py)
export const DEFAULT_MF_RECOMMENDED: Record<string, string> = {
  "108466": "ICICI Prudential Large Cap Fund",
  "101635": "DSP Large Cap Fund",
  "150799": "WhiteOak Capital Large Cap Fund",
  "100349": "ICICI Prudential Large & Mid Cap Fund",
  "106144": "Invesco India Large & Mid Cap Fund",
  "108596": "Bandhan Large & Mid Cap Fund",
  "152856": "Bandhan Nifty Midcap 150 Index Fund",
  "150583": "WhiteOak Capital Mid Cap Fund",
  "145139": "Invesco India Small Cap Fund",
  "106823": "ICICI Prudential Small Cap Fund",
  "146193": "Edelweiss Small Cap Fund",
  "153909": "Helios Small Cap Fund",
  "152072": "WhiteOak Capital Multi Cap Fund",
  "151812": "Mirae Asset Multicap Fund",
  "152095": "Edelweiss Multi Cap Fund",
  "151289": "HSBC Multi Cap Fund",
  "151292": "HSBC Multi Cap Fund",
  "150347": "WhiteOak Capital Flexi Cap Fund",
  "102252": "HSBC Flexi Cap Fund",
  "140355": "Edelweiss Flexi Cap Fund",
  "152136": "Helios Flexi Cap Fund",
  "149766": "Invesco India Flexi Cap Fund",
  "108202": "DSP Natural Resources And New Energy Fund",
  "101262": "Nippon India Power & Infra Fund",
  "148987": "HDFC Banking & Financial Services Fund",
  "152208": "DSP Banking & Financial Services Fund",
  "152053": "DSP Multi Asset Allocation Fund",
  "148459": "Nippon India Multi Asset Allocation Fund",
  "151746": "WhiteOak Capital Multi Asset Allocation Fund",
  "153046": "Invesco India Multi Asset Allocation Fund",
  "152065": "Kotak Multi Asset Allocation Fund",
};

export const DEFAULT_PMS_RECOMMENDED: Record<string, string> = {
  "174": "Stallion Asset Core Fund",
  "781": "ICICI Prudential PMS Value Strategy",
  "606": "Buoyant Opportunities PMS",
  "1193": "Carnelian Capital Compounder Strategy",
  "2512": "Abakkus Emerging Opportunities Approach",
  "731": "360 ONE Multicap PMS",
  "325": "Sundaram S.E.L.F",
  "324": "Sundaram SISOP",
  "327": "Sundaram Rising Star",
};

const MF_STORAGE_KEY = "fh_recommended_mf_map";
const PMS_STORAGE_KEY = "fh_recommended_pms_map";
const EVENT_NAME = "fh-recommended-updated";

// In-memory singletons
let currentMfMap: Record<string, string> = { ...DEFAULT_MF_RECOMMENDED };
let currentPmsMap: Record<string, string> = { ...DEFAULT_PMS_RECOMMENDED };
let initialized = false;

export function initRecommended() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  try {
    const rawMf = localStorage.getItem(MF_STORAGE_KEY);
    if (rawMf) {
      currentMfMap = { ...DEFAULT_MF_RECOMMENDED, ...JSON.parse(rawMf) };
    }
    const rawPms = localStorage.getItem(PMS_STORAGE_KEY);
    if (rawPms) {
      currentPmsMap = { ...DEFAULT_PMS_RECOMMENDED, ...JSON.parse(rawPms) };
    }
  } catch {
    /* fallback to defaults */
  }

  // Also sync with server in background
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api-production-f3147.up.railway.app";
  fetch(`${apiUrl}/api/backoffice/recommended`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;
      if (data.mf && typeof data.mf === "object") {
        currentMfMap = { ...currentMfMap, ...data.mf };
        localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(currentMfMap));
      }
      if (data.pms && typeof data.pms === "object") {
        currentPmsMap = { ...currentPmsMap, ...data.pms };
        localStorage.setItem(PMS_STORAGE_KEY, JSON.stringify(currentPmsMap));
      }
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    })
    .catch(() => {
      /* ignore offline/error */
    });
}

export function getRecommendedMfMap(): Record<string, string> {
  initRecommended();
  return { ...currentMfMap };
}

export function getRecommendedPmsMap(): Record<string, string> {
  initRecommended();
  return { ...currentPmsMap };
}

export function isMfRecommended(code?: unknown): boolean {
  if (!code) return false;
  initRecommended();
  return String(code).trim() in currentMfMap;
}

export function isPmsRecommended(iaId?: unknown): boolean {
  if (!iaId) return false;
  initRecommended();
  return String(iaId).trim() in currentPmsMap;
}

export async function setRecommendedItem(
  kind: "mf" | "pms",
  id: string,
  recommended: boolean,
  name = ""
): Promise<void> {
  initRecommended();
  const cleanId = String(id).trim();
  if (!cleanId) return;

  if (kind === "mf") {
    if (recommended) {
      currentMfMap[cleanId] = name || currentMfMap[cleanId] || `Scheme ${cleanId}`;
    } else {
      delete currentMfMap[cleanId];
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(currentMfMap));
    }
  } else {
    if (recommended) {
      currentPmsMap[cleanId] = name || currentPmsMap[cleanId] || `Strategy ${cleanId}`;
    } else {
      delete currentPmsMap[cleanId];
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(PMS_STORAGE_KEY, JSON.stringify(currentPmsMap));
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }

  // Post to backend API
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api-production-f3147.up.railway.app";
  try {
    await fetch(`${apiUrl}/api/backoffice/recommended`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        kind,
        id: cleanId,
        name,
        recommended,
      }),
    });
  } catch {
    /* saved locally */
  }
}

export function useRecommended() {
  const [, setTick] = useState(0);

  useEffect(() => {
    initRecommended();
    function onUpdate() {
      setTick((t) => t + 1);
    }
    window.addEventListener(EVENT_NAME, onUpdate);
    return () => window.removeEventListener(EVENT_NAME, onUpdate);
  }, []);

  return {
    mfMap: getRecommendedMfMap(),
    pmsMap: getRecommendedPmsMap(),
    isMfRecommended,
    isPmsRecommended,
    toggleMf: (code?: string | null, name?: string) =>
      code ? setRecommendedItem("mf", code, !isMfRecommended(code), name) : Promise.resolve(),
    togglePms: (id?: string | null, name?: string) =>
      id ? setRecommendedItem("pms", id, !isPmsRecommended(id), name) : Promise.resolve(),
    addMf: (code: string, name?: string) => setRecommendedItem("mf", code, true, name),
    removeMf: (code: string) => setRecommendedItem("mf", code, false),
    addPms: (id: string, name?: string) => setRecommendedItem("pms", id, true, name),
    removePms: (id: string) => setRecommendedItem("pms", id, false),
  };
}
