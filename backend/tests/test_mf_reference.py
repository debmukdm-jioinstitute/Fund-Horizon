import gzip

from app.backoffice.mf_reference import _query, load_csv

CSV = (
    "record_type,amfi_scheme_code,scheme_name,amc_id,amc_name\n"
    "scheme_master,1,Alpha Fund,A1,\n"
    "AMC_Master,,,A1,Alpha AMC\n"
)


def test_load_and_query(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    f = tmp_path / "r.csv.gz"
    f.write_bytes(gzip.compress(CSV.encode()))
    assert load_csv(f) == {"scheme_master": 1, "amc_master": 1}
    cols, rows, total = _query("scheme_master", "alpha", {"amc_id": "A1"}, None, "asc", 10, 0)
    assert total == 1 and rows[0]["scheme_name"] == "Alpha Fund" and "amc_name" not in cols
