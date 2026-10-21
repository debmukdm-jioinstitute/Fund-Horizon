from __future__ import annotations
"""Abstract Database Repository Protocol & Base Class.

Defines the contract for persistence backends (SQLite for local/test,
PostgreSQL with connection pooling for Supabase/Neon production).
"""

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
        customer_id: str | None = None,
    ) -> str:
        """Persist a planning calculation request and response."""
        ...

    @abstractmethod
    def list_customer_plans(
        self, customer_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """List plan summaries belonging to one customer."""
        ...

    @abstractmethod
    def count_customer_plans(self, customer_id: str) -> int:
        """Return the number of plans belonging to one customer."""
        ...

    @abstractmethod
    def create_customer(
        self,
        name: str,
        email: str,
        mobile: str,
        password_hash: str,
        role: str = "customer",
        assigned_rm_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a customer account. Returns the public customer record (no password hash).

        Raises ValueError if the email or mobile is already registered.
        """
        ...

    @abstractmethod
    def get_customer_by_id(self, customer_id: str) -> dict[str, Any] | None:
        """Retrieve a customer by id, including the password hash (internal use)."""
        ...

    @abstractmethod
    def get_customer_by_email(self, email: str) -> dict[str, Any] | None:
        """Retrieve a customer by lowercased email, including the password hash (internal use)."""
        ...

    @abstractmethod
    def get_customer_by_mobile(self, mobile: str) -> dict[str, Any] | None:
        """Retrieve a customer by digits-only mobile, including the password hash (internal use)."""
        ...

    @abstractmethod
    def list_customers(
        self,
        limit: int = 50,
        offset: int = 0,
        assigned_rm_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List public customer records with plan counts, optionally filtered by assigned RM."""
        ...

    @abstractmethod
    def count_customers(self, assigned_rm_id: str | None = None) -> int:
        """Return total customer count, optionally filtered by assigned RM."""
        ...

    @abstractmethod
    def update_customer(self, customer_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        """Update allowed customer fields (role, assigned_rm_id). Returns the public record."""
        ...

    @abstractmethod
    def create_auth_session(self, customer_id: str, token_sha256: str, expires_at: str) -> None:
        """Persist a login session keyed by the SHA-256 of the bearer token."""
        ...

    @abstractmethod
    def get_auth_session(self, token_sha256: str) -> dict[str, Any] | None:
        """Retrieve a login session by token hash."""
        ...

    @abstractmethod
    def delete_auth_session(self, token_sha256: str) -> bool:
        """Delete a login session. Returns True if one was removed."""
        ...

    @abstractmethod
    def purge_expired_auth_sessions(self) -> int:
        """Delete expired login sessions. Returns the number removed."""
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
