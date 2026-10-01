/**
 * Whether a document may be read again from the same file, and if not, why
 * (006 FR-023, US9 AS6-7).
 *
 * "Read again" throws away what the last reading proposed and reads the file
 * once more, the way the user now names. That is safe only while nothing the
 * last reading proposed has become a record:
 *
 * - a receipt or invoice still waiting for review (one card, no items);
 * - a group none of whose items is confirmed yet (skipped items are fine:
 *   they made nothing, and the new reading replaces them too);
 * - a document whose reading failed.
 *
 * Every other state is refused with a sentence the screen shows as it is.
 * The rule is written once, here: the job's live update carries its answer
 * (see `jobForEvent`), so no screen needs a copy, and the route asks the same
 * function again inside its write, with the counts as they are then.
 */

import { ImportState } from "$lib/enums.js";

/**
 * Why this document cannot be read again, or null when it can.
 *
 * `confirmedItems` is how many of its items are confirmed or already
 * imported: the `confirmed` count of a group. A receipt has none.
 */
export function readAgainRefusal(
  state: number,
  confirmedItems: number,
): string | null {
  // A finished group is itself marked Imported, and its items are counted as
  // confirmed too. "Already imported" is the truer answer for it, so the
  // job's own state is asked first.
  if (state === ImportState.Imported) {
    return "This document is already imported, so it can no longer be read again.";
  }
  if (state === ImportState.Confirmed) {
    return "This document is being imported, so it can no longer be read again.";
  }
  if (confirmedItems > 0) {
    const counted =
      confirmedItems === 1
        ? "1 item is already confirmed"
        : `${confirmedItems} items are already confirmed`;
    return `${counted}, so this document can no longer be read again. Reading it again would replace items that are already in the books.`;
  }
  switch (state) {
    case ImportState.PendingReview:
    case ImportState.Grouped:
    case ImportState.Failed:
      return null;
    case ImportState.Queued:
    case ImportState.Extracting:
    case ImportState.Processing:
      return "This document is still being read. Wait until the reading has finished.";
    case ImportState.Skipped:
      return "This document was skipped, so it can no longer be read again. Upload it again to read it.";
    default:
      return "This document cannot be read again.";
  }
}
