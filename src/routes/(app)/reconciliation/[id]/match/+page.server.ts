import type { PageServerLoad } from './$types.js';
import { loadMatchWorkspace } from '$lib/server/loaders/reconciliation.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadMatchWorkspace(locals, Number(params.id));
