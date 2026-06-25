// Currency registry — a baked-in snapshot of Frankfurter's GET /v2/currencies list
// (api.frankfurter.dev), so the dropdowns offer exactly the currencies the rate API can
// convert. Regenerate from that endpoint if it changes. The main currency is a single
// global setting; foreign-currency records carry their own code and are always converted
// back to the main currency for display and statistics.
//
// Symbols are Frankfurter's verbatim, so several currencies share a bare "$"; that's fine
// because amounts render in a single main currency and foreign rows also print the ISO
// code (e.g. "Original: SGD $123"). Decimals are derived at runtime via Intl rather than
// stored.

export type CurrencyMeta = {
	code: string;
	name: string;
	symbol: string;
};

export const CURRENCIES: CurrencyMeta[] = [
	{ code: 'AED', name: 'United Arab Emirates Dirham', symbol: 'د.إ' },
	{ code: 'AFN', name: 'Afghan Afghani', symbol: '؋' },
	{ code: 'ALL', name: 'Albanian Lek', symbol: 'L' },
	{ code: 'AMD', name: 'Armenian Dram', symbol: '֏' },
	{ code: 'ANG', name: 'Netherlands Antillean Gulden', symbol: 'ƒ' },
	{ code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
	{ code: 'ARS', name: 'Argentine Peso', symbol: '$' },
	{ code: 'AUD', name: 'Australian Dollar', symbol: '$' },
	{ code: 'AWG', name: 'Aruban Florin', symbol: 'ƒ' },
	{ code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
	{ code: 'BAM', name: 'Bosnia and Herzegovina Convertible Mark', symbol: 'КМ' },
	{ code: 'BBD', name: 'Barbadian Dollar', symbol: '$' },
	{ code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
	{ code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب' },
	{ code: 'BIF', name: 'Burundian Franc', symbol: 'Fr' },
	{ code: 'BMD', name: 'Bermudian Dollar', symbol: '$' },
	{ code: 'BND', name: 'Brunei Dollar', symbol: '$' },
	{ code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.' },
	{ code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
	{ code: 'BSD', name: 'Bahamian Dollar', symbol: '$' },
	{ code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.' },
	{ code: 'BWP', name: 'Botswana Pula', symbol: 'P' },
	{ code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br' },
	{ code: 'BZD', name: 'Belize Dollar', symbol: '$' },
	{ code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
	{ code: 'CDF', name: 'Congolese Franc', symbol: 'Fr' },
	{ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
	{ code: 'CLP', name: 'Chilean Peso', symbol: '$' },
	{ code: 'CNH', name: 'Chinese Renminbi Yuan Offshore', symbol: '¥' },
	{ code: 'CNY', name: 'Chinese Renminbi Yuan', symbol: '¥' },
	{ code: 'COP', name: 'Colombian Peso', symbol: '$' },
	{ code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
	{ code: 'CUP', name: 'Cuban Peso', symbol: '$' },
	{ code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$' },
	{ code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
	{ code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj' },
	{ code: 'DKK', name: 'Danish Krone', symbol: 'kr.' },
	{ code: 'DOP', name: 'Dominican Peso', symbol: '$' },
	{ code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج' },
	{ code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م' },
	{ code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk' },
	{ code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
	{ code: 'EUR', name: 'Euro', symbol: '€' },
	{ code: 'FJD', name: 'Fijian Dollar', symbol: '$' },
	{ code: 'FKP', name: 'Falkland Pound', symbol: '£' },
	{ code: 'GBP', name: 'British Pound', symbol: '£' },
	{ code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
	{ code: 'GGP', name: 'Guernsey Pound', symbol: '£' },
	{ code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
	{ code: 'GIP', name: 'Gibraltar Pound', symbol: '£' },
	{ code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
	{ code: 'GNF', name: 'Guinean Franc', symbol: 'Fr' },
	{ code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
	{ code: 'GYD', name: 'Guyanese Dollar', symbol: '$' },
	{ code: 'HKD', name: 'Hong Kong Dollar', symbol: '$' },
	{ code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
	{ code: 'HTG', name: 'Haitian Gourde', symbol: 'G' },
	{ code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
	{ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
	{ code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
	{ code: 'IMP', name: 'Isle of Man Pound', symbol: '£' },
	{ code: 'INR', name: 'Indian Rupee', symbol: '₹' },
	{ code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د' },
	{ code: 'IRR', name: 'Iranian Rial', symbol: '﷼' },
	{ code: 'ISK', name: 'Icelandic Króna', symbol: 'kr.' },
	{ code: 'JEP', name: 'Jersey Pound', symbol: '£' },
	{ code: 'JMD', name: 'Jamaican Dollar', symbol: '$' },
	{ code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا' },
	{ code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
	{ code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
	{ code: 'KGS', name: 'Kyrgyzstani Som', symbol: 'som' },
	{ code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
	{ code: 'KMF', name: 'Comorian Franc', symbol: 'Fr' },
	{ code: 'KPW', name: 'North Korean Won', symbol: '₩' },
	{ code: 'KRW', name: 'South Korean Won', symbol: '₩' },
	{ code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
	{ code: 'KYD', name: 'Cayman Islands Dollar', symbol: '$' },
	{ code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
	{ code: 'LAK', name: 'Lao Kip', symbol: '₭' },
	{ code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل' },
	{ code: 'LKR', name: 'Sri Lankan Rupee', symbol: '₨' },
	{ code: 'LRD', name: 'Liberian Dollar', symbol: '$' },
	{ code: 'LSL', name: 'Lesotho Loti', symbol: 'L' },
	{ code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د' },
	{ code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.' },
	{ code: 'MDL', name: 'Moldovan Leu', symbol: 'L' },
	{ code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
	{ code: 'MKD', name: 'Macedonian Denar', symbol: 'ден' },
	{ code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
	{ code: 'MNT', name: 'Mongolian Tögrög', symbol: '₮' },
	{ code: 'MOP', name: 'Macanese Pataca', symbol: 'P' },
	{ code: 'MRO', name: 'Mauritanian Ouguiya', symbol: 'UM' },
	{ code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM' },
	{ code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
	{ code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'MVR' },
	{ code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK' },
	{ code: 'MXN', name: 'Mexican Peso', symbol: '$' },
	{ code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
	{ code: 'MZN', name: 'Mozambican Metical', symbol: 'MTn' },
	{ code: 'NAD', name: 'Namibian Dollar', symbol: '$' },
	{ code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
	{ code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$' },
	{ code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
	{ code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs.' },
	{ code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
	{ code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.' },
	{ code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.' },
	{ code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
	{ code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K' },
	{ code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
	{ code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
	{ code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
	{ code: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲' },
	{ code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق' },
	{ code: 'RON', name: 'Romanian Leu', symbol: 'Lei' },
	{ code: 'RSD', name: 'Serbian Dinar', symbol: 'RSD' },
	{ code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
	{ code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw' },
	{ code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
	{ code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$' },
	{ code: 'SCR', name: 'Seychellois Rupee', symbol: '₨' },
	{ code: 'SDG', name: 'Sudanese Pound', symbol: '£' },
	{ code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
	{ code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
	{ code: 'SHP', name: 'Saint Helenian Pound', symbol: '£' },
	{ code: 'SLE', name: 'New Leone', symbol: 'Le' },
	{ code: 'SOS', name: 'Somali Shilling', symbol: 'Sh' },
	{ code: 'SRD', name: 'Surinamese Dollar', symbol: '$' },
	{ code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
	{ code: 'STN', name: 'São Tomé and Príncipe Second Dobra', symbol: 'Db' },
	{ code: 'SVC', name: 'Salvadoran Colón', symbol: '₡' },
	{ code: 'SYP', name: 'Syrian Pound', symbol: '£S' },
	{ code: 'SZL', name: 'Swazi Lilangeni', symbol: 'E' },
	{ code: 'THB', name: 'Thai Baht', symbol: '฿' },
	{ code: 'TJS', name: 'Tajikistani Somoni', symbol: 'ЅМ' },
	{ code: 'TMT', name: 'Turkmenistani Manat', symbol: 'm' },
	{ code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت' },
	{ code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
	{ code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
	{ code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: '$' },
	{ code: 'TWD', name: 'New Taiwan Dollar', symbol: '$' },
	{ code: 'TZS', name: 'Tanzanian Shilling', symbol: 'Sh' },
	{ code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
	{ code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
	{ code: 'USD', name: 'United States Dollar', symbol: '$' },
	{ code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
	{ code: 'UZS', name: 'Uzbekistan Som', symbol: 'so\'m' },
	{ code: 'VES', name: 'Venezuelan Bolívar Soberano', symbol: 'Bs' },
	{ code: 'VND', name: 'Vietnamese Đồng', symbol: '₫' },
	{ code: 'VUV', name: 'Vanuatu Vatu', symbol: 'Vt' },
	{ code: 'WST', name: 'Samoan Tala', symbol: 'T' },
	{ code: 'XAF', name: 'Central African CFA Franc', symbol: 'CFA' },
	{ code: 'XAG', name: 'Silver (Troy Ounce)', symbol: 'oz t' },
	{ code: 'XAU', name: 'Gold (Troy Ounce)', symbol: 'oz t' },
	{ code: 'XCD', name: 'East Caribbean Dollar', symbol: '$' },
	{ code: 'XCG', name: 'Caribbean Guilder', symbol: 'Cg' },
	{ code: 'XDR', name: 'Special Drawing Rights', symbol: 'SDR' },
	{ code: 'XOF', name: 'West African CFA Franc', symbol: 'Fr' },
	{ code: 'XPD', name: 'Palladium', symbol: 'oz t' },
	{ code: 'XPF', name: 'CFP Franc', symbol: 'Fr' },
	{ code: 'XPT', name: 'Platinum', symbol: 'oz t' },
	{ code: 'YER', name: 'Yemeni Rial', symbol: '﷼' },
	{ code: 'ZAR', name: 'South African Rand', symbol: 'R' },
	{ code: 'ZMW', name: 'Zambian Kwacha', symbol: 'K' },
	{ code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'ZiG' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const DEFAULT_CURRENCY = 'USD';

export function currencyMeta(code: string | null | undefined): CurrencyMeta {
	const upper = (code ?? DEFAULT_CURRENCY).toUpperCase();
	return BY_CODE.get(upper) ?? { code: upper, name: upper, symbol: upper };
}

export function currencySymbol(code: string | null | undefined): string {
	return currencyMeta(code).symbol;
}

// Decimal places per currency, derived from Intl's currency data (JPY → 0, KWD → 3,
// USD → 2, …). Memoised; falls back to 2 for codes Intl doesn't recognise (e.g. metals
// like XAU/XAG).
const decimalsCache = new Map<string, number>();

export function currencyDecimals(code: string | null | undefined): number {
	const c = currencyMeta(code).code;
	const cached = decimalsCache.get(c);
	if (cached != null) return cached;
	let d = 2;
	try {
		d =
			new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).resolvedOptions()
				.maximumFractionDigits ?? 2;
	} catch {
		d = 2;
	}
	decimalsCache.set(c, d);
	return d;
}

// Memoised Intl.NumberFormat per currency code — building one is relatively expensive.
// A fixed 'en-US' locale keeps grouping deterministic across SSR/CSR; the symbol prefix
// (not the locale) carries currency identity.
const fmtCache = new Map<string, Intl.NumberFormat>();

function formatter(code: string): Intl.NumberFormat {
	const cached = fmtCache.get(code);
	if (cached) return cached;
	const decimals = currencyDecimals(code);
	const fmt = new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
	fmtCache.set(code, fmt);
	return fmt;
}

/** Format a number in the given currency, prefixed with its symbol, e.g. "$1,234.56". */
export function formatCurrency(n: number, code: string | null | undefined): string {
	const meta = currencyMeta(code);
	return `${meta.symbol} ${formatter(meta.code).format(n ?? 0)}`;
}

/** Format a number using the given currency's decimals, with no symbol prefix. */
export function formatCurrencyAmount(n: number, code: string | null | undefined): string {
	return formatter(currencyMeta(code).code).format(n ?? 0);
}
