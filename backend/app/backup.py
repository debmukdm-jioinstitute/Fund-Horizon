from __future__ import annotations
"""Backup and restore of the SQLite database using Cloudflare R2 or local fallback."""

import gzip
import logging
import os
import shutil
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from app.db.sqlite import get_default_db_path
from app.storage import r2

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
            "Attach a volume and set FH_DB_PATH inside it, or set DATABASE_URL to PostgreSQL.",
            get_default_db_path(),
            vol,
        )


def restore_if_needed() -> bool:
    """On startup, if SQLite DB is missing or empty and R2 is enabled, restore the newest backup."""
    if not uses_sqlite() or not r2.enabled():
        return False
    src_path = get_default_db_path()
    if src_path.exists() and src_path.stat().st_size > 100:
        return False

    backups = sorted(r2.list_keys(prefix="backups/plans-"))
    if not backups:
        log.info("Restore on boot: No backups found in R2.")
        return False

    newest = backups[-1]
    log.info("Restore on boot: Restoring %s from R2 object %s", src_path, newest)
    tmp_parent = "/tmp" if os.path.exists("/tmp") else None
    with tempfile.TemporaryDirectory(dir=tmp_parent) as tmpdir:
        gz_file = Path(tmpdir) / "backup.db.gz"
        r2.get_file(newest, gz_file)

        raw_db = Path(tmpdir) / "restored.db"
        with gzip.open(gz_file, "rb") as f_in, open(raw_db, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

        src_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(raw_db), str(src_path))

    log.info("Restore on boot: Restored %s (%d bytes) from %s", src_path, src_path.stat().st_size, newest)
    return True


def backup_sqlite() -> Path | str | None:
    """Take a consistent SQLite snapshot, gzip and upload to R2 (or fallback to local disk)."""
    if not uses_sqlite():
        return None
    src_path = get_default_db_path()
    if not src_path.exists() or src_path.stat().st_size == 0:
        return None

    if r2.enabled():
        now_str = datetime.now(UTC).strftime("%Y%m%d-%H%M")
        key = f"backups/plans-{now_str}.db.gz"
        tmp_parent = "/tmp" if os.path.exists("/tmp") else None
        with tempfile.TemporaryDirectory(dir=tmp_parent) as tmpdir:
            tmp_db = Path(tmpdir) / "plans.db"
            gz_db = Path(tmpdir) / f"plans-{now_str}.db.gz"

            src, dst = sqlite3.connect(src_path), sqlite3.connect(tmp_db)
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()

            with open(tmp_db, "rb") as f_in, gzip.open(gz_db, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

            r2.put_file(gz_db, key, content_type="application/gzip")

        # Keep last KEEP in R2
        all_backups = sorted(r2.list_keys(prefix="backups/plans-"))
        if len(all_backups) > KEEP:
            for old in all_backups[:-KEEP]:
                r2.delete(old)

        # Clean legacy local backups on volume if present to reclaim disk
        legacy_dir = src_path.parent / "backups"
        if legacy_dir.exists() and legacy_dir.is_dir():
            for old_local in legacy_dir.glob("plans-*.db*"):
                old_local.unlink(missing_ok=True)

        log.info("Backed up SQLite database to R2: %s", key)
        return key

    # Fallback to local disk when R2 is not configured
    dest_dir = src_path.parent / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{src_path.stem}-{datetime.now(UTC):%Y%m%d}.db"
    if dest.exists():
        return None
    tmp = dest.with_suffix(".tmp")
    src, dst = sqlite3.connect(src_path), sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    tmp.replace(dest)
    for old in sorted(dest_dir.glob(f"{src_path.stem}-*.db"))[:-KEEP]:
        old.unlink()
    return dest
