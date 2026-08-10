import type { PageServerLoad } from './$types.js';
import { loadReconciliationPage } from '$lib/server/loaders/reconciliation.js';

export const load: PageServerLoad = ({ locals }) => loadReconciliationPage(locals, null);
