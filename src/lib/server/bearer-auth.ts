import { eq } from "drizzle-orm";
import { users } from "./db/schema.js";
import type { LedgerDb } from "./ledger/types.js";
import { getEffectivePermissions } from "./permissions.js";

/** Shared REST/MCP authentication. Never accepts a caller-supplied user ID. */
export function bearerLocals(
  db: LedgerDb,
  authorization: string | null,
): App.Locals | null {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) return null;
  const user = db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.bearerToken, match[1]))
    .get();
  if (!user) return null;
  return { user, ...getEffectivePermissions(db, user.id) };
}
