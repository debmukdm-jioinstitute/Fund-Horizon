"""Who may use the CRM, and what they can see.

* ``admin``      — everything, can write.
* ``rm``         — their own book; a **team lead** (someone others report to in ``rm_teams``) also sees and edits
                   their reports' books.
* ``compliance`` — read-only access to everything; every write is refused.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.api.auth import get_optional_customer
from app.db import sqlite
from app.repo_crm_phase3 import team_ids

CRM_ROLES = ("admin", "rm", "compliance")
UNSCOPED_ROLES = ("admin", "compliance")
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# POSTs that only read (nothing is written), so read-only accounts may use them
_READ_ONLY_POSTS = {"/api/crm/duplicates/check"}

def unscoped(me: dict) -> bool:
    """True when the account sees every record (admin and compliance)."""
    return me["role"] in UNSCOPED_ROLES


def crm_user(request: Request, customer: Annotated[dict | None, Depends(get_optional_customer)]) -> dict:
    if not customer:
        raise HTTPException(401, "Sign in to continue.")

    role = customer.get("role", "admin")
    if role not in CRM_ROLES:
        if customer.get("is_staff"):
            role = "admin"
        else:
            raise HTTPException(403, "You do not have permission to access this resource.")
    if role == "compliance" and request.method not in _SAFE_METHODS and request.url.path not in _READ_ONLY_POSTS:
        raise HTTPException(403, "Compliance accounts are read-only.")
    return {**customer, "role": role, "_team": None if role in UNSCOPED_ROLES else team_ids(customer["id"])}
