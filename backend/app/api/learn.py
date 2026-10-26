from __future__ import annotations
from app.db.d1 import on_workers
"""FH Academy: staff learning hub (lessons, flashcards with FSRS state, scored quizzes, XP, streaks, badges, leaderboard).

Content lives in ``app/data/academy`` (one source of truth, bundled with the API image). Quizzes are scored here so
results cannot be faked: ``start`` returns a seeded shuffle without answers, ``answer`` gives practice feedback once
per question, and ``submit`` scores. XP rows are unique on (staff, kind, ref) so a repeated action never pays twice.
"""


import json
import math
import random
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
if not on_workers():
    from sqlalchemy import func, select
if not on_workers():
    from sqlalchemy.dialects import postgresql
if not on_workers():
    from sqlalchemy.dialects import sqlite as sqlite_dialect
if not on_workers():
    from sqlalchemy.orm import Session

from app.api.auth import require_staff
from app.db import sqlite
from app.db.models import Base
from app.models.learn import (
    LEARN_TABLES,
    BadgeModel,
    CardReviewModel,
    LearnPrefsModel,
    LearnProgressModel,
    QuizAttemptModel,
    XpEventModel,
)
from app.repo_crm_core import IST, _get_engine

router = APIRouter(prefix="/api/learn", tags=["learn"])
Staff = Annotated[dict, Depends(require_staff)]

DATA = Path(__file__).resolve().parent.parent / "data" / "academy"
XP = {"lesson": 10, "check": 5, "card": 2, "quiz_pass": 50, "perfect": 100, "daily": 20}
LEVEL_NAMES = [(1, "Trainee"), (3, "Associate"), (6, "Specialist"), (10, "Expert"), (15, "Mentor")]
CHECKPOINT_PASS, MOCK_PASS, MOCK_SIZE, MOCK_SECONDS, GRACE_SECONDS = 70, 50, 50, 3600, 30
STAGE_OF_SECTION = {"L": "L", "E": "E", "A": "A", "R": "R", "N": "N", "Niche": "Niche"}
# Syllabus order a new joiner follows. Module directories are loaded in this order (not alphabetically),
# so /me progress, "next lesson" and the Home page cards all read in teaching order.
MODULE_ORDER = ["mf", "pms", "psych", "compare", "terms", "bonds", "idcw", "goals", "timing", "sip", "alloc", "stepup", "rebal", "overlap", "withdraw"]  # Module 1..17
_ENSURED: set[int] = set()


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def _content() -> dict[str, Any]:
    mods: dict[str, Any] = {}
    lessons: dict[str, Any] = {}
    questions: dict[str, Any] = {}
    cards: dict[str, Any] = {}
    dirs = sorted((p for p in DATA.iterdir() if p.is_dir()),
                  key=lambda p: (MODULE_ORDER.index(p.name) if p.name in MODULE_ORDER else len(MODULE_ORDER), p.name))
    for mdir in dirs:
        mod = json.loads((mdir / "module.json").read_text())
        order = [json.loads(f.read_text()) for f in sorted((mdir / "lessons").glob("*.json"))]
        mod["_lessons"] = order
        mods[mod["id"]] = mod
        for les in order:
            les["module"] = mod["id"]
            lessons[les["id"]] = les
            for q in les["check"]:
                questions[q["id"]] = q
        for q in mod["final"]["questions"]:
            questions[q["id"]] = q
        for c in mod["cards"]:
            cards[c["id"]] = {**c, "module": mod["id"]}
    q_lesson: dict[str, str] = {}
    for les in lessons.values():
        for q in les["check"]:
            q_lesson.setdefault(q["id"], les["id"])
    for mod in mods.values():
        for q in mod["final"]["questions"]:
            if q["id"] not in q_lesson:
                stage = STAGE_OF_SECTION.get(q["sec"].split(":")[0].split(" ")[0], "Niche")
                q_lesson[q["id"]] = next((les["id"] for les in mod["_lessons"] if les["stage"] == stage), mod["_lessons"][0]["id"])
    return dict(mods=mods, lessons=lessons, questions=questions, cards=cards, q_lesson=q_lesson,
                glossary=json.loads((DATA / "glossary.json").read_text()), badges=json.loads((DATA / "badges.json").read_text()))


