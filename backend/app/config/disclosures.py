"""All user-facing compliance copy. Reused by the API, UI and PDF.

TODO(owner-compliance-review): every string in this module is user-facing copy.
"""

ARN = "ARN 345439"  # TODO(owner-compliance-review)
FIRM = "Fund Horizon"  # TODO(owner-compliance-review)

DISCLOSURE_LINES = [
    f"AMFI-registered Mutual Fund Distributor, {ARN}.",
    "Investments in Mutual Funds are subject to Market Risks. "
    "Read all scheme related documents carefully.",
    "Past performance may or may not be sustained.",
    "We deal in Regular Plans only and earn a trailing commission; disclosure of commission "
    "is made at the time of investment. Direct plans with lower expense ratios are available "
    "to investors.",
    "Illustrations use assumed returns and are not guarantees.",
]  # TODO(owner-compliance-review)

SHORTLIST_HEADING = (
    "Illustrative shortlist (ranked by past-performance composite; not a recommendation)"
)  # TODO(owner-compliance-review)

TAX_INFO = (
    "Tax treatment varies by fund type and current law; confirm with a tax professional."
)  # TODO(owner-compliance-review)

CONSENT_TEXT = (
    "I consent to Fund Horizon processing the details I enter to generate an illustrative "
    "plan. I understand this is an illustration and no outcome is assured."
)  # TODO(owner-compliance-review)

ALLOCATION_HEADING = "Suggested allocation"  # TODO(owner-compliance-review)

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

BANNED_WORDS = ["best", "guaranteed", "advice", "advisory", "recommend you buy"]


def all_disclosures() -> dict:
    """Payload sent to clients via /api/meta and embedded in plan responses."""
    return {
        "arn": ARN,
        "lines": DISCLOSURE_LINES,
        "shortlist_heading": SHORTLIST_HEADING,
        "tax_info": TAX_INFO,
        "consent_text": CONSENT_TEXT,
        "allocation_heading": ALLOCATION_HEADING,
        "analytics_disclaimer": ANALYTICS_DISCLAIMER,
        "compare_disclaimer": COMPARE_DISCLAIMER,
        "ranking_disclaimer": RANKING_DISCLAIMER,
        "portfolio_disclaimer": PORTFOLIO_DISCLAIMER,
    }

