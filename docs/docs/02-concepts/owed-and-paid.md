---
sidebar_position: 4
---

# Owed, part paid and paid

Some records are paid when they happen. Other records are owed until a payment comes later. This
page tells how Akaun knows which records are paid.

## Paid now, or owed until later

A record that moves money straight from a money account is paid when you save it. For example,
you pay 50.00 from **Bank** for software. The record shows **Paid** immediately.

A record that uses **Accounts Payable** or **Accounts Receivable** is owed. The money did not move
yet:

- **Accounts Payable**: the business owes money to a contact. For example, a supplier sends a bill
  of 300.00, and you pay it next month.
- **Accounts Receivable**: a contact owes money to the business. For example, you send an invoice
  of 500.00 to a customer.

Such a record must name a contact. Akaun then knows who owes the money, or to whom the business
owes it. See [Contacts and their balances](./contacts-and-balances.md).

## The statuses

Each record has one of these statuses. The page of a transfer shows no status.

| Status | What it shows |
|---|---|
| **Outstanding** | Nobody paid any of the amount yet. |
| **Part paid** | Payments cover some of the amount, but not all of it. The record page shows the amount that is still outstanding. |
| **Paid** | Payments cover the full amount, or the record did not use Accounts Payable or Accounts Receivable. |

The **Records** screen has a tab for each status: **All**, **Outstanding**, **Part paid** and
**Paid**.

## Akaun calculates the status

You cannot mark a record as paid. Akaun calculates the status from the payments against the
record. Thus the status on each screen is always the same.

A payment is a record of its own. It moves money out of a money account and puts it against one or
more records that are owed. The part of a payment that goes against one record is an allocation.
When you record a payment, the **Allocation** section shows each outstanding record and its
allocation.

For example, a supplier bill is 300.00. You pay 100.00. The bill shows **Part paid**, with 200.00
outstanding. Later you pay 200.00. The bill then shows **Paid**.

A payment cannot put more against a record than the amount that is outstanding on it.

## One payment for many records

One payment can settle many records. For example, a supplier sends three bills in one month. You
pay all three with one bank transfer.

One payment can also settle records of many contacts. Under **Who**, choose **Several at once**.
On the **Records** screen, **Pay all outstanding** opens a payment for all contacts that the
business owes money to.

On the page of a record, the rail shows **Payments applied**: each payment that settles the
record. On the page of a payment, the rail shows **Allocated to**: each record that the payment
settles.

## Take a payment back

If a payment is on the wrong record, take the allocation back. On the record page or the payment
page, click the undo icon (**Take this back**) beside the allocation. The record is then
**Outstanding** or **Part paid** again. To do this, you must have the permission to delete
records.

**Take this back** removes the allocation only. The payment record stays. Its money still moved
out of the money account.

## Paid and cleared are different

**Paid** tells that the money moved. **Cleared** tells that a bank statement line matches the
record. A record can be paid and not cleared. See
[Bank reconciliation](../07-bank-reconciliation.md).

## Related

- [Bills you pay later](../03-everyday-tasks/bills-you-pay-later.md)
- [Getting paid](../05-sales/getting-paid.md)
- [Invoices](../05-sales/invoices.md)
- [Edit, delete or undo a record](../03-everyday-tasks/edit-delete-undo.md)
- [Locked records](./locked-records.md)
- [Contacts and their balances](./contacts-and-balances.md)
