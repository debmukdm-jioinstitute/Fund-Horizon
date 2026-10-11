"""Illustrative insurance-plan research shortlist (curated October 2026).

Claim-settlement figures for life insurers are the individual death-claim paid
ratios from the IRDAI Annual Report 2024-25 (via insurer audited financials).
Health-insurer figures are insurer-reported and vary by source and period, so the
source is named on each entry. Solvency ratios are as of March 2025.

Premiums are deliberately not quoted: they move with age, health, occupation,
city and sum insured. This is a research shortlist for the customer's own
comparison, not a recommendation.
"""

RESEARCHED_ON = "2026-10"

TERM_PLANS: list[dict] = [
    {
        "insurer": "Axis Max Life",
        "plan": "Smart Term Plan Plus",
        "claim_settlement": "99.70% (FY 2024-25, IRDAI)",
        "solvency": "1.90x (FY 2024-25)",
        "sum_insured": "₹1 Cr and above",
        "features": [
            "Critical illness cover for up to 64 conditions",
            "Zero-cost exit option within a set window",
            "Option to raise cover at life milestones",
        ],
        "why_included": "Highest claim-settlement record in this shortlist; solvency above the IRDAI 1.5x minimum.",
    },
    {
        "insurer": "HDFC Life",
        "plan": "Click 2 Protect Super",
        "claim_settlement": "99.68% (FY 2024-25, IRDAI)",
        "solvency": "2.01x (FY 2024-25)",
        "sum_insured": "₹1 Cr and above",
        "features": [
            "Raise cover at marriage, child birth or a home loan",
            "Premium-break option of up to 2 years",
            "Critical illness cover for 60 conditions",
        ],
        "why_included": "Claim-settlement record within 0.02 pp of the leader; low complaint volume.",
    },
    {
        "insurer": "Tata AIA",
        "plan": "Sampoorna Raksha Promise",
        "claim_settlement": "99.41% (FY 2024-25, IRDAI)",
        "solvency": "3.20x (FY 2024-25)",
        "sum_insured": "₹1 Cr and above",
        "features": [
            "Instant payout on claim intimation",
            "Critical illness rider for 40 conditions",
            "Whole-life cover variant available",
        ],
        "why_included": "Strongest solvency buffer in this shortlist.",
    },
    {
        "insurer": "ICICI Prudential",
        "plan": "iProtect Smart Plus",
        "claim_settlement": "99.30% (FY 2024-25, IRDAI)",
        "solvency": "2.10x (FY 2024-25)",
        "sum_insured": "₹1 Cr and above",
        "features": [
            "Critical illness add-on available",
            "Accidental death benefit rider available",
            "Terminal illness payout option",
        ],
        "why_included": "Solid claim-settlement record with a wide rider menu.",
    },
]

HEALTH_PLANS: list[dict] = [
    {
        "insurer": "Aditya Birla Health",
        "plan": "Activ One",
        "claim_settlement": "97.4% (2025-26, insurer-reported)",
        "solvency": None,
        "sum_insured": "₹2 L – ₹6 Cr",
        "features": [
            "Wellness-linked rewards and fitness discounts",
            "Wide sum-insured range up to ₹6 Cr",
            "Large cashless hospital network",
        ],
        "why_included": "Highest reported claim-settlement record in this shortlist.",
    },
    {
        "insurer": "Care Health",
        "plan": "Care Supreme",
        "claim_settlement": "96.7% (FY 2024-25, insurer-reported)",
        "solvency": None,
        "sum_insured": "₹5 L – ₹1 Cr",
        "features": [
            "No room-rent caps",
            "Unlimited restore of sum insured",
            "No premium loading for pre-existing conditions (per insurer)",
        ],
        "why_included": "Restore benefit with no room-rent sub-limits.",
    },
    {
        "insurer": "HDFC ERGO",
        "plan": "Optima Secure",
        "claim_settlement": "94–97% (sources vary, 2024-26)",
        "solvency": None,
        "sum_insured": "₹5 L – ₹2 Cr",
        "features": [
            "2x cover from day one (Secure benefit)",
            "Restore benefit once a year",
            "No room-rent limits",
        ],
        "why_included": "Day-one doubled cover with a restore benefit.",
    },
    {
        "insurer": "Niva Bupa",
        "plan": "ReAssure 2.0",
        "claim_settlement": "94.4% (2025-26, insurer-reported)",
        "solvency": None,
        "sum_insured": "₹5 L – no upper limit",
        "features": [
            "10,000+ cashless network hospitals",
            "Carry-forward of unused cover",
            "High sum-insured ceiling for families",
        ],
        "why_included": "Large network and a high sum-insured ceiling.",
    },
]

SOURCES: list[str] = [
    "IRDAI Annual Report 2024-25 (life-insurer claim-settlement and solvency figures)",
    "Insurer audited financials and public disclosures (plan features, health claim ratios)",
]
