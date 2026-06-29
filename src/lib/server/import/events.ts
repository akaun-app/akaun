import { EventEmitter } from 'events';

export const importEvents = new EventEmitter();
// Each open SSE connection registers 2 listeners (`job-update` + `job-deleted`)
// and removes both on disconnect — cap at ~100 concurrent streams. See the
// matching note in $lib/server/finance/events.ts.
importEvents.setMaxListeners(200);
