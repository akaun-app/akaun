import type { PageServerLoad, Actions } from './$types.js';
import { loadContactsPage, contactsActions } from '$lib/server/loaders/contacts.js';

export const load: PageServerLoad = ({ locals }) => loadContactsPage(locals);
export const actions: Actions = contactsActions;
