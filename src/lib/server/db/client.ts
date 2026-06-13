import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DATABASE_PATH } from '../env.js';
import { createLogger } from '../logger.js';
import { getSetting, setSetting, SETTING_KEYS } from '../settings.js';
import * as schema from './schema.js';
import { users } from './schema.js';

const log = createLogger('db');

function createDb() {
	mkdirSync(dirname(DATABASE_PATH), { recursive: true });
	const raw = new Database(DATABASE_PATH);
	raw.pragma('journal_mode = WAL');
	raw.pragma('foreign_keys = ON');
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
		const passwordHash = await hash('admin');
		db.insert(users)
			.values({ email: 'admin@localhost', username: 'admin', passwordHash, role: 'owner' })
			.run();
		log.info('Default admin user created (username: admin, password: admin)');
	}
}

export function ensureApiToken(): void {
	const owner = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.role, 'owner'))
		.get();
	if (!owner) return;

	const existing = getSetting(db, owner.id, SETTING_KEYS.apiBearer);
	if (existing) return;

	const token = randomBytes(32).toString('hex');
	setSetting(db, owner.id, SETTING_KEYS.apiBearer, token);
	log.info({ token }, 'API bearer token generated — copy this to use the API or iOS Shortcuts');
}
