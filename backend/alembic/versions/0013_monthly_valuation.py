"""Monthly valuation module: additive ``val_*`` tables (batches, files, accounts, holdings, cash flows, reconciliation,
snapshots, report versions, audit log) plus SQLite append-only triggers on snapshots, report versions and the audit log.

Safe by design: only creates what is missing, never alters or drops existing tables. The same DDL is applied lazily at runtime
by ``app.backoffice.valuation.models.ensure_schema`` so a deploy never depends on migration order.

shortcut: this reuses the live model tables; if val_* columns change after the first deploy, freeze this file into explicit
op.create_table calls and add a new revision for the change.

Revision ID: valuation_0013
Revises: lead_sr_no_0012
Create Date: 2026-11-02 10:00:00.000000
"""

import os
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "valuation_0013"
down_revision: Union[str, None] = "lead_sr_no_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from app.backoffice.valuation import models as m

    bind = op.get_bind()
    m.Base.metadata.create_all(bind, tables=m.TABLES, checkfirst=True)
    if bind.dialect.name == "sqlite":
        for ddl in m.immutability_ddl():
            bind.exec_driver_sql(ddl)


def downgrade() -> None:
    """Drops ONLY the new val_* tables. Refuses when approved snapshots exist (they are the audit record) unless FH_VAL_ALLOW_DROP=1."""
    from app.backoffice.valuation import models as m

    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "val_snapshots" in insp.get_table_names() and os.environ.get("FH_VAL_ALLOW_DROP") != "1":
        if bind.execute(sa.text("SELECT COUNT(*) FROM val_snapshots")).scalar():
            raise RuntimeError("Refusing to drop val_* tables: approved snapshots exist. Take a backup, then set FH_VAL_ALLOW_DROP=1.")
    if bind.dialect.name == "sqlite":
        for t in m._IMMUTABLE:
            for op_ in ("update", "delete"):
                bind.exec_driver_sql(f"DROP TRIGGER IF EXISTS trg_{t}_no_{op_}")
    for tbl in reversed(m.TABLES):
        tbl.drop(bind, checkfirst=True)
