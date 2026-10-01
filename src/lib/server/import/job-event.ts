import type { ImportModeValue } from "$lib/import-reading.js";
import type { importItems, importQueue } from "../db/schema.js";
import { fileExists } from "../file-storage.js";
import { parseProfileSnapshot } from "./profile-snapshot.js";
import { readAgainRefusal } from "./read-again.js";

type ImportJobRow = typeof importQueue.$inferSelect;

/**
 * How many of a group's items stand where, for the queue card (FR-016).
 * "Needs attention" is an item still waiting whose confirm would be held back:
 * see `itemAttention` in `group-state.ts`.
 */
export type ImportGroupCounts = {
  ready: number;
  needsAttention: number;
  confirmed: number;
  /**
   * How many of the confirmed items are income; the rest are expenses. The
   * history row colours a finished group by what its records are.
   */
  confirmedIncome: number;
  skipped: number;
};

/**
 * The import profile a job is read with, as the screens name it (FR-041): the
 * name and import mode from the copy kept on the row, so a profile renamed or
 * deleted later does not change what the screen says.
 */
export type ImportJobProfile = { name: string; mode: ImportModeValue };

/**
 * An import job as the import screen receives it, without the document text
 * or the copy of its profile. A job read as several items also carries its
 * item counts; a receipt has none. A job read with a profile carries the
 * profile's name and mode.
 *
 * Every job says whether it can be read again from its file, and if not, why
 * (006 FR-023, US9 AS7), so the screen offers "Read again" only when the
 * server would accept it and can say why when it would not.
 */
export type ImportJobEvent = Omit<
  ImportJobRow,
  "extractedText" | "preExtractedText" | "profileSnapshot"
> & {
  itemCounts?: ImportGroupCounts;
  profile?: ImportJobProfile;
  canReadAgain: boolean;
  /** Why it cannot be read again, in words to show; null when it can. */
  readAgainReason: string | null;
};

/**
 * The one shape of a job row that leaves the server as a live update or in the
 * stream's first snapshot. The document text is dropped: it can be tens of
 * thousands of characters, no screen reads it from an event, and every open tab
 * would otherwise receive it again each time the job changes state. The text
 * stays in the table, where confirm and the duplicate check read it. The copy
 * of the profile is dropped for the same reason (its instructions alone can be
 * thousands of characters); only the name and mode the screens show are sent.
 */
export function jobForEvent(
  row: ImportJobRow,
  itemCounts?: ImportGroupCounts,
): ImportJobEvent {
  const job: Partial<ImportJobRow> = { ...row };
  delete job.extractedText;
  delete job.preExtractedText;
  delete job.profileSnapshot;
  const event = job as ImportJobEvent;
  if (itemCounts) event.itemCounts = itemCounts;
  const snapshot = parseProfileSnapshot(row.profileSnapshot);
  if (snapshot) event.profile = { name: snapshot.name, mode: snapshot.mode };
  // A group's counts are always given (see `jobEvents`); a job sent without
  // them has no items, so none of them is confirmed.
  // The file is looked for only for a skipped job (see `readAgainRefusal`).
  event.readAgainReason = readAgainRefusal(
    row.state,
    itemCounts?.confirmed ?? 0,
    () => fileExists(row.tempFilePath),
  );
  event.canReadAgain = event.readAgainReason === null;
  return event;
}

type ImportItemRow = typeof importItems.$inferSelect;

/**
 * One item of a group as the import screens receive it. An item keeps no
 * document text, so it is sent whole; this type is the one name for that
 * shape, so a column added to items later is a choice made here.
 *
 * `attention` is why a confirm-all would leave the item behind, worked out on
 * the server so no screen needs a copy of the rule. It is present on every
 * item the server sends from 006 S1 on, and null when nothing holds it back.
 */
export type ImportItemEvent = ImportItemRow & { attention?: string | null };

/** The shape of an item row that leaves the server as a live update. */
export function itemForEvent(
  row: ImportItemRow,
  attention?: string | null,
): ImportItemEvent {
  const item: ImportItemEvent = { ...row };
  if (attention !== undefined) item.attention = attention;
  return item;
}
