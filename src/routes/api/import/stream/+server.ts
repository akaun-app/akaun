import { not, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { importEvents } from '$lib/server/import/events.js';
import { ImportState } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

const TERMINAL_STATES = [ImportState.Confirmed, ImportState.Skipped];

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'view')) return new Response('Forbidden', { status: 403 });

	const encoder = new TextEncoder();

	const encodeEvent = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
	const encodeComment = (text: string) => encoder.encode(`: ${text}\n\n`);

	let cleanup: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			// Shared ledger — snapshot every active job, not just the caller's.
			const currentJobs = db
				.select()
				.from(importQueue)
				.where(not(inArray(importQueue.state, TERMINAL_STATES)))
				.all();
			controller.enqueue(encodeEvent({ type: 'snapshot', jobs: currentJobs }));

			const updateHandler = ({ job }: { job: unknown }) => {
				try {
					controller.enqueue(encodeEvent({ type: 'job-update', job }));
				} catch {
					// stream already closed
				}
			};

			const deleteHandler = ({ jobId }: { jobId: string }) => {
				try {
					controller.enqueue(encodeEvent({ type: 'job-deleted', jobId }));
				} catch {
					// stream already closed
				}
			};

			importEvents.on('job-update', updateHandler);
			importEvents.on('job-deleted', deleteHandler);

			// Keep connection alive through proxies and dev server
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encodeComment('heartbeat'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 15000);

			cleanup = () => {
				clearInterval(heartbeat);
				importEvents.off('job-update', updateHandler);
				importEvents.off('job-deleted', deleteHandler);
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
