import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getAuditTrail, type RecordType } from '$lib/server/audit.js';
import { hasPermission, type ResourceName } from '$lib/server/permissions.js';

// audit RecordType -> the ResourceName whose 'view' permission gates it.
const RESOURCE_BY_RECORD_TYPE: Record<RecordType, ResourceName> = {
	expense: 'expenses',
	income: 'income',
	claim: 'claims',
	contact: 'contacts',
	quotation: 'quotations',
	invoice: 'invoices'
};

export const GET: RequestHandler = ({ locals, params }) => {
	const recordType = params.recordType as RecordType;
	const resource = RESOURCE_BY_RECORD_TYPE[recordType];
	if (!resource) return Response.json({ error: 'Unknown record type' }, { status: 400 });
	if (!hasPermission(locals, resource, 'view')) return new Response('Forbidden', { status: 403 });

	const recordId = parseInt(params.recordId!);
	if (!recordId) return Response.json({ error: 'Invalid record id' }, { status: 400 });

	return Response.json(getAuditTrail(db, recordType, recordId));
};
