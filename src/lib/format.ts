const numFmt = new Intl.NumberFormat('en-MY', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

export function formatMoney(n: number): string {
	return numFmt.format(n);
}

export function formatMoneyRM(n: number): string {
	return 'RM ' + numFmt.format(n);
}

export function formatDateShort(iso: string): string {
	if (!iso) return '';
	const [, m, d] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
}

export function formatDate(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

export function monthLabel(iso: string): string {
	const [y, m] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${months[parseInt(m) - 1]} ${y}`;
}
