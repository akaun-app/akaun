// Device sign-in state stays server-side and belongs to the initiating user.
import { EventEmitter } from "node:events";
import {
  requestDeviceCode,
  checkDeviceCode,
  ChatgptAuthError,
  type DeviceAuthorization,
  type ChatgptCredentials,
} from "./chatgpt-oauth.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface SignInResult {
  connectionId: string;
  email: string | null;
}
export type SignInSnapshot =
  | { type: "sign-in-pending"; state: string }
  | ({ type: "sign-in-complete"; state: string } & SignInResult)
  | { type: "sign-in-failed"; state: string; message: string };
interface Attempt {
  userId: number;
  state: string;
  controller: AbortController;
  snapshot: SignInSnapshot;
  device?: DeviceAuthorization;
  timer?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
  fetchFn?: FetchLike;
}
interface Connection {
  models?: Set<string>;
  userId: number;
  credentials: ChatgptCredentials;
  timer: ReturnType<typeof setTimeout>;
}
const attempts = new Map<string, Attempt>();
const activeByUser = new Map<number, string>();
const connections = new Map<string, Connection>();
const CONNECTION_TTL_MS = 30 * 60_000;
export const chatgptSignInEvents = new EventEmitter();

function publish(a: Attempt, snapshot: SignInSnapshot) {
  a.snapshot = snapshot;
  chatgptSignInEvents.emit(snapshot.type, { userId: a.userId, ...snapshot });
}
function stop(a: Attempt) {
  a.controller.abort();
  clearTimeout(a.timer);
  clearTimeout(a.expiry);
  if (activeByUser.get(a.userId) === a.state) activeByUser.delete(a.userId);
}
function retainTerminal(a: Attempt) {
  a.timer = setTimeout(() => attempts.delete(a.state), CONNECTION_TTL_MS);
  a.timer.unref?.();
}
function fail(a: Attempt, message: string) {
  if (a.snapshot.type !== "sign-in-pending") return;
  stop(a);
  publish(a, { type: "sign-in-failed", state: a.state, message });
  retainTerminal(a);
}
export function signInSnapshot(
  userId: number,
  state: string,
): SignInSnapshot | null {
  const a = attempts.get(state);
  return a?.userId === userId ? a.snapshot : null;
}
export function cancelSignIn(userId: number, state: string): void {
  const a = attempts.get(state);
  if (a?.userId === userId) fail(a, "ChatGPT sign-in was cancelled.");
}
export async function startSignIn(
  userId: number,
  hooks: { fetchFn?: FetchLike } = {},
) {
  const previous = activeByUser.get(userId);
  if (previous) cancelSignIn(userId, previous);
  // Bound retained attempts per user; saved/staged connections have their own TTL.
  for (const [id, old] of attempts) {
    if (old.userId === userId) {
      clearTimeout(old.timer);
      attempts.delete(id);
    }
  }
  const state = crypto.randomUUID();
  const a: Attempt = {
    userId,
    state,
    controller: new AbortController(),
    snapshot: { type: "sign-in-pending", state },
    fetchFn: hooks.fetchFn,
  };
  attempts.set(state, a);
  activeByUser.set(userId, state);
  try {
    const device = await requestDeviceCode(hooks.fetchFn, a.controller.signal);
    if (a.controller.signal.aborted)
      throw new ChatgptAuthError(
        "cancelled",
        "This sign-in was replaced. Start again.",
      );
    a.device = device;
    a.expiry = setTimeout(
      () => fail(a, "The sign-in code expired. Start again."),
      Math.max(0, device.expiresAt - Date.now()),
    );
    a.expiry.unref?.();
    schedule(a, device.intervalMs);
    return {
      state,
      userCode: device.userCode,
      verificationUrl: device.verificationUrl,
      expiresAt: device.expiresAt,
    };
  } catch (error) {
    fail(
      a,
      error instanceof ChatgptAuthError
        ? error.message
        : "ChatGPT sign-in could not start. Try again.",
    );
    throw error instanceof ChatgptAuthError
      ? error
      : new ChatgptAuthError(
          "sign_in_unavailable",
          "ChatGPT sign-in could not start. Try again.",
        );
  }
}
function schedule(a: Attempt, delay: number) {
  a.timer = setTimeout(() => {
    void poll(a);
  }, delay);
  a.timer.unref?.();
}
async function poll(a: Attempt) {
  const device = a.device;
  if (!device || a.controller.signal.aborted) return;
  try {
    const credentials = await checkDeviceCode(
      device,
      a.fetchFn,
      a.controller.signal,
    );
    if (a.controller.signal.aborted) return;
    if (!credentials) {
      schedule(a, device.intervalMs);
      return;
    }
    stop(a);
    const connectionId = crypto.randomUUID();
    const timer = setTimeout(() => {
      connections.delete(connectionId);
      if (a.snapshot.type === "sign-in-complete")
        publish(a, {
          type: "sign-in-failed",
          state: a.state,
          message: "The connection expired before Save. Sign in again.",
        });
    }, CONNECTION_TTL_MS);
    timer.unref?.();
    const own = [...connections.entries()].filter(
      ([, p]) => p.userId === a.userId,
    );
    if (own.length >= 10) {
      const [oldId, old] = own[0];
      clearTimeout(old.timer);
      connections.delete(oldId);
    }
    connections.set(connectionId, { userId: a.userId, credentials, timer });
    publish(a, {
      type: "sign-in-complete",
      state: a.state,
      connectionId,
      email: credentials.email ?? null,
    });
    retainTerminal(a);
  } catch (error) {
    if (a.controller.signal.aborted) return;
    // Transient upstream/network failures retry within the overall expiry bound.
    if (error instanceof ChatgptAuthError && error.code === "slow_down") {
      device.intervalMs += 5000;
      schedule(a, device.intervalMs);
      return;
    }
    if (
      !(error instanceof ChatgptAuthError) ||
      error.status === 429 ||
      (error.status ?? 0) >= 500
    ) {
      schedule(
        a,
        Math.max(
          device.intervalMs,
          10_000,
          error instanceof ChatgptAuthError ? (error.retryAfterMs ?? 0) : 0,
        ),
      );
      return;
    }
    fail(a, error.message);
  }
}
/** Catalog returned by OpenAI for this unsaved connection, never browser input. */
export function setConnectionModels(
  userId: number,
  connectionId: string,
  models: string[],
): void {
  const p = connections.get(connectionId);
  if (p?.userId === userId) p.models = new Set(models);
}
export function connectionModelAllowed(
  userId: number,
  connectionId: string,
  model: string,
): boolean {
  const p = connections.get(connectionId);
  return p?.userId === userId && p.models?.has(model) === true;
}
export function takeConnection(
  userId: number,
  connectionId: string,
): ChatgptCredentials | null {
  const p = connections.get(connectionId);
  if (!p || p.userId !== userId) return null;
  connections.delete(connectionId);
  clearTimeout(p.timer);
  return p.credentials;
}
export function peekConnection(
  userId: number,
  connectionId: string,
): ChatgptCredentials | null {
  const p = connections.get(connectionId);
  return p?.userId === userId ? p.credentials : null;
}
/** Test teardown: abort all requests and release every timer. */
export function resetSignIns(): void {
  for (const a of attempts.values()) stop(a);
  for (const p of connections.values()) clearTimeout(p.timer);
  attempts.clear();
  activeByUser.clear();
  connections.clear();
}
