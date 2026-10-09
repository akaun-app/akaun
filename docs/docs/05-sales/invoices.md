---
sidebar_position: 2
---

# Invoices

An invoice asks a customer to pay. You write the invoice as a draft, and then you send it. When you
send it, the customer owes the amount and Akaun adds a record to the books.

:::info

To make an invoice, you need the **Add** permission on invoices. To send or change one, you need
**Change**. To delete one, you need **Delete**.

:::

## The Invoices list

Open **Invoices** to see all invoices. Each row shows the customer, the invoice number, the
status, the date, the due date and the amount.

The tabs above the list filter it:

- **All**: all invoices.
- **Draft**: invoices that you did not send yet.
- **Sent**: sent invoices that are not fully paid.
- **Paid**: sent invoices that payments cover in full.
- **Cancelled**: invoices that do not count.
- **Overdue**: invoices with a due date in the past that are not fully paid. This tab also shows
  a draft with a due date in the past.

Each tab shows the number of invoices in it.

The **Status** column shows **Draft**, **Sent**, **Part paid**, **Paid**, **Overdue** or
**Cancelled**. Akaun calculates **Part paid**, **Paid** and **Overdue** from the payments and the
due date.

Above the list, four cards show totals in the main currency:

- **Sent**: the amount that is still owed on the invoices that wait for payment.
- **Overdue**: the amount that is still outstanding on overdue invoices.
- **Paid**: the amount paid on the paid invoices.
- **All recorded**: the total of all invoices, including drafts.

To find an invoice, use these controls:

- **Date**: choose a **From date** and a **To date**. The list shows invoices with an issue date
  in that range.
