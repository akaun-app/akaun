---
sidebar_position: 7
---

# Foreign currency

Your book has one main currency. You can also record an expense or an income in a different
currency. This page tells how Akaun changes a foreign amount into the main currency.

## The main currency

The main currency is the currency of your book. All amounts and all reports show in it. You choose
it in **Settings**, on the **General** tab, in the **Currency** field.

Choose the main currency before you add data. When the book has one record, quotation or invoice,
Akaun locks the **Currency** field. A lock icon then shows beside it. A change of the main currency
would make all the old amounts wrong.

## A record in a foreign currency

On an expense or an income, click **+ Foreign currency**. A **Foreign currency** box opens with
these fields:

- **Currency**: the currency of the bill or the receipt.
- **Amount (USD)**: the amount in that currency, as the bill shows it. The label shows the
  currency that you chose.
- **Rate (1 USD = ? MYR)**: the number of units of the main currency for 1 unit of the foreign
  currency.

The form shows **+ Foreign currency** only when one of the two accounts is an expense category or
an income category. A transfer, a payment, an opening balance or a journal entry is always in the
main currency.

## The exchange rate

Akaun tries to find the exchange rate for the date of the record. It gets the rate from a free
public rate service on the internet, and it keeps a copy of each rate that it finds. If you change
the date, Akaun finds the rate again.

If Akaun cannot find a rate, the form shows a message. An example is "No rate found for that
date — enter it yourself." Then type the rate from your bank or your bill. You can also change a rate
that Akaun found. Without a rate, the save bar shows "Enter the exchange rate before saving." and
Akaun does not save the record.

Akaun keeps the rate with the record. Later changes in the rate do not change the record.

## The main-currency amount

Akaun calculates the amount in the main currency: the foreign amount multiplied by the rate. The
**Amount** field of the record shows this result, and you cannot change it there.

For example, the main currency is MYR. You pay a bill of 100.00 USD, and the rate is 4.50. The
record amount is 450.00 MYR.

The **Records** screen shows the main-currency amount. Under it, the screen shows the foreign
amount and its currency.

## Reports use the main currency

All reports and all balances add the main-currency amounts. They never add foreign amounts. Thus
a report total is always in one currency.

## Related

- [Record an expense or income](../03-everyday-tasks/record-expense-or-income.md)
- [Invoices](../05-sales/invoices.md)
- [Quotations](../05-sales/quotations.md)
- [Settings reference](../09-administration/settings-reference.md)
- [Prepare your book](../01-getting-started/set-up-your-book.md)
