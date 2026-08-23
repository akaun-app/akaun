import type { PageServerLoad } from "./$types.js";
import { loadInvoiceNew } from "$lib/server/loaders/invoices.js";

export const load: PageServerLoad = ({ locals }) => loadInvoiceNew(locals);
