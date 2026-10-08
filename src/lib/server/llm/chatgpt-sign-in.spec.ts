import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  startSignIn,
  cancelSignIn,
  signInSnapshot,
  takeConnection,
  peekConnection,
  resetSignIns,
  setConnectionModels,
  connectionModelAllowed,
} from "./chatgpt-sign-in.js";
import { issuer } from "./__fixtures__/chatgpt-issuer.js";
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  resetSignIns();
  vi.useRealTimers();
});
describe("device sign-in lifecycle", () => {
  it("keeps completion for an SSE reconnect and stores nothing until Save", async () => {
    const up = issuer({ pending: 1 });
    const { state } = await startSignIn(1, { fetchFn: up.fn });
    expect(signInSnapshot(2, state)).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signInSnapshot(1, state)?.type).toBe("sign-in-pending");
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = signInSnapshot(1, state);
    expect(snapshot?.type).toBe("sign-in-complete");
    if (snapshot?.type !== "sign-in-complete")
      throw new Error("Expected completion");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /secret-device|access_token|refresh_token/,
    );
    expect(peekConnection(2, snapshot.connectionId)).toBeNull();
    expect(takeConnection(2, snapshot.connectionId)).toBeNull();
    expect(takeConnection(1, snapshot.connectionId)?.accountId).toBe("account");
    expect(takeConnection(1, snapshot.connectionId)).toBeNull();
  });
  it("cancels only the owner's attempt and stops future checks", async () => {
    const up = issuer({ pending: 100 });
    const { state } = await startSignIn(1, { fetchFn: up.fn });
    cancelSignIn(2, state);
    expect(signInSnapshot(1, state)?.type).toBe("sign-in-pending");
    cancelSignIn(1, state);
    cancelSignIn(1, state);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(up.fn).toHaveBeenCalledTimes(1);
    expect(signInSnapshot(1, state)?.type).toBe("sign-in-failed");
  });
  it("expires codes without making another request", async () => {
    const up = issuer({ interval: 5, expires: 2 });
    const { state } = await startSignIn(1, { fetchFn: up.fn });
    await vi.advanceTimersByTimeAsync(5000);
    expect(signInSnapshot(1, state)).toMatchObject({
      type: "sign-in-failed",
      message: expect.stringMatching(/expired/),
    });
    expect(up.fn).toHaveBeenCalledTimes(1);
  });
  it("replaces concurrent attempts without checking the superseded code", async () => {
    const up = issuer({ pending: 100 });
    const first = await startSignIn(1, { fetchFn: up.fn });
    const second = await startSignIn(1, { fetchFn: up.fn });
    await vi.advanceTimersByTimeAsync(1000);
    expect(signInSnapshot(1, first.state)).toBeNull();
    expect(signInSnapshot(1, second.state)?.type).toBe("sign-in-pending");
    expect(
      up.fn.mock.calls.filter(([url]) => url.endsWith("/deviceauth/token")),
    ).toHaveLength(1);
  });
  it("discards an approval that returns after cancellation", async () => {
    const up = issuer();
    let release!: (response: Response) => void;
    const fn = async (url: string, init?: RequestInit) =>
      url.endsWith("/deviceauth/token")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : up.fn(url, init);
    const { state } = await startSignIn(1, { fetchFn: fn });
    await vi.advanceTimersByTimeAsync(1000);
    cancelSignIn(1, state);
    release(Response.json({ authorization_code: "c", code_verifier: "v" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(signInSnapshot(1, state)?.type).toBe("sign-in-failed");
  });
  it("honors rate-limit retry-after without browser polling", async () => {
    const up = issuer();
    let polls = 0;
    const fn = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/deviceauth/token") && ++polls === 1)
        return Response.json(
          { error: "rate_limited" },
          { status: 429, headers: { "retry-after": "30" } },
        );
      return up.fn(url, init);
    };
    const { state } = await startSignIn(1, { fetchFn: fn });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signInSnapshot(1, state)?.type).toBe("sign-in-complete");
  });
  it("allows Save only for a model in the owner's server-fetched catalog", async () => {
    const { state } = await startSignIn(1, { fetchFn: issuer().fn });
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = signInSnapshot(1, state);
    if (snapshot?.type !== "sign-in-complete")
      throw new Error("Expected completion");
    const id = snapshot.connectionId;
    expect(connectionModelAllowed(1, id, "model")).toBe(false);
    setConnectionModels(2, id, ["forged"]);
    expect(connectionModelAllowed(1, id, "forged")).toBe(false);
    setConnectionModels(1, id, ["model"]);
    expect(connectionModelAllowed(1, id, "model")).toBe(true);
    expect(connectionModelAllowed(2, id, "model")).toBe(false);
    expect(connectionModelAllowed(1, id, "old-model")).toBe(false);
    expect(takeConnection(1, id)?.accountId).toBe("account");
    expect(connectionModelAllowed(1, id, "model")).toBe(false);
  });
  it("expires an unsaved connection", async () => {
    const { state } = await startSignIn(1, { fetchFn: issuer().fn });
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = signInSnapshot(1, state);
    if (snapshot?.type !== "sign-in-complete")
      throw new Error("Expected completion");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(peekConnection(1, snapshot.connectionId)).toBeNull();
  });
});
