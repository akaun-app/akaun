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

USER_ID=$(sqlite3 "$TARGET_DB" "SELECT id FROM users LIMIT 1;")
if [[ -z "$USER_ID" ]]; then
  echo "ERROR: No user found in target database." >&2
  echo "       Run: bun run scripts/create-admin.ts <username> <password>" >&2
  exit 1
fi
echo "Migrating data for user_id=$USER_ID"

# ── Safety backup ──────────────────────────────────────────────────────────────

BACKUP="$TARGET_DB.bak.$(date +%Y%m%d%H%M%S)"
cp "$TARGET_DB" "$BACKUP"
echo "Backed up target DB to: $BACKUP"

# ── Check for existing data ────────────────────────────────────────────────────

EXISTING=$(sqlite3 "$TARGET_DB" "SELECT count(*) FROM expenses WHERE user_id=$USER_ID;")
if [[ "$EXISTING" -gt 0 ]]; then
  echo "WARNING: Target already has $EXISTING expense(s) for this user." >&2
  read -r -p "         Continue anyway? This may create duplicates. [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── DB Migration ───────────────────────────────────────────────────────────────

echo ""
echo "Running DB migration..."

sqlite3 "$TARGET_DB" <<SQL
ATTACH DATABASE '${SOURCE_DB//\'/\'\'}' AS src;

BEGIN;

