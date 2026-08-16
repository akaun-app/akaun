import type { PageServerLoad } from './$types.js';
import { loadReportsPage } from '$lib/server/loaders/reports.js';

export const load: PageServerLoad = ({ locals, url }) => loadReportsPage(locals, null, url);
