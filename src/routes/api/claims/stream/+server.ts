import { claimEvents } from '$lib/server/finance/events.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'claims', 'view')) return new Response('Forbidden', { status: 403 });

	const encoder = new TextEncoder();
	const encodeEvent = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
	const encodeComment = (text: string) => encoder.encode(`: ${text}\n\n`);

	let cleanup: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const updateHandler = ({ item }: { item: unknown }) => {
				try {
					controller.enqueue(encodeEvent({ type: 'claim-update', item }));
				} catch {
					// stream closed
				}
			};

			const deleteHandler = ({ id }: { id: number }) => {
				try {
					controller.enqueue(encodeEvent({ type: 'claim-delete', id }));
				} catch {
					// stream closed
				}
			};

			claimEvents.on('claim-update', updateHandler);
			claimEvents.on('claim-delete', deleteHandler);

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encodeComment('heartbeat'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 15000);

			cleanup = () => {
				clearInterval(heartbeat);
				claimEvents.off('claim-update', updateHandler);
				claimEvents.off('claim-delete', deleteHandler);
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
			'X-Accel-Buffering': 'no'
		}
	});
};
