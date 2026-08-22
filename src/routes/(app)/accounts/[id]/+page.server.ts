import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';
import { loadAccountDetail, accountsActions } from '$lib/server/loaders/accounts.js';

/**
 * One account's page.
 *
 * `accountsActions` stays: the opening-balance editor and the delete/deactivate
 * buttons post form actions from here. The merged-account redirect moved into
 * the loader, so this route no longer has an opinion about which id is real.
 */
export const load: PageServerLoad = ({ locals, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw redirect(302, '/accounts');
	return loadAccountDetail(locals, id);
};
export const actions: Actions = accountsActions;
