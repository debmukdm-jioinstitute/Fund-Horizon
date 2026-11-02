from __future__ import annotations

import re

from app.backoffice.valuation.providers.base import ProviderAdapter


class ProAffluence(ProviderAdapter):
    id = "proaffluence"
    label = "ProAffluence (PMS)"
    asset_class = "pms"
    markers = [(r"pro\s*-?\s*affluence", 2), (r"portfolio\s+management", 1), (r"\bpms\b", 1)]

    @classmethod
    def mf_text(cls, pages):
        return bool(re.search(r"mutual\s*fund\s*distributor|\bMF\s+Summary", "\n".join(pages[:2]), re.I))

    @classmethod
    def check(cls, st):
        if st.asset_class == "mutual_fund":
            return
        if not st.account_no:
            st.errors.append("PMS account/client code not found; needed for duplicate detection and history. Enter it manually.")
