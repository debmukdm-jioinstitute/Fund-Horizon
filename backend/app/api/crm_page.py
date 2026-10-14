"""Shared list pagination for the CRM routers: ``limit``/``offset``/``sort``/``q``.

Lists keep returning bare JSON arrays (existing clients rely on that); the
match count before paging is sent in the ``X-Total-Count`` header.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, HTTPException, Query, Response

from app.repo_crm_core import CrmCoreError, Page


def _page_params(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str | None = Query(None, max_length=64, description="Column name; prefix with '-' for descending"),
    q: str | None = Query(None, max_length=100, description="Case-insensitive text search"),
) -> Page:
    return Page(limit=limit, offset=offset, sort=sort or None, q=(q or "").strip() or None)


PageParams = Annotated[Page, Depends(_page_params)]


def send_total(response: Response, page: Page, total: int | None = None) -> None:
    response.headers["X-Total-Count"] = str(page.total if total is None else total)


def guard(fn, *args: Any, **kwargs: Any):
    """Run a repo call, turning ``CrmCoreError`` into a 422."""
    try:
        return fn(*args, **kwargs)
    except CrmCoreError as e:
        raise HTTPException(422, str(e)) from e


def paginate_rows(rows: list[dict], page: Page) -> list[dict]:
    """In-memory q/sort/limit/offset for lists that are not SQL-backed (sets ``page.total``)."""
    if page.q:
        needle = page.q.lower()
        rows = [r for r in rows if any(needle in str(v).lower() for v in r.values() if v is not None)]
    if page.sort:
        key = page.sort.lstrip("-")
        if rows and key not in rows[0]:
            raise HTTPException(422, f"sort must be a field name (optionally prefixed with '-'), got '{key}'")
        rows = sorted(rows, key=lambda r: (r.get(key) is None, r.get(key)), reverse=page.sort.startswith("-"))
    page.total = len(rows)
    return rows[page.offset : page.offset + page.limit]
