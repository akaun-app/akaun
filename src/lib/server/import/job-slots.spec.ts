import { describe, expect, it } from "vitest";
import { createJobSlots } from "./job-slots.js";

// The worker's slots, with the per-job work replaced by a promise the test
// ends by hand. No database, no AI provider and no timers are involved.

type Job = { id: string };

/** A job run that only ends when the test says so. */
function controlledRuns() {
  const started: string[] = [];
  const endings = new Map<
    string,
    { finish: () => void; fail: (err: Error) => void }
  >();
  const run = (job: Job) =>
    new Promise<void>((resolve, reject) => {
      started.push(job.id);
      endings.set(job.id, { finish: resolve, fail: reject });
    });
  return { started, endings, run };
}

/** Lets the `.catch` / `.finally` that free a slot run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(max: number, queue: Job[]) {
  const runs = controlledRuns();
  const errors: { id: string; err: unknown }[] = [];
  let limit = max;
  const slots = createJobSlots<Job>({
    listQueued: () => queue,
    maxConcurrency: () => limit,
    run: runs.run,
    onError: (job, err) => errors.push({ id: job.id, err }),
  });
  return {
    ...runs,
    slots,
    errors,
    setLimit: (n: number) => (limit = n),
  };
}

describe("createJobSlots", () => {
  it("starts a second job while a long one is still running", () => {
    const queue: Job[] = [{ id: "long" }];
    const t = setup(3, queue);

    // The tick returns without waiting for the job it started.
    expect(t.slots.tick()).toBeUndefined();
    expect(t.started).toEqual(["long"]);

    // The long job is still running when a second document arrives.
    queue.splice(0, queue.length, { id: "second" });
    t.slots.tick();

    expect(t.started).toEqual(["long", "second"]);
    expect(t.slots.activeCount).toBe(2);
  });

  it("never runs more jobs at once than the setting allows", async () => {
    const queue: Job[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const t = setup(2, queue);

    t.slots.tick();
    expect(t.started).toEqual(["a", "b"]);

    // Both slots are taken, so another tick starts nothing.
    queue.splice(0, 2);
    t.slots.tick();
    expect(t.started).toEqual(["a", "b"]);
    expect(t.slots.activeCount).toBe(2);

    // One job ends, which frees one slot for one more job.
    t.endings.get("a")!.finish();
    await settle();
    t.slots.tick();
    expect(t.started).toEqual(["a", "b", "c"]);
    expect(t.slots.activeCount).toBe(2);
  });

  it("frees the slot of a job that throws, and reports the error", async () => {
    const queue: Job[] = [{ id: "bad" }];
    const t = setup(1, queue);

    t.slots.tick();
    const err = new Error("provider down");
    t.endings.get("bad")!.fail(err);
    await settle();

    expect(t.errors).toEqual([{ id: "bad", err }]);
    expect(t.slots.activeCount).toBe(0);

    queue.splice(0, queue.length, { id: "next" });
    t.slots.tick();
    expect(t.started).toEqual(["bad", "next"]);
  });

  it("does not start a running job again while it still shows as queued", () => {
    // A job with caller-supplied text stays Queued until its first state change.
    const queue: Job[] = [{ id: "a" }, { id: "b" }];
    const t = setup(3, queue);

    t.slots.tick();
    t.slots.tick();

    expect(t.started).toEqual(["a", "b"]);
    expect(t.slots.activeCount).toBe(2);
  });

  it("reads the limit on every tick", () => {
    const queue: Job[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const t = setup(1, queue);

    t.slots.tick();
    expect(t.started).toEqual(["a"]);

    t.setLimit(3);
    t.slots.tick();
    expect(t.started).toEqual(["a", "b", "c"]);
  });
});
