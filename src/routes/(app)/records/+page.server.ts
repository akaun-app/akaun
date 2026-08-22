import type { PageServerLoad } from "./$types.js";
import {
  loadRecordsPage,
  recordsActions,
} from "$lib/server/loaders/records.js";

export const load: PageServerLoad = ({ locals }) => loadRecordsPage(locals);

export const actions = recordsActions;
