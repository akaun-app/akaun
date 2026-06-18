const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for strings in strict `YYYY-MM-DD` form that are also real calendar dates. */
export function isValidDate(value: unknown): value is string {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	if (isNaN(d.getTime())) return false;
	// Reject overflow like 2024-02-31 (Date would roll it forward).
	return d.toISOString().slice(0, 10) === value;
}

/** Today in `YYYY-MM-DD` (UTC). */
export function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Return `value` if it is a valid `YYYY-MM-DD` date, otherwise `fallback` (defaults to today). */
export function normalizeDate(value: unknown, fallback: string = today()): string {
	return isValidDate(value) ? value : fallback;
}
