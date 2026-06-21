#!/usr/bin/env bash
# migrate-from-akaun.sh
# One-time migration from Akaun (SwiftData/macOS) to Akaun Web (Drizzle/SQLite).
# Run from the akaun-web project root:  bash scripts/migrate-from-akaun.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_DB="$HOME/Library/Application Support/Akaun/default.store"
TARGET_DB="$PROJECT_DIR/data/akaun.db"
SOURCE_DOCS="$HOME/Library/Application Support/Akaun/Documents"
TARGET_STORAGE="$PROJECT_DIR/data/storage"

# ── Validate prerequisites ─────────────────────────────────────────────────────

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "ERROR: Source database not found at: $SOURCE_DB" >&2
  exit 1
fi

if [[ ! -f "$TARGET_DB" ]]; then
  echo "ERROR: Target database not found at: $TARGET_DB" >&2
  echo "       Start the web app at least once so migrations run and the DB is created." >&2
  exit 1
fi

# ── Safety backup ──────────────────────────────────────────────────────────────

BACKUP="$TARGET_DB.bak.$(date +%Y%m%d%H%M%S)"
cp "$TARGET_DB" "$BACKUP"
echo "Backed up target DB to: $BACKUP"

# ── Check for existing data ────────────────────────────────────────────────────

EXISTING=$(sqlite3 "$TARGET_DB" "SELECT count(*) FROM expenses;")
if [[ "$EXISTING" -gt 0 ]]; then
  echo "WARNING: Target already has $EXISTING expense(s)." >&2
  read -r -p "         Continue anyway? This may create duplicates. [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── DB Migration ───────────────────────────────────────────────────────────────
# Delegated to a TypeScript script so it can reuse the app's contact
# resolve-or-create logic (src/lib/server/queries/contacts.ts) for supplier/
# customer dedup instead of re-implementing it in raw SQL.

echo ""
echo "Running DB migration..."

cd "$PROJECT_DIR" && bun run scripts/migrate-from-akaun.ts "$SOURCE_DB" "$TARGET_DB"

# ── Copy attachment files ──────────────────────────────────────────────────────

echo ""
echo "Copying attachment files..."

copy_count=0
skip_count=0

copy_file() {
  local src_rel="$1"   # e.g. "Expenses/UUID_name.pdf"
  local date="$2"      # e.g. "2026-01-14"
  local type_dir="$3"  # e.g. "expenses"

  local basename="${src_rel#*/}"           # strip "Expenses/" prefix
  local year="${date:0:4}"
  local month="${date:5:2}"
  local src_path="${SOURCE_DOCS}/${src_rel}"
  local dst_dir="${TARGET_STORAGE}/${type_dir}/${year}/${month}"
  local dst_path="${dst_dir}/${basename}"

  if [[ ! -f "$src_path" ]]; then
    echo "  MISSING: $src_path" >&2
    (( skip_count++ )) || true
    return
  fi

  mkdir -p "$dst_dir"
  cp "$src_path" "$dst_path"
  (( copy_count++ )) || true
}

# Expense attachments
while IFS='|' read -r relpath date; do
  copy_file "$relpath" "$date" "expenses"
done < <(sqlite3 "$TARGET_DB" "
  ATTACH DATABASE '${SOURCE_DB//\'/\'\'}' AS src;
  SELECT a.ZFILENAME, date(e.ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch')
  FROM src.ZATTACHMENT a
  JOIN src.ZEXPENSE e ON a.ZEXPENSE = e.Z_PK
  WHERE a.ZEXPENSE IS NOT NULL;
")

# Claim attachments
while IFS='|' read -r relpath date; do
  copy_file "$relpath" "$date" "claims"
done < <(sqlite3 "$TARGET_DB" "
  ATTACH DATABASE '${SOURCE_DB//\'/\'\'}' AS src;
  SELECT a.ZFILENAME, date(c.ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch')
  FROM src.ZCLAIMATTACHMENT a
  JOIN src.ZCLAIM c ON a.ZCLAIM = c.Z_PK;
")

# Income attachments
while IFS='|' read -r relpath date; do
  copy_file "$relpath" "$date" "income"
done < <(sqlite3 "$TARGET_DB" "
  ATTACH DATABASE '${SOURCE_DB//\'/\'\'}' AS src;
  SELECT a.ZFILENAME, date(i.ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch')
  FROM src.ZINCOMEATTACHMENT a
  JOIN src.ZINCOME i ON a.ZINCOME = i.Z_PK;
")

echo "Files copied: $copy_count  |  Skipped (missing): $skip_count"

# ── Verification ───────────────────────────────────────────────────────────────
# Row counts were already printed by migrate-from-akaun.ts above.

echo ""
echo "Migration complete. Review counts above against source:"
echo "  Expected: 120 expenses, 27 claims, 5 incomes,"
echo "            127 expense_attachments, 29 claim_attachments, 5 income_attachments"
echo ""
echo "Next step: Re-enter your API key and settings in the web app's Settings page."
