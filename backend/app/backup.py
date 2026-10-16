"""Daily online backup of the SQLite database, plus a loud warning when it sits on throw-away storage."""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.db.sqlite import get_default_db_path

log = logging.getLogger(__name__)
KEEP = int(os.environ.get("FH_BACKUP_KEEP", "14"))


def uses_sqlite() -> bool:
    return not os.environ.get("DATABASE_URL", "").strip().startswith(("postgres://", "postgresql://"))


def warn_if_ephemeral() -> None:
    """On Railway a SQLite file outside the attached volume is wiped on every deploy."""
    if not uses_sqlite() or not os.environ.get("RAILWAY_ENVIRONMENT"):
        return
    vol = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "")
    if not vol or not str(get_default_db_path().resolve()).startswith(str(Path(vol).resolve())):
        log.critical(
            "CRM DATA AT RISK: SQLite at %s is not on a Railway volume (RAILWAY_VOLUME_MOUNT_PATH=%r) and DATABASE_URL is unset. "
            "Attach a volume and set FH_DB_PATH inside it, or set DATABASE_URL to PostgreSQL.", get_default_db_path(), vol,
        )


def backup_sqlite() -> Path | None:
    """One consistent snapshot per UTC day in <db dir>/backups, newest KEEP kept. Returns the file, or None if skipped."""
    if not uses_sqlite():
        return None  # PostgreSQL: use the provider's point-in-time backups
    src_path = get_default_db_path()
    if not src_path.exists():
        return None
    dest_dir = src_path.parent / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{src_path.stem}-{datetime.now(UTC):%Y%m%d}.db"
    if dest.exists():
        return None
    tmp = dest.with_suffix(".tmp")
    src, dst = sqlite3.connect(src_path), sqlite3.connect(tmp)
    try:
        src.backup(dst)  # online backup API: safe while the app is writing
    finally:
        dst.close()
        src.close()
    tmp.replace(dest)
    for old in sorted(dest_dir.glob(f"{src_path.stem}-*.db"))[:-KEEP]:
        old.unlink()
    return dest
