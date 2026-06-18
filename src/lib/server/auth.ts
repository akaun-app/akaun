import { randomBytes } from 'crypto';
import { eq, lt } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './db/schema.js';
import { sessions, users } from './db/schema.js';

type Db = BunSQLiteDatabase<typeof schema>;

export function getSessionUser(
	db: Db,
	sessionId: string
): { id: number; email: string; username: string; name: string | null; role: string } | null {
	const now = new Date().toISOString();

	// Sweep expired sessions
	db.delete(sessions).where(lt(sessions.expiresAt, now)).run();

	const row = db
		.select({
			id: users.id,
			email: users.email,
			username: users.username,
			name: users.name,
			role: users.role,
			expiresAt: sessions.expiresAt
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, sessionId))
		.get();

	if (!row || row.expiresAt < now) return null;
	return { id: row.id, email: row.email, username: row.username, name: row.name, role: row.role };
}

export function createSession(db: Db, userId: number): string {
	const id = randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
	db.insert(sessions).values({ id, userId, expiresAt }).run();
	return id;
}

export function deleteSession(db: Db, sessionId: string): void {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}
