import type { PageServerLoad } from "./$types.js";
import { loadImportProfileDetail } from "$lib/server/loaders/import-profiles.js";

export const load: PageServerLoad = ({ locals, params }) =>
  loadImportProfileDetail(locals, params.id);
