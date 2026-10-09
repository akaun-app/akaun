---
sidebar_position: 1
---

# Quotations

A quotation offers a price to a customer before you do the work. A quotation does not change the
books. Use it when a customer asks for a price in writing.

:::info

To make a quotation, you need the **Add** permission on quotations. To change one, you need
**Change**. To delete one, you need **Delete**.

:::

## The Quotations list

Open **Quotations** to see all quotations. Each row shows the customer, the quotation number, the
status, the date, the expiry date and the amount.

The tabs above the list filter it by status:

- **All**
- **Draft**
- **Sent**
- **Accepted**
- **Declined**
- **Converted**
- **Expired**

Each tab shows the number of quotations in it.

To find a quotation, use these controls:

- **Date**: choose a **From date** and a **To date**. The list shows quotations with an issue date
  in that range.
- The search box (**Search QT#, customer, ref…**): type a part of the quotation number, the
  customer name or the reference.
- **Clear**: removes the date filter and the search, and shows the **All** tab again. It shows only
  when a filter is on.

Above the list, four cards show totals in the main currency: **Sent**, **Accepted**,
**This month** and **All recorded**. Below the filters, **Filtered total** shows the total of the
rows on the list.

## Make a quotation

1. On the **Quotations** screen, click **New quotation**.

   The **New quotation** page opens. **Issue date** shows today.

2. Optional: in **Expiry date**, choose the last day that the price is valid.
3. In **Customer**, type a part of the name of the customer.
4. Choose the customer from the list.

   The list shows only contacts with the role **Customer**. If the customer is not in the list,
   click **Create "Acme Sdn Bhd"** (with the name that you typed). When you save the quotation,
   Akaun adds a new contact. The new contact is a **Business** with the role **Customer**.

5. If the price is in a foreign currency, choose the currency in **Currency**.

   A rate field shows, for example **Rate (1 USD = ? MYR)**. Akaun tries to find the rate for the
   issue date. If it finds no rate, type the rate.

6. Optional: in **Reference**, type a reference, for example the order number of the customer.
7. In **Line items**, in **Description**, type what you sell.
8. In **Qty**, type the quantity.
9. In **Unit Price**, type the price of one unit.

   **Total** shows the amount of the line. **Subtotal:** shows the total of all lines.

10. To add a line, click **+ Add line**.
11. Optional: in **Notes**, type a note for the customer.
12. Optional: in **Terms & conditions**, type your terms.
13. In the bar at the bottom of the page, click **Create quotation**.

A quotation must have a customer and at least one line with a description. If one is missing, the
bar at the bottom tells you what to add.

To remove a line, click the bin icon at the end of the line. A quotation always keeps one line.

## Result

Akaun saves the quotation and opens its page. Akaun gives the quotation a number, and its status is
**Draft**.

The page shows the **Line items** and the **Details**. **History** in the rail shows who made each
change, and when.

## Change a quotation

1. Open the quotation.
2. Click **Edit**.
3. Change the fields.
4. In the bar at the bottom of the page, click **Save**.

To cancel your changes, click **Discard**. A change of the issue date does not change the exchange
rate. If necessary, type a new rate.

## Print a quotation

1. Open the quotation.
2. Click **Print**.

A PDF of the quotation opens in a new browser tab. Use the browser to print it or save it.

The PDF shows these items:

- Your logo, company name, address and registration number. These come from **Settings**, on the
  **Company** tab.
- The customer under **Bill to**, with the address, registration number and phone of the contact.
- The issue date, **Valid until** (the expiry date) and the reference.
- The line items, **Subtotal** and **Total**.
- The notes and the terms and conditions.

The colour of the PDF comes from **Accent color** in **Settings**, on the **Templates** tab.

## Delete a quotation

On a converted quotation, **Delete** is disabled.

:::caution

You cannot undo a delete. Akaun removes the quotation permanently.

:::

1. Open the quotation.
2. Click **Delete**.
3. In the dialog, click **Delete**.

Akaun removes the quotation from the list.

## When a quotation expires

**Expired** shows that the expiry date is in the past. Only a quotation with the status **Draft**
or **Sent** can expire. Akaun calculates this from the date. You do not mark a quotation as expired.

An expired quotation also stays on the tab of its status. For example, an expired draft shows on
the **Draft** tab and on the **Expired** tab.

A quotation without an expiry date never expires.

## Notes and limits

- At this time, the screen cannot change the status of a quotation. A new quotation stays
  **Draft**, so the screen cannot make an invoice from it. Make the invoice on the **Invoices**
  screen. See [Invoices](./invoices.md).
- For this reason, the **Sent**, **Accepted**, **Declined** and **Converted** tabs show no
  quotations that you make on the screen. The **Sent** and **Accepted** cards do not count them.
- A quotation does not change any account or any contact balance.

## Related

- [Invoices](./invoices.md)
- [Contacts](../06-contacts.md)
- [Foreign currency](../02-concepts/foreign-currency.md)
- [Settings reference](../09-administration/settings-reference.md)
