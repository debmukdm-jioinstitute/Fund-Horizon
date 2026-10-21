#!/usr/bin/env bash
set -euo pipefail

DB_FILE="${1:-plans.db}"
if [ ! -f "$DB_FILE" ]; then
  if [ -f "data/plans.db" ]; then
    DB_FILE="data/plans.db"
  fi
fi

echo "Dumping $DB_FILE to dump.sql..."
sqlite3 "$DB_FILE" .dump | grep -vE '^(BEGIN|COMMIT|PRAGMA)' > dump.sql
echo "Executing dump.sql on Cloudflare D1 (fund-horizon)..."
npx wrangler d1 execute fund-horizon --remote --file=dump.sql
echo "Done."
