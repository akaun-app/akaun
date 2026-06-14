import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.isSuperuser) throw redirect(302, '/');
	// Data is loaded client-side via /api/users and /api/groups
	return {};
};
