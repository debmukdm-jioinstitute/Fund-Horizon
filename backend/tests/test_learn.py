# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
"""FH Academy: server-scored quizzes, XP that cannot be farmed, streaks, FSRS card state, leaderboard, migration."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.api import learn as L

from .test_crm_core import _login, _make_customer, admin, client, rm

FUTURE = (datetime.now(UTC) + timedelta(days=30)).isoformat()


def shown_correct(content_q, start_q):
    """Index in the shuffled options that holds the original correct option text."""
    return start_q["o"].index(content_q["o"][content_q["a"]])


def play(client, quiz_id, mode="practice", right=True):
    st = client.post(f"/api/learn/quiz/{quiz_id}/start", json={"mode": mode}).json()
    qs = L._content()["questions"]
    ans = {}
    for q in st["questions"]:
        good = shown_correct(qs[q["id"]], q)
        ans[q["id"]] = good if right else (good + 1) % 4
        if mode == "practice":
            r = client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/answer", json={"qid": q["id"], "choice": ans[q["id"]]})
            assert r.status_code == 200, r.text
    return st, client.post(f"/api/learn/quiz/{quiz_id}/submit", json={"attempt_id": st["attempt_id"], "answers": ans})


# --- content integrity -------------------------------------------------------------------------------------
MODULES = {"mf": (22, "Module 1"), "pms": (16, "Module 2"), "sip": (18, "Module 12"),
           "alloc": (18, "Module 13"), "stepup": (18, "Module 14")}


def test_content_is_consistent():
    c = L._content()
    assert set(c["mods"]) == set(MODULES)
    # syllabus order, not directory order: Module 1 must stay the first module a new joiner sees
    assert list(c["mods"]) == ["mf", "pms", "sip", "alloc", "stepup"]
    for mid, (n_lessons, code) in MODULES.items():
        mod = c["mods"][mid]
        assert (len(mod["_lessons"]), mod["code"]) == (n_lessons, code), mid
        assert len(mod["final"]["questions"]) >= 25 and mod["final"]["pass_pct"] == 80, mid
    for mod in c["mods"].values():
        ids = [x["id"] for x in mod["_lessons"]]
        assert ids == sorted(ids) and len(ids) >= 15
        card_ids = {x["id"] for x in mod["cards"]}
        assigned = [cid for les in mod["_lessons"] for cid in les["card_ids"]]
        assert set(assigned) == card_ids and len(assigned) == len(set(assigned))
        for les in mod["_lessons"]:
            assert les["words"] <= 400, les["id"]
            assert len(les["check"]) == 3 and 2 <= len(les["objectives"]) <= 3 and les["example"] and les["say"] and les["never"]
    for q in c["questions"].values():
        assert len(q["o"]) == 4 and len(set(q["o"])) == 4 and q["a"] in range(4) and q["why"], q["id"]


def test_every_lesson_check_and_final_question_resolves():
    c = L._content()
    for mid, mod in c["mods"].items():
        spec = L._quiz_spec(f"{mid}-final")
        assert spec["module"] == mid and len(spec["ids"]) == len(mod["final"]["questions"])
        for les in mod["_lessons"]:
            assert L._quiz_spec(f"lesson:{les['id']}")["ids"] == [q["id"] for q in les["check"]]
            for q in les["check"]:
                # a question can be reused by a later lesson; the mapping points at its first home in this module
                assert c["q_lesson"][q["id"]] in {x["id"] for x in mod["_lessons"]}
        assert len(L._quiz_spec(f"{mid}-cp1")["ids"]) >= 3


def test_pms_aprn_date_is_flagged_for_compliance_review():
    les = L._content()["lessons"]["pms-03"]
    assert "TODO-COMPLIANCE" in les["body_md"] and "31 Jul 2025" in les["body_md"]


def test_certificate_needs_all_five_finals_and_names_them(client, admin):
    play(client, "mf-final")
    assert client.get("/api/learn/me").json()["certificate"] is None  # one of five is not enough
    for mid in ("pms", "sip", "alloc", "stepup"):
        play(client, f"{mid}-final")
    me = client.get("/api/learn/me").json()
    assert set(me["certificate"]) == set(MODULES)
    assert all(c["score"] == 30 and c["title"] for c in me["certificate"].values())
    badges = {b["id"] for b in me["badges"]}
    assert {f"grad_{m}" for m in MODULES} | {"full_stack"} <= badges


# --- pure helpers ----------------------------------------------------------------------------------------
def test_levels_follow_100_n_1_5():
    assert L.level_for(0) == 1 and L.level_for(99) == 1 and L.level_for(100) == 1
    assert L.level_for(L.level_xp(3)) == 3 and L.level_for(L.level_xp(3) - 1) == 2 and L.level_xp(2) == 283
    assert [L.level_name(n) for n in (1, 3, 6, 10, 15)] == ["Trainee", "Associate", "Specialist", "Expert", "Mentor"]


def test_streak_freeze_and_reset():
    seven = [f"2026-10-{d:02d}" for d in range(1, 8)]
    assert L.streak_for(seven, "2026-10-07") == (7, 1)
    assert L.streak_for(seven, "2026-10-08") == (7, 1)  # today not over yet
    assert L.streak_for(seven, "2026-10-09") == (7, 0)  # one missed day spends the freeze
    assert L.streak_for(seven, "2026-10-10")[0] == 0  # second miss resets
    assert L.streak_for([], "2026-10-10") == (0, 0)


# --- API ---------------------------------------------------------------------------------------------------
def test_staff_only(client):
    assert client.get("/api/learn/me").status_code == 401
    _login(client, _make_customer("customer"))
    assert client.get("/api/learn/me").status_code == 403


def test_new_user_home_and_content_hides_answers(client, admin):
    me = client.get("/api/learn/me").json()
    assert me["new_here"] and me["xp"] == 0 and me["next_lesson"]["lesson_id"] == "mf-01" and me["level"] == 1
    body = client.get("/api/learn/content/mf").json()
    assert len(body["lessons"]) == 22 and body["glossary"]
    for les in body["lessons"]:
        for q in les["check"]:
            assert set(q) == {"id", "q", "o"}
    assert client.get("/api/learn/content/nope").status_code == 404


def test_lesson_xp_is_not_farmable(client, admin):
    r1 = client.post("/api/learn/lessons/mf-01/complete").json()
    assert r1["xp_awarded"] == 30 and "first_step" in r1["new_badges"]  # 10 lesson + 20 daily goal
    assert client.post("/api/learn/lessons/mf-01/complete").json()["xp_awarded"] == 0
    assert client.post("/api/learn/lessons/mf-02/complete").json()["xp_awarded"] == 10  # daily goal already paid today
    assert client.post("/api/learn/lessons/zzz/complete").status_code == 404
    assert client.get("/api/learn/me").json()["xp"] == 40


def test_quiz_is_shuffled_scored_and_pays_once(client, admin):
    a = client.post("/api/learn/quiz/mf-final/start", json={"mode": "practice"}).json()
    b = client.post("/api/learn/quiz/mf-final/start", json={"mode": "practice"}).json()
    assert len(a["questions"]) == 30 and all("a" not in q and "why" not in q for q in a["questions"])
    assert [q["id"] for q in a["questions"]] != [q["id"] for q in b["questions"]]

    _, r = play(client, "mf-final")
    res = r.json()
    assert r.status_code == 200 and res["score"] == 30 and res["passed"] and res["perfect"] and "perfectionist" in res["new_badges"]
    assert res["xp_awarded"] >= 150 and "grad_mf" in res["new_badges"]  # 50 pass + 100 perfect first try (+ combo)
    _, r2 = play(client, "mf-final")
    assert r2.json()["xp_awarded"] == 0 and r2.json()["passed"]  # repeating never pays again


def test_exam_mode_scores_on_server_and_fail_pays_nothing(client, admin):
    _, r = play(client, "mf-final", mode="exam", right=False)
    res = r.json()
    assert res["score"] == 0 and not res["passed"] and res["xp_awarded"] == 0 and len(res["missed"]) == 30
    assert res["missed"][0]["why"] and res["missed"][0]["lesson_id"]
    st = client.post("/api/learn/quiz/mf-final/start", json={"mode": "exam"}).json()
    assert st["time_limit_s"] == 30 * 72
    # no feedback in exam mode
    assert client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/answer", json={"qid": st["questions"][0]["id"], "choice": 0}).status_code == 409


def test_practice_answer_is_locked_after_first_try(client, admin):
    st = client.post("/api/learn/quiz/mf-final/start", json={"mode": "practice"}).json()
    q = st["questions"][0]
    right = shown_correct(L._content()["questions"][q["id"]], q)
    wrong = (right + 1) % 4
    first = client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/answer", json={"qid": q["id"], "choice": wrong}).json()
    again = client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/answer", json={"qid": q["id"], "choice": right}).json()
    assert not first["correct"] and not again["correct"] and again["locked_choice"] == wrong and first["correct_choice"] == right


def test_timed_out_exam_pays_nothing(client, admin):
    from app.api.learn import _db
    from app.models.learn import QuizAttemptModel

    st = client.post("/api/learn/quiz/mf-final/start", json={"mode": "exam"}).json()
    qs = L._content()["questions"]
    ans = {q["id"]: shown_correct(qs[q["id"]], q) for q in st["questions"]}
    with _db() as s:
        a = s.get(QuizAttemptModel, st["attempt_id"])
        state = json.loads(a.answers_json)
        state["deadline"] = "2020-01-01T00:00:00+00:00"
        a.answers_json = json.dumps(state)
        s.commit()
    res = client.post("/api/learn/quiz/mf-final/submit", json={"attempt_id": st["attempt_id"], "answers": ans}).json()
    assert res["timed_out"] and not res["passed"] and res["xp_awarded"] == 0


def test_lesson_check_awards_5xp_per_correct_once(client, admin):
    qid = "lesson:mf-01"
    for _ in range(2):
        st = client.post(f"/api/learn/quiz/{qid}/start", json={"mode": "practice"}).json()
        qs = L._content()["questions"]
        got = 0
        for q in st["questions"]:
            r = client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/answer", json={"qid": q["id"], "choice": shown_correct(qs[q["id"]], q)}).json()
            got += r["xp_awarded"]
        assert got == (15 if _ == 0 else 0)
    assert client.post(f"/api/learn/quiz/{qid}/start", json={"mode": "exam"}).status_code == 422


def test_checkpoint_and_mock_quizzes(client, admin):
    st = client.post("/api/learn/quiz/mf-cp1/start", json={"mode": "practice"}).json()
    assert 3 <= len(st["questions"]) <= 9
    mock = client.post("/api/learn/quiz/mf-mock/start", json={"mode": "exam"}).json()
    assert len(mock["questions"]) == 50 and mock["time_limit_s"] == 3600 and mock["pass_pct"] == 50
    assert client.post("/api/learn/quiz/mf-cp99/start", json={"mode": "practice"}).status_code == 404


def test_cards_fsrs_state_due_and_xp(client, admin):
    due = client.get("/api/learn/cards/due?module=mf").json()
    assert len(due["cards"]) == 20 and all(c["fsrs"] is None for c in due["cards"])
    cid = due["cards"][0]["id"]
    body = {"rating": 3, "fsrs": {"stability": 2.5, "difficulty": 5, "state": 2}, "due": FUTURE}
    r = client.post(f"/api/learn/cards/{cid}/review", json=body).json()
    assert r["xp_awarded"] == 2
    assert client.post(f"/api/learn/cards/{cid}/review", json=body).json()["xp_awarded"] == 0  # same card, same day
    after = client.get("/api/learn/cards/due?module=mf").json()
    assert cid not in [c["id"] for c in after["cards"]] and after["reviewed_today"] == 1
    assert len(after["cards"]) == 19  # the daily budget of new cards shrinks as you review
    allc = client.get("/api/learn/cards/due?module=mf&deck=all").json()["cards"]
    assert next(c for c in allc if c["id"] == cid)["fsrs"]["stability"] == 2.5
    assert client.post("/api/learn/cards/nope/review", json=body).status_code == 404
    assert client.post(f"/api/learn/cards/{cid}/review", json={**body, "rating": 9}).status_code == 422
    assert client.post(f"/api/learn/cards/{cid}/review", json={**body, "due": "not a date"}).status_code == 422


def test_missed_questions_can_be_added_to_flashcards(client, admin):
    st, r = play(client, "mf-final", mode="exam", right=False)
    n = client.post(f"/api/learn/quiz/attempts/{st['attempt_id']}/add-missed-to-cards").json()["cards_added"]
    assert n > 10
    unseen = client.post("/api/learn/quiz/mf-final/start", json={"mode": "practice"}).json()
    assert client.post(f"/api/learn/quiz/attempts/{unseen['attempt_id']}/add-missed-to-cards").status_code == 409


def test_leaderboard_and_opt_out(client, admin):
    client.post("/api/learn/lessons/mf-01/complete")
    lb = client.get("/api/learn/leaderboard?period=all").json()
    assert lb["top"][0]["xp"] == 30 and lb["top"][0]["you"] and lb["you"]["rank"] == 1
    assert client.put("/api/learn/prefs", json={"leaderboard_optout": True}).json()["leaderboard_optout"] is True
    lb = client.get("/api/learn/leaderboard?period=week").json()
    assert lb["top"] == [] and lb["you"] is None and lb["hidden"]
    assert client.get("/api/learn/leaderboard?period=year").status_code == 422


def test_migrate_local_runs_once_and_awards_no_xp(client, admin):
    payload = {"cards": [{"card_id": "mf-c3", "fsrs": {"stability": 4}, "due": FUTURE}, {"card_id": "bogus", "fsrs": {}, "due": FUTURE}],
               "best": {"mf-final": {"score": 26, "total": 30}}}
    r = client.post("/api/learn/migrate-local", json=payload).json()
    assert r["migrated"] and r["cards"] == 1
    assert client.post("/api/learn/migrate-local", json=payload).json()["migrated"] is False
    me = client.get("/api/learn/me").json()
    assert me["xp"] == 0 and me["migrated"] and me["quiz_best"]["mf-final"]["score"] == 26 and "grad_mf" in [b["id"] for b in me["badges"]]
    left = {c["id"] for c in client.get("/api/learn/cards/due?module=mf").json()["cards"]}
    assert "mf-c3" not in left


def test_retry_wrong_only_is_partial_and_never_pays_or_passes(client, admin):
    st, r = play(client, "mf-final", mode="practice", right=False)
    missed = [m["id"] for m in r.json()["missed"]]
    assert r.json()["xp_awarded"] == 0 and len(missed) == 30
    part = client.post("/api/learn/quiz/mf-final/start", json={"mode": "practice", "only": missed[:5]}).json()
    assert len(part["questions"]) == 5
    qs = L._content()["questions"]
    ans = {}
    for q in part["questions"]:
        ans[q["id"]] = shown_correct(qs[q["id"]], q)
        client.post(f"/api/learn/quiz/attempts/{part['attempt_id']}/answer", json={"qid": q["id"], "choice": ans[q["id"]]})
    res = client.post("/api/learn/quiz/mf-final/submit", json={"attempt_id": part["attempt_id"], "answers": ans}).json()
    assert res["score"] == 5 and res["total"] == 5 and res["xp_awarded"] == 0 and "grad_mf" not in res["new_badges"]
    me = client.get("/api/learn/me").json()
    assert me["xp"] == 0 and me["certificate"] is None and me["quiz_best"]["mf-final"]["score"] == 0
    assert client.post("/api/learn/quiz/mf-final/start", json={"only": ["nope"]}).status_code == 422
    # the failed full attempt was the first counting one, so a later perfect run earns the pass XP but not the "first try" bonus
    _, full = play(client, "mf-final")
    assert 50 <= full.json()["xp_awarded"] < 150
