import type { PageServerLoad } from "./$types.js";
import { loadImportProfileNew } from "$lib/server/loaders/import-profiles.js";

export const load: PageServerLoad = ({ locals }) =>
  loadImportProfileNew(locals);
