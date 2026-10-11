"""Utility script to verify connection to Supabase or PostgreSQL."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

load_dotenv(backend_dir / ".env")

from sqlalchemy import create_engine, text
from app.db.postgres import normalize_postgres_url


def test_connection() -> bool:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("❌ DATABASE_URL is not set in backend/.env or environment.")
        return False

    print(f"🔗 Testing database connection...")
    try:
        normalized_url = normalize_postgres_url(db_url)
        # Mask password in log output
        import re
        masked = re.sub(r":([^@]+)@", ":****@", normalized_url)
        print(f"   Target: {masked}")

        engine = create_engine(normalized_url, pool_pre_ping=True)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version();")).scalar()
            print("✅ Successfully connected to PostgreSQL!")
            print(f"   Database Version: {result}")
            return True
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False


if __name__ == "__main__":
    success = test_connection()
    sys.exit(0 if success else 1)
