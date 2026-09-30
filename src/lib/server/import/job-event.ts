import type { importItems, importQueue } from "../db/schema.js";

type ImportJobRow = typeof importQueue.$inferSelect;

/** An import job as the import screen receives it, without the document text. */
export type ImportJobEvent = Omit<
  ImportJobRow,
  "extractedText" | "preExtractedText"
>;

/**
 * The one shape of a job row that leaves the server as a live update or in the
 * stream's first snapshot. The document text is dropped: it can be tens of
 * thousands of characters, no screen reads it from an event, and every open tab
 * would otherwise receive it again each time the job changes state. The text
 * stays in the table, where confirm and the duplicate check read it.
 */
export function jobForEvent(row: ImportJobRow): ImportJobEvent {
  const job: Partial<ImportJobRow> = { ...row };
  delete job.extractedText;
  delete job.preExtractedText;
  return job as ImportJobEvent;
}

type ImportItemRow = typeof importItems.$inferSelect;

/**
 * One item of a group as the import screens receive it. An item keeps no
 * document text, so it is sent whole; this type is the one name for that
 * shape, so a column added to items later is a choice made here.
 */
export type ImportItemEvent = ImportItemRow;

/** The shape of an item row that leaves the server as a live update. */
export function itemForEvent(row: ImportItemRow): ImportItemEvent {
  return { ...row };
}
