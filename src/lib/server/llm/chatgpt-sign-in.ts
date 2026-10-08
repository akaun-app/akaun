// The Settings sign-in for a `chatgpt` provider, from "Sign in with ChatGPT"
// to a set of tokens the next Save stores on the provider row.
//
// OpenAI redirects only to an IPv4 loopback address. So each sign-in opens a
// listener on `127.0.0.1:<free port>` for as long as it waits.
// - Akaun on the same machine as the browser (the desktop app, a local
//   server): the redirect lands on the listener and sign-in finishes by itself.
// - Akaun on another machine (Docker on a server): the redirect cannot reach
//   it, and the browser shows a page that does not load. Its address still
//   holds the code, so the person pastes that address into Settings, and it
//   goes through `completeFromPastedUrl`. The code is useless without the PKCE
//   verifier, which never leaves this process.
//
// Two kinds of state are held in memory only, each tied to the user who
// started it:
// - A pending sign-in, for 10 minutes.
// - A finished connection waiting for Save, for 30 minutes. This keeps the
//   Settings rule that nothing is written before Save. A restart drops both,
//   and the person signs in again.

import { createServer, type Server } from "node:http";
import { EventEmitter } from "events";
import {
  CALLBACK_PATH,
  ChatgptAuthError,
  DYNAMIC_CLIENT_ID,
  buildAuthorizeUrl,
  discover,
  exchangeCode,
  parseCallback,
  randomValue,
  type CallbackParams,
  type ChatgptCredentials,
} from "./chatgpt-oauth.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SIGN_IN_TTL_MS = 10 * 60_000;
const CONNECTION_TTL_MS = 30 * 60_000;
const APP_NAME = "Akaun";

interface PendingSignIn {
  userId: number;
  nonce: string;
  verifier: string;
  clientId?: string;
  redirectUri: string;
  timer: ReturnType<typeof setTimeout>;
  server: Server;
  hooks: SignInHooks;
}

interface PendingConnection {
  userId: number;
  credentials: ChatgptCredentials;
  timer: ReturnType<typeof setTimeout>;
}

const signIns = new Map<string, PendingSignIn>();
const connections = new Map<string, PendingConnection>();

/**
 * `sign-in-complete` `{ userId, state, connectionId, email }` and
 * `sign-in-failed` `{ userId, state, message }`. The listener finishes a
 * sign-in outside any request, so this is how the Settings sheet hears of it.
 */
export const chatgptSignInEvents = new EventEmitter();

export interface SignInHooks {
  /** The client id this installation was issued by an earlier sign-in. */
  savedClientId?: string;
  /** Called once a client id is issued, before the code is exchanged. */
  onClientId?: (clientId: string) => void;
  fetchFn?: FetchLike;
}

export interface SignInResult {
  connectionId: string;
  email: string | null;
}

export async function startSignIn(
  userId: number,
  hooks: SignInHooks = {},
): Promise<{ state: string; authorizeUrl: string }> {
  const { authorization_endpoint } = await discover(hooks.fetchFn);
  const state = randomValue();
  const nonce = randomValue();
  const verifier = randomValue();
  const { server, port } = await listen(state);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const timer = setTimeout(() => {
    if (signIns.get(state)?.server === server) {
      signIns.delete(state);
      server.close();
      // Said aloud, so a sheet still waiting stops waiting.
      chatgptSignInEvents.emit("sign-in-failed", {
        userId,
        state,
        message:
          "The sign-in timed out. Start again with Sign in with ChatGPT.",
      });
    }
  }, SIGN_IN_TTL_MS);
  timer.unref?.();
  signIns.set(state, {
    userId,
    nonce,
    verifier,
    clientId: hooks.savedClientId,
    redirectUri,
    timer,
    server,
    hooks,
  });
  const authorizeUrl = await buildAuthorizeUrl({
    authorizationEndpoint: authorization_endpoint,
    clientId: hooks.savedClientId,
    redirectUri,
    state,
    nonce,
    verifier,
    appName: APP_NAME,
  });
  return { state, authorizeUrl };
}

/** Finishes a sign-in from the address the browser landed on. */
export function completeFromPastedUrl(
  userId: number,
  pasted: string,
): Promise<SignInResult> {
  const params = parseCallback(pasted);
  if (!params || !params.state)
    return Promise.reject(
      new ChatgptAuthError(
        "invalid_callback",
        "That address is not a ChatGPT sign-in result. Copy the whole address from the page the browser opened after you signed in.",
      ),
    );
  const pending = signIns.get(params.state);
  if (!pending || pending.userId !== userId)
    return Promise.reject(
      new ChatgptAuthError(
        "unknown_sign_in",
        "This sign-in has expired or was already used. Start again with Sign in with ChatGPT.",
      ),
    );
  return finish(params.state, params);
}

