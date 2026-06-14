import { incomeEvents } from '$lib/server/finance/events.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'income', 'view')) return new Response('Forbidden', { status: 403 });

	const userId = locals.user.id;
	const encoder = new TextEncoder();
	const encodeEvent = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
	const encodeComment = (text: string) => encoder.encode(`: ${text}\n\n`);

	let cleanup: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const updateHandler = ({ userId: uid, item }: { userId: number; item: unknown }) => {
				if (uid !== userId) return;
				try {
					controller.enqueue(encodeEvent({ type: 'income-update', item }));
				} catch {
					// stream closed
				}
			};

			const deleteHandler = ({ userId: uid, id }: { userId: number; id: number }) => {
				if (uid !== userId) return;
				try {
					controller.enqueue(encodeEvent({ type: 'income-delete', id }));
				} catch {
					// stream closed
				}
			};

			incomeEvents.on('income-update', updateHandler);
			incomeEvents.on('income-delete', deleteHandler);

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encodeComment('heartbeat'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 15000);

			cleanup = () => {
				clearInterval(heartbeat);
				incomeEvents.off('income-update', updateHandler);
				incomeEvents.off('income-delete', deleteHandler);
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
