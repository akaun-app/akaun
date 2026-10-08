import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHATGPT_ISSUER, resetDiscovery } from "./chatgpt-oauth.js";
import {
  chatgptSignInEvents,
  completeFromPastedUrl,
  peekConnection,
  startSignIn,
  takeConnection,
} from "./chatgpt-sign-in.js";

const DISCOVERY = {
  issuer: CHATGPT_ISSUER,
  authorization_endpoint: `${CHATGPT_ISSUER}/oauth/authorize`,
  token_endpoint: `${CHATGPT_ISSUER}/oauth/token`,
};

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned ID token: the claims are what is read. */
const idToken = (claims: object) =>
  `${b64({ alg: "none" })}.${b64(claims)}.sig`;

/** The issuer. The token endpoint checks PKCE against the authorize URL. */
function issuer(email = "person@example.com") {
  const exchanges: URLSearchParams[] = [];
  let challenge = "";
  let nonce = "";
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/.well-known/openid-configuration"))
      return Response.json(DISCOVERY);
    if (input === DISCOVERY.token_endpoint) {
      const body = new URLSearchParams(String(init?.body));
      exchanges.push(body);
      const verified =
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url") === challenge;
      if (!verified)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email offline_access chatgpt.tokens.use.direct",
        id_token: idToken({
          aud: body.get("client_id"),
          sub: "user-sub",
          email,
          nonce,
        }),
      });
    }
    throw new Error(`unexpected ${input}`);
  });
  const remember = (authorizeUrl: string) => {
    const url = new URL(authorizeUrl);
    challenge = url.searchParams.get("code_challenge") ?? "";
    nonce = url.searchParams.get("nonce") ?? "";
  };
  return { fn, exchanges, remember };
}

function callbackUrl(
  authorizeUrl: string,
  params: Record<string, string>,
): string {
  const redirect = new URL(
    new URL(authorizeUrl).searchParams.get("redirect_uri")!,
  );
  for (const [key, value] of Object.entries(params))
    redirect.searchParams.set(key, value);
  return redirect.toString();
}

beforeEach(() => resetDiscovery());

describe("startSignIn", () => {
  it("asks to register this installation, with PKCE and a loopback redirect", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(1, { fetchFn: up.fn });
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("agent_name_hint")).toBe("Akaun");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain(
      "chatgpt.tokens.use.direct",
    );
    expect(url.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(url.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
    );
    // Close the listener.
    await completeFromPastedUrl(
      1,
      callbackUrl(authorizeUrl, { state, error: "access_denied" }),
    ).catch(() => undefined);
  });

  it("reuses an issued client id instead of registering again", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(1, {
      fetchFn: up.fn,
      savedClientId: "client-saved",
    });
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("client-saved");
    expect(url.searchParams.has("agent_name_hint")).toBe(false);
    await completeFromPastedUrl(
      1,
      callbackUrl(authorizeUrl, { state, error: "access_denied" }),
    ).catch(() => undefined);
  });
});

