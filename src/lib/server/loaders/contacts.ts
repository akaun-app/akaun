import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listContacts, getContactUsageCounts } from '$lib/server/queries/contacts.js';
import {
	createContact,
	patchContact,
	replaceContactRoles,
	deleteContact,
	mergeContacts
} from '$lib/server/services/contacts.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export function loadContactsPage(locals: App.Locals, openContactId: number | null) {
	if (!hasPermission(locals, 'contacts', 'view')) throw redirect(302, '/dashboard');

	const contacts = listContacts(db, {});
	const usage = getContactUsageCounts(db, contacts.map((c) => c.id));

	if (openContactId !== null && !contacts.some((c) => c.id === openContactId)) {
		throw redirect(302, '/contacts');
	}

	return {
		contacts,
		usage,
		openContactId,
		perms: {
			add: hasPermission(locals, 'contacts', 'add'),
			change: hasPermission(locals, 'contacts', 'change'),
			delete: hasPermission(locals, 'contacts', 'delete')
		}
	};
}

function parseRoles(data: FormData): number[] {
	return data.getAll('roles').map((r) => parseInt(String(r))).filter((n) => !Number.isNaN(n));
}

export const contactsActions: Actions = {
	create: async ({ locals, request }) => {
		if (!hasPermission(locals, 'contacts', 'add')) return fail(403, { error: 'Forbidden' });
		const userId = locals.user!.id;
		const data = await request.formData();

		const entityType = parseInt(String(data.get('entityType') ?? '0'));
		const legalName = String(data.get('legalName') ?? '').trim();
		if (!entityType) return fail(400, { error: 'Entity type is required' });
		if (!legalName) return fail(400, { error: 'Legal name is required' });

		const contact = createContact(db, userId, {
			entityType,
			legalName,
			registrationNo: String(data.get('registrationNo') ?? '').trim() || null,
			email: String(data.get('email') ?? '').trim() || null,
			phone: String(data.get('phone') ?? '').trim() || null,
			address: String(data.get('address') ?? '').trim() || null,
			remark: String(data.get('remark') ?? '').trim() || null,
			roles: parseRoles(data)
		});

		return { success: true, id: contact.id };
	},

	update: async ({ locals, request }) => {
		if (!hasPermission(locals, 'contacts', 'change')) return fail(403, { error: 'Forbidden' });
		const userId = locals.user!.id;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid contact' });

		const legalName = String(data.get('legalName') ?? '').trim();
		if (!legalName) return fail(400, { error: 'Legal name is required' });

		patchContact(db, id, userId, {
			entityType: parseInt(String(data.get('entityType') ?? '0')) || undefined,
			legalName,
			registrationNo: String(data.get('registrationNo') ?? '').trim() || null,
			email: String(data.get('email') ?? '').trim() || null,
			phone: String(data.get('phone') ?? '').trim() || null,
			address: String(data.get('address') ?? '').trim() || null,
			remark: String(data.get('remark') ?? '').trim() || null
		});
		replaceContactRoles(db, id, userId, parseRoles(data));

		return { success: true, id };
	},

	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'contacts', 'delete')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid contact' });
		const ok = deleteContact(db, id);
		if (!ok) return fail(409, { error: 'Contact is referenced by records and cannot be deleted.' });
		return { success: true };
	},

	merge: async ({ locals, request }) => {
		if (!hasPermission(locals, 'contacts', 'change') || !hasPermission(locals, 'contacts', 'delete')) {
			return fail(403, { error: 'Forbidden' });
		}
		const userId = locals.user!.id;
		const data = await request.formData();
		const survivorId = parseInt(String(data.get('survivorId') ?? '0'));
		const loserIds = String(data.get('loserIds') ?? '').split(',').map(Number).filter(Boolean);
		if (!survivorId || loserIds.length === 0 || loserIds.includes(survivorId)) {
			return fail(400, { error: 'Invalid survivor/loser selection' });
		}
		mergeContacts(db, survivorId, loserIds, userId);
		return { success: true };
	}
};
