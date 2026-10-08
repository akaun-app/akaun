// Sign in with ChatGPT — OpenAI's OAuth that lets a person spend their own
// ChatGPT plan in another app instead of an API key (developers.openai.com/siwc).
//
// The protocol only: discovery, the authorize URL, the code exchange, refresh,
// revoke and the model list. No storage and no server state, and every network
// call takes its `fetch`, so the specs drive it with a stub. Written from the
// documented OAuth 2.0 / OIDC flow. OpenAI's devkit (`@siwc/local`) is under a
// noncommercial licence, so nothing is copied from it.
//
// The parts that are not ordinary OAuth:
// - An installation registers itself on first sign-in. It sends the client id
//   `dynamic_agent_client`, and the callback carries the client id issued to it.
//   That id is reused for later sign-ins and for every refresh.
// - The redirect is an IPv4 loopback URI (`http://127.0.0.1:<port>/auth/callback`).
// - The access token is a Bearer for the ordinary Responses API, under the
//   preview's rules (see `chatgpt-fetch.ts`).

export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_API_BASE = "https://api.openai.com/v1";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CALLBACK_PATH = "/auth/callback";
const PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_USAGE_SCOPE}`;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What a `chatgpt` provider row stores in `oauth_credentials`, as JSON. */
export interface ChatgptCredentials {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Epoch ms. The server can ask that a refresh not come sooner. */
  earliestRefreshAt?: number;
  email?: string;
  subject?: string;
}

/** Codes after which only a new sign-in helps; retrying the refresh never will. */
const SIGN_IN_AGAIN = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "not_signed_in",
]);

export class ChatgptAuthError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ChatgptAuthError";
    this.code = code;
    this.status = status;
  }
  get needsSignIn(): boolean {
    return SIGN_IN_AGAIN.has(this.code);
  }
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}

let discoveryCache: Promise<Discovery> | undefined;

/** The issuer's OIDC configuration. Cached for the process; a failure is not. */
export function discover(fetchFn: FetchLike = fetch): Promise<Discovery> {
  discoveryCache ??= (async () => {
    const res = await fetchFn(
      `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
      { headers: { accept: "application/json" } },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !isObject(data) || data.issuer !== CHATGPT_ISSUER)
      throw new ChatgptAuthError(
        "discovery_failed",
        "ChatGPT sign-in is unavailable right now. Try again shortly.",
        res.status,
      );
    // Every endpoint must belong to the issuer, so a tampered document cannot
    // send a code or a refresh token anywhere else.
    for (const key of [
      "authorization_endpoint",
      "token_endpoint",
      "revocation_endpoint",
    ]) {
      const value = data[key];
      if (key === "revocation_endpoint" && value === undefined) continue;
      if (typeof value !== "string" || new URL(value).origin !== CHATGPT_ISSUER)
        throw new ChatgptAuthError(
          "discovery_failed",
          "ChatGPT sign-in configuration could not be verified.",
        );
    }
    return data as unknown as Discovery;
  })().catch((error: unknown) => {
    discoveryCache = undefined;
    throw error;
  });
  return discoveryCache;
}

/** Test seam: forget the cached discovery document. */
export function resetDiscovery(): void {
  discoveryCache = undefined;
}

export function randomValue(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString("base64url");
}

export async function buildAuthorizeUrl(input: {
  authorizationEndpoint: string;
  /** The issued client id, or undefined to register this installation. */
  clientId?: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  appName: string;
}): Promise<string> {
  const url = new URL(input.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: input.clientId ?? DYNAMIC_CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: SCOPES,
    resource: CHATGPT_API_BASE,
    state: input.state,
    nonce: input.nonce,
    code_challenge_method: "S256",
    code_challenge: await s256(input.verifier),
  }).toString();
  if (!input.clientId) url.searchParams.set("agent_name_hint", input.appName);
  return url.toString();
}

export type CallbackParams =
  | { ok: true; code: string; state: string; clientId?: string }
  | { ok: false; state?: string; error: string };

/**
 * Reads the redirect the browser landed on. The loopback listener passes it
 * its request URL, and a remote server gets the same URL pasted from the
 * address bar.
 */
export function parseCallback(raw: string): CallbackParams | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const one = (name: string) => {
    const all = url.searchParams.getAll(name);
    return all.length === 1 ? all[0] : undefined;
  };
  const state = one("state");
  const error = one("error");
  if (error) return { ok: false, state, error };
  const code = one("code");
  if (!code || !state) return null;
  const clientId = one("client_id");
  if (clientId !== undefined && !/^[\w-]{1,200}$/.test(clientId)) return null;
  return { ok: true, code, state, clientId };
}

export async function exchangeCode(
  input: {
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
    nonce: string;
  },
  fetchFn: FetchLike = fetch,
): Promise<ChatgptCredentials> {
  const data = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: CHATGPT_API_BASE,
    }),
    fetchFn,
  );
  const identity = idTokenIdentity(data.id_token, input.clientId, input.nonce);
  // A sign-in that did not grant plan usage would save fine and fail on the
  // first request. OAuth may leave `scope` out when it granted what was asked.
  if (
    typeof data.scope === "string" &&
    !data.scope.split(/\s+/).includes(PLAN_USAGE_SCOPE)
  )
    throw new ChatgptAuthError(
      "scope_not_granted",
      "ChatGPT did not allow Akaun to use the plan. Sign in again and allow access.",
    );
  return {
    clientId: input.clientId,
    ...tokenFields(data),
    ...identity,
  };
}

