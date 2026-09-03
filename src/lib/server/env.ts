import { env } from '$env/dynamic/private';

export const DATABASE_PATH = env['DATABASE_PATH'] || './data/akaun.db';
export const STORAGE_PATH = env['STORAGE_PATH'] || './data/storage';

/**
 * Encrypts `llmProviders.apiKey` at rest (`crypto/secret-box.ts`) when set.
 * Optional rather than required, so an existing deployment that upgrades
 * without adding it keeps starting — its provider keys just stay in plaintext,
 * exactly as they are today, until this is set. 32 raw bytes, base64-encoded.
 */
export const ENCRYPTION_KEY = env['ENCRYPTION_KEY']
	? Buffer.from(env['ENCRYPTION_KEY'], 'base64')
	: null;

/**
 * Where tesseract.js caches its downloaded `*.traineddata` language files.
 * Without an explicit path it writes them into the process CWD, which is the
 * repo root in dev (they were once committed by accident) and the app payload
 * dir for the Docker/Tauri sidecar. Keeping them under the storage dir puts
 * them on the same writable volume as everything else the app downloads.
 */
export const OCR_CACHE_PATH = `${STORAGE_PATH}/ocr-cache`;
