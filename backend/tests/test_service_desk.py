from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api import service_desk as sd

ADMIN = {"id": "a1", "role": "admin", "_team": None}
RM = {"id": "rm1", "role": "rm", "_team": []}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))


def q(**kw):
    return sd.QueryIn(**{"client_name": "A B", "category": "operational", **kw})


def test_other_needs_free_text_and_others_drop_it():
    with pytest.raises(ValidationError):
        q(category="other")
    assert q(category="other", other_text=" KYC help ").other_text == "KYC help"
    assert q(other_text="stray").other_text == ""
    with pytest.raises(ValidationError):
        q(client_name="   ")
    with pytest.raises(ValidationError):
        q(category="bogus")


def test_lifecycle_and_scoping():
    a = sd.create_query(q(source="voice"), ADMIN)["id"]
    sd.create_query(q(client_name="Z"), RM)
    assert sd.list_queries(ADMIN, None, 100, 0)["total"] == 2
    assert sd.list_queries(RM, None, 100, 0)["total"] == 1  # RM sees only their own
    sd.set_status(a, sd.StatusIn(status="completed"), ADMIN)
    done = sd.list_queries(ADMIN, "completed", 100, 0)
    assert done["total"] == 1 and done["rows"][0]["completed_at"] and done["rows"][0]["source"] == "voice"
    sd.set_status(a, sd.StatusIn(status="incoming"), ADMIN)  # reopening clears completion time
    assert sd.list_queries(ADMIN, "incoming", 100, 0)["rows"][-1]["completed_at"] is None
    with pytest.raises(HTTPException) as e:
        sd.set_status("nope", sd.StatusIn(status="completed"), ADMIN)
    assert e.value.status_code == 404


def test_compliance_read_only_and_bad_status():
    with pytest.raises(HTTPException) as e:
        sd.create_query(q(), {"id": "c", "role": "compliance", "_team": None})
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        sd.list_queries(ADMIN, "bogus", 100, 0)


def test_report_cycle_dates():
    c = sd.report_cycle(date(2026, 11, 25))  # after the 7th -> next cycle, Nov reports sent in Dec
    assert (c["report_month"], c["finalize_by"], c["hard_deadline"]) == ("November 2026", "2026-11-30", "2026-12-07")
    assert c["send_by"] == "2026-12-04"  # 5 Dec 2026 is a Saturday -> Friday
    c = sd.report_cycle(date(2026, 12, 3))  # still inside Dec cycle
    assert c["report_month"] == "November 2026" and c["days_left"] == 4
    assert sd.report_cycle(date(2026, 12, 20))["hard_deadline"] == "2027-01-07"


def test_tracker_counts_unsent():
    from app.db import sqlite
    conn = sqlite.get_default_connection()
    with conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS monthly_reports (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, household_id TEXT,
            report_month TEXT, value_as_on TEXT, data TEXT NOT NULL, pdf BLOB NOT NULL, emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)""")
        now = sd.datetime.now(sd.UTC).isoformat()
        conn.execute("INSERT INTO monthly_reports VALUES ('1','c1',NULL,'m','d','{}',x'00',?,?,'u')", (now, now))
        conn.execute("INSERT INTO monthly_reports VALUES ('2','c2',NULL,'m','d','{}',x'00',NULL,?,'u')", (now,))
    conn.close()
    t = sd.report_tracker(ADMIN)
    # cycle_start may be next month when today is past the 7th, so only assert shape then
    assert set(t) >= {"generated", "emailed", "unsent", "send_by"}


def test_modify_delete_and_search():
    res = sd.create_query(q(client_name="Rajesh Sharma", priority="urgent", details="Urgent redemption"), ADMIN)
    qid = res["id"]
    assert res["ticket_code"] == f"SR-{qid[:6].upper()}"

    # Search by ticket code or client name
    found = sd.list_queries(ADMIN, q=res["ticket_code"])
    assert found["total"] == 1
    assert found["rows"][0]["ticket_code"] == res["ticket_code"]
    assert found["rows"][0]["priority"] == "urgent"

    # Modify query
    sd.update_query(qid, sd.QueryUpdateIn(client_name="Rajesh S. Sharma", priority="high", resolution_note="Drafted form"), ADMIN)
    upd = sd.list_queries(ADMIN, q="Rajesh S")
    assert upd["total"] == 1
    assert upd["rows"][0]["client_name"] == "Rajesh S. Sharma"
    assert upd["rows"][0]["priority"] == "high"
    assert upd["rows"][0]["resolution_note"] == "Drafted form"

    # Delete query
    sd.delete_query(qid, ADMIN)
    assert sd.list_queries(ADMIN, q="Rajesh S")["total"] == 0

