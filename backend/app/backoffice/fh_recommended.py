"""Curated "FH Recommended" mutual funds (Regular plan, Growth), keyed by AMFI scheme code.

Only the pick is stored here; every number shown for these funds comes from the live AMFI / mfapi.in feeds.
"""
from __future__ import annotations

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
    # Multi cap (AMFI lists two identical HSBC Multi Cap Regular Growth codes; both kept)
    "152072": "WhiteOak Capital Multi Cap Fund",
    "151812": "Mirae Asset Multicap Fund",
    "152095": "Edelweiss Multi Cap Fund",
    "151289": "HSBC Multi Cap Fund",
    "151292": "HSBC Multi Cap Fund",
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
# (its publisher's factsheet page needs a browser to read); the UI says so instead of showing nothing.
MF_FACTSHEET_SOURCE: dict[str, str] = {
    **dict.fromkeys(("108466", "100349", "106823"), "icici_mf"),
    **dict.fromkeys(("101635", "152208", "152053", "108202"), "dsp"),
    **dict.fromkeys(("106144", "145139", "149766", "153046"), "invesco"),
    **dict.fromkeys(("101262", "148459"), "nippon"),
    **dict.fromkeys(("102252", "151289", "151292"), "hsbc"),
    "148987": "hdfc",
    "152065": "kotak",
    **dict.fromkeys(("146193", "152095", "140355"), "edelweiss"),
}
PMS_FACTSHEET_SOURCE: dict[str, str] = {"174": "stallion", "2512": "abakkus_pms"}  # keyed by APMI strategy id
