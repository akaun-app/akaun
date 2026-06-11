function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
}

export const DATABASE_PATH = requireEnv('DATABASE_PATH');
export const STORAGE_PATH = requireEnv('STORAGE_PATH');
export const API_BEARER_TOKEN = requireEnv('API_BEARER_TOKEN');