describe("completeFromPastedUrl", () => {
  it("exchanges the code with the verifier and holds the tokens for Save", async () => {
    const up = issuer();
    const onClientId = vi.fn();
    const { authorizeUrl, state } = await startSignIn(7, {
      fetchFn: up.fn,
      onClientId,
    });
    up.remember(authorizeUrl);
    const complete = vi.fn();
    chatgptSignInEvents.once("sign-in-complete", complete);

    const result = await completeFromPastedUrl(
      7,
      callbackUrl(authorizeUrl, {
        state,
        code: "code-1",
        client_id: "client-new",
      }),
    );

    expect(result.email).toBe("person@example.com");
    expect(onClientId).toHaveBeenCalledWith("client-new");
    expect(up.exchanges[0].get("client_id")).toBe("client-new");
    expect(up.exchanges[0].get("redirect_uri")).toBe(
      new URL(authorizeUrl).searchParams.get("redirect_uri"),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        state,
        connectionId: result.connectionId,
      }),
    );
    // Another user cannot see or take it; its owner takes it once.
    expect(peekConnection(8, result.connectionId)).toBeNull();
    expect(takeConnection(8, result.connectionId)).toBeNull();
    expect(takeConnection(7, result.connectionId)).toMatchObject({
      clientId: "client-new",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      email: "person@example.com",
      subject: "user-sub",
    });
    expect(takeConnection(7, result.connectionId)).toBeNull();
  });

  it("refuses a sign-in started by another user, and one already used", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(1, { fetchFn: up.fn });
    up.remember(authorizeUrl);
    const pasted = callbackUrl(authorizeUrl, {
      state,
      code: "code-1",
      client_id: "client-new",
    });
    await expect(completeFromPastedUrl(2, pasted)).rejects.toThrow(/expired/);
    await completeFromPastedUrl(1, pasted);
    await expect(completeFromPastedUrl(1, pasted)).rejects.toThrow(/expired/);
  });

  it("saves an issued client id only after its exchange succeeds", async () => {
    const up = issuer();
    const onClientId = vi.fn();
    const { authorizeUrl, state } = await startSignIn(1, {
      fetchFn: up.fn,
      onClientId,
    });
    // No `remember`: the issuer refuses the verifier, as for a forged paste.
    await expect(
      completeFromPastedUrl(
        1,
        callbackUrl(authorizeUrl, { state, code: "c", client_id: "forged" }),
      ),
    ).rejects.toThrow(/Sign in again/);
    expect(onClientId).not.toHaveBeenCalled();
  });

  it("refuses a sign-in that did not grant plan usage", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(1, { fetchFn: up.fn });
    up.remember(authorizeUrl);
    const grantOnly = up.fn.getMockImplementation()!;
    up.fn.mockImplementation(async (input: string, init?: RequestInit) => {
      const res = await grantOnly(input, init);
      if (input !== DISCOVERY.token_endpoint) return res;
      return Response.json({ ...(await res.json()), scope: "openid email" });
    });
    await expect(
      completeFromPastedUrl(
        1,
        callbackUrl(authorizeUrl, {
          state,
          code: "c",
          client_id: "client-new",
        }),
      ),
    ).rejects.toThrow(/did not allow Akaun to use the plan/);
  });

  it("refuses an address that is not a sign-in result", async () => {
    await expect(
      completeFromPastedUrl(1, "https://example.com/nothing"),
    ).rejects.toThrow(/not a ChatGPT sign-in result/);
  });

  it("reports a cancelled sign-in", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(1, { fetchFn: up.fn });
    const failed = vi.fn();
    chatgptSignInEvents.once("sign-in-failed", failed);
    await expect(
      completeFromPastedUrl(
        1,
        callbackUrl(authorizeUrl, { state, error: "access_denied" }),
      ),
    ).rejects.toThrow(/cancelled/);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, state }),
    );
  });
});

describe("the loopback listener", () => {
  it("finishes the sign-in when the browser lands on it", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(3, { fetchFn: up.fn });
    up.remember(authorizeUrl);
    const complete = new Promise<{ connectionId: string }>((resolve) =>
      chatgptSignInEvents.once("sign-in-complete", resolve),
    );

    const res = await fetch(
      callbackUrl(authorizeUrl, {
        state,
        code: "code-1",
        client_id: "client-new",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Signed in");
    const { connectionId } = await complete;
    expect(takeConnection(3, connectionId)?.accessToken).toBe("access-1");
  });

  it("does not answer a callback for another sign-in", async () => {
    const up = issuer();
    const { authorizeUrl, state } = await startSignIn(3, { fetchFn: up.fn });
    const res = await fetch(
      callbackUrl(authorizeUrl, { state: "someone-else", code: "c" }),
    );
    expect(res.status).toBe(400);
    await completeFromPastedUrl(
      3,
      callbackUrl(authorizeUrl, { state, error: "access_denied" }),
    ).catch(() => undefined);
  });
});
