---
sidebar_position: 1
---

# Users and groups

Use the **Users & Groups** screen to add the people who work in your book. A group controls
what each person can do. Do these tasks after the first sign-in, and each time a person joins or
leaves.

:::info

Only a superuser can open **Users & Groups**. Akaun does not open the screen for other users. In
the sidebar, the screen is under **Administration**.

:::

## How access works

- A permission lets a user do one action in one area, for example **Add** on **Records**. See
  [Permissions explained](./permissions-explained.md).
- A group is a set of permissions. A user can be in more than one group.
- A user gets each permission that one or more of their groups gives. A group cannot remove a
  permission that a different group gives.
- A group with the **Superuser** switch on gives all permissions in all areas. Its members are
  superusers.
- You can give one user extra permissions. Extra permissions only add. They cannot remove a
  permission that a group gives.

## The groups that Akaun makes

Akaun makes four groups. At each start of the server, Akaun makes each of these groups again if
it is missing. **Administrators** is a superuser group. Its members can do all actions in all
areas, and they can open **Users & Groups**.

The other three groups give these permissions:

| Area | **Bookkeeper** | **Data Entry** | **Reviewer** |
|---|---|---|---|
| **Dashboard** | none | none | none |
| **Records** | View, Add, Change | Add | View |
| **Auto Import** | View, Add | Add | View |
| **Contacts** | View, Add, Change | View, Add | View |
| Quotations | View, Add, Change | Add | View |
| Invoices | View, Add, Change | Add | View |
| **Reconciliation** | View, Add, Change | none | View |
| **Accounts** | View, Add, Change | none | View |
| **Reports** | View | none | View |
| **Adjustments** | none | none | none |

Read these notes before you choose a group:

- No group except **Administrators** gives **Delete** or **Adjustments**.
- **Bookkeeper** does not have **Change** on **Auto Import**. Thus a Bookkeeper can upload files,
  but cannot confirm or skip the items. To let a Bookkeeper confirm items, give **Change** on
  **Auto Import**.
- A screen opens only for a user with **View** on its area. **Data Entry** has **View** on
  **Contacts** only. Thus a Data Entry user cannot open **Records**, **Auto Import**,
  **Quotations** or **Invoices**.
- No group except **Administrators** has **View** on **Dashboard**.
- Quotations and Invoices have no row in the permission grid. You cannot change these two areas
  for a group. See [Permissions explained](./permissions-explained.md).
- The description of **Administrators** mentions backups and reset. Akaun has no backup or reset
  in the screens. See [Backups and upgrades](./backups-and-upgrades.md).

## The Users tab

The **Users** tab shows one row for each user, with these columns:

- **User**: the name and the email.
- **Groups**: the groups of the user. **No groups** shows that the user is in no group.
- **Access**: **Superuser**, **Standard** or **No access**.
- **API token**: **Configured** if the user has an API token, or **None**.
- **Created**: the date when the user was added.

## Add a user

**Email**, **Username** and **Temporary password** are necessary. Each user must have a different
email and a different username.

:::caution

Select one or more groups for each user. At each start of the server, Akaun puts each user with no
group into **Administrators**. That user then becomes a superuser.

:::

1. In the sidebar, click **Users & Groups**.
2. On the **Users** tab, click **Add user**.
3. In **Full name**, type the name of the person.
4. In **Email**, type the email address.
5. In **Username**, type the name that the person types to sign in.
6. In **Temporary password**, type a password for the first sign-in.
7. Under **Group membership**, select one or more groups.
8. If the person needs more permissions than the groups give, select them under **Permissions**.
9. Click **Create user**.

Akaun shows **User created**, and the user shows in the list. Give the username and the
temporary password to the person. Tell the person to change the password on the **Security** tab
of the profile. See [Your profile](./your-profile.md).

## Change a user

:::caution

Do not change the username of the `admin` user. At each start, Akaun looks for a user with the
username `admin`. If it finds none, it adds a new `admin` user with the password `akaun-admin`.
This new user is a superuser, and anyone who knows the default password can sign in.

:::

1. On the **Users** tab, click the row of the user.
2. If necessary, change **Full name**, **Email** or **Username**.
3. If the user needs a new password, type it in **Reset password**.
4. Under **Group membership**, select or clear the groups. Keep one or more groups selected.
5. Click **Save changes**.

Akaun shows **User saved**. If **Reset password** is empty, the password does not change. A new
password also disconnects all the connected apps of the user.

## Give a user extra permissions

Use extra permissions when one person needs one more action than their groups give.

1. On the **Users** tab, click the row of the user.
2. Under **Permissions**, find the row of the area.
3. Select the action that the user needs.
4. Click **Save changes**.

A permission that a group gives shows selected, and you cannot clear it there. To remove that
permission, change the groups of the user.

Extra permissions work only when the user is in one or more groups. The **Permissions** section
does not show for a superuser, because a superuser has all permissions.

