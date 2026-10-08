// Codex-compatible device login for self-hosted installations.
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_API_BASE = "https://chatgpt.com/backend-api/codex";
// Public Codex OAuth client, also used by OpenHands; not an Akaun registration.
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
// Catalog capability version pinned to the published Codex client release.
export const CODEX_CLIENT_VERSION = "0.161.0";
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface ChatgptCredentials {
  version: 2;
  authKind: "codex-device";
  clientId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  earliestRefreshAt?: number;
  email?: string;
  subject: string;
}
export class ChatgptAuthError extends Error {
  retryAfterMs?: number;
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChatgptAuthError";
  }
  get needsSignIn(): boolean {
    return [
      "invalid_grant",
      "invalid_refresh_token",
      "token_expired",
      "refresh_token_expired",
      "refresh_token_invalidated",
      "refresh_token_reused",
      "not_signed_in",
      "account_mismatch",
    ].includes(this.code);
  }
}
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export interface DeviceAuthorization {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
  expiresAt: number;
}
async function deviceRequest(
  path: string,
  body: object,
  fn: FetchLike,
  signal?: AbortSignal,
) {
  return fn(`${CHATGPT_ISSUER}/api/accounts/deviceauth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  });
}
export async function requestDeviceCode(
  fn: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<DeviceAuthorization> {
  const res = await deviceRequest(
    "usercode",
    { client_id: CODEX_CLIENT_ID },
    fn,
    signal,
  );
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok)
    throw new ChatgptAuthError(
      "device_auth_unavailable",
      "Enable device code login in ChatGPT Security settings, or ask your workspace administrator. Then try again.",
      res.status,
    );
  const code = isObject(data) ? (data.user_code ?? data.usercode) : undefined;
  const interval = isObject(data) ? Number(data.interval ?? 5) : NaN;
  const expiry = isObject(data) ? Number(data.expires_in ?? 900) : NaN;
  if (
    !isObject(data) ||
    typeof data.device_auth_id !== "string" ||
    !data.device_auth_id ||
    typeof code !== "string" ||
    !code ||
    !Number.isFinite(interval) ||
    interval < 0 ||
    !Number.isFinite(expiry) ||
    expiry <= 0
  )
    throw new ChatgptAuthError(
      "invalid_device_response",
      "ChatGPT returned an invalid device sign-in response.",
    );
  return {
    deviceAuthId: data.device_auth_id,
    userCode: code,
    verificationUrl: `${CHATGPT_ISSUER}/codex/device`,
    intervalMs: Math.max(1, interval) * 1000,
    expiresAt: Date.now() + Math.min(900, expiry) * 1000,
  };
}
export async function checkDeviceCode(
  device: DeviceAuthorization,
  fn: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<ChatgptCredentials | null> {
  const res = await deviceRequest(
    "token",
    { device_auth_id: device.deviceAuthId, user_code: device.userCode },
    fn,
    signal,
  );
  const data: unknown = await res.json().catch(() => null);
  signal?.throwIfAborted();
  const failure = apiError(data, res.status, res.headers.get("retry-after"));
  // Codex returns 403/404 while pending; explicit terminal errors still win.
  if (
    failure.code === "authorization_pending" ||
    ((res.status === 403 || res.status === 404) &&
      !["access_denied", "expired_token"].includes(failure.code))
  )
    return null;
  if (!res.ok) throw failure;
  if (
    !isObject(data) ||
    typeof data.authorization_code !== "string" ||
    !data.authorization_code ||
    typeof data.code_verifier !== "string" ||
    !data.code_verifier
  )
    throw new ChatgptAuthError(
      "invalid_device_response",
      "ChatGPT returned an incomplete device approval.",
    );
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code: data.authorization_code,
      code_verifier: data.code_verifier,
      redirect_uri: `${CHATGPT_ISSUER}/deviceauth/callback`,
    }),
    fn,
    signal,
  );
  const keys = await signingKeys(fn, signal);
  const identity = verifiedClaims(tokens.id_token, keys, CODEX_CLIENT_ID);
  const access = verifiedClaims(tokens.access_token, keys);
  const accountId = accountClaim(access);
  if (typeof identity.sub !== "string" || !identity.sub)
    throw new ChatgptAuthError(
      "invalid_id_token",
      "ChatGPT did not confirm the account identity.",
    );
  return {
    version: 2,
    authKind: "codex-device",
    clientId: CODEX_CLIENT_ID,
    accountId,
    subject: identity.sub,
    ...tokenFields(tokens),
    ...(typeof identity.email === "string" ? { email: identity.email } : {}),
  };
}
async function signingKeys(
  fn: FetchLike,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const res = await fn(`${CHATGPT_ISSUER}/.well-known/jwks.json`, {
    signal: requestSignal(signal),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !isObject(body) || !Array.isArray(body.keys))
    throw new ChatgptAuthError(
      "identity_unavailable",
      "ChatGPT identity verification is unavailable. Try again.",
      res.status,
    );
  return body.keys.filter(isObject);
}
function verifiedClaims(
  raw: unknown,
  keys: Record<string, unknown>[],
  audience?: string,
): Record<string, unknown> {
  try {
    if (typeof raw !== "string") throw new Error();
    const parts = raw.split(".");
    if (parts.length !== 3) throw new Error();
    const header: unknown = JSON.parse(
      Buffer.from(parts[0], "base64url").toString(),
    );
    const claims: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString(),
    );
    if (
      !isObject(header) ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      !isObject(claims)
    )
      throw new Error();
    const key = keys.find(
      (k) =>
        k.kid === header.kid &&
        k.kty === "RSA" &&
        (k.use === undefined || k.use === "sig") &&
        (k.alg === undefined || k.alg === "RS256"),
    );
    if (
      !key ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        createPublicKey({ key: key as JsonWebKey, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    )
      throw new Error();
    const now = Date.now() / 1000;
    if (
      claims.iss !== CHATGPT_ISSUER ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now + 30) ||
      (audience &&
        !(
          claims.aud === audience ||
          (Array.isArray(claims.aud) && claims.aud.includes(audience))
        ))
    )
      throw new Error();
    return claims;
  } catch {
    throw new ChatgptAuthError(
      "invalid_id_token",
      "ChatGPT identity could not be verified. Sign in again.",
    );
  }
}
function accountClaim(access: Record<string, unknown>): string {
  const auth = access["https://api.openai.com/auth"];
  if (
    !isObject(auth) ||
    typeof auth.chatgpt_account_id !== "string" ||
    !auth.chatgpt_account_id
  )
    throw new ChatgptAuthError(
      "invalid_id_token",
      "ChatGPT did not confirm the subscription account.",
    );
  return auth.chatgpt_account_id;
}
async function tokenRequest(
  body: URLSearchParams,
  fn: FetchLike,
  signal?: AbortSignal,
) {
  const res = await fn(`${CHATGPT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: requestSignal(signal),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiError(data, res.status);
  if (!isObject(data))
    throw new ChatgptAuthError(
      "invalid_token_response",
      "ChatGPT returned invalid credentials.",
    );
  return data;
}
function tokenFields(data: Record<string, unknown>, previous?: string) {
  const refreshToken =
    typeof data.refresh_token === "string" && data.refresh_token
      ? data.refresh_token
      : previous;
  let expiresIn = data.expires_in;
  if (expiresIn === undefined && typeof data.access_token === "string") {
    try {
      expiresIn =
        JSON.parse(
          Buffer.from(data.access_token.split(".")[1], "base64url").toString(),
        ).exp -
        Date.now() / 1000;
    } catch {
      /* Invalid tokens are rejected below. */
    }
  }
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    !refreshToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    (data.token_type !== undefined &&
      String(data.token_type).toLowerCase() !== "bearer")
  )
    throw new ChatgptAuthError(
      "invalid_token_response",
      "ChatGPT returned incomplete credentials.",
    );
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
export async function refreshCredentials(
  current: ChatgptCredentials,
  fn: FetchLike = fetch,
): Promise<ChatgptCredentials> {
  // Fetch verification keys before consuming the rotating refresh token.
  const keys = await signingKeys(fn);
  const data = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: current.refreshToken,
    }),
    fn,
  );
  const fields = tokenFields(data, current.refreshToken);
  if (
    accountClaim(verifiedClaims(fields.accessToken, keys)) !==
      current.accountId ||
    (data.id_token !== undefined &&
      verifiedClaims(data.id_token, keys, CODEX_CLIENT_ID).sub !==
        current.subject)
  )
    throw new ChatgptAuthError(
      "account_mismatch",
      "The ChatGPT account changed. Sign in again in Settings.",
    );
  return { ...current, ...fields };
}
export function parseStoredCredentials(
  raw: string | null | undefined,
): ChatgptCredentials | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      isObject(v) &&
      v.version === 2 &&
      v.authKind === "codex-device" &&
      v.clientId === CODEX_CLIENT_ID &&
      typeof v.accountId === "string" &&
      v.accountId &&
      typeof v.subject === "string" &&
      v.subject &&
      typeof v.accessToken === "string" &&
      v.accessToken &&
      typeof v.refreshToken === "string" &&
      v.refreshToken &&
      typeof v.expiresAt === "number" &&
      Number.isFinite(v.expiresAt)
    )
      return v as unknown as ChatgptCredentials;
  } catch {
    /* Legacy credentials require device sign-in. */
  }
  return null;
}
export function codexHeaders(
  token: string,
  accountId: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "Akaun (Codex-compatible)",
  };
}
export interface ChatgptModel {
  id: string;
  name: string;
}
export async function listChatgptModels(
  token: string,
  fn: FetchLike,
  accountId: string,
): Promise<ChatgptModel[]> {
  const res = await fn(
    `${CHATGPT_API_BASE}/models?client_version=${CODEX_CLIENT_VERSION}`,
    {
      headers: {
        ...codexHeaders(token, accountId),
        accept: "application/json",
      },
      signal: requestSignal(),
    },
  );
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiError(data, res.status);
  if (!isObject(data) || !Array.isArray(data.models))
    throw new ChatgptAuthError(
      "invalid_models",
      "ChatGPT returned an invalid model list.",
    );
  return data.models
    .filter(
      (m): m is Record<string, unknown> =>
        isObject(m) &&
        m.visibility === "list" &&
        typeof m.slug === "string" &&
        typeof m.display_name === "string",
    )
    .map((m) => ({ id: m.slug as string, name: m.display_name as string }));
}
export function apiError(
  body: unknown,
  status?: number,
  retryAfter?: string | null,
): ChatgptAuthError {
  const top = isObject(body) ? body : {};
  const nested = isObject(top.error) ? top.error : {};
  const code =
    typeof top.error === "string"
      ? top.error
      : typeof nested.code === "string"
        ? nested.code
        : "api_error";
  // Never echo upstream authentication bodies into the UI or logs.
  const error = new ChatgptAuthError(
    code,
    code === "access_denied"
      ? "ChatGPT sign-in was cancelled."
      : code === "expired_token"
        ? "The sign-in code expired. Start again."
        : ["invalid_grant", "invalid_refresh_token"].includes(code)
          ? "Your ChatGPT sign-in expired. Sign in again in Settings."
          : `ChatGPT sign-in failed (HTTP ${status ?? "error"}). Try again.`,
    status,
  );
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay) && delay > 0) error.retryAfterMs = delay;
  }
  return error;
}
