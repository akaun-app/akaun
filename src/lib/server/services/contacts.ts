import {
	createContact as _create,
	updateContact as _update,
	setContactRoles as _setRoles,
	hardDeleteContact as _hardDelete,
	mergeContacts as _merge,
	getContact,
	type ContactCreate,
	type ContactPatch
} from '$lib/server/queries/contacts.js';
import { contactEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createContact(db: Db, actingUserId: number, data: ContactCreate) {
	const contact = _create(db, actingUserId, data);
	contactEvents.emit('contact-update', { item: contact });
	return contact;
}

export function patchContact(db: Db, id: number, actingUserId: number, patch: ContactPatch) {
	const contact = _update(db, id, actingUserId, patch);
	if (contact) contactEvents.emit('contact-update', { item: contact });
	return contact;
}

export function replaceContactRoles(db: Db, id: number, actingUserId: number, roles: number[]) {
	_setRoles(db, id, roles);
	const contact = getContact(db, id);
	if (contact) contactEvents.emit('contact-update', { item: contact });
	return contact;
}

export function deleteContact(db: Db, id: number): boolean {
	const ok = _hardDelete(db, id);
	if (ok) contactEvents.emit('contact-delete', { id });
	return ok;
}

export function mergeContacts(db: Db, survivorId: number, loserIds: number[], actingUserId: number) {
	const survivor = _merge(db, survivorId, loserIds, actingUserId);
	for (const id of loserIds) {
		if (id !== survivorId) contactEvents.emit('contact-delete', { id });
	}
	if (survivor) contactEvents.emit('contact-update', { item: survivor });
	return survivor;
}
