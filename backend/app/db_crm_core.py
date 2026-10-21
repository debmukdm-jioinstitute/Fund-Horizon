from __future__ import annotations
"""Raw-SQLite DDL for the CRM core tables (W1).

``init_crm_core_schema(conn)`` is idempotent (``CREATE TABLE IF NOT EXISTS``).
The coordinator wires it into ``SQLiteRepository._init_schema``; the Alembic
migration ``0003_crm_core`` carries the matching Postgres DDL and
``app/repo_crm_core.py`` additionally ensures the schema via SQLAlchemy
``create_all`` on first use, so tests work without manual migration steps.
"""


import sqlite3


def init_crm_core_schema(conn: sqlite3.Connection) -> None:
    """Create the CRM core tables if they do not exist yet."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS households (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            primary_customer_id TEXT,
            rm_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_households_rm ON households(rm_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS household_members (
            id TEXT PRIMARY KEY,
            household_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'other',
            UNIQUE(household_id, customer_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_household_members_household ON household_members(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_household_members_customer ON household_members(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY,
            sr_no INTEGER,
            name TEXT NOT NULL,
            email TEXT,
            mobile TEXT,
            source TEXT NOT NULL DEFAULT 'other',
            status TEXT NOT NULL DEFAULT 'new',
            assigned_rm_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            converted_household_id TEXT,
            converted_at TEXT,
            updated_at TEXT,
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_leads_email ON leads(email)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_leads_mobile ON leads(mobile)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_leads_status ON leads(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_leads_assigned_rm ON leads(assigned_rm_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS opportunities (
            id TEXT PRIMARY KEY,
            household_id TEXT,
            customer_id TEXT,
            product_line TEXT NOT NULL,
            title TEXT NOT NULL,
            amount INTEGER,
            stage TEXT NOT NULL,
            probability INTEGER NOT NULL DEFAULT 0,
            expected_close TEXT,
            assigned_rm_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            lost_reason TEXT,
            closed_at TEXT,
            won_amount INTEGER,
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opportunities_household ON opportunities(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opportunities_assigned_rm ON opportunities(assigned_rm_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opportunities_line_stage ON opportunities(product_line, stage)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT,
            household_id TEXT,
            customer_id TEXT,
            opportunity_id TEXT,
            case_id TEXT,
            lead_id TEXT,
            policy_id TEXT,
            fd_id TEXT,
            due_at TEXT,
            done_at TEXT,
            assigned_rm_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_assigned ON activities(assigned_rm_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_household ON activities(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_due ON activities(due_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_policy ON activities(policy_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_lead ON activities(lead_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_activities_fd ON activities(fd_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            category TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            sla_due_at TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            updated_at TEXT,
            created_by TEXT,
            updated_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_cases_customer ON cases(customer_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_cases_status ON cases(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_cases_sla ON cases(sla_due_at)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            entity TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            field TEXT NOT NULL,
            old TEXT,
            new TEXT,
            actor_id TEXT,
            at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON audit_log(entity)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_entity_id ON audit_log(entity_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS crm_list_views (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            entity TEXT NOT NULL,
            name TEXT NOT NULL,
            filters TEXT NOT NULL DEFAULT '{}',
            columns TEXT NOT NULL DEFAULT '[]',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, entity, name)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_crm_list_views_user ON crm_list_views(user_id)")
