import { eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema.js';
import { groups, groupPermissions, userGroups, userPermissions } from './db/schema.js';

type Db = BetterSQLite3Database<typeof schema>;

export type ResourceName = 'dashboard' | 'expenses' | 'income' | 'claims' | 'import' | 'categories';
export type ActionName = 'view' | 'add' | 'change' | 'delete';
export type PermissionSet = Record<ActionName, boolean>;
export type EffectivePermissions = Record<ResourceName, PermissionSet>;

const ALL_RESOURCES: ResourceName[] = ['dashboard', 'expenses', 'income', 'claims', 'import', 'categories'];

function emptyPermissions(): EffectivePermissions {
	const perms = {} as EffectivePermissions;
	for (const r of ALL_RESOURCES) {
		perms[r] = { view: false, add: false, change: false, delete: false };
	}
	return perms;
}

function fullPermissions(): EffectivePermissions {
	const perms = {} as EffectivePermissions;
	for (const r of ALL_RESOURCES) {
		perms[r] = { view: true, add: true, change: true, delete: true };
	}
	return perms;
}

export function getEffectivePermissions(
	db: Db,
	userId: number
): { permissions: EffectivePermissions; isSuperuser: boolean } {
	const memberships = db
		.select({ groupId: userGroups.groupId })
		.from(userGroups)
		.where(eq(userGroups.userId, userId))
		.all();

	if (memberships.length === 0) {
		return { permissions: emptyPermissions(), isSuperuser: false };
	}

	const groupIds = memberships.map((m) => m.groupId);

	const userGroupRows = db
		.select({ isSuperuser: groups.isSuperuser })
		.from(groups)
		.where(inArray(groups.id, groupIds))
		.all();

	if (userGroupRows.some((g) => g.isSuperuser)) {
		return { permissions: fullPermissions(), isSuperuser: true };
	}

	const permRows = db
		.select()
		.from(groupPermissions)
		.where(inArray(groupPermissions.groupId, groupIds))
		.all();

	const merged = emptyPermissions();
	for (const row of permRows) {
		const res = row.resource as ResourceName;
		if (!merged[res]) continue;
		if (row.canView) merged[res].view = true;
		if (row.canAdd) merged[res].add = true;
		if (row.canChange) merged[res].change = true;
		if (row.canDelete) merged[res].delete = true;
	}

	// Apply user-level extra permissions (additive OR merge on top of group-merged)
	const userOverrides = db
		.select()
		.from(userPermissions)
		.where(eq(userPermissions.userId, userId))
		.all();

	for (const row of userOverrides) {
		const res = row.resource as ResourceName;
		if (!merged[res]) continue;
		if (row.canView) merged[res].view = true;
		if (row.canAdd) merged[res].add = true;
		if (row.canChange) merged[res].change = true;
		if (row.canDelete) merged[res].delete = true;
	}

	return { permissions: merged, isSuperuser: false };
}

export function hasPermission(
	locals: App.Locals,
	resource: ResourceName,
	action: ActionName
): boolean {
	if (locals.isSuperuser) return true;
	return locals.permissions?.[resource]?.[action] ?? false;
}
