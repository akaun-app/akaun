import type { PageServerLoad } from "./$types.js";
import {
  loadRecordsPage,
  recordsActions,
} from "$lib/server/loaders/records.js";

/**
 * The same list, with one record's drawer already open, so a record has an
 * address somebody can copy out of the bar and send (FR-004).
 *
 * The shared loader redirects to `/records` when the id names nothing this user
 * can see, so a stale link lands on the list rather than an empty drawer.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const openRecordId = Number(params.id);
  const data = loadRecordsPage(
    locals,
    Number.isInteger(openRecordId) ? openRecordId : null,
  );
  return { ...data, openRecordId };
};

export const actions = recordsActions;
