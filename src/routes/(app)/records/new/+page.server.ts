import type { PageServerLoad } from "./$types.js";
import { loadRecordNew } from "$lib/server/loaders/records.js";

export const load: PageServerLoad = ({ locals }) => loadRecordNew(locals);
