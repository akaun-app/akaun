import type { PageServerLoad } from "./$types.js";
import { loadImportPage } from "$lib/server/loaders/import.js";

export const load: PageServerLoad = ({ locals }) => loadImportPage(locals);
