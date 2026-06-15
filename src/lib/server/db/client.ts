import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DATABASE_PATH, ADMIN_PASSWORD } from '../env.js';
import { createLogger } from '../logger.js';
import * as schema from './schema.js';
import { users, groups, groupPermissions, userGroups, settings } from './schema.js';

const log = createLogger('db');

function createDb() {
	mkdirSync(dirname(DATABASE_PATH), { recursive: true });
	const raw = new Database(DATABASE_PATH);
	raw.exec('PRAGMA journal_mode = WAL;');
	raw.exec('PRAGMA foreign_keys = ON;');
	const db = drizzle(raw, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return { db, raw };
}

const { db } = createDb();
export { db };

export async function ensureDefaultAdmin(): Promise<void> {
	const exists = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, 'admin'))
		.get();

	if (!exists) {
		const generated = !ADMIN_PASSWORD;
		const password = ADMIN_PASSWORD || randomBytes(18).toString('base64url');
		const passwordHash = await hash(password);
		db.insert(users)
			.values({ email: 'admin@localhost', username: 'admin', passwordHash, role: 'owner' })
			.run();
		if (generated) {
			// Print the generated password exactly once so the operator can log in and change it.
			log.warn(
				`Default admin user created (username: admin). Generated password: ${password} — log in and change it now. Set ADMIN_PASSWORD to control this.`
			);
		} else {
			log.info('Default admin user created (username: admin) with password from ADMIN_PASSWORD.');
		}
	}
}

const SEED_GROUPS = [
	{
		name: 'Administrators',
		description: 'Unrestricted access to every area, including user management, backups and reset. Cannot be renamed or deleted.',
		isSuperuser: true,
		permissions: {}
	},
	{
		name: 'Bookkeeper',
		description: 'Maintains day-to-day records across the shared ledger.',
		isSuperuser: false,
		permissions: {
			expenses: { canView: true, canAdd: true, canChange: true, canDelete: false },
			income: { canView: true, canAdd: true, canChange: true, canDelete: false },
			claims: { canView: true, canAdd: true, canChange: true, canDelete: false },
			import: { canView: true, canAdd: true, canChange: false, canDelete: false },
			categories: { canView: true, canAdd: false, canChange: true, canDelete: false }
		}
	},
	{
		name: 'Data Entry',
		description: 'Adds new records but cannot edit, claim or delete existing ones.',
		isSuperuser: false,
		permissions: {
			expenses: { canView: false, canAdd: true, canChange: false, canDelete: false },
			income: { canView: false, canAdd: true, canChange: false, canDelete: false },
			claims: { canView: false, canAdd: false, canChange: false, canDelete: false },
			import: { canView: false, canAdd: true, canChange: false, canDelete: false },
			categories: { canView: true, canAdd: false, canChange: false, canDelete: false }
		}
	},
	{
		name: 'Reviewer',
		description: 'Read-only visibility across all financial records.',
		isSuperuser: false,
		permissions: {
			expenses: { canView: true, canAdd: false, canChange: false, canDelete: false },
			income: { canView: true, canAdd: false, canChange: false, canDelete: false },
			claims: { canView: true, canAdd: false, canChange: false, canDelete: false },
			import: { canView: true, canAdd: false, canChange: false, canDelete: false },
			categories: { canView: true, canAdd: false, canChange: false, canDelete: false }
		}
	}
];

export function ensureGroupSeed(): void {
	// Seed default groups
	for (const seed of SEED_GROUPS) {
		const existing = db.select({ id: groups.id }).from(groups).where(eq(groups.name, seed.name)).get();
		if (!existing) {
			const [group] = db
				.insert(groups)
				.values({ name: seed.name, description: seed.description, isSuperuser: seed.isSuperuser })
				.returning({ id: groups.id })
				.all();
			if (!seed.isSuperuser) {
				const permRows = Object.entries(seed.permissions).map(([resource, perms]) => ({
					groupId: group.id,
					resource,
					...perms
				}));
				if (permRows.length > 0) {
					db.insert(groupPermissions).values(permRows).run();
				}
			}
			log.info({ group: seed.name }, 'Seeded default group');
		}
	}

	// Migrate api.bearerToken from settings → users.bearer_token
	const allUsers = db.select({ id: users.id, bearerToken: users.bearerToken }).from(users).all();
	for (const user of allUsers) {
		if (user.bearerToken) continue; // already migrated
		const row = db
			.select({ value: settings.value })
			.from(settings)
			.where(and(eq(settings.userId, user.id), eq(settings.key, 'api.bearerToken')))
			.get();
		if (row?.value) {
			db.update(users).set({ bearerToken: row.value }).where(eq(users.id, user.id)).run();
			db.delete(settings)
				.where(and(eq(settings.userId, user.id), eq(settings.key, 'api.bearerToken')))
				.run();
			log.info({ userId: user.id }, 'Migrated api.bearerToken to users.bearer_token');
		}
	}

	// Assign all ungrouped users to Administrators
	const adminGroup = db.select({ id: groups.id }).from(groups).where(eq(groups.name, 'Administrators')).get();
	if (!adminGroup) return;

	const ungrouped = db
		.select({ id: users.id })
		.from(users)
		.all()
		.filter((u) => {
			const membership = db
				.select({ groupId: userGroups.groupId })
				.from(userGroups)
				.where(eq(userGroups.userId, u.id))
				.get();
			return !membership;
		});

	for (const u of ungrouped) {
		db.insert(userGroups).values({ userId: u.id, groupId: adminGroup.id }).run();
		log.info({ userId: u.id }, 'Assigned ungrouped user to Administrators');
	}
}
