import {
  REVIEW_COLUMN_NAMES,
  type importItems,
  type importQueue,
  type ReviewColumnName,
} from "../db/schema.js";

/**
 * The fields a reviewer checks before a document, or one item of it, becomes a
 * record, exactly as they are stored.
 *
 * A receipt's queue row and each item of a group have the same review columns
 * (`reviewColumns` in `db/schema.ts`), so this one type describes both. Code
 * that works out what a record will say from what was read (the confirm route
 * building `ImportReviewFields`, the duplicate check, the review card) can take
 * a `ReviewFields` and serve a receipt and an item alike.
 */
export type ReviewFields = Pick<
  typeof importQueue.$inferSelect,
  ReviewColumnName
>;

// Both tables must keep exactly this shape. If a review column were added to
// one table by hand and not through `reviewColumns`, or given another type,
// one of these lines would stop compiling.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const queueRowHasReviewFields: Same<
  Pick<typeof importQueue.$inferSelect, ReviewColumnName>,
  ReviewFields
> = true;
const itemHasReviewFields: Same<
  Pick<typeof importItems.$inferSelect, ReviewColumnName>,
  ReviewFields
> = true;
void queueRowHasReviewFields;
void itemHasReviewFields;

/**
 * Copies the review fields out of a queue row or an item, and nothing else.
 * A document that turns out to have one item is reviewed as a receipt, so its
 * item's fields go onto the queue row with this.
 */
export function pickReviewFields(row: ReviewFields): ReviewFields {
  const picked: Partial<Record<ReviewColumnName, unknown>> = {};
  for (const name of REVIEW_COLUMN_NAMES) picked[name] = row[name];
  return picked as ReviewFields;
}
