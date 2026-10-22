from __future__ import annotations
"""Curated "FH Recommended" mutual funds (Regular plan, Growth), keyed by AMFI scheme code.

Only the pick is stored here; every number shown for these funds comes from the live AMFI / mfapi.in feeds.
"""

FH_RECOMMENDED_MF_CODES: dict[str, str] = {
    # Large cap
    "108466": "ICICI Prudential Large Cap Fund",
    "101635": "DSP Large Cap Fund",
    "150799": "WhiteOak Capital Large Cap Fund",
    # Large & mid cap
    "100349": "ICICI Prudential Large & Mid Cap Fund",
    "106144": "Invesco India Large & Mid Cap Fund",
    "108596": "Bandhan Large & Mid Cap Fund",
    # Mid cap
    "152856": "Bandhan Nifty Midcap 150 Index Fund",
    "150583": "WhiteOak Capital Mid Cap Fund",
    # Small cap
    "145139": "Invesco India Small Cap Fund",
    "106823": "ICICI Prudential Small Cap Fund",
    "146193": "Edelweiss Small Cap Fund",
    "153909": "Helios Small Cap Fund",
    # Multi cap
    "152072": "WhiteOak Capital Multi Cap Fund",
    "151812": "Mirae Asset Multicap Fund",
    "152095": "Edelweiss Multi Cap Fund",
    "151289": "HSBC Multi Cap Fund",
    # Flexi cap
    "150347": "WhiteOak Capital Flexi Cap Fund",
    "102252": "HSBC Flexi Cap Fund",
    "140355": "Edelweiss Flexi Cap Fund",
    "152136": "Helios Flexi Cap Fund",
    "149766": "Invesco India Flexi Cap Fund",
    # Sectoral
    "108202": "DSP Natural Resources And New Energy Fund",
    "101262": "Nippon India Power & Infra Fund",
    "148987": "HDFC Banking & Financial Services Fund",
    "152208": "DSP Banking & Financial Services Fund",
    # Multi asset
    "152053": "DSP Multi Asset Allocation Fund",
    "148459": "Nippon India Multi Asset Allocation Fund",
    "151746": "WhiteOak Capital Multi Asset Allocation Fund",
    "153046": "Invesco India Multi Asset Allocation Fund",
    "152065": "Kotak Multi Asset Allocation Fund",
}

# Which publisher's factsheet source covers each curated pick. A pick missing here has no automated source yet
# (360 ONE and Sundaram publish no public factsheet download); the UI says so instead of showing nothing.
MF_FACTSHEET_SOURCE: dict[str, str] = {
    **dict.fromkeys(("108466", "100349", "106823"), "icici_mf"),
    **dict.fromkeys(("101635", "152208", "152053", "108202"), "dsp"),
    **dict.fromkeys(("106144", "145139", "149766", "153046"), "invesco"),
    **dict.fromkeys(("101262", "148459"), "nippon"),
    **dict.fromkeys(("102252", "151289"), "hsbc"),
    "148987": "hdfc",
    "152065": "kotak",
    **dict.fromkeys(("146193", "152095", "140355"), "edelweiss"),
    **dict.fromkeys(("150799", "150583", "152072", "150347", "151746"), "whiteoak"),
    **dict.fromkeys(("108596", "152856"), "bandhan"),
    **dict.fromkeys(("153909", "152136"), "helios"),
    "151812": "mirae",
}
PMS_FACTSHEET_SOURCE: dict[str, str] = {
    "174": "stallion", "2512": "abakkus_pms", "1193": "carnelian_compounder", "781": "icici_pms_value", "606": "buoyant",
}  # keyed by APMI strategy id

# Checked in a real browser: these publishers offer no public factsheet download for the strategy
# (360 ONE and Sundaram show performance on-page only). Distinct from "source not connected yet".
PMS_NO_PUBLIC_FACTSHEET: frozenset[str] = frozenset({"731", "325", "324", "327"})

import json
from pathlib import Path

OVERRIDES_FILE = Path(__file__).resolve().parent.parent / "data" / "recommended_overrides.json"

FH_RECOMMENDED_PMS_IDS: dict[str, str] = {
    "174": "Stallion Asset Core Fund",
    "781": "ICICI Prudential PMS Value Strategy",
    "606": "Buoyant Opportunities PMS",
    "1193": "Carnelian Capital Compounder Strategy",
    "2512": "Abakkus Emerging Opportunities Approach",
    "731": "360 ONE Multicap PMS",
    "325": "Sundaram S.E.L.F",
    "324": "Sundaram SISOP",
    "327": "Sundaram Rising Star",
}

def load_overrides():
    if OVERRIDES_FILE.exists():
        try:
            with open(OVERRIDES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "mf_add" in data and isinstance(data["mf_add"], dict):
                    FH_RECOMMENDED_MF_CODES.update(data["mf_add"])
                if "mf_remove" in data and isinstance(data["mf_remove"], list):
                    for k in data["mf_remove"]:
                        FH_RECOMMENDED_MF_CODES.pop(str(k), None)
                if "pms_add" in data and isinstance(data["pms_add"], dict):
                    FH_RECOMMENDED_PMS_IDS.update(data["pms_add"])
                if "pms_remove" in data and isinstance(data["pms_remove"], list):
                    for k in data["pms_remove"]:
                        FH_RECOMMENDED_PMS_IDS.pop(str(k), None)
        except Exception:
            pass

def save_recommended_override(kind: str, item_id: str, name: str, recommended: bool):
    item_id = str(item_id).strip()
    data = {"mf_add": {}, "mf_remove": [], "pms_add": {}, "pms_remove": []}
    if OVERRIDES_FILE.exists():
        try:
            with open(OVERRIDES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if kind == "mf":
        if recommended:
            FH_RECOMMENDED_MF_CODES[item_id] = name or f"Scheme {item_id}"
            data.setdefault("mf_add", {})[item_id] = name or f"Scheme {item_id}"
            if item_id in data.get("mf_remove", []):
                data["mf_remove"].remove(item_id)
        else:
            FH_RECOMMENDED_MF_CODES.pop(item_id, None)
            if item_id not in data.setdefault("mf_remove", []):
                data["mf_remove"].append(item_id)
            if item_id in data.get("mf_add", {}):
                del data["mf_add"][item_id]
    elif kind == "pms":
        if recommended:
            FH_RECOMMENDED_PMS_IDS[item_id] = name or f"Strategy {item_id}"
            data.setdefault("pms_add", {})[item_id] = name or f"Strategy {item_id}"
            if item_id in data.get("pms_remove", []):
                data["pms_remove"].remove(item_id)
        else:
            FH_RECOMMENDED_PMS_IDS.pop(item_id, None)
            if item_id not in data.setdefault("pms_remove", []):
                data["pms_remove"].append(item_id)
            if item_id in data.get("pms_add", {}):
                del data["pms_add"][item_id]
    try:
        OVERRIDES_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OVERRIDES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

load_overrides()
