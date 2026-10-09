---
sidebar_position: 5
---

# Locked records

Some changes to a record can make a different record wrong. Akaun locks a record to prevent this.
This page tells when a record is locked, what you can still change, and how to unlock it.

## When a record is locked

A record is locked in these two cases:

- A payment settles some or all of the record. The payment record is also locked.
- A bank statement line matches the record.

For example, a supplier bill is 300.00 and a payment of 300.00 settles it. If you change the bill
to 250.00, the payment is then wrong. Thus Akaun locks the amount of the bill.

## What you cannot change

On a locked record, you cannot change these fields:

- The amount.
- The date.
- The currency and the exchange rate.
- The accounts. On an expense or an income, only the money account is locked. The category is
  not locked.

You also cannot delete a locked record.

## What you can still change

On a locked record, you can still change these fields:

- The description.
- The contact.
- The reference.
- The remark.
- The attachments.
- On an expense or an income, the category, and the extra lines of a split.

A change to these fields cannot make a payment or a bank match wrong.

## How Akaun shows a locked record

- On the **Records** screen, a lock icon shows beside the description. Put the pointer on the icon
  to see the reason.
- On the record page, a note above the form gives the reason. The locked fields are read only.
- On the record page, **Delete** is not available. Put the pointer on it to see the reason.

The reason tells you what to undo. For example: "A payment has settled this record. Undo the
settlement before changing its amount, date or the account it moved through."

## How to unlock a record

Remove each thing that locks the record:

- If a payment settles the record, click the undo icon (**Take this back**) beside the payment. See
  [Owed, part paid and paid](./owed-and-paid.md).
- If a bank statement line matches the record, remove the match on the reconciliation screen of
  the account. See [Bank reconciliation](../07-bank-reconciliation.md).

When nothing settles or matches the record, it is unlocked. You can then change all of its fields.

## Records made by an invoice

When you send an invoice, Akaun makes an **Invoice** record. You cannot change or delete this
record on its record page. The record page tells you to change it on the invoice. After you send
an invoice, you cannot change its amounts on the invoice page either. See
[Invoices](../05-sales/invoices.md).

## Related

- [Edit, delete or undo a record](../03-everyday-tasks/edit-delete-undo.md)
- [Bills you pay later](../03-everyday-tasks/bills-you-pay-later.md)
- [Attach receipts](../03-everyday-tasks/attach-receipts.md)
- [Bank reconciliation](../07-bank-reconciliation.md)
- [Invoices](../05-sales/invoices.md)