## Issue an API token for a user

An API token lets a program connect to Akaun as this user. The program can do all the actions
that the user can do. See [Connect AI assistants](./connect-ai-assistants.md).

:::caution

Issue the token from the panel of the user, as the steps below tell you. The row menu (three
dots) also has **Issue API token**, but it does not show the new token. If you use it, open the
panel of the user and click **Regenerate** to get a token that you can copy.

:::

1. On the **Users** tab, click the row of the user.
2. Under **API Token**, click **Issue token**.
3. Under **New token — copy now**, click the copy button next to the token.
4. Keep the token in a safe place, for example a password manager.

The **API token** column shows **Configured**. Akaun shows the full token one time only.

The **Issue token**, **Regenerate** and **Revoke** buttons act immediately. You do not need
**Save changes** for them.

### Replace or remove a token

:::caution

**Regenerate** makes a new token and stops the old token immediately. A program that uses the old
token cannot connect until you give it the new token.

:::

- To replace the token, click **Regenerate**. Then copy the new token.
- To remove the token, click **Revoke**. Akaun shows **Token revoked**.

## Stop the access of a user

:::caution

Do not leave a user in no group. The panel says that such a user sees an empty app. This is true
only until the next start of the server. At each start, Akaun puts each user with no group into
**Administrators**. That user then becomes a superuser.

:::

To stop the access of a user safely, put the user in a group with no permissions:

1. On the **Groups** tab, make a new group with no permissions, for example `No access`. See
   [Make a group](#make-a-group).
2. On the **Users** tab, click the row of the user.
3. Under **Group membership**, clear all the groups.
4. Select the `No access` group.
5. Under **Permissions**, clear each extra permission.
6. In **Reset password**, type a new password that the person does not know.
7. If the **API Token** section shows **API token configured**, click **Revoke**.
8. Click **Save changes**.

The **Access** column shows **Standard**. The user cannot sign in with the old password. If the user
is still signed in, the user can open only **Settings** and the profile. The records of the user
stay in the book.

## Remove a user

:::caution

You cannot undo the removal of a user. Do not remove the `admin` user: at the next start, Akaun
adds a new `admin` user with the password `akaun-admin`. If the user made records or other items,
Akaun can refuse the removal and show **Failed to delete user**. Then use
[Stop the access of a user](#stop-the-access-of-a-user) instead.

:::

1. On the **Users** tab, click the row of the user.
2. Click **Remove**.
3. In the message of the browser, click **OK**.

Akaun shows **User removed**, and the row goes from the list. You cannot remove yourself. If you
try, Akaun shows **Cannot delete your own account**.

## The Groups tab

The **Groups** tab shows the list of groups on the left. Each item shows the number of members and
the number of permissions. Click a group to see its details on the right.

### Make a group

1. On the **Groups** tab, click **New group**. Akaun adds a group with the name **New group** and
   opens it.
2. At the top of the group, type a name for the group.
3. In the description box, type what the group is for.
4. In the permission grid, select the actions that the group gives.
5. Click **Save changes**.

Akaun shows **Group saved**. **Save changes** and **Reset** show only when the group has unsaved
changes. **Reset** removes your changes.

### The permission grid

The grid has one row for each area and one column for each action: **View**, **Add**, **Change**
and **Delete**. Select **All** to select the four actions of a row. The line above the grid shows
the number of permissions that the group gives, for example **15 of 32 granted**.

**Reports** is view only. **Add**, **Change** and **Delete** have no effect on **Reports**.

### The Superuser switch

:::caution

When you set **Superuser** to on, each member of the group becomes a superuser. A superuser can do
all actions in all areas. A superuser can also add users, remove users and make other users
superusers. Use it only for people that you trust with all the books.

:::

1. Click the group.
2. Click the **Superuser** switch.
3. Click **Save changes**.

The group shows **Superuser** and **Grid bypassed**. The permission grid does not show.

### Protected groups

**Administrators** shows **Protected**. You cannot change its name, its description or its
**Superuser** switch. You cannot delete it.

:::caution

Keep two or more trusted users in **Administrators**. If the only superuser forgets the password,
no screen in Akaun can give a new password to that user.

:::

### Delete a group

You can delete a group only when it has no members and is not protected.

1. Click the group.
2. Click the menu button (three dots) next to the name.
3. Click **Delete group**.
4. In the message of the browser, click **OK**.

Akaun shows **Group deleted**.

If you delete or rename **Bookkeeper**, **Data Entry** or **Reviewer**, Akaun makes a new group with
that name at the next start of the server.

## Notes and limits

- A change to the permissions applies on the next action of the user. The user does not need to
  sign in again.
- A sign-in stays valid in the browser for up to 30 days. A new password does not end a sign-in
  that is already open. To stop the access immediately, use a group with no permissions.
