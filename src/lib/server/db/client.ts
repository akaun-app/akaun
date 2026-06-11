import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DATABASE_PATH } from '../env.js';
import * as schema from './schema.js';

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
