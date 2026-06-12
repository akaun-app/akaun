import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DATABASE_PATH } from '../env.js';
import * as schema from './schema.js';
import { users } from './schema.js';

function createDb() {
	mkdirSync(dirname(DATABASE_PATH), { recursive: true });
	const sqlite = new Database(DATABASE_PATH);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}

export const db = createDb();

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
		console.log('[akaun] Default admin user created (username: admin, password: admin)');
	}
}
