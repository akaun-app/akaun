import type { Database } from "bun:sqlite";

export type AccountReference = {
  table: string;
  column: string;
  retained: boolean;
};

const RETAINED = new Set(["accounts.merged_into_account_id"]);

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function discoverAccountReferences(db: Database): AccountReference[] {
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  const references: AccountReference[] = [];

  for (const { name: table } of tables) {
    const foreignKeys = db
      .query(`PRAGMA foreign_key_list(${quote(table)})`)
      .all() as { table: string; from: string }[];
    for (const key of foreignKeys) {
      if (key.table !== "accounts") continue;
      references.push({
        table,
        column: key.from,
        retained: RETAINED.has(`${table}.${key.from}`),
      });
    }
  }

  return references.sort(
    (a, b) =>
      a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );
}

export function repointAccountReferences(
  db: Database,
  sourceAccountId: number,
  survivorAccountId: number,
): Record<string, number> {
  if (sourceAccountId === survivorAccountId) {
    throw new Error("A merged account cannot redirect to itself.");
  }

  const counts: Record<string, number> = {};
  for (const reference of discoverAccountReferences(db)) {
    if (reference.retained) continue;
    const result = db
      .query(
        `UPDATE ${quote(reference.table)} SET ${quote(reference.column)} = ? WHERE ${quote(reference.column)} = ?`,
      )
      .run(survivorAccountId, sourceAccountId);
    if (result.changes > 0) {
      counts[reference.table] =
        (counts[reference.table] ?? 0) + Number(result.changes);
    }
  }
  return counts;
}
