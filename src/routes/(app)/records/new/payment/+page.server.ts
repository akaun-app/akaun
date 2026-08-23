import type { PageServerLoad } from "./$types.js";
import { loadPaymentNew } from "$lib/server/loaders/records.js";

export const load: PageServerLoad = ({ locals, url }) =>
  loadPaymentNew(locals, url);
