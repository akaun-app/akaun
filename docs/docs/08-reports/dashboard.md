---
sidebar_position: 1
---

# Dashboard

The **Dashboard** is a short summary of the business. It shows three figures and the newest records.
Use it for a fast check. For the full figures, open the reports.

:::info

You need the **View** permission on **Dashboard**. Without it, the **Dashboard** item does not show
in the sidebar, and Akaun opens **Settings** instead. Of the groups that Akaun creates, only
**Administrators** has this permission. See
[Permissions explained](../09-administration/permissions-explained.md).

:::

## Open the Dashboard

1. Click **Dashboard**.

The top of the screen shows **Welcome back** and your username.

## Choose the period

The buttons at the top right choose the period. There are four buttons:

- The month two months ago, for example **Aug**.
- Last month, for example **Sep**.
- This month, for example **Oct**.
- **This year**: from 1 January to today.

At the start, the **Dashboard** shows this month. On a phone, the buttons are in one list. Click
the period name to open the list.

The period changes **Net profit** and **Cash flow**. **Financial position** always shows today.

## The three figures

Click a figure to open its report with the same dates. The report then shows the same number.

### Net profit

**Net profit** is the revenue minus the expenses for the period. If the expenses are more than the
revenue, the figure shows the word **loss** after it, with no minus sign. The card then shows in
red.

It opens [Profit & Loss](./profit-and-loss.md).

### Financial position

**Financial position** shows the total of all assets today. Below it, Akaun shows the total
liabilities and the total equity. The assets are always equal to the liabilities plus the equity.

It opens [Balance Sheet](./balance-sheet.md).

### Cash flow

**Cash flow** is the change in your cash during the period. A positive number shows that the business
received more cash than it paid. Cash is the money in accounts with the sub-type **Cash**, **Bank**,
**Wallet** or **Prepaid/debit card**.

If some accounts have no sub-type, the card also shows an amount with **needs review**. Give each of
these accounts a sub-type. See [Accounts and categories](../02-concepts/accounts-and-categories.md).

It opens [Cash Flow Statement](./cash-flow.md).

## If the books do not balance

Sometimes **Financial position** shows **The books do not balance — check Reports**. This tells you
that a record in the book is not correct. The lines of each record must add to zero. This message
shows only when the data is damaged.

The **Books** tab shows only if you have the **View** permission on **Reports**.

1. Click **Settings**.
2. Click the **Books** tab.
3. In **Ledger integrity check**, click **Check now**.
4. Read the result.

The check only reads the book. It changes nothing. If a record is wrong, the result gives its
record number and the difference. Give this result to your administrator.

## Recent activity

**Recent activity** shows the seven newest expenses and income, by the date of the record. An income
shows a plus sign. An expense shows a minus sign. Each row shows the description, the contact and
the date.

Click **View all** to open the **Records** screen.

## Notes

- The **Dashboard** updates by itself when somebody saves a record.
- To open a report from a figure, you also need the **View** permission on **Reports**.
- **Recent activity** shows only expenses and income. It does not show transfers, payments,
  opening balances, invoices or journal entries.
- The **Dashboard** has no export. Use the reports to export the figures.

## Related

- [Profit & Loss](./profit-and-loss.md)
- [Balance Sheet](./balance-sheet.md)
- [Cash Flow Statement](./cash-flow.md)
- [Settings reference](../09-administration/settings-reference.md)
