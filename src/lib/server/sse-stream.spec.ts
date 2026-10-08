import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import { eventStream } from "./sse-stream.js";

describe("SSE snapshots", () => {
  it("recovers a result completed before connect and filters subsequent events", async () => {
    const emitter = new EventEmitter();
    const response = eventStream(
      [
        {
          emitter,
          events: { complete: "sign-in-complete" },
          filter: (payload) => payload.userId === 1 && payload.state === "mine",
        },
      ],
      () => ({
        type: "sign-in-complete",
        state: "mine",
        connectionId: "saved-result",
      }),
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain(
      "saved-result",
    );
    emitter.emit("complete", {
      userId: 2,
      state: "mine",
      connectionId: "another-user",
    });
    emitter.emit("complete", {
      userId: 1,
      state: "other",
      connectionId: "another-attempt",
    });
    emitter.emit("complete", {
      userId: 1,
      state: "mine",
      connectionId: "my-result",
    });
    const next = decoder.decode((await reader.read()).value);
    expect(next).toContain("my-result");
    expect(next).not.toMatch(/another-user|another-attempt/);
    await reader.cancel();
    expect(emitter.listenerCount("complete")).toBe(0);
  });
});
