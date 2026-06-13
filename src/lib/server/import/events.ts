import { EventEmitter } from 'events';

export const importEvents = new EventEmitter();
importEvents.setMaxListeners(50);
