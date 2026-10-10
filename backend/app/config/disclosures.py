"""All user-facing compliance copy. Reused by the API, UI and PDF.

TODO(owner-compliance-review): every string in this module is user-facing copy.
"""

ARN = "ARN 345439"  # TODO(owner-compliance-review)
FIRM = "Fund Horizon"  # TODO(owner-compliance-review)

DISCLOSURE_LINES = [
    f"AMFI-registered Mutual Fund Distributor, {ARN}.",
    "Fund Horizon is an execution-only distributor and is not a SEBI-registered "
    "investment adviser.",
    "Investments in Mutual Funds are subject to Market Risks. "
    "Read all scheme related documents carefully.",
    "Past performance may or may not be sustained.",
    "We deal in Regular Plans only and earn a trailing commission; disclosure of commission "
    "is made at the time of investment. Direct plans with lower expense ratios are available "
    "to investors.",
    "Illustrations use assumed returns and are not guarantees.",
    "Each scheme carries a SEBI riskometer. Read the Scheme Information Document (SID) and "
    "Key Information Memorandum (KIM) on the AMC or AMFI website before investing.",
]  # TODO(owner-compliance-review)

SHORTLIST_HEADING = (
    "Illustrative shortlist (ranked by past-performance composite; not a recommendation)"
)  # TODO(owner-compliance-review)

TAX_INFO = (
    "All SIP amounts, future costs and success figures are pre-tax illustrations. "
    "They do not imply the SIP is enough after tax. Tax treatment varies by fund type and "
    "current law; debt-fund gains are typically taxed at the investor's slab after April 2023. "
    "A configurable pre-tax haircut on non-equity sleeves is documented in the planning "
    "assumptions and is not applied unless that haircut is configured. Confirm with a tax "
    "professional."
)  # TODO(owner-compliance-review)

TAX_PER_GOAL_NOTE = (
    "Pre-tax illustration: the SIP, future cost and chance figures for this goal ignore tax. "
    "Debt and liquid sleeves are especially affected on short horizons. This is not an "
    "after-tax sufficiency statement."
)  # TODO(owner-compliance-review)

SUCCESS_PROB_NOTE = (
    "Sized at the assumed (central) planning return is not the same as likely to succeed. "
    "A goal that is fully sized only means the allocated SIP reaches the inflated target on "
    "the central path; Monte Carlo success is often near 50% even then. "
    "P(success) is the share of 5,000 simulated paths that reach the inflated goal with the "
    "allocated SIP. The SIP for about 80% chance is shown in the same row. "
    "Simulations are illustrations, not guarantees."
)  # TODO(owner-compliance-review)

SCHEME_DOCS_NOTE = (
    "SEBI requires every scheme to publish a riskometer in its offer documents. This "
    "illustration does not show per-scheme riskometer images. Before investing, read the SID "
    "and KIM on the AMC website or via AMFI (https://www.amfiindia.com)."
)  # TODO(owner-compliance-review)

CONSENT_TEXT = (
    "I consent to Fund Horizon processing the details I enter to generate an illustrative "
    "plan. I understand this is an illustration and no outcome is assured."
)  # TODO(owner-compliance-review)

ALLOCATION_HEADING = "Illustrative allocation"  # TODO(owner-compliance-review)

ANALYTICS_DISCLAIMER = (
    "All figures are historical illustrations and do not assure future performance."
)  # TODO(owner-compliance-review)

COMPARE_DISCLAIMER = (
    "Illustrative comparison; not an investment recommendation."
)  # TODO(owner-compliance-review)

RANKING_DISCLAIMER = (
    "Ranked by past-performance composite score; illustrative and not a recommendation."
)  # TODO(owner-compliance-review)

PORTFOLIO_DISCLAIMER = (
    "Illustrative portfolio analysis; does not constitute an investment recommendation."
)  # TODO(owner-compliance-review)

# Engine status -> wording that does not read "funded" as "likely to succeed".
SIZED_STATUS_LABELS = {
    "funded": "Sized (central path)",
    "partially_funded": "Partly sized (central path)",
    "unfunded": "Not sized",
}  # TODO(owner-compliance-review)

# "recommendation" is allowed; bare "recommend" / "suggested" are not.
BANNED_WORDS = [
    "best",
    "guaranteed",
    "advice",
    "advisory",
    "recommend you buy",
    "suggested",
    "recommend",
]


def all_disclosures() -> dict:
    """Payload sent to clients via /api/meta and embedded in plan responses."""
    return {
        "arn": ARN,
        "lines": DISCLOSURE_LINES,
        "shortlist_heading": SHORTLIST_HEADING,
        "tax_info": TAX_INFO,
        "tax_per_goal_note": TAX_PER_GOAL_NOTE,
        "success_prob_note": SUCCESS_PROB_NOTE,
        "scheme_docs_note": SCHEME_DOCS_NOTE,
        "consent_text": CONSENT_TEXT,
        "allocation_heading": ALLOCATION_HEADING,
        "sized_status_labels": SIZED_STATUS_LABELS,
        "analytics_disclaimer": ANALYTICS_DISCLAIMER,
        "compare_disclaimer": COMPARE_DISCLAIMER,
        "ranking_disclaimer": RANKING_DISCLAIMER,
        "portfolio_disclaimer": PORTFOLIO_DISCLAIMER,
    }
