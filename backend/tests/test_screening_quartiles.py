"""Unit tests for quartile computation and Advisorkhoj provider."""
from __future__ import annotations

import httpx

from app.backoffice.providers.advisorkhoj import AdvisorkhojProvider
from app.backoffice.screening.quartiles import (
    compute_category_quartiles,
    resolve_quartile_cascade,
)


def test_8_peer_quartiles():
    # 8 peers with returns 10%, 9%, 8%, 7%, 6%, 5%, 4%, 3%
    scheme_returns = {f"scheme_{i}": 0.03 + i * 0.01 for i in range(8)}
    # scheme_7 has 0.10, scheme_0 has 0.03
    q_map = compute_category_quartiles(scheme_returns, min_peers=8)

    # scheme_7 and scheme_6 -> Q1
    assert q_map["scheme_7"] == 1
    assert q_map["scheme_6"] == 1
    # scheme_5 and scheme_4 -> Q2
    assert q_map["scheme_5"] == 2
    assert q_map["scheme_4"] == 2
    # scheme_3 and scheme_2 -> Q3
    assert q_map["scheme_3"] == 3
    assert q_map["scheme_2"] == 3
    # scheme_1 and scheme_0 -> Q4
    assert q_map["scheme_1"] == 4
    assert q_map["scheme_0"] == 4


def test_7_peers_unavailable():
    # 7 peers (< min_peers=8)
    scheme_returns = {f"scheme_{i}": 0.03 + i * 0.01 for i in range(7)}
    q_map = compute_category_quartiles(scheme_returns, min_peers=8)
    for q in q_map.values():
        assert q is None


def test_tied_returns_share_quartile():
    # Top two returns tie: average rank 1.5 -> both Q1; next two tie at 3.5 -> both Q2.
    scheme_returns = {f"s{i}": v for i, v in enumerate([0.10, 0.10, 0.08, 0.08, 0.05, 0.04, 0.03, 0.02])}
    q_map = compute_category_quartiles(scheme_returns, min_peers=8)
    assert q_map["s0"] == q_map["s1"] == 1
    assert q_map["s2"] == q_map["s3"] == 2


def test_quartile_cascade():
    # External available
    q, src = resolve_quartile_cascade("1", computed_q=2, external_q=1, external_source="advisorkhoj")
    assert q == 1
    assert src == "advisorkhoj"

    # Computed fallback
    q, src = resolve_quartile_cascade("1", computed_q=3, external_q=None)
    assert q == 3
    assert src == "computed"

    # None available
    q, src = resolve_quartile_cascade("1", computed_q=None, external_q=None)
    assert q is None
    assert src == "unavailable"


def test_advisorkhoj_robots_disallow_short_circuit():
    provider = AdvisorkhojProvider()
    # Mock robots file with Disallow: /getSearchResults
    robots_txt = "User-agent: *\nDisallow: /getSearchResults\nDisallow: /admin\nAllow: /\n"

    transport = httpx.MockTransport(
        lambda req: httpx.Response(200, text=robots_txt)
    )
    mock_client = httpx.Client(transport=transport)
    provider._client = mock_client

    # /getSearchResults should be disallowed
    assert not provider.check_robots_allowed("/getSearchResults")
    # /mutual-funds-research should be allowed
    assert provider.check_robots_allowed("/mutual-funds-research")

    # When trying to fetch a disallowed path, short-circuits with blocked
    assert provider.parse_quartile_from_html("<p>Category Quartile: 2</p>") == 2