- The search box (**Search IV#, customer, ref…**): type a word. Akaun finds it in the invoice
  number, the customer name, the reference, the notes, the terms and the line items.
- **Clear**: removes the filters and the search, and shows the **All** tab again. It shows only
  when a filter is on.

**Filtered total** shows the total of the rows on the list.

## Make an invoice

1. On the **Invoices** screen, click **New invoice**.

   The **New invoice** page opens. **Issue date** shows today.

2. Optional: in **Due date**, choose the last day for payment.
3. In **Customer**, type a part of the name of the customer.
4. Choose the customer from the list.

   The list shows only contacts with the role **Customer**. If the customer is not in the list,
   click **Create "Acme Sdn Bhd"** (with the name that you typed). When you save the invoice,
   Akaun adds a new contact. The new contact is a **Business** with the role **Customer**.

5. If the invoice is in a foreign currency, choose the currency in **Currency**.

   A rate field shows, for example **Rate (1 USD = ? MYR)**. Akaun tries to find the rate for the
   issue date. If it finds no rate, type the rate.

6. Optional: in **Reference**, type a reference, for example the order number of the customer.
7. In **Line items**, in **Description**, type what you sell.
8. In **Qty**, type the quantity.
9. In **Unit Price**, type the price of one unit.
10. To add a line, click **+ Add line**.
11. Optional: in **Notes**, type a note for the customer.
12. Optional: in **Terms & conditions**, type your terms.
13. In the bar at the bottom of the page, click **Create invoice**.

An invoice must have a customer and at least one line with a description. If one is missing, the
bar at the bottom tells you what to add. To remove a line, click the bin icon at the end of the
line. An invoice always keeps one line.

Akaun saves the invoice as a draft and opens its page. A draft does not change the books. The
customer owes nothing yet.

## Change a draft invoice

1. Open the invoice.
2. Click **Edit**.
3. Change the fields.
4. In the bar at the bottom of the page, click **Save**.

To cancel your changes, click **Discard**. A change of the issue date does not change the exchange
rate. If necessary, type a new rate.

## Send an invoice

**Send** shows only on a draft invoice. **Send** does not send an email. It records that the
customer owes the amount. Give the PDF to the customer yourself. See
[Print an invoice](#print-an-invoice).

:::caution

After you click **Send**, the customer owes the amount and it appears in the books. You cannot
delete a sent invoice. At this time, the screen cannot cancel an invoice either. Check the customer,
the date, the currency and each line before you send.

:::

1. Open the draft invoice.
2. Click **Send**.

   A dialog opens, for example **Send invoice IV20261009-001?**. It says: "From here on the
   customer owes this amount, and it appears in the books. A sent invoice can be cancelled but not
   deleted." At this time, the screen cannot cancel an invoice.

3. Click **Send**.

## Result

Akaun saves an **Invoice** record on the **Records** screen. The record has these values:

- The date is the issue date of the invoice.
- The description is "Invoice" and the invoice number. The reference is the invoice number.
- The amount goes into **Accounts Receivable**, with the customer as the contact.
- The other line is the revenue account that **Settings** › **Books** names for **Sales revenue**.

The invoice page then shows the **Settled** card in its rail:

- **Paid so far**: the total of the payments against the invoice.
- **Outstanding**: the amount that the customer still owes.

The balance of the customer on the **Contacts** screen increases by the amount. See
[Contacts and their balances](../02-concepts/contacts-and-balances.md).

Change the invoice, not its **Invoice** record. The page of the record refuses a change and a
delete. See [Locked records](../02-concepts/locked-records.md).

## Overdue invoices

An invoice is overdue when its due date is in the past and it is not fully paid. On the invoice
page, **OVERDUE** shows beside the **Due date**. On the list, the status of a sent invoice is
**Overdue**.

An invoice without a due date is never overdue. A paid invoice is not overdue. A draft with a due
date in the past also shows **OVERDUE** on its page, but its status stays **Draft**.

## Print an invoice

1. Open the invoice.
2. Click **Print**.

A PDF of the invoice opens in a new browser tab. Use the browser to print it or save it.

The PDF shows these items:

- Your logo, company name, address and registration number. These come from **Settings**, on the
  **Company** tab.
- The customer under **Bill to**, with the address, registration number and phone of the contact.
- The issue date, the due date and the reference. If the invoice is overdue, the due date shows
  "overdue".
- The amount that is due, or the date of payment if the invoice is paid.
- The line items, **Subtotal**, **Total**, and **Amount due** or **Amount paid**.
- The notes and the terms and conditions.

The colour of the PDF comes from **Accent color** in **Settings**, on the **Templates** tab.

## Delete a draft invoice

You can delete an invoice only while it is a draft. On a sent invoice, **Delete** is disabled.

:::caution

You cannot undo a delete. Akaun removes the invoice permanently.

:::

1. Open the draft invoice.
2. Click **Delete**.
3. In the dialog, click **Delete**.

## The rail of an invoice

The rail on the right of the invoice page can show these cards:

- **Settled**: **Paid so far** and **Outstanding**. It shows after you send the invoice.
- **Payments**: each payment against the invoice. Click a payment to open its page.
- **Came from**: the quotation that the invoice was made from. It shows only when the invoice came
  from a quotation. At this time, the screen cannot make an invoice from a quotation.
- **History**: who made each change, and when.

## Notes and limits

- At this time, the screen cannot cancel an invoice.
- At this time, the screen cannot save a change to a sent invoice. **Edit** still shows, but Akaun
  refuses the save.
- At this time, the invoice page has no button to record a payment from the customer. See
  [Getting paid](./getting-paid.md).
- The page of the **Invoice** record looks editable, but Akaun refuses a change to it. Its
  **Delete** button also refuses.
- On the **Records** list, a delete of many selected records does not stop at an **Invoice**
  record. Do not select an **Invoice** record for a delete there.

## Related

- [Getting paid](./getting-paid.md)
- [Quotations](./quotations.md)
- [Owed, part paid and paid](../02-concepts/owed-and-paid.md)
- [Contacts and their balances](../02-concepts/contacts-and-balances.md)
- [Locked records](../02-concepts/locked-records.md)
