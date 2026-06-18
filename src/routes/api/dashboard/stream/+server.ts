import type { RequestHandler } from './$types.js';
import { incomeEvents, expenseEvents, claimEvents } from '$lib/server/finance/events.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'dashboard', 'view')) return new Response('Forbidden', { status: 403 });

	const userId = locals.user.id;
	const encoder = new TextEncoder();
	const signal = encoder.encode('data: {"type":"data-changed"}\n\n');
	const encodeComment = (text: string) => encoder.encode(`: ${text}\n\n`);

	let cleanup: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const send = ({ userId: uid }: { userId: number }) => {
				if (uid !== userId) return;
				try {
					controller.enqueue(signal);
				} catch {
					// stream closed
				}
			};

			incomeEvents.on('income-update', send);
			incomeEvents.on('income-delete', send);
			expenseEvents.on('expense-update', send);
			expenseEvents.on('expense-delete', send);
			claimEvents.on('claim-update', send);
			claimEvents.on('claim-delete', send);

			// 30-second heartbeat (dashboard is a summary view; less frequent than item pages)
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encodeComment('heartbeat'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 30_000);

			cleanup = () => {
				clearInterval(heartbeat);
				incomeEvents.off('income-update', send);
				incomeEvents.off('income-delete', send);
				expenseEvents.off('expense-update', send);
				expenseEvents.off('expense-delete', send);
				claimEvents.off('claim-update', send);
				claimEvents.off('claim-delete', send);
			};
		},
		cancel() {
			cleanup?.();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