def _quiz_spec(quiz_id: str) -> dict[str, Any]:
    """-> {module, ids, pass_pct, title}; raises 404 for an unknown quiz id."""
    c = _content()
    if quiz_id.startswith("lesson:"):
        les = c["lessons"].get(quiz_id[7:])
        if les:
            return dict(module=les["module"], ids=[q["id"] for q in les["check"]], pass_pct=CHECKPOINT_PASS, title=les["title"])
    else:
        mid, _, kind = quiz_id.partition("-")
        mod = c["mods"].get(mid)
        if mod and kind == "final":
            return dict(module=mid, ids=[q["id"] for q in mod["final"]["questions"]], pass_pct=mod["final"]["pass_pct"], title=mod["final"]["title"])
        if mod and kind == "mock":
            pool = sorted({q["id"] for les in mod["_lessons"] for q in les["check"]} | {q["id"] for q in mod["final"]["questions"]})
            return dict(module=mid, ids=pool, pass_pct=MOCK_PASS, title=f"{mod['title']} practice exam", mock=True)
        if mod and kind.startswith("cp") and kind[2:].isdigit():
            k = int(kind[2:])
            group = mod["_lessons"][3 * (k - 1): 3 * k]
            if len(group) == 3:
                ids = list(dict.fromkeys(q["id"] for les in group for q in les["check"]))
                return dict(module=mid, ids=ids, pass_pct=CHECKPOINT_PASS, title=f"Checkpoint {k}")
    raise HTTPException(404, "Unknown quiz.")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def _db() -> Session:
    engine = _get_engine()
    if id(engine) not in _ENSURED:
        Base.metadata.create_all(engine, tables=LEARN_TABLES)
        _ENSURED.add(id(engine))
    return Session(engine)


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(d: datetime) -> str:
    return d.isoformat()


def _ist_day(ts: str) -> str:
    return datetime.fromisoformat(ts).astimezone(IST).date().isoformat()


def _award(s: Session, staff: str, kind: str, ref: str, xp: int) -> int:
    """Insert one XP row; the unique index makes a repeat a no-op. Returns XP actually granted."""
    if xp <= 0:
        return 0
    row = dict(staff_id=staff, kind=kind, ref_id=ref[:80], xp=xp, ts=_iso(_now()))
    dialect = s.get_bind().dialect.name
    ins = (postgresql.insert if dialect == "postgresql" else sqlite_dialect.insert)(XpEventModel.__table__).values(**row)
    res = s.execute(ins.on_conflict_do_nothing(index_elements=["staff_id", "kind", "ref_id"]))
    return xp if res.rowcount else 0


def _xp_total(s: Session, staff: str) -> int:
    return int(s.scalar(select(func.coalesce(func.sum(XpEventModel.xp), 0)).where(XpEventModel.staff_id == staff)) or 0)


def level_xp(n: int) -> int:
    return math.ceil(100 * n ** 1.5)


def level_for(xp: int) -> int:
    """XP needed for level n is 100 * n^1.5 (rounded up); everyone starts at level 1."""
    n = 1
    while level_xp(n + 1) <= xp:
        n += 1
    return n


def level_name(level: int) -> str:
    return [n for lv, n in LEVEL_NAMES if level >= lv][-1]


def streak_for(days: list[str], today: str) -> tuple[int, int]:
    """(current streak, freezes left) from sorted unique IST activity dates.

    Every 7th streak day earns one freeze; a missed day spends one if available, else resets the streak.
    Today is not counted as missed until it ends.
    """
    if not days:
        return 0, 0
    d = [datetime.fromisoformat(x).date() for x in days]
    t = datetime.fromisoformat(today).date()
    streak = freezes = 0
    prev = None
    for day in d:
        if prev is not None:
            for _ in range((day - prev).days - 1):
                if freezes:
                    freezes -= 1
                else:
                    streak = 0
        streak += 1
        if streak % 7 == 0:
            freezes += 1
        prev = day
    gap = (t - prev).days - (0 if prev == t else 1)  # days fully missed since the last activity
    for _ in range(max(gap, 0)):
        if freezes:
            freezes -= 1
        else:
            streak = 0
    return streak, freezes


def _activity_days(s: Session, staff: str) -> list[str]:
    ts = s.scalars(select(XpEventModel.ts).where(XpEventModel.staff_id == staff)).all()
    return sorted({_ist_day(t) for t in ts})


