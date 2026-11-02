from __future__ import annotations

from app.backoffice.valuation.providers.base import ProviderAdapter


class Stallion(ProviderAdapter):
    id = "stallion"
    label = "Stallion (PMS)"
    asset_class = "pms"
    markers = [(r"stallion\s+asset", 2), (r"\bstallion\b", 1), (r"portfolio\s+management", 1), (r"\bpms\b", 1)]

    @classmethod
    def check(cls, st):
        if not st.account_no:
            st.errors.append("PMS account/client code not found; needed for duplicate detection and history. Enter it manually.")
