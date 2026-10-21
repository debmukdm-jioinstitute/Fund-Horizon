"""Migrate local factsheet archive files to Cloudflare R2 and vacuum SQLite.

Usage:
    python scripts/migrate_factsheets_to_r2.py
    python backend/scripts/migrate_factsheets_to_r2.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.backoffice.collectors import factsheet_archive_dir
from app.db import sqlite as _sqlite
from app.storage import r2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate_factsheets_to_r2")


def migrate() -> None:
    if not r2.enabled():
        logger.error(
            "Cloudflare R2 is not configured. Missing required env vars: "
            "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"
        )
        sys.exit(1)

    archive_dir = factsheet_archive_dir()
    logger.info("Factsheet archive directory: %s", archive_dir)

    conn = _sqlite.get_default_connection()
    try:
        # Check if factsheets table exists
        table_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='factsheets'"
        ).fetchone()
        if not table_exists:
            logger.info("Table 'factsheets' does not exist yet. Nothing to migrate.")
            return

        migrated_files = 0
        freed_bytes = 0

        if archive_dir.exists() and archive_dir.is_dir():
            files = [p for p in archive_dir.iterdir() if p.is_file() and not p.name.startswith(".")]
            logger.info("Found %d local file(s) in archive directory.", len(files))

            for file in files:
                key = f"factsheets/{file.name}"
                size = file.stat().st_size

                # 1. Upload to R2 if not already there
                if not r2.exists(key):
                    logger.info("Uploading %s to R2 (%s)...", file.name, key)
                    r2.put_file(file, key, content_type="application/pdf")

                # 2. Verify exists in R2
                if r2.exists(key):
                    # 3. Update DB rows referencing this local file
                    with conn:
                        conn.execute(
                            """
                            UPDATE factsheets
                            SET archived_path = ?
                            WHERE archived_path = ?
                               OR archived_path = ?
                               OR archived_path = ?
                               OR archived_path LIKE ?
                            """,
                            (key, str(file), str(file.resolve()), file.name, f"%/{file.name}"),
                        )
                    # 4. Safely delete local copy
                    file.unlink(missing_ok=True)
                    migrated_files += 1
                    freed_bytes += size
                else:
                    logger.error("Failed to verify existence of %s in R2. Skipping local deletion.", key)
        else:
            logger.info("Archive directory does not exist or is not a directory. Scanning DB for orphan paths...")

        # Update any remaining DB rows that have absolute paths if their key exists in R2
        rows = conn.execute(
            "SELECT id, archived_path FROM factsheets WHERE archived_path IS NOT NULL AND archived_path LIKE '/%'"
        ).fetchall()
        for row in rows:
            filename = Path(row["archived_path"]).name
            key = f"factsheets/{filename}"
            if r2.exists(key):
                with conn:
                    conn.execute("UPDATE factsheets SET archived_path = ? WHERE id = ?", (key, row["id"]))
                logger.info("Updated factsheet row %d from local path to %s", row["id"], key)

        logger.info(
            "Migration complete: %d file(s) migrated, freed ~%.2f MB.",
            migrated_files,
            freed_bytes / (1024 * 1024),
        )

        # 5. Reclaim SQLite disk space
        logger.info("Running SQLite VACUUM to reclaim disk space...")
        conn.execute("VACUUM")
        logger.info("SQLite VACUUM completed successfully.")

    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