def _badge(s: Session, staff: str, bid: str, new: list[str]) -> None:
    if not s.get(BadgeModel, (staff, bid)):
        s.add(BadgeModel(staff_id=staff, badge_id=bid, earned_at=_iso(_now())))
        new.append(bid)


def _passed(s: Session, staff: str, quiz_id: str) -> bool:
    return any(
        _passed_attempt(a)
        for a in s.scalars(select(QuizAttemptModel).where(QuizAttemptModel.staff_id == staff, QuizAttemptModel.quiz_id == quiz_id, QuizAttemptModel.finished_at.is_not(None)))
    )


def _check_badges(s: Session, staff: str, extra: dict[str, bool] | None = None) -> list[str]:
    new: list[str] = []
    extra = extra or {}
    if s.scalar(select(func.count()).select_from(LearnProgressModel).where(LearnProgressModel.staff_id == staff)):
        _badge(s, staff, "first_step", new)
    # one graduate badge per module, whatever the module set grows to, plus one for every module at once
    c = _content()
    passed = [mid for mid in c["mods"] if _passed(s, staff, f"{mid}-final")]
    for mid in passed:
        _badge(s, staff, f"grad_{mid}", new)
    if passed and len(passed) == len(c["mods"]):
        _badge(s, staff, "full_stack", new)
    streak, _ = streak_for(_activity_days(s, staff), datetime.now(IST).date().isoformat())
    if streak >= 7:
        _badge(s, staff, "streak_7", new)
    if streak >= 30:
        _badge(s, staff, "streak_30", new)
    if s.scalar(select(func.count()).select_from(CardReviewModel).where(CardReviewModel.staff_id == staff, CardReviewModel.fsrs_json.is_not(None))) >= 100:
        _badge(s, staff, "card_shark", new)
    if extra.get("perfect_final"):
        _badge(s, staff, "perfectionist", new)
    if extra.get("compliance_ace"):
        _badge(s, staff, "compliance_ace", new)
    return new


def _daily_goal(s: Session, staff: str, today: str) -> int:
    """+20 XP once per IST day when a lesson is completed or 10 cards are reviewed."""
    lessons = [c for c in s.scalars(select(LearnProgressModel.completed_at).where(LearnProgressModel.staff_id == staff)) if _ist_day(c) == today]
    cards = [t for t in s.scalars(select(XpEventModel.ts).where(XpEventModel.staff_id == staff, XpEventModel.kind == "card")) if _ist_day(t) == today]
    return _award(s, staff, "daily", today, XP["daily"]) if lessons or len(cards) >= 10 else 0


