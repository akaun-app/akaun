import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { DEFAULT_CURRENCY } from "$lib/currency.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function mainCurrencyCode(db: Db): string {
  return (
    getSetting(db, SETTING_KEYS.currencyCode) ?? DEFAULT_CURRENCY
  ).toUpperCase();
}

// `resolveRecordCurrency` used to live here. It read a currency and rate out of
// `FormData` and, for a foreign one with no rate given, fetched the rate for the
// record's date. Nothing calls it: the record drawer posts JSON to
// `/api/records`, and it resolves the rate the same way the screens always did —
// against `GET /api/exchange-rate`, for the record's own date, re-queried when
// the currency or the date changes. The server still refuses a rate that is not
// positive (the Zod schema on `/api/records`), which is the guarantee that
// mattered. Deleted rather than left as a second, unused way to do the same job.
