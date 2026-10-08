// A `chatgpt` provider's access token, kept fresh.
//
// Refresh tokens rotate: each refresh consumes the old one. Two import jobs
// that both refreshed would leave one of them with a token that no longer
// works, and its next refresh would end the sign-in. So refresh is
// single-flight per provider, the new tokens are saved before anyone uses
// them, and a caller whose token was already replaced takes the new one
// instead of refreshing again.

import {
  ChatgptAuthError,
  refreshCredentials,
  type ChatgptCredentials,
} from "./chatgpt-oauth.js";
import type { TokenSource } from "./chatgpt-fetch.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CredentialStore {
  read(providerId: string): Promise<ChatgptCredentials | null>;
  write(providerId: string, credentials: ChatgptCredentials): Promise<void>;
}

/** Refresh this long before expiry, so a token does not lapse mid-request. */
const REFRESH_AHEAD_MS = 60_000;

const inflight = new Map<string, Promise<ChatgptCredentials>>();

export function createTokenSource(
  providerId: string,
  store: CredentialStore,
  fetchFn?: FetchLike,
): TokenSource {
  const load = async () => {
    const credentials = await store.read(providerId);
    if (!credentials)
      throw new ChatgptAuthError(
        "not_signed_in",
        "This ChatGPT provider is not signed in. Sign in again in Settings.",
      );
    return credentials;
  };

  // `stale` is the token the caller holds. When the store already has a
  // different one, someone else refreshed, and that one is returned.
  const refreshFrom = (stale: string) => {
    let flight = inflight.get(providerId);
    if (!flight) {
      flight = (async () => {
        const current = await load();
        if (current.accessToken !== stale) return current;
        const next = await refreshCredentials(current, fetchFn);
        await store.write(providerId, next);
        return next;
      })().finally(() => inflight.delete(providerId));
      inflight.set(providerId, flight);
    }
    return flight;
  };

  return {
    async accountId() {
      return (await load()).accountId;
    },
    async token() {
      const current = await load();
      const now = Date.now();
      if (current.expiresAt - now > REFRESH_AHEAD_MS)
        return current.accessToken;
      // The server may ask for no refresh before a set time. Until then, a
      // token that has not actually expired is still used.
      if (
        current.earliestRefreshAt !== undefined &&
        current.earliestRefreshAt > now &&
        current.expiresAt > now
      )
        return current.accessToken;
      return (await refreshFrom(current.accessToken)).accessToken;
    },
    async refresh(rejected) {
      return (await refreshFrom(rejected)).accessToken;
    },
  };
}

/**
 * The store backed by `llm_providers.oauth_credentials`, loaded on first use
 * rather than imported. `model-factory` is imported by `structured-call` and so
 * by every reader and its specs, and importing `db/client.ts` opens the real
 * book (CLAUDE.md). The import happens only when a `chatgpt` provider is
 * actually called.
 */
export const dbCredentialStore: CredentialStore = {
  async read(providerId) {
    const { readChatgptCredentials } = await import("./chatgpt-store.js");
    return readChatgptCredentials(providerId);
  },
  async write(providerId, credentials) {
    const { writeChatgptCredentials } = await import("./chatgpt-store.js");
    writeChatgptCredentials(providerId, credentials);
  },
};
