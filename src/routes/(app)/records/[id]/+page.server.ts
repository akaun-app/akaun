import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types.js";
import { loadRecordDetail } from "$lib/server/loaders/records.js";

/**
 * One record's page, at the address it has always had (FR-004).
 *
 * No `actions`: the page saves through `PATCH /api/records/[id]` and deletes
 * through `DELETE /api/records/[id]`, the same endpoints the create drawer
 * already used.
 */
export const load: PageServerLoad = ({ locals, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw redirect(302, "/records");
	return loadRecordDetail(locals, id);
};