-- 1. Claims
INSERT INTO main.claims (claim_number, date, status, user_id)
SELECT
    ZCLAIMNUMBER,
    date(ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch'),
    lower(ZSTATUS),
    ${USER_ID}
FROM src.ZCLAIM;

-- 2. Expenses (claim FK resolved by joining on claim_number)
INSERT INTO main.expenses
    (expense_number, item_name, supplier, reference, remark, category,
     status, date, amount, claim_id, user_id)
SELECT
    e.ZEXPENSENUMBER,
    e.ZITEMNAME,
    coalesce(e.ZSUPPLIER, ''),
    coalesce(e.ZREFERENCE, ''),
    coalesce(e.ZREMARK, ''),
    coalesce(e.ZCATEGORY, 'Other'),
    lower(e.ZSTATUS),
    date(e.ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch'),
    e.ZAMOUNTCENTS / 100.0,
    c_dst.id,
    ${USER_ID}
FROM src.ZEXPENSE e
LEFT JOIN src.ZCLAIM c_src ON e.ZCLAIM = c_src.Z_PK
LEFT JOIN main.claims c_dst
       ON c_dst.claim_number = c_src.ZCLAIMNUMBER
      AND c_dst.user_id = ${USER_ID};

-- 3. Incomes
INSERT INTO main.incomes
    (income_number, source, description_text, reference, remark, category, date, amount, user_id)
SELECT
    ZINCOMENUMBER,
    coalesce(ZSOURCE, ''),
    coalesce(ZDESCRIPTIONTEXT, ''),
    coalesce(ZREFERENCE, ''),
    coalesce(ZREMARK, ''),
    coalesce(ZCATEGORY, 'Other'),
    date(ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch'),
    ZAMOUNTCENTS / 100.0,
    ${USER_ID}
FROM src.ZINCOME;

-- 4. Expense attachments
--    ZFILENAME = "Expenses/{uuid}_{name}" → "expenses/YYYY/MM/{uuid}_{name}"
INSERT INTO main.expense_attachments (expense_id, filename, display_name, added_date)
SELECT
    e_dst.id,
    'expenses/' || substr(ed.d,1,4) || '/' || substr(ed.d,6,2) || '/'
        || substr(a.ZFILENAME, instr(a.ZFILENAME,'/')+1),
    a.ZDISPLAYNAME,
    ed.d
FROM src.ZATTACHMENT a
JOIN src.ZEXPENSE e_src ON a.ZEXPENSE = e_src.Z_PK
JOIN main.expenses e_dst
     ON e_dst.expense_number = e_src.ZEXPENSENUMBER AND e_dst.user_id = ${USER_ID}
JOIN (SELECT Z_PK,
             date(ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch') AS d
      FROM src.ZEXPENSE) ed ON ed.Z_PK = e_src.Z_PK
WHERE a.ZEXPENSE IS NOT NULL;

-- 5. Claim attachments (all stored in ZCLAIMATTACHMENT)
INSERT INTO main.claim_attachments (claim_id, filename, display_name, added_date)
SELECT
    c_dst.id,
    'claims/' || substr(cd.d,1,4) || '/' || substr(cd.d,6,2) || '/'
        || substr(a.ZFILENAME, instr(a.ZFILENAME,'/')+1),
    a.ZDISPLAYNAME,
    cd.d
FROM src.ZCLAIMATTACHMENT a
JOIN src.ZCLAIM c_src ON a.ZCLAIM = c_src.Z_PK
JOIN main.claims c_dst
     ON c_dst.claim_number = c_src.ZCLAIMNUMBER AND c_dst.user_id = ${USER_ID}
JOIN (SELECT Z_PK,
             date(ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch') AS d
      FROM src.ZCLAIM) cd ON cd.Z_PK = c_src.Z_PK;

-- 6. Income attachments
INSERT INTO main.income_attachments (income_id, filename, display_name, added_date)
SELECT
    i_dst.id,
    'income/' || substr(id2.d,1,4) || '/' || substr(id2.d,6,2) || '/'
        || substr(a.ZFILENAME, instr(a.ZFILENAME,'/')+1),
    a.ZDISPLAYNAME,
    id2.d
FROM src.ZINCOMEATTACHMENT a
JOIN src.ZINCOME i_src ON a.ZINCOME = i_src.Z_PK
JOIN main.incomes i_dst
     ON i_dst.income_number = i_src.ZINCOMENUMBER AND i_dst.user_id = ${USER_ID}
JOIN (SELECT Z_PK,
             date(ZDATE + strftime('%s','2001-01-01') + 28800, 'unixepoch') AS d
      FROM src.ZINCOME) id2 ON id2.Z_PK = i_src.Z_PK;

-- 7. Search text
INSERT INTO main.expense_search_text (expense_id, text)
SELECT e_dst.id, s.ZTEXT
FROM src.ZEXPENSESEARCHDATA s
JOIN src.ZEXPENSE e_src ON s.ZEXPENSE = e_src.Z_PK
JOIN main.expenses e_dst
     ON e_dst.expense_number = e_src.ZEXPENSENUMBER AND e_dst.user_id = ${USER_ID}
WHERE s.ZTEXT IS NOT NULL;

INSERT INTO main.income_search_text (income_id, text)
SELECT i_dst.id, s.ZTEXT
FROM src.ZINCOMESEARCHDATA s
JOIN src.ZINCOME i_src ON s.ZINCOME = i_src.Z_PK
JOIN main.incomes i_dst
     ON i_dst.income_number = i_src.ZINCOMENUMBER AND i_dst.user_id = ${USER_ID}
WHERE s.ZTEXT IS NOT NULL;

-- 8. App sequences (REPLACE handles any pre-existing sequences from test data)
INSERT OR REPLACE INTO main.app_sequences (prefix, date_key, last_sequence, user_id)
SELECT ZPREFIX, ZDATEKEY, ZLASTSEQUENCE, ${USER_ID}
FROM src.ZAPPSEQUENCE;

COMMIT;
SQL

echo "DB migration complete."

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

echo ""
echo "── Row counts ────────────────────────────────────────────────"
printf "  %-30s %s\n" "Table" "Count"
printf "  %-30s %s\n" "-----" "-----"

q_expenses="SELECT count(*) FROM expenses WHERE user_id=${USER_ID}"
q_incomes="SELECT count(*) FROM incomes WHERE user_id=${USER_ID}"
q_claims="SELECT count(*) FROM claims WHERE user_id=${USER_ID}"
q_expense_attachments="SELECT count(*) FROM expense_attachments WHERE expense_id IN (SELECT id FROM expenses WHERE user_id=${USER_ID})"
q_claim_attachments="SELECT count(*) FROM claim_attachments WHERE claim_id IN (SELECT id FROM claims WHERE user_id=${USER_ID})"
q_income_attachments="SELECT count(*) FROM income_attachments WHERE income_id IN (SELECT id FROM incomes WHERE user_id=${USER_ID})"
q_expense_search_text="SELECT count(*) FROM expense_search_text WHERE expense_id IN (SELECT id FROM expenses WHERE user_id=${USER_ID})"
q_income_search_text="SELECT count(*) FROM income_search_text WHERE income_id IN (SELECT id FROM incomes WHERE user_id=${USER_ID})"
q_app_sequences="SELECT count(*) FROM app_sequences WHERE user_id=${USER_ID}"

for table in expenses incomes claims expense_attachments claim_attachments income_attachments expense_search_text income_search_text app_sequences; do
  varname="q_${table}"
  count=$(sqlite3 "$TARGET_DB" "${!varname};")
  printf "  %-30s %s\n" "$table" "$count"
done

echo ""
echo "Migration complete. Review counts above against source:"
echo "  Expected: 120 expenses, 27 claims, 5 incomes,"
echo "            127 expense_attachments, 29 claim_attachments, 5 income_attachments"
echo ""
echo "Next step: Re-enter your API key and settings in the web app's Settings page."
