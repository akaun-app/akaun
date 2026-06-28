import { EventEmitter } from 'events';

export const incomeEvents = new EventEmitter();
export const expenseEvents = new EventEmitter();
export const claimEvents = new EventEmitter();
export const contactEvents = new EventEmitter();

incomeEvents.setMaxListeners(50);
expenseEvents.setMaxListeners(50);
claimEvents.setMaxListeners(50);
contactEvents.setMaxListeners(50);

export const quotationEvents = new EventEmitter();
export const invoiceEvents = new EventEmitter();
quotationEvents.setMaxListeners(50);
invoiceEvents.setMaxListeners(50);
