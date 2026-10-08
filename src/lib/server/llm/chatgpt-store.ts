// The DB half of `chatgpt-tokens.ts`. Kept in its own module so that only a
// dynamic import reaches `db/client.ts` — see `dbCredentialStore`.

import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/client.js";
import { llmProviders } from "$lib/server/db/schema.js";
import {
  parseStoredCredentials,
  type ChatgptCredentials,
} from "./chatgpt-oauth.js";

export function readChatgptCredentials(
  providerId: string,
): ChatgptCredentials | null {
  const row = db
    .select({ credentials: llmProviders.oauthCredentials })
    .from(llmProviders)
    .where(eq(llmProviders.id, providerId))
    .get();
  return parseStoredCredentials(row?.credentials);
}

export function writeChatgptCredentials(
  providerId: string,
  credentials: ChatgptCredentials,
): void {
  db.update(llmProviders)
    .set({ oauthCredentials: JSON.stringify(credentials) })
    .where(eq(llmProviders.id, providerId))
    .run();
}
