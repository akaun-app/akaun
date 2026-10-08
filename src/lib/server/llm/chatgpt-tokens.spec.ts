import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatgptAuthError,
  CHATGPT_ISSUER,
  resetDiscovery,
  type ChatgptCredentials,
} from "./chatgpt-oauth.js";
import { createTokenSource, type CredentialStore } from "./chatgpt-tokens.js";

const DISCOVERY = {
  issuer: CHATGPT_ISSUER,
  authorization_endpoint: `${CHATGPT_ISSUER}/oauth/authorize`,
  token_endpoint: `${CHATGPT_ISSUER}/oauth/token`,
};

function memoryStore(initial: ChatgptCredentials | null) {
  let value = initial;
  const writes: ChatgptCredentials[] = [];
  const store: CredentialStore = {
    read: async () => value,
    write: async (_id, next) => {
      value = next;
      writes.push(next);
    },
  };
  return { store, writes, current: () => value };
}

function credentials(
  over: Partial<ChatgptCredentials> = {},
): ChatgptCredentials {
  return {
    clientId: "client-1",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 3_600_000,
    ...over,
  };
}

/** The issuer: discovery, and a token endpoint that rotates on each refresh. */
function issuer() {
  let n = 0;
  const refreshBodies: URLSearchParams[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/.well-known/openid-configuration"))
      return Response.json(DISCOVERY);
    if (input === DISCOVERY.token_endpoint) {
      refreshBodies.push(new URLSearchParams(String(init?.body)));
      n++;
      // A little delay, so concurrent callers really overlap.
      await new Promise((r) => setTimeout(r, 10));
      return Response.json({
        access_token: `access-${n}`,
        refresh_token: `refresh-${n}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid offline_access",
      });
    }
    throw new Error(`unexpected ${input}`);
  });
  return { fn, refreshBodies };
}

beforeEach(() => resetDiscovery());

describe("createTokenSource", () => {
  it("uses a token that is still valid without refreshing", async () => {
    const { store } = memoryStore(credentials());
    const up = issuer();
    expect(await createTokenSource("p1", store, up.fn).token()).toBe(
      "access-old",
    );
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("refreshes once for many callers when the token is about to expire, and saves the rotation", async () => {
    const { store, writes } = memoryStore(
      credentials({ expiresAt: Date.now() + 10_000 }),
    );
    const up = issuer();
    const source = createTokenSource("p1", store, up.fn);
    const results = await Promise.all([
      source.token(),
      source.token(),
      source.token(),
    ]);
    expect(results).toEqual(["access-1", "access-1", "access-1"]);
    expect(up.refreshBodies).toHaveLength(1);
    expect(up.refreshBodies[0].get("refresh_token")).toBe("refresh-old");
    expect(up.refreshBodies[0].get("client_id")).toBe("client-1");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      clientId: "client-1",
    });
  });

  it("takes the new token instead of refreshing again when another caller already did", async () => {
    const { store } = memoryStore(credentials({ accessToken: "access-new" }));
    const up = issuer();
    const token = await createTokenSource("p1", store, up.fn).refresh(
      "access-old",
    );
    expect(token).toBe("access-new");
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("waits out earliest_refresh_at while the token has not expired", async () => {
    const { store } = memoryStore(
      credentials({
        expiresAt: Date.now() + 10_000,
        earliestRefreshAt: Date.now() + 5_000,
      }),
    );
    const up = issuer();
    expect(await createTokenSource("p1", store, up.fn).token()).toBe(
      "access-old",
    );
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("asks for a new sign-in when nothing is stored", async () => {
    const { store } = memoryStore(null);
    const error = await createTokenSource("p1", store, issuer().fn)
      .token()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatgptAuthError);
    expect((error as ChatgptAuthError).needsSignIn).toBe(true);
  });

  it("asks for a new sign-in when the refresh token is refused", async () => {
    const { store } = memoryStore(credentials({ expiresAt: Date.now() }));
    const fn = vi.fn(async (input: string) =>
      input.endsWith("/.well-known/openid-configuration")
        ? Response.json(DISCOVERY)
        : Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const error = await createTokenSource("p1", store, fn)
      .token()
      .catch((e: unknown) => e);
    expect((error as ChatgptAuthError).needsSignIn).toBe(true);
    expect((error as Error).message).toMatch(/Sign in again/);
  });
});
