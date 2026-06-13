import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const initialLevel = (process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info')).trim();

const root = pino({
	level: initialLevel,
	...(isDev ? { transport: { target: 'pino-pretty' } } : {})
});

// Track every logger so setLogLevel can update them all at once
const allLoggers: pino.Logger[] = [root];

// Called from hooks.server.ts after $env/dynamic/private is available,
// bridging SvelteKit's .env loading (Vite dev) to pino's runtime level.
export function setLogLevel(level: string) {
	const trimmed = level.trim();
	for (const logger of allLoggers) {
		logger.level = trimmed;
	}
}

export function createLogger(namespace: string) {
	const child = root.child({ ns: namespace });
	allLoggers.push(child);
	return child;
}
