import { EventEmitter } from 'events';

export const searchRebuildEvents = new EventEmitter();
// A handful of admins might have the settings page open across tabs; cap generously.
searchRebuildEvents.setMaxListeners(50);
