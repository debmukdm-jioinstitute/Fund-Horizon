from __future__ import annotations

from app.backoffice.valuation.providers.base import ProviderAdapter


class FundsIndia(ProviderAdapter):
    id = "fundsindia"
    label = "FundsIndia (Mutual Funds)"
    asset_class = "mutual_fund"
    default_asset_type = "mutual_fund"
    markers = [(r"funds\s*india", 2), (r"\bfolio\s*(no|number)", 1), (r"mutual\s*fund", 1)]

    @classmethod
    def check(cls, st):
        if not st.holdings and not st.needs_manual_review:
            st.errors.append("No mutual fund holdings extracted.")
        if any(not h.account_no for h in st.holdings):
            st.warnings.append("Some holdings have no folio/account number; they cannot be matched to an account.")
        for h in st.holdings:
            if h.isin and not h.isin.startswith("INF"):
                h.issues.append("ISIN does not start with INF (not a mutual fund ISIN).")
                h.validation_status = "warning"
