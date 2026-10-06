import type { PageServerLoad } from "./$types.js";
import { loadImportDetail } from "$lib/server/loaders/import.js";

/**
 * One document read as several items, at its own address so it can be shared
 * (006 FR-016). No `actions`: the page writes through `/api/import/[jobId]`
 * and its item routes, which the import queue already uses.
 */
export const load: PageServerLoad = ({ locals, params }) =>
  loadImportDetail(locals, params.id);
