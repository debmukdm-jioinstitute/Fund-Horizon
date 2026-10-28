from fastapi.testclient import TestClient

from app.main import app


def test_portfolio_and_peers_public():
    with TestClient(app) as c:
        codes = [r["scheme_code"] for r in c.app.state.eligible.head(3).to_dict("records")]
        for code in codes:
            r = c.get(f"/api/funds/{code}/portfolio")
            assert r.status_code == 200 and "data" in r.json()
            p = c.get(f"/api/funds/{code}/peers")
            assert p.status_code == 200 and p.json()["count"] >= 1
        assert c.get("/api/funds/NOPE/peers").status_code == 404

