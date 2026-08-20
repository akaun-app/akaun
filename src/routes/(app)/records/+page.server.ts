import type { PageServerLoad } from "./$types.js";
import {
  loadRecordsPage,
  recordsActions,
} from "$lib/server/loaders/records.js";

/** The bare list. Both routes share one loader and one set of actions. */
export const load: PageServerLoad = ({ locals }) =>
  loadRecordsPage(locals, null);

export const actions = recordsActions;
