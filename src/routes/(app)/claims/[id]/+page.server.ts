import type { PageServerLoad, Actions } from './$types.js';
import { loadClaimsPage, claimsActions } from '$lib/server/loaders/claims.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadClaimsPage(locals, parseInt(params.id) || null);
export const actions: Actions = claimsActions;
