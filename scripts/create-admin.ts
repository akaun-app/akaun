import 'dotenv/config';
import { hash } from 'argon2';
import { db } from '../src/lib/server/db/client.js';
import { users } from '../src/lib/server/db/schema.js';

const [username, password] = process.argv.slice(2);

if (!username || !password) {
	console.error('Usage: bun run scripts/create-admin.ts <username> <password>');
	process.exit(1);
}

const passwordHash = await hash(password);

db.insert(users).values({ email: `${username}@localhost`, username, passwordHash, role: 'owner' }).run();

console.log(`Admin user created: ${username}`);
