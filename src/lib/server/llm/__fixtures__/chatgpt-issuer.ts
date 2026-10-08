import { generateKeyPairSync, sign } from "node:crypto";
import { vi } from "vitest";
import {
  CHATGPT_ISSUER,
  CODEX_CLIENT_ID,
  type ChatgptCredentials,
} from "../chatgpt-oauth.js";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test",
  use: "sig",
  alg: "RS256",
};
export function jwt(claims: object = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: CHATGPT_ISSUER,
      sub: "person",
      aud: CODEX_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  ).toString("base64url");
  const input = header + "." + body;
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString(
      "base64url",
    )
  );
}
export function accessJwt(accountId = "account", sequence = 0) {
  return jwt({
    jti: sequence,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  });
}
export function credentials(
  over: Partial<ChatgptCredentials> = {},
): ChatgptCredentials {
  return {
    version: 2,
    authKind: "codex-device",
    clientId: CODEX_CLIENT_ID,
    accountId: "account",
    subject: "person",
    email: "person@example.com",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 3600_000,
    ...over,
  };
}
export function issuer(
  options: {
    pending?: number;
    interval?: number | string;
    expires?: number;
    accountId?: string;
    idClaims?: object;
    refreshError?: string;
    tokenOverrides?: object;
  } = {},
) {
  const exchanges: URLSearchParams[] = [];
  let polls = 0;
  let rotations = 0;
  const tokens: string[] = [];
  const fn = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith("/deviceauth/usercode"))
        return Response.json({
          device_auth_id: "secret-device",
          user_code: "ABCD-EFGH",
          interval: options.interval ?? 1,
          expires_in: options.expires ?? 900,
        });
      if (url.endsWith("/deviceauth/token")) {
        if (polls++ < (options.pending ?? 0))
          return Response.json({}, { status: 403 });
        return Response.json({
          authorization_code: "secret-code",
          code_verifier: "secret-verifier",
        });
      }
      if (url.endsWith("/.well-known/jwks.json"))
        return Response.json({ keys: [jwk] });
      if (url.endsWith("/oauth/token")) {
        const body = new URLSearchParams(String(init?.body));
        exchanges.push(body);
        if (body.get("grant_type") === "refresh_token" && options.refreshError)
          return Response.json(
            { error: options.refreshError },
            { status: 400 },
          );
        const access = accessJwt(options.accountId, ++rotations);
        tokens.push(access);
        return Response.json({
          access_token: access,
          refresh_token: `refresh-${rotations}`,
          token_type: "Bearer",
          expires_in: 3600,
          id_token: jwt(options.idClaims),
          ...options.tokenOverrides,
        });
      }
      throw new Error("Unexpected issuer request: " + url);
    },
  );
  return { fn, exchanges, tokens };
}
