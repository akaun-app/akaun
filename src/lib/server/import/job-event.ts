import type { importItems, importQueue } from "../db/schema.js";

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
  skipped: number;
};

/**
 * An import job as the import screen receives it, without the document text.
 * A job read as several items also carries its item counts; a receipt has none.
 */
export type ImportJobEvent = Omit<
  ImportJobRow,
  "extractedText" | "preExtractedText"
> & { itemCounts?: ImportGroupCounts };

/**
 * The one shape of a job row that leaves the server as a live update or in the
 * stream's first snapshot. The document text is dropped: it can be tens of
 * thousands of characters, no screen reads it from an event, and every open tab
 * would otherwise receive it again each time the job changes state. The text
 * stays in the table, where confirm and the duplicate check read it.
 */
export function jobForEvent(
  row: ImportJobRow,
  itemCounts?: ImportGroupCounts,
): ImportJobEvent {
  const job: Partial<ImportJobRow> = { ...row };
  delete job.extractedText;
  delete job.preExtractedText;
  const event = job as ImportJobEvent;
  if (itemCounts) event.itemCounts = itemCounts;
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
