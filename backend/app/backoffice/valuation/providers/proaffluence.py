from __future__ import annotations

from app.backoffice.valuation.providers.base import ProviderAdapter


class ProAffluence(ProviderAdapter):
    id = "proaffluence"
    label = "ProAffluence (PMS)"
    asset_class = "pms"
    markers = [(r"pro\s*-?\s*affluence", 2), (r"portfolio\s+management", 1), (r"\bpms\b", 1)]

    @classmethod
    def check(cls, st):
        if not st.account_no:
            st.errors.append("PMS account/client code not found; needed for duplicate detection and history. Enter it manually.")
