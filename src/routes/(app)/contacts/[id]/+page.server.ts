import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';
import { loadContactDetail, contactsActions } from '$lib/server/loaders/contacts.js';

export const load: PageServerLoad = ({ locals, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw redirect(302, '/contacts');
	return loadContactDetail(locals, id);
};
export const actions: Actions = contactsActions;
