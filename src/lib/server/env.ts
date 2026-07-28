import { env } from '$env/dynamic/private';

export const DATABASE_PATH = env['DATABASE_PATH'] || './data/akaun.db';
export const STORAGE_PATH = env['STORAGE_PATH'] || './data/storage';
