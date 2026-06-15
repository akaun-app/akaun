// Lightweight in-memory rate limiter. The app runs as a single-instance adapter-node
// process, so an in-memory store is sufficient (state resets on restart, which is fine
// for brute-force protection).

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { limited: boolean; retryAfterSeconds: number };

/**
 * Record an attempt for `key` and report whether it is now rate limited.
 * Uses a fixed window of `windowMs`; once `max` attempts are reached within the
 * window, further attempts are blocked until the window resets.
 */
export function hit(key: string, max: number, windowMs: number): RateLimitResult {
	const now = Date.now();
	const existing = buckets.get(key);

	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { limited: false, retryAfterSeconds: 0 };
	}

	existing.count += 1;
	if (existing.count > max) {
		return { limited: true, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
	}
	return { limited: false, retryAfterSeconds: 0 };
}

/** Clear the counter for `key` (call on a successful auth). */
export function reset(key: string): void {
	buckets.delete(key);
}