/** Takes a finished connection for Save. It can be taken once. */
export function takeConnection(
  userId: number,
  connectionId: string,
): ChatgptCredentials | null {
  const pending = connections.get(connectionId);
  if (!pending || pending.userId !== userId) return null;
  connections.delete(connectionId);
  clearTimeout(pending.timer);
  return pending.credentials;
}

/** A finished connection's tokens, left in place: for the model list before Save. */
export function peekConnection(
  userId: number,
  connectionId: string,
): ChatgptCredentials | null {
  const pending = connections.get(connectionId);
  return pending && pending.userId === userId ? pending.credentials : null;
}

async function finish(
  state: string,
  params: CallbackParams,
): Promise<SignInResult> {
  // Taken out at once, so the listener and a paste cannot both use one code.
  const pending = signIns.get(state);
  if (!pending)
    throw new ChatgptAuthError(
      "unknown_sign_in",
      "This sign-in has expired or was already used. Start again with Sign in with ChatGPT.",
    );
  signIns.delete(state);
  clearTimeout(pending.timer);
  pending.server.close();

  try {
    if (!params.ok)
      throw new ChatgptAuthError(
        params.error,
        params.error === "access_denied"
          ? "ChatGPT sign-in was cancelled."
          : `ChatGPT sign-in failed (${params.error}).`,
      );
    const clientId = params.clientId ?? pending.clientId;
    if (!clientId || clientId === DYNAMIC_CLIENT_ID)
      throw new ChatgptAuthError(
        "registration_incomplete",
        "ChatGPT did not finish registering Akaun. Try signing in again.",
      );
    const credentials = await exchangeCode(
      {
        clientId,
        code: params.code,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
        nonce: pending.nonce,
      },
      pending.hooks.fetchFn,
    );
    // Saved only now. A pasted address can carry any `client_id`, and only a
    // successful exchange, whose ID token names it as the audience, shows the
    // issuer really issued it. Saving it sooner would let one bad paste
    // break sign-in for the whole installation.
    if (clientId !== pending.clientId) pending.hooks.onClientId?.(clientId);
    const connectionId = crypto.randomUUID();
    const timer = setTimeout(
      () => connections.delete(connectionId),
      CONNECTION_TTL_MS,
    );
    timer.unref?.();
    connections.set(connectionId, {
      userId: pending.userId,
      credentials,
      timer,
    });
    const result = { connectionId, email: credentials.email ?? null };
    chatgptSignInEvents.emit("sign-in-complete", {
      userId: pending.userId,
      state,
      ...result,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ChatGPT sign-in failed.";
    chatgptSignInEvents.emit("sign-in-failed", {
      userId: pending.userId,
      state,
      message,
    });
    throw error;
  }
}

/** The loopback listener for one sign-in. It answers only its own callback. */
function listen(state: string): Promise<{ server: Server; port: number }> {
  let port = 0;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    // The Host check stops a page that rebinds a name to 127.0.0.1 from
    // reaching the listener.
    if (
      req.method !== "GET" ||
      url.pathname !== CALLBACK_PATH ||
      req.headers.host !== `127.0.0.1:${port}`
    ) {
      res.writeHead(404).end("Not found");
      return;
    }
    const params = parseCallback(url.href);
    if (!params || params.state !== state) {
      res
        .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end(
          "This is not the sign-in Akaun is waiting for. Start again from Settings.",
        );
      return;
    }
    finish(state, params).then(
      () =>
        page(res, "Signed in", "You can close this tab and return to Akaun."),
      (error: unknown) =>
        page(
          res,
          "Sign-in did not finish",
          error instanceof Error ? error.message : "Try again from Settings.",
        ),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new ChatgptAuthError(
          "callback_unavailable",
          "Akaun could not open a local port for the ChatGPT sign-in.",
        ),
      ),
    );
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function page(
  res: import("node:http").ServerResponse,
  title: string,
  text: string,
): void {
  const escape = (s: string) =>
    s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res
    .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    .end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(title)}</title>` +
        `<style>body{font:16px system-ui;max-width:32rem;margin:18vh auto;padding:24px}</style>` +
        `<h1>${escape(title)}</h1><p>${escape(text)}</p></html>`,
    );
}
