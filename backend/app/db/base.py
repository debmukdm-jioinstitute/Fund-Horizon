"""Abstract Database Repository Protocol & Base Class.

Defines the contract for persistence backends (SQLite for local/test,
PostgreSQL with connection pooling for Supabase/Neon production).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DatabaseRepository(ABC):
    """Abstract persistence interface for Fund Horizon."""

    @abstractmethod
    def save_plan(
        self,
        request: dict[str, Any],
        result: dict[str, Any],
        plan_id: str | None = None,
        created_at: str | None = None,
    ) -> str:
        """Persist a planning calculation request and response."""
        ...

    @abstractmethod
    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        """Retrieve a stored plan by its UUID string."""
        ...

    @abstractmethod
    def list_plans(self, limit: int = 50, offset: int = 0, search: str | None = None) -> list[dict[str, Any]]:
        """List stored plans with pagination and optional search query."""
        ...

    @abstractmethod
    def count_plans(self) -> int:
        """Return total count of stored plans."""
        ...

    @abstractmethod
    def delete_plan(self, plan_id: str) -> bool:
        """Delete a stored plan by id. Returns True if deleted, False if not found."""
        ...

    @abstractmethod
    def save_cas_session(
        self,
        payload: dict[str, Any],
        investor_name: str | None = None,
        total_value: float = 0.0,
        xirr: float | None = None,
        session_id: str | None = None,
    ) -> str:
        """Persist an anonymized CAS statement analysis session."""
        ...

    @abstractmethod
    def get_cas_session(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve a stored CAS analysis session by its UUID string."""
        ...

    @abstractmethod
    def list_cas_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        """List stored CAS sessions with pagination."""
        ...

    @abstractmethod
    def count_cas_sessions(self) -> int:
        """Return total count of stored CAS analysis sessions."""
        ...

    @abstractmethod
    def upsert_funds(self, funds: list[dict[str, Any]]) -> int:
        """Upsert fund scheme directory entries. Returns number of rows touched."""
        ...

    @abstractmethod
    def get_fund(self, scheme_code: str) -> dict[str, Any] | None:
        """Retrieve a fund scheme by scheme_code."""
        ...

    @abstractmethod
    def list_funds(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        """List fund schemes with pagination."""
        ...

    @abstractmethod
    def upsert_metrics(self, metrics: list[dict[str, Any]]) -> int:
        """Upsert calculated fund metrics. Returns number of rows touched."""
        ...

    @abstractmethod
    def get_metrics(self, scheme_code: str) -> dict[str, Any] | None:
        """Retrieve performance metrics for a scheme code."""
        ...

    @abstractmethod
    def get_db_info(self) -> dict[str, Any]:
        """Return status metadata about the database backend."""
        ...