# ---------------------------------------------------------------------------
# /me and content
# ---------------------------------------------------------------------------
def _week_start() -> str:
    n = datetime.now(IST)
    monday = (n - timedelta(days=n.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return _iso(monday.astimezone(UTC))


def _reviewed_today(s: Session, staff: str) -> int:
    today = datetime.now(IST).date().isoformat()
    return sum(1 for t in s.scalars(select(XpEventModel.ts).where(XpEventModel.staff_id == staff, XpEventModel.kind == "card")) if _ist_day(t) == today)


def _due_ids(s: Session, staff: str, module: str | None = None, daily_cards: int = 20) -> list[str]:
    """Overdue cards plus never-seen cards, with new cards capped by what is left of today's 20-card budget."""
    c = _content()
    rows = {r.card_id: r for r in s.scalars(select(CardReviewModel).where(CardReviewModel.staff_id == staff))}
    now = _iso(_now())
    due = [cid for cid, r in rows.items() if r.due_at <= now and cid in c["cards"] and (not module or c["cards"][cid]["module"] == module)]
    new = [cid for cid, card in c["cards"].items() if cid not in rows and (not module or card["module"] == module)]
    return due + new[: max(0, daily_cards - _reviewed_today(s, staff))]


@router.get("/me")
def me(staff: Staff):
    c = _content()
    sid = staff["id"]
    with _db() as s:
        xp = _xp_total(s, sid)
        lvl = level_for(xp)
        done = {r for r in s.scalars(select(LearnProgressModel.lesson_id).where(LearnProgressModel.staff_id == sid))}
        today = datetime.now(IST).date().isoformat()
        streak, freezes = streak_for(_activity_days(s, sid), today)
        prefs = s.get(LearnPrefsModel, sid)
        badges = {b.badge_id: b.earned_at for b in s.scalars(select(BadgeModel).where(BadgeModel.staff_id == sid))}
        attempts = s.scalars(select(QuizAttemptModel).where(QuizAttemptModel.staff_id == sid, QuizAttemptModel.finished_at.is_not(None))).all()
        best: dict[str, dict[str, Any]] = {}
        for a in (x for x in attempts if _counts(x)):
            b = best.get(a.quiz_id)
            if a.total and (not b or a.score / a.total > b["score"] / b["total"]):
                best[a.quiz_id] = dict(score=a.score, total=a.total, finished_at=a.finished_at, passed=_passed_attempt(a))
        week = _iso_sum(s, sid, _week_start())
        rank = _rank(s, sid, "week")
        progress = {}
        for mid, m in c["mods"].items():
            left = [les for les in m["_lessons"] if les["id"] not in done]
            progress[mid] = dict(code=m["code"], title=m["title"], blurb=m["blurb"],
                                 done=len(m["_lessons"]) - len(left), total=len(m["_lessons"]), minutes_left=sum(les["minutes"] for les in left),
                                 next=dict(lesson_id=left[0]["id"], title=left[0]["title"], minutes=left[0]["minutes"]) if left else None)
        nxt = next(((m["id"], les) for m in c["mods"].values() for les in m["_lessons"] if les["id"] not in done), None)
        cert = {}
        for mid in c["mods"]:
            b = best.get(f"{mid}-final")
            if b and b["passed"]:
                cert[mid] = dict(title=c["mods"][mid]["title"], score=b["score"], total=b["total"], date=_ist_day(b["finished_at"]))
        return dict(
            xp=xp, level=lvl, level_name=level_name(lvl), level_floor_xp=level_xp(lvl) if lvl > 1 else 0, next_level_xp=level_xp(lvl + 1),
            streak=streak, freezes=freezes, week_xp=week, week_rank=rank, due_count=len(_due_ids(s, sid)),
            badges=[dict(id=k, earned_at=v) for k, v in badges.items()], badge_defs=c["badges"],
            completed_lessons=sorted(done), progress=progress, quiz_best=best, certificate=cert if len(cert) == len(c["mods"]) else None,
            next_lesson=dict(module=nxt[0], lesson_id=nxt[1]["id"], title=nxt[1]["title"], minutes=nxt[1]["minutes"]) if nxt else None,
            new_here=not done and xp == 0, leaderboard_optout=bool(prefs and prefs.leaderboard_optout), migrated=bool(prefs and prefs.migrated_at),
            name=staff.get("name") or staff.get("email"),
        )


def _counts(a: QuizAttemptModel) -> bool:
    """A finished attempt counts toward best score, passes and certificates unless it was a partial "retry wrong only"."""
    return bool(a.finished_at) and not json.loads(a.answers_json).get("partial")


def _passed_attempt(a: QuizAttemptModel) -> bool:
    return bool(a.total) and _counts(a) and 100 * (a.score or 0) >= _quiz_spec(a.quiz_id)["pass_pct"] * a.total


def _strip(les: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in les.items() if k not in ("check", "words", "todo")}
    out["check"] = [dict(id=q["id"], q=q["q"], o=q["o"]) for q in les["check"]]
    return out


@router.get("/content/{module}")
def content(module: str, staff: Staff):
    c = _content()
    mod = c["mods"].get(module)
    if not mod:
        raise HTTPException(404, "Unknown module.")
    head = {k: v for k, v in mod.items() if k not in ("_lessons", "final", "cards")}
    checkpoints = [dict(id=f"{module}-cp{k}", after=mod["_lessons"][3 * k - 1]["id"]) for k in range(1, len(mod["_lessons"]) // 3 + 1)]
    return dict(module={**head, "checkpoints": checkpoints, "final": dict(id=f"{module}-final", title=mod["final"]["title"], questions=len(mod["final"]["questions"]), pass_pct=mod["final"]["pass_pct"]),
                         "mock": dict(id=f"{module}-mock", questions=min(MOCK_SIZE, len(_quiz_spec(f"{module}-mock")["ids"])), minutes=MOCK_SECONDS // 60, pass_pct=MOCK_PASS)},
                lessons=[_strip(les) for les in mod["_lessons"]], cards=mod["cards"], glossary=c["glossary"])


# ---------------------------------------------------------------------------
# Lessons
# ---------------------------------------------------------------------------
@router.post("/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: str, staff: Staff):
    if lesson_id not in _content()["lessons"]:
        raise HTTPException(404, "Unknown lesson.")
    sid = staff["id"]
    with _db() as s:
        if not s.get(LearnProgressModel, (sid, lesson_id)):
            s.add(LearnProgressModel(staff_id=sid, lesson_id=lesson_id, completed_at=_iso(_now())))
            s.flush()
        gained = _award(s, sid, "lesson", lesson_id, XP["lesson"])
        gained += _daily_goal(s, sid, datetime.now(IST).date().isoformat())
        new = _check_badges(s, sid)
        before = _xp_total(s, sid) - gained
        total = before + gained
        s.commit()
        return dict(xp_awarded=gained, xp=total, level_up=level_for(total) > level_for(before), new_badges=new)


# ---------------------------------------------------------------------------
# Quizzes
# ---------------------------------------------------------------------------
class StartBody(BaseModel):
    mode: str = Field("practice", pattern="^(practice|exam)$")
    only: list[str] | None = Field(None, max_length=100)  # "retry wrong only": a subset of this quiz's questions; never pays XP


class AnswerBody(BaseModel):
    qid: str
    choice: int = Field(ge=0, le=3)


class SubmitBody(BaseModel):
    attempt_id: str
    answers: dict[str, int] = {}


def _load_attempt(s: Session, sid: str, attempt_id: str, quiz_id: str | None = None) -> tuple[QuizAttemptModel, dict[str, Any]]:
    a = s.get(QuizAttemptModel, attempt_id)
    if not a or a.staff_id != sid or (quiz_id and a.quiz_id != quiz_id):
        raise HTTPException(404, "Attempt not found.")
    return a, json.loads(a.answers_json)


@router.post("/quiz/{quiz_id}/start")
def quiz_start(quiz_id: str, body: StartBody, staff: Staff):
    spec = _quiz_spec(quiz_id)
    if quiz_id.startswith("lesson:") and body.mode != "practice":
        raise HTTPException(422, "Lesson checks are practice only.")
    c = _content()
    seed = secrets.token_hex(8)
    rng = random.Random(seed)
    ids = list(spec["ids"])
    if body.only is not None:
        if not body.only or not set(body.only) <= set(ids):
            raise HTTPException(422, "Unknown questions for this quiz.")
        ids = list(dict.fromkeys(body.only))
    rng.shuffle(ids)
    if spec.get("mock") and body.only is None:
        ids = ids[:MOCK_SIZE]
    perm = {}
    for qid in ids:
        p = list(range(4))
        rng.shuffle(p)
        perm[qid] = p  # shown position i displays original option perm[qid][i]
    limit = None
    if body.mode == "exam":
        limit = MOCK_SECONDS if spec.get("mock") else int(len(ids) * 72)
    now = _now()
    state = dict(seed=seed, order=ids, perm=perm, answers={}, seq=[], partial=body.only is not None, limit=limit, deadline=_iso(now + timedelta(seconds=limit)) if limit else None)
    aid = uuid.uuid4().hex
    with _db() as s:
        s.add(QuizAttemptModel(id=aid, staff_id=staff["id"], quiz_id=quiz_id, mode=body.mode, answers_json=json.dumps(state), started_at=_iso(now)))
        s.commit()
    qs = [dict(id=q, sec=c["questions"][q].get("sec", ""), q=c["questions"][q]["q"], o=[c["questions"][q]["o"][i] for i in perm[q]]) for q in ids]
    return dict(attempt_id=aid, quiz_id=quiz_id, title=spec["title"], mode=body.mode, pass_pct=spec["pass_pct"], time_limit_s=limit, questions=qs)


@router.post("/quiz/attempts/{attempt_id}/answer")
def quiz_answer(attempt_id: str, body: AnswerBody, staff: Staff):
    """Practice-mode feedback. The first answer to a question is locked, so feedback cannot be mined for a better score."""
    sid = staff["id"]
    with _db() as s:
        a, st = _load_attempt(s, sid, attempt_id)
        if a.mode != "practice" or a.finished_at:
            raise HTTPException(409, "Feedback is only available in an open practice attempt.")
        q = _content()["questions"].get(body.qid)
        if not q or body.qid not in st["perm"]:
            raise HTTPException(404, "Question not in this attempt.")
        perm = st["perm"][body.qid]
        correct_shown = perm.index(q["a"])
        if body.qid not in st["answers"]:
            st["answers"][body.qid] = body.choice
            st["seq"].append(body.qid)
            a.answers_json = json.dumps(st)
        chosen = st["answers"][body.qid]
        gained = 0
        if a.quiz_id.startswith("lesson:") and chosen == correct_shown:
            gained = _award(s, sid, "check", f"{a.quiz_id[7:]}:{body.qid}", XP["check"])
        extra = {"compliance_ace": False}
        if a.quiz_id.startswith("lesson:") and _content()["lessons"][a.quiz_id[7:]]["stage"] == "Compliance" and len(st["answers"]) == len(st["order"]):
            if all(st["answers"][x] == st["perm"][x].index(_content()["questions"][x]["a"]) for x in st["order"]):
                extra["compliance_ace"] = True
        new = _check_badges(s, sid, extra)
        s.commit()
        return dict(correct=chosen == correct_shown, locked_choice=chosen, correct_choice=correct_shown, why=q["why"], lesson_id=_content()["q_lesson"].get(body.qid), xp_awarded=gained, new_badges=new)


def _score(st: dict[str, Any], answers: dict[str, int]) -> tuple[int, list[dict[str, Any]], int]:
    c = _content()
    score, missed, combo, run = 0, [], 0, 0
    seq = st.get("seq", [])
    for qid in st["order"]:
        q = c["questions"][qid]
        perm = st["perm"][qid]
        shown = [q["o"][i] for i in perm]
        correct_shown = perm.index(q["a"])
        chosen = answers.get(qid)
        if chosen == correct_shown:
            score += 1
        else:
            missed.append(dict(id=qid, q=q["q"], options=shown, correct=correct_shown, chosen=chosen, why=q["why"], lesson_id=c["q_lesson"].get(qid)))
    for qid in seq:  # combo bonus: +1 XP per correct answer after the 2nd in a row (practice only)
        run = run + 1 if answers.get(qid) == st["perm"][qid].index(c["questions"][qid]["a"]) else 0
        combo += 1 if run > 2 else 0
    return score, missed, combo


@router.post("/quiz/{quiz_id}/submit")
def quiz_submit(quiz_id: str, body: SubmitBody, staff: Staff):
    spec = _quiz_spec(quiz_id)
    sid = staff["id"]
    with _db() as s:
        a, st = _load_attempt(s, sid, body.attempt_id, quiz_id)
        if a.finished_at:
            raise HTTPException(409, "Attempt already submitted.")
        now = _now()
        timed_out = bool(st["deadline"]) and now > datetime.fromisoformat(st["deadline"]) + timedelta(seconds=GRACE_SECONDS)
        answers = st["answers"] if a.mode == "practice" else {k: v for k, v in body.answers.items() if k in st["perm"] and 0 <= v <= 3}
        score, missed, combo = _score(st, answers)
        total = len(st["order"])
        passed = 100 * score >= spec["pass_pct"] * total
        first = not any(_counts(x) for x in s.scalars(select(QuizAttemptModel).where(QuizAttemptModel.staff_id == sid, QuizAttemptModel.quiz_id == quiz_id)))
        a.score, a.total, a.finished_at = score, total, _iso(now)
        a.answers_json = json.dumps({**st, "answers": answers})
        gained = 0
        if passed and not timed_out and not st.get("partial") and not quiz_id.startswith("lesson:"):
            gained += _award(s, sid, "quiz_pass", quiz_id, XP["quiz_pass"])
            if first and score == total:
                gained += _award(s, sid, "perfect", quiz_id, XP["perfect"])
            if a.mode == "practice" and combo:
                gained += _award(s, sid, "combo", quiz_id, combo)
        new = _check_badges(s, sid, {"perfect_final": quiz_id.endswith("-final") and score == total and total >= 30 and not timed_out and not st.get("partial")})
        total_xp = _xp_total(s, sid)
        s.commit()
        return dict(score=score, total=total, passed=passed and not timed_out, timed_out=timed_out, pass_pct=spec["pass_pct"], xp_awarded=gained,
                    xp=total_xp, level_up=level_for(total_xp) > level_for(total_xp - gained), perfect=score == total, missed=missed, new_badges=new, attempt_id=a.id)


@router.post("/quiz/attempts/{attempt_id}/add-missed-to-cards")
def add_missed_to_cards(attempt_id: str, staff: Staff):
    """Make the flashcards of every lesson with a missed question due now (state kept if already reviewed)."""
    c = _content()
    sid = staff["id"]
    with _db() as s:
        a, st = _load_attempt(s, sid, attempt_id)
        if not a.finished_at:
            raise HTTPException(409, "Submit the attempt first.")
        _, missed, _ = _score(st, st["answers"])
        card_ids = {cid for m in missed for cid in c["lessons"][m["lesson_id"]]["card_ids"]} if missed else set()
        now = _iso(_now())
        for cid in card_ids:
            row = s.get(CardReviewModel, (sid, cid))
            if row:
                row.due_at = min(row.due_at, now)
            else:
                s.add(CardReviewModel(staff_id=sid, card_id=cid, fsrs_json=None, due_at=now))
        s.commit()
        return dict(cards_added=len(card_ids))


# ---------------------------------------------------------------------------
# Flashcards (scheduling runs in the client with ts-fsrs; the server stores the state)
# ---------------------------------------------------------------------------
class ReviewBody(BaseModel):
    rating: int = Field(ge=1, le=4)
    fsrs: dict[str, Any]
    due: str


def _parse_due(due: str) -> datetime:
    try:
        d = datetime.fromisoformat(due.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(422, "Invalid due date.") from e
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    if d > _now() + timedelta(days=3660):
        raise HTTPException(422, "Due date too far ahead.")
    return d.astimezone(UTC)


@router.get("/cards/due")
def cards_due(staff: Staff, module: str | None = None, deck: str = Query("due", pattern="^(due|all|unknown|lesson)$"), lesson: str | None = None):
    c = _content()
    sid = staff["id"]
    with _db() as s:
        rows = {r.card_id: r for r in s.scalars(select(CardReviewModel).where(CardReviewModel.staff_id == sid))}
        if deck == "due":
            ids = _due_ids(s, sid, module)
        else:
            pool = [cid for cid, k in c["cards"].items() if not module or k["module"] == module]
            if deck == "lesson":
                les = c["lessons"].get(lesson or "")
                ids = [x for x in (les["card_ids"] if les else []) if x in pool]
            elif deck == "unknown":
                ids = [x for x in pool if x in rows and (json.loads(rows[x].fsrs_json or "{}").get("_r", 1) <= 2)]
            else:
                ids = pool
        out = [dict(id=cid, fsrs=json.loads(rows[cid].fsrs_json) if cid in rows and rows[cid].fsrs_json else None, due=rows[cid].due_at if cid in rows else None) for cid in ids]
        return dict(cards=out, reviewed_today=_reviewed_today(s, sid))


@router.post("/cards/{card_id}/review")
def card_review(card_id: str, body: ReviewBody, staff: Staff):
    if card_id not in _content()["cards"]:
        raise HTTPException(404, "Unknown card.")
    if len(json.dumps(body.fsrs)) > 2000:
        raise HTTPException(422, "Card state too large.")
    sid = staff["id"]
    due = _parse_due(body.due)
    with _db() as s:
        state = json.dumps({**body.fsrs, "_r": body.rating})
        row = s.get(CardReviewModel, (sid, card_id))
        if row:
            row.fsrs_json, row.due_at = state, _iso(due)
        else:
            s.add(CardReviewModel(staff_id=sid, card_id=card_id, fsrs_json=state, due_at=_iso(due)))
        s.flush()
        today = datetime.now(IST).date().isoformat()
        gained = _award(s, sid, "card", f"{card_id}:{today}", XP["card"])
        gained += _daily_goal(s, sid, today)
        new = _check_badges(s, sid)
        total = _xp_total(s, sid)
        s.commit()
        return dict(xp_awarded=gained, xp=total, level_up=level_for(total) > level_for(total - gained), new_badges=new)


# ---------------------------------------------------------------------------
# Leaderboard, prefs, one-time migration of the old localStorage progress
# ---------------------------------------------------------------------------
def _iso_sum(s: Session, sid: str, since: str | None) -> int:
    q = select(func.coalesce(func.sum(XpEventModel.xp), 0)).where(XpEventModel.staff_id == sid)
    if since:
        q = q.where(XpEventModel.ts >= since)
    return int(s.scalar(q) or 0)


def _board(s: Session, period: str) -> list[tuple[str, int]]:
    q = select(XpEventModel.staff_id, func.sum(XpEventModel.xp)).group_by(XpEventModel.staff_id)
    if period == "week":
        q = q.where(XpEventModel.ts >= _week_start())
    hidden = set(s.scalars(select(LearnPrefsModel.staff_id).where(LearnPrefsModel.leaderboard_optout == 1)))
    rows = [(sid, int(x)) for sid, x in s.execute(q) if sid not in hidden and x]
    return sorted(rows, key=lambda r: (-r[1], r[0]))


def _rank(s: Session, sid: str, period: str) -> int | None:
    for i, (staff_id, _) in enumerate(_board(s, period), 1):
        if staff_id == sid:
            return i
    return None


@router.get("/leaderboard")
def leaderboard(staff: Staff, period: str = Query("week", pattern="^(week|all)$")):
    with _db() as s:
        board = _board(s, period)
        top = []
        for i, (sid, xp) in enumerate(board[:10], 1):
            who = sqlite.get_customer_by_id(sid) or {}
            top.append(dict(rank=i, name=who.get("name") or "Staff member", xp=xp, you=sid == staff["id"]))
        mine = next(((i, xp) for i, (sid, xp) in enumerate(board, 1) if sid == staff["id"]), None)
        prefs = s.get(LearnPrefsModel, staff["id"])
        return dict(period=period, top=top, you=dict(rank=mine[0], xp=mine[1]) if mine else None, hidden=bool(prefs and prefs.leaderboard_optout))


class PrefsBody(BaseModel):
    leaderboard_optout: bool


@router.put("/prefs")
def set_prefs(body: PrefsBody, staff: Staff):
    with _db() as s:
        p = s.get(LearnPrefsModel, staff["id"]) or LearnPrefsModel(staff_id=staff["id"], leaderboard_optout=0)
        p.leaderboard_optout = int(body.leaderboard_optout)
        s.merge(p)
        s.commit()
    return dict(leaderboard_optout=body.leaderboard_optout)


class LegacyCard(BaseModel):
    card_id: str
    fsrs: dict[str, Any]
    due: str


class LegacyBest(BaseModel):
    score: int = Field(ge=0, le=100)
    total: int = Field(ge=1, le=100)


class MigrateBody(BaseModel):
    cards: list[LegacyCard] = Field(default_factory=list, max_length=300)
    best: dict[str, LegacyBest] = Field(default_factory=dict)


@router.post("/migrate-local")
def migrate_local(body: MigrateBody, staff: Staff):
    """Import the old browser-only progress once per staff member. Awards no XP."""
    c = _content()
    sid = staff["id"]
    with _db() as s:
        p = s.get(LearnPrefsModel, sid) or LearnPrefsModel(staff_id=sid, leaderboard_optout=0)
        if p.migrated_at:
            return dict(migrated=False, reason="already migrated")
        n = 0
        for lc in body.cards:
            if lc.card_id in c["cards"] and not s.get(CardReviewModel, (sid, lc.card_id)) and len(json.dumps(lc.fsrs)) <= 2000:
                s.add(CardReviewModel(staff_id=sid, card_id=lc.card_id, fsrs_json=json.dumps({**lc.fsrs, "_r": 3}), due_at=_iso(_parse_due(lc.due))))
                n += 1
        for qid, b in body.best.items():
            if qid in (f"{m}-final" for m in c["mods"]) and b.score <= b.total == len(_quiz_spec(qid)["ids"]):
                t = _iso(_now())
                s.add(QuizAttemptModel(id=uuid.uuid4().hex, staff_id=sid, quiz_id=qid, mode="legacy", score=b.score, total=b.total, answers_json="{}", started_at=t, finished_at=t))
        p.migrated_at = _iso(_now())
        s.merge(p)
        s.flush()
        _check_badges(s, sid)
        s.commit()
        return dict(migrated=True, cards=n)