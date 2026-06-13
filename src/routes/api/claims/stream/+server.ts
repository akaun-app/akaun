import { claimEvents } from '$lib/server/finance/events.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

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
					controller.enqueue(encodeEvent({ type: 'claim-update', item }));
				} catch {
					// stream closed
				}
			};

			const deleteHandler = ({ userId: uid, id }: { userId: number; id: number }) => {
				if (uid !== userId) return;
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
			Connection: 'keep-alive'
		}
	});
};
