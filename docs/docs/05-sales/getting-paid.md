---
sidebar_position: 3
---

# Getting paid

When you send an invoice, the customer owes the amount. This page tells what **Paid** means for an
invoice, and where you see the amount that customers still owe.

At this time, the screen cannot record a payment from a customer. The invoice page has no button
for it, and the **Records** screen has no link for it.

Read [Owed, part paid and paid](../02-concepts/owed-and-paid.md) first. It tells what
**Outstanding**, **Part paid** and **Paid** mean.

## What Paid means for an invoice

A sent invoice puts its amount on **Accounts Receivable**, with the customer as the contact. A
payment from the customer settles this amount, in full or in part.

Akaun calculates the status from the payments. You cannot mark an invoice as paid.

| Status on the Invoices list | What it shows |
|---|---|
| **Sent** | No payment covers the invoice yet. |
| **Part paid** | Payments cover some of the amount, but not all of it. |
| **Paid** | Payments cover the full amount. |
| **Overdue** | The due date is in the past and payments do not cover the full amount. |

## See what customers owe you

You can see the amount that is still owed in these places.

### The invoice page

After you send the invoice, the **Settled** card in the rail shows **Paid so far** and
**Outstanding**. If a payment settles part or all of the invoice, the **Payments** card shows it.

### The Invoices screen

The **Sent** tab shows the sent invoices that are not fully paid. The **Sent** card shows the
amount that is still owed on them. The **Overdue** card shows the amount that is overdue.

### The Contacts screen

The **Balance** column shows **owed to you** beside each contact that owes you money. Under the
title, **owed to you** shows the total. You see these amounts only if you have the **View**
permission on records.

### The contact page

The amount at the top shows **still owed to you**. This amount also needs the **View**
permission on records.

### The Records screen

The **Outstanding** tab and the **Part paid** tab show each **Invoice** record that is not fully
paid.

See [Contacts and their balances](../02-concepts/contacts-and-balances.md) and
[Find records](../03-everyday-tasks/find-records.md).

## Do not record the payment as an income

:::caution

Do not save a new income for money that pays an invoice. The invoice already counts the sale. A
second income counts the sale two times, and the invoice stays outstanding.

:::

## Notes and limits

- The **Outstanding payables** panel on the **Records** screen shows only what the business owes.
  It does not show what customers owe.
- **Take this back** removes a payment from a record. See
  [Edit, delete or undo a record](../03-everyday-tasks/edit-delete-undo.md).
- A paid invoice prints with **Amount paid** and the date of the last payment. See
  [Invoices](./invoices.md#print-an-invoice).

## Related

- [Invoices](./invoices.md)
- [Owed, part paid and paid](../02-concepts/owed-and-paid.md)
- [Contacts and their balances](../02-concepts/contacts-and-balances.md)
- [Bills you pay later](../03-everyday-tasks/bills-you-pay-later.md)
