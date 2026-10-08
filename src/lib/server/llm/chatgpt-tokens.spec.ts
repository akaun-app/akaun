import { describe, expect, it } from "vitest";
import { createTokenSource, type CredentialStore } from "./chatgpt-tokens.js";
import { type ChatgptCredentials } from "./chatgpt-oauth.js";
import { credentials, issuer } from "./__fixtures__/chatgpt-issuer.js";
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
  return { store, writes };
}
describe("device credential refresh", () => {
  it("uses an unexpired token and the stored account header without refreshing", async () => {
    const up = issuer();
    const source = createTokenSource(
      "p1",
      memoryStore(credentials()).store,
      up.fn,
    );
    expect(await source.token()).toBe("access-old");
    expect(await source.accountId()).toBe("account");
    expect(up.fn).not.toHaveBeenCalled();
  });
  it("rotates once for concurrent callers and persists before returning", async () => {
    const { store, writes } = memoryStore(
      credentials({ expiresAt: Date.now() }),
    );
    const up = issuer();
    const source = createTokenSource("p2", store, up.fn);
    const results = await Promise.all([
      source.token(),
      source.token(),
      source.token(),
    ]);
    expect(results).toEqual([up.tokens[0], up.tokens[0], up.tokens[0]]);
    expect(writes).toHaveLength(1);
    expect(writes[0].refreshToken).toBe("refresh-1");
    expect(up.exchanges).toHaveLength(1);
    expect(up.exchanges[0].get("refresh_token")).toBe("refresh-old");
  });
  it("reuses a token that another caller already refreshed", async () => {
    const up = issuer();
    const source = createTokenSource(
      "p3",
      memoryStore(credentials({ accessToken: "already-new" })).store,
      up.fn,
    );
    expect(await source.refresh("access-old")).toBe("already-new");
    expect(up.fn).not.toHaveBeenCalled();
  });
  it("requires reconnection for absent or rejected credentials", async () => {
    await expect(
      createTokenSource("p4", memoryStore(null).store).token(),
    ).rejects.toMatchObject({ needsSignIn: true });
    const up = issuer({ refreshError: "invalid_grant" });
    const { store, writes } = memoryStore(
      credentials({ expiresAt: Date.now() }),
    );
    await expect(
      createTokenSource("p5", store, up.fn).token(),
    ).rejects.toMatchObject({ needsSignIn: true });
    expect(writes).toHaveLength(0);
  });
});
