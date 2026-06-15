import { env } from '$env/dynamic/private';

export const DATABASE_PATH = env['DATABASE_PATH'] || './data/akaun.db';
export const STORAGE_PATH = env['STORAGE_PATH'] || './data/storage';

// Optional initial password for the auto-created `admin` account on first boot.
// If unset, a strong random password is generated and printed to the logs once.
export const ADMIN_PASSWORD = env['ADMIN_PASSWORD'] || '';
