import type { PageServerLoad } from './$types.js';
import { loadJournalPage } from '$lib/server/loaders/journal.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadJournalPage(locals, parseInt(params.id) || null);
