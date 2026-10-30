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
        "insurer_key": "axis_max_life",
        "slug": "smart-term-plan-plus",
        "document_url": "https://www.maxlifeinsurance.com/term-insurance-plans/smart-term-plan",
        "document_name": "Axis_Max_Life_Smart_Term_Plan_Plus_Brochure.pdf",
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
        "why_included": "Claim-settlement record within 0.02% of the leader; low complaint volume.",
        "insurer_key": "hdfc_life",
        "slug": "click-2-protect-super",
        "document_url": "https://www.hdfclife.com/term-insurance-plans/click-2-protect-super",
        "document_name": "HDFC_Life_Click_2_Protect_Super_Brochure.pdf",
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
        "insurer_key": "tata_aia",
        "slug": "sampoorna-raksha-promise",
        "document_url": "https://www.tataaia.com/life-insurance-plans/term-plans/sampoorna-raksha-promise.html",
        "document_name": "Tata_AIA_Sampoorna_Raksha_Promise_Brochure.pdf",
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
        "insurer_key": "icici_prudential",
        "slug": "iprotect-smart-plus",
        "document_url": "https://www.iciciprulife.com/term-insurance-plans/iprotect-smart-term-insurance-calculator.html",
        "document_name": "ICICI_Prudential_iProtect_Smart_Plus_Brochure.pdf",
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
        "insurer_key": "aditya_birla",
        "slug": "activ-one",
        "document_url": "https://www.adityabirlacapital.com/healthinsurance/activ-one",
        "document_name": "Aditya_Birla_Activ_One_Policy_Brochure.pdf",
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
        "insurer_key": "care_health",
        "slug": "care-supreme",
        "document_url": "https://www.careinsurance.com/health-insurance-plans/care-supreme",
        "document_name": "Care_Health_Care_Supreme_Brochure.pdf",
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
        "insurer_key": "hdfc_ergo",
        "slug": "optima-secure",
        "document_url": "https://www.hdfcergo.com/health-insurance/optima-secure",
        "document_name": "HDFC_ERGO_Optima_Secure_Policy_Brochure.pdf",
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
        "insurer_key": "niva_bupa",
        "slug": "reassure-2-0",
        "document_url": "https://www.nivabupa.com/health-insurance-plans/reassure-2-0.html",
        "document_name": "Niva_Bupa_ReAssure_2.0_Brochure.pdf",
    },
]

SOURCES: list[str] = [
    "IRDAI Annual Report 2024-25 (life-insurer claim-settlement and solvency figures)",
    "Insurer audited financials and public disclosures (plan features, health claim ratios)",
]
