import type { PageServerLoad } from './$types.js';
import { loadReportsPage } from '$lib/server/loaders/reports.js';

export const load: PageServerLoad = ({ locals, params, url }) =>
	loadReportsPage(locals, params.view, url);
