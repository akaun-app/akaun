import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { importQueue } from "../db/schema.js";
import { STORAGE_PATH } from "../env.js";
import { createLogger } from "../logger.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { createJobSlots } from "./job-slots.js";
import { processImportJob } from "./process-job.js";
import { ImportState } from "$lib/enums.js";

const log = createLogger("import:worker");

const TICK_INTERVAL = 2000;

// How many documents may be read at once, from Settings (1 to 10, default 3).
function maxConcurrency(): number {
  return Math.min(
    10,
    Math.max(
      1,
      parseInt(
        getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? "3",
        10,
      ) || 3,
    ),
  );
}

const slots = createJobSlots({
  listQueued: () =>
    db
      .select()
      .from(importQueue)
      .where(eq(importQueue.state, ImportState.Queued))
      .all(),
  maxConcurrency,
  // The slots mark the job as running before this starts and free it when it
  // ends. The reading itself lives in process-job.ts, which is given the
  // database and storage folder, so its tests can give it their own.
  run: (job) => processImportJob(db, job, { storageRoot: STORAGE_PATH }),
  // The job keeps whatever state it had reached. This is logged, as a failed
  // tick was before, and the next tick carries on with the other jobs.
  onError: (job, err) => log.error({ err, jobId: job.id }, "Job error"),
});

export function startImportWorker(): void {
  recoverStaleJobs();
  scheduleTick();
}

// The next tick is scheduled as soon as this one has started its jobs. It does
// not wait for them to finish, so a free slot is filled within one interval.
function scheduleTick() {
  setTimeout(() => {
    try {
      slots.tick();
    } catch (err) {
      log.error({ err }, "Tick error");
    }
    scheduleTick();
  }, TICK_INTERVAL);
}

function recoverStaleJobs() {
  db.update(importQueue)
    .set({ state: ImportState.Queued })
    .where(
      inArray(importQueue.state, [
        ImportState.Extracting,
        ImportState.Processing,
      ]),
    )
    .run();
}