export async function refreshCredentials(
  current: ChatgptCredentials,
  fetchFn: FetchLike = fetch,
): Promise<ChatgptCredentials> {
  const data = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: current.clientId,
      refresh_token: current.refreshToken,
      resource: CHATGPT_API_BASE,
    }),
    fetchFn,
  );
  const fields = tokenFields(data, current.refreshToken);
  const identity =
    typeof data.id_token === "string"
      ? idTokenIdentity(data.id_token, current.clientId)
      : {};
  // A refresh that came back for another account is not this connection.
  if (
    identity.subject &&
    current.subject &&
    identity.subject !== current.subject
  )
    throw new ChatgptAuthError(
      "account_mismatch",
      "The ChatGPT account changed. Sign in again in Settings.",
    );
  return { ...current, ...fields, ...identity };
}

/** Ends the session at OpenAI. Returns false when this could not be confirmed. */
export async function revokeCredentials(
  current: ChatgptCredentials,
  fetchFn: FetchLike = fetch,
): Promise<boolean> {
  try {
    const { revocation_endpoint } = await discover(fetchFn);
    if (!revocation_endpoint) return false;
    const res = await fetchFn(revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: current.refreshToken,
        token_type_hint: "refresh_token",
        client_id: current.clientId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

export interface ChatgptModel {
  id: string;
  name: string;
}

/** The models this account may use. Only the ones marked to list are shown. */
export async function listChatgptModels(
  accessToken: string,
  fetchFn: FetchLike = fetch,
): Promise<ChatgptModel[]> {
  const res = await fetchFn(`${CHATGPT_API_BASE}/models`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw apiError(body, res.status);
  const raw = isObject(body) && Array.isArray(body.models) ? body.models : [];
  return raw
    .filter(
      (m): m is { slug: string; display_name: string } =>
        isObject(m) &&
        m.visibility === "list" &&
        typeof m.slug === "string" &&
        typeof m.display_name === "string",
    )
    .map((m) => ({ id: m.slug, name: m.display_name }));
}

/** The stored JSON back into credentials, or null when it is not a usable set. */
export function parseStoredCredentials(
  raw: string | null | undefined,
): ChatgptCredentials | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isObject(value) &&
      typeof value.clientId === "string" &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      typeof value.expiresAt === "number"
    )
      return value as unknown as ChatgptCredentials;
  } catch {
    // Unreadable is the same as absent: the provider needs a new sign-in.
  }
  return null;
}

async function tokenRequest(
  body: URLSearchParams,
  fetchFn: FetchLike,
): Promise<Record<string, unknown>> {
  const { token_endpoint } = await discover(fetchFn);
  const res = await fetchFn(token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw apiError(data, res.status);
  if (!isObject(data))
    throw new ChatgptAuthError(
      "invalid_token_response",
      "ChatGPT returned an invalid sign-in response. Sign in again.",
    );
  return data;
}

function tokenFields(
  data: Record<string, unknown>,
  previousRefreshToken?: string,
): Pick<
  ChatgptCredentials,
  "accessToken" | "refreshToken" | "expiresAt" | "earliestRefreshAt"
> {
  const refreshToken =
    typeof data.refresh_token === "string" && data.refresh_token
      ? data.refresh_token
      : previousRefreshToken;
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.token_type !== "string" ||
    data.token_type.toLowerCase() !== "bearer" ||
    typeof data.expires_in !== "number" ||
    !(data.expires_in > 0) ||
    !refreshToken
  )
    throw new ChatgptAuthError(
      "invalid_token_response",
      "ChatGPT returned incomplete credentials. Sign in again.",
    );
  const earliest = data.earliest_refresh_at;
  // A number is seconds since the epoch; a string is a date.
  const earliestRefreshAt =
    typeof earliest === "number"
      ? earliest * 1000
      : typeof earliest === "string"
        ? Date.parse(earliest)
        : undefined;
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    ...(earliestRefreshAt !== undefined && Number.isFinite(earliestRefreshAt)
      ? { earliestRefreshAt }
      : {}),
  };
}

/**
 * Who signed in, from the ID token's claims.
 *
 * The signature is not checked. The token came straight from the token
 * endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place of a signature
 * check. Nothing is authorised on its claims either: the access token is what
 * OpenAI checks. Audience and nonce are still compared, to catch a response
 * meant for another sign-in.
 */
function idTokenIdentity(
  idToken: unknown,
  clientId: string,
  nonce?: string,
): Pick<ChatgptCredentials, "email" | "subject"> {
  const invalid = () =>
    new ChatgptAuthError(
      "invalid_id_token",
      "ChatGPT did not confirm who signed in. Sign in again.",
    );
  if (typeof idToken !== "string") throw invalid();
  let claims: Record<string, unknown>;
  try {
    const payload = idToken.split(".")[1] ?? "";
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!isObject(parsed)) throw new Error("claims");
    claims = parsed;
  } catch {
    throw invalid();
  }
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
  if (!audOk || (nonce !== undefined && claims.nonce !== nonce))
    throw invalid();
  return {
    ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    ...(typeof claims.sub === "string" ? { subject: claims.sub } : {}),
  };
}

/** OAuth errors carry a string `error`; Responses errors carry `error.code`. */
export function apiError(body: unknown, status?: number): ChatgptAuthError {
  const top = isObject(body) ? body : {};
  const nested = isObject(top.error) ? top.error : {};
  const code =
    typeof top.error === "string"
      ? top.error
      : typeof nested.code === "string"
        ? nested.code
        : "api_error";
  const description =
    typeof top.error_description === "string"
      ? top.error_description
      : typeof nested.message === "string"
        ? nested.message
        : typeof top.detail === "string"
          ? top.detail
          : undefined;
  const message = SIGN_IN_AGAIN.has(code)
    ? "Your ChatGPT sign-in has expired. Sign in again in Settings."
    : description || `ChatGPT returned HTTP ${status ?? "error"}`;
  return new ChatgptAuthError(code, message, status);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
