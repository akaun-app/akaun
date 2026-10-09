---
sidebar_position: 3
---

# How a record moves money

Each record moves an amount out of one account and into a different account. This page tells how
the record form shows this, and why it keeps each balance correct.

## Two lines: out of one account, into a different account

Each record has two lines. On the record form, the label of the first line is **out of**. The
label of the second line is **into**. You choose one account for each line. The amount of the record
goes out of the first account and into the second account.

For example, you buy printer paper for 50.00 with cash:

| Line | Account | Amount |
|---|---|---|
| **out of** | **Cash** | 50.00 out |
| **into** | An expense category, for example Office supplies | 50.00 in |

The balance of **Cash** goes down by 50.00. The total of the expense category goes up by 50.00.

Income works in the same way, but in the other direction. A customer pays you 200.00 into the
bank. The money came out of **Product Sales** and went into **Bank**. The income category is the
place that the money came from.

A transfer also has two lines. You move 100.00 from **Bank** to **Cash**. The money came out of
**Bank** and went into **Cash**.

## More than two lines

Sometimes one amount goes to more than one place. For example, one supplier bill of 80.00 is for
fuel and for paper. Click **+ Add a line** to add a line for each category. The form shows
**+ Add a line** only on an expense or an income, unless you have the **Adjustments** permission.

On an expense or an income, each extra line is a category of the same kind. You type the amount
of each category. Without the **Adjustments** permission, you can add only this type of line.
Akaun keeps one record with all the lines. It is still an **Expense** or an **Income**. See
[Split across categories](../03-everyday-tasks/split-across-categories.md).

## The two sides must be equal

The money out of the accounts must be equal to the money into the accounts. With two lines, this
is always true, because both lines use the amount of the record.

With more lines, the form shows the difference while you type. At the top of the **The entry**
section, a label shows **Balanced** when the two sides are equal. If they are not equal, it shows the
difference, for example **5.00 apart**. Then the save bar shows the reason, and Akaun does not
save the record.

## Why this keeps each balance correct

Each record adds the same amount to one side as it takes from the other side. Thus the money in
the book is always complete. Money cannot appear from nowhere, and it cannot disappear.

Akaun calculates the balance of each account from its records. You cannot type a balance. If you
change or delete a record, each balance that the record touches changes with it. Thus two screens
cannot show two different balances for one account.

## Records that need the Adjustments permission

Most records match an everyday kind: an expense, an income, a transfer, a payment or an opening
balance. Some records do not match one of these kinds. Examples:

- A record between two accounts that do not fit together as an everyday kind. For example, you
  receive a loan of 1,000.00 into the bank. The money came out of **Loans** and went into
  **Bank**.
- A record with extra lines that are not an everyday split. For example, the lines include two
  money accounts, or an expense category and an income category.

Akaun saves such a record as a **Journal entry**. To save a journal entry, you must have the
**Adjustments** permission.

:::info

A journal entry needs the **Adjustments** permission. No group that Akaun creates gives this
permission. A user with it can save a record between any two accounts. The record form then shows
all accounts on each line. See [Permissions explained](../09-administration/permissions-explained.md).

:::

:::info For accountants

Akaun is a double-entry system. The record form uses plain words in place of debit and credit:

- The **into** line is the debit side.
- The **out of** line is the credit side.

The lines of each record add up to zero. Akaun keeps each amount as a signed number: a debit is
positive and a credit is negative.

In the reports, Akaun shows each balance with its natural sign. Thus Liability, Equity and
Revenue balances show as positive numbers. On the **Accounts** screen and on each account page,
Akaun shows the stored sign. There, a credit balance shows with a minus sign.

:::

## Related

- [Record an expense or income](../03-everyday-tasks/record-expense-or-income.md)
- [Split across categories](../03-everyday-tasks/split-across-categories.md)
- [Move money between accounts](../03-everyday-tasks/move-money-between-accounts.md)
- [Edit, delete or undo a record](../03-everyday-tasks/edit-delete-undo.md)
- [Permissions explained](../09-administration/permissions-explained.md)
