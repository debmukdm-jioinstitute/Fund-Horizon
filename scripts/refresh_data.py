"""Copy local scheme metrics and month-end NAVs into Supabase.

    python scripts/refresh_data.py

Run `alembic upgrade head` first. Plans and cas_sessions are not touched.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")


def main() -> int:
    from app.db.postgres import connect_session, database_url
    from app.db.refresh import sync

    if not database_url():
        print("DATABASE_URL is not set in backend/.env.")
        return 1

    data_dir = Path(os.environ.get("FH_DATA_DIR", ROOT / "data" / "fundhorizon_mf_rag_dataset"))
    with connect_session() as conn:
        counts = sync(conn, data_dir)
    print(
        f"funds {counts['funds']}, metrics {counts['metrics']}, "
        f"nav_monthly {counts['nav_monthly']}, nav files skipped {counts['nav_files_skipped']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
