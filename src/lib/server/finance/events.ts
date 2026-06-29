import { EventEmitter } from 'events';

export const incomeEvents = new EventEmitter();
export const expenseEvents = new EventEmitter();
export const claimEvents = new EventEmitter();
export const contactEvents = new EventEmitter();
export const quotationEvents = new EventEmitter();
export const invoiceEvents = new EventEmitter();

// Each open SSE connection registers 2 listeners (an `*-update` + an `*-delete`
// handler) and removes both on disconnect (see the stream endpoints' `cancel()`).
// So the ceiling is connections × 2; this caps each domain at ~100 concurrent
// streams before Node's leak warning. Listeners are cleaned up reliably, so the
// limit only guards against a genuine leak, not normal load.
const MAX_LISTENERS = 200;
for (const emitter of [
	incomeEvents,
	expenseEvents,
	claimEvents,
	contactEvents,
	quotationEvents,
	invoiceEvents
]) {
	emitter.setMaxListeners(MAX_LISTENERS);
}
