import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * App-level encryption at rest for secrets stored in the database (currently:
 * `llmProviders.apiKey`). Keyed by `ENCRYPTION_KEY` (`env.ts`) rather than an OS
 * keychain, because the app ships headless (Docker) as well as desktop (Tauri),
 * and only an env-var-keyed cipher works identically in both.
 */

const ALGORITHM = "aes-256-gcm";

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [iv, encrypted, cipher.getAuthTag()]
    .map((buf) => buf.toString("base64"))
    .join(".");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [ivB64, encryptedB64, tagB64] = stored.split(".");
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * `encryptSecret` always produces three base64 segments joined by `.`; a
 * plaintext API key (or anything typed by a user) essentially never does. Lets
 * a row written before `ENCRYPTION_KEY` was set be told apart from one written
 * after, so both can be read back correctly during the transition.
 */
export function looksEncrypted(value: string): boolean {
  return /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(value);
}
