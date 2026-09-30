/**
 * What the worker's slots need to know about the outside world. Passed in, so
 * the slot rules can be tested without a database or an AI provider.
 */
export type JobSlotDeps<J extends { id: string }> = {
  /** The jobs waiting to start, oldest-first or in whatever order the queue gives. */
  listQueued: () => J[];
  /** How many jobs may run at the same time. Read on every tick, so a change in settings applies at once. */
  maxConcurrency: () => number;
  /** Does all the work for one job. */
  run: (job: J) => Promise<void>;
  /** Called when `run` throws. The slot is freed either way. */
  onError: (job: J, err: unknown) => void;
};

/**
 * The worker's fixed number of slots. Each tick fills the free slots with
 * queued jobs and returns straight away, without waiting for them. A job frees
 * its slot when it ends, whether it succeeded or failed.
 *
 * Before this, a tick waited for its whole batch, so one slow document held
 * every free slot empty until it was done.
 */
export function createJobSlots<J extends { id: string }>(deps: JobSlotDeps<J>) {
  const active = new Set<string>();

  function start(job: J) {
    active.add(job.id);
    deps
      .run(job)
      .catch((err: unknown) => deps.onError(job, err))
      .finally(() => active.delete(job.id));
  }

  return {
    /** Starts as many queued jobs as there are free slots. Never waits for one. */
    tick(): void {
      const free = deps.maxConcurrency() - active.size;
      if (free <= 0) return;
      // A job that has started can still show as queued for a moment, before its
      // first state change is written. It already has a slot, so skip it.
      const waiting = deps.listQueued().filter((job) => !active.has(job.id));
      for (const job of waiting.slice(0, free)) start(job);
    },
    /** How many jobs are running now. */
    get activeCount(): number {
      return active.size;
    },
  };
}
