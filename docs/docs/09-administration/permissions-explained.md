---
sidebar_position: 2
---

# Permissions explained

A permission lets a user do one action in one area of Akaun. Read this page before you make a
group or give a user extra permissions. To change the permissions, see
[Users and groups](./users-and-groups.md).

## The four actions

- **View**: open the screen of the area and see its items. Without **View**, the screen does not
  open, and its item does not show in the sidebar.
- **Add**: make a new item.
- **Change**: change an item that exists.
- **Delete**: remove an item.

A superuser has all the actions in all the areas. The permission grid does not apply to a
superuser.

## The areas

The permission grid in **Users & Groups** shows these areas. The table tells what each action
lets a user do. "No effect" shows that Akaun does not use the action in that area.

| Area | **View** | **Add** | **Change** | **Delete** |
|---|---|---|---|---|
| **Dashboard** | Open the **Dashboard**. | No effect. | No effect. | No effect. |
| **Records** | Open the **Records** list, the record pages and the account statements. | Make a new record. Record a payment. | Change a record. | Delete a record. Click **Take this back** on a settlement. |
| **Auto Import** | Open **Auto Import** and see the import profiles. | Upload files. | Confirm, skip or edit the items. Add, change, enable, disable or delete an import profile. | Click **Discard** on a file. Click **Clear history**. |
| **Contacts** | Open **Contacts** and the contact pages. | Add a contact. | Change a contact and its roles. | Delete a contact. |
| **Reconciliation** | Open the reconciliation screen of an account. | Upload a statement. Make a transfer from a statement line. | Match statement lines to records. Edit a statement line. | Remove a statement or a statement line. |
| **Accounts** | Open **Accounts** and the account pages. | Add an account. | Change an account, deactivate it, or enter its starting balance. Choose the default accounts. | Delete an account. |
| **Reports** | Open **Reports**. See the **Books** tab in **Settings**. | No effect. | No effect. | No effect. |
| **Adjustments** | No effect. | Save a new record that is not an everyday record. | Change a record that is not an everyday record. | No effect. |

Some tasks need two permissions:

- To merge two contacts, a user needs **Change** and **Delete** on **Contacts**.
- To read a file again on **Auto Import**, a user needs **Add** and **Change** on **Auto Import**.

## Records

**Records** is one permission for all kinds of record. It covers expenses, income, transfers,
payments, opening balances and journal entries. A user cannot have permission for expenses only.

## Reports

**Reports** is view only. A report shows figures and never changes them. Thus **Add**, **Change**
and **Delete** have no effect on **Reports**. The grid shows a note about this under the rows.

## Adjustments

**Adjustments** lets a user save a record between any two accounts. Akaun decides from the
accounts if a record needs this permission. These records are everyday records, and they do not
need **Adjustments**:

- An expense: money out of a money account into an expense category.
- A bill to pay later: money out of **Accounts Payable** into an expense category.
- An income: money out of an income category into a money account.
- A transfer: money from one money account to a different money account.
- A payment: money from a money account to **Accounts Payable**, or from **Accounts Receivable**
  into a money account.
- An opening balance.
- A split: one account that holds or owes money, and two or more categories of the same kind.

All other records need **Adjustments**. Examples are a correction between two categories, a record
with two money accounts and a category, and a record with partner capital. On the record form,
**Adjustments** also gives the user a choice of all accounts.

:::caution

No group that Akaun makes gives **Adjustments**. A user with this permission can make the books
show any figures, and the books still add up. Give it only to a person that you trust with the
books. Give it on purpose, to one user, as an extra permission.

:::

See [How a record moves money](../02-concepts/how-an-entry-works.md).

## Quotations and invoices

The permission grid has no rows for Quotations and Invoices. Akaun still checks these two
permissions. The four groups that Akaun makes have them, as the table in
[Users and groups](./users-and-groups.md#the-groups-that-akaun-makes) shows.

You cannot change these two permissions on the screen. A new group that you make has no
permission on Quotations or Invoices. Its members cannot open these two screens. Only a
superuser can then work with quotations and invoices.

## Settings

:::info

**Settings** has no permission. All users who can sign in can open **Settings**. All users can
change the company details, the templates, the AI providers and the number format. Two parts have
a check:

- The **Books** tab shows only for a user with **View** on **Reports**.
- To choose a default account, a user needs **Change** on **Accounts**.

On the **Groups** tab, the text for a superuser group says that settings are for superusers only.
This is not correct at this time. Give access to Akaun only to people that you trust with these settings.

:::

See [Settings reference](./settings-reference.md).

## Notes and limits

- A change to the permissions applies on the next action of the user.
- A user who is in no group has no permissions, and extra permissions have no effect. At the next
  start of the server, Akaun puts that user into **Administrators**. See
  [Stop the access of a user](./users-and-groups.md#stop-the-access-of-a-user).
- An AI assistant that connects as a user can read only the areas that the user can view. See
  [Connect AI assistants](./connect-ai-assistants.md).
