/**
 * `expenses` + `income` → `records`, and `journal` → `adjustments`.
 *
 * Plain rows in, plain rows out, no database. Both permission tables are keyed
 * `(ownerId, resource)`, so collapsing two resources onto one primary key is a
 * merge and not a rename: the four booleans are OR-ed before the write
 * (data-model.md §3, research.md R-04).
 *
 * Pure, because Principle V names permission resolution as TDD-required and a
 * merge expressed as SQL inside a migration cannot be driven red-green. The
 * thin applier that writes the result lives in `db/client.ts`.
 */

/** One row of `group_permissions` or `user_permissions`, owner-agnostic. */
export type PermissionRow = {
  /** `group_id` or `user_id` — the merge does not care which table it came from. */
  ownerId: number;
  resource: string;
  canView: boolean;
  canAdd: boolean;
  canChange: boolean;
  canDelete: boolean;
};

const ABILITIES = ["canView", "canAdd", "canChange", "canDelete"] as const;

/** The two resources that collapse into `records`, plus `records` itself so a rerun is a no-op. */
const MERGED_INTO_RECORDS = new Set(["expenses", "income", "records"]);

export function mergeRecordsPermissions(
  rows: PermissionRow[],
): PermissionRow[] {
  const out: PermissionRow[] = [];
  // One accumulator per owner. A missing source row simply never contributes,
  // which is what makes "reads as all-false" true without writing it down.
  const recordsByOwner = new Map<number, PermissionRow>();

  for (const row of rows) {
    if (MERGED_INTO_RECORDS.has(row.resource)) {
      let merged = recordsByOwner.get(row.ownerId);
      if (!merged) {
        merged = {
          ownerId: row.ownerId,
          resource: "records",
          canView: false,
          canAdd: false,
          canChange: false,
          canDelete: false,
        };
        recordsByOwner.set(row.ownerId, merged);
        // Held in `out` at the position the first source row occupied, so the
        // result keeps a stable order for a caller that diffs it.
        out.push(merged);
      }
      for (const ability of ABILITIES) {
        merged[ability] = merged[ability] || row[ability];
      }
      continue;
    }

    if (row.resource === "journal") {
      // One row becomes one row. No collision, no merge, no loss.
      out.push({ ...row, resource: "adjustments" });
      continue;
    }

    out.push({ ...row });
  }

  return out;
}
