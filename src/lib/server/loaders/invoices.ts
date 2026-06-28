import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listInvoices } from '$lib/server/queries/invoices.js';
import { removeInvoice, payInvoice } from '$lib/server/services/invoices.js';
import { InvoiceStatus } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export function loadInvoicesPage(locals: App.Locals, openInvoiceId: number | null) {
	if (!hasPermission(locals, 'invoices', 'view')) throw redirect(302, '/dashboard');
	const allInvoices = listInvoices(db, { limit: 1000 });

	const counts = { all: 0, draft: 0, sent: 0, paid: 0, cancelled: 0 };
	allInvoices.forEach((inv) => {
		counts.all++;
		if (inv.status === InvoiceStatus.Draft) counts.draft++;
		else if (inv.status === InvoiceStatus.Sent) counts.sent++;
		else if (inv.status === InvoiceStatus.Paid) counts.paid++;
		else if (inv.status === InvoiceStatus.Cancelled) counts.cancelled++;
	});

	if (openInvoiceId !== null && !allInvoices.some((inv) => inv.id === openInvoiceId)) {
		throw redirect(302, '/invoices');
	}

	return { invoices: allInvoices, counts, openInvoiceId };
}

export const invoicesActions: Actions = {
	pay: async ({ locals, request }) => {
		if (!hasPermission(locals, 'invoices', 'change')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid invoice' });
		const result = payInvoice(db, id, locals.user!.id);
		if (!result.ok) {
			if (result.reason === 'already_paid') return fail(409, { error: 'Invoice is already paid.' });
			return fail(404, { error: 'Invoice not found' });
		}
		return { success: true };
	},
	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'invoices', 'delete')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid invoice' });
		const result = removeInvoice(db, id);
		if (!result.ok) {
			if (result.reason === 'paid') return fail(409, { error: 'Paid invoices cannot be deleted.' });
			return fail(404, { error: 'Invoice not found' });
		}
		return { success: true };
	}
};
