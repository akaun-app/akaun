import type { PageServerLoad } from "./$types.js";
import { loadQuotationNew } from "$lib/server/loaders/quotations.js";

export const load: PageServerLoad = ({ locals }) => loadQuotationNew(locals);
