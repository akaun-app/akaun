---
sidebar_position: 4
---

# Your profile

Your profile holds the settings that apply only to you. Examples are your name, your password and
the order of your screens. All users can open their own profile. No
permission is necessary.

## Open your profile

1. At the bottom of the sidebar, click the user menu button (three dots) next to your name.
2. Click **Profile**.

The **My Profile** screen opens. It has five tabs: **Profile**, **Security**, **API Token**,
**Connected apps** and **Navigation**.

## Profile

:::caution

If you are the `admin` user, do not change the username. At each start, Akaun adds a new superuser
with the username `admin` and the password `akaun-admin` when no user has the username `admin`.
See [Users and groups](./users-and-groups.md#change-a-user).

:::

1. Click the **Profile** tab.
2. Change **Display name**, **Email** or **Username**.
3. Click **Save changes**.

Akaun shows **Profile updated**.

**Email** and **Username** are necessary. Each user must have a different email and a different
username. If the step fails, Akaun shows one of these messages:

- **Email or username is already taken.**
- **Enter a valid email address.**

## Security

Use this tab to change your password.

1. Click the **Security** tab.
2. In **Current password**, type your password.
3. In **New password**, type a new password. Use 8 characters or more.
4. In **Confirm new password**, type the new password again.
5. Click **Change password**.

Akaun shows **Password changed**. Akaun also disconnects all your connected apps. The other
browsers where you are signed in stay signed in.

If the step fails, Akaun shows one of these messages:

- **Current password is incorrect.**
- **New password must be at least 8 characters.**
- **Passwords do not match.**

## API Token

An API token lets a program connect to Akaun as you. For example, an AI assistant can use it. See
[Connect AI assistants](./connect-ai-assistants.md).

:::caution

A program with your token can do all the actions that you can do, also changes and deletes. Give
the token only to a program that you trust. If you are a superuser, use a different user with
fewer permissions for the program.

:::

1. Click the **API Token** tab.
2. Click **Generate token**.
3. Under **Copy this token now — it will not be shown again.**, click **Copy**.
4. Keep the token in a safe place, for example a password manager.

Akaun shows **New API token generated — copy it now**. After you leave the page, Akaun shows only
the last four characters of the token, under **Active token**.

You have one token only.

- To replace it, click **Regenerate token**. The old token stops working immediately.
- To remove it, click **Revoke token**. Akaun shows **API token revoked**.

A superuser can also replace or revoke your token in **Users & Groups**. See
[Users and groups](./users-and-groups.md).

## Connected apps

The **Connected apps** tab shows each app that you let read your data, for example an AI
assistant. For each app, it shows:

- the name of the app,
- the permissions that you gave, for example `records:read`,
- the date of the connection and the date when it expires,
- **Last used**: the last time that the app read your data, or **Never**.

If no app is connected, the tab shows **No apps connected.**

To disconnect an app:

1. Click the **Connected apps** tab.
2. Find the app.
3. Click **Revoke access**.

Akaun shows **App access revoked**. The app cannot read your data any more. To use the app again,
connect it again.

A new password also disconnects all your apps. **Sign out** does not disconnect them.

## Navigation

Use this tab to change the order of the main screens in the sidebar. You can also choose the
screens on the bottom bar of a phone. The list shows only the screens that you have the **View**
permission for.

1. Click the **Navigation** tab.
2. Drag an item by its handle to change the order.
3. Select **Show on mobile** for each screen that you want on the bottom bar.
4. Click **Save changes**.

Akaun shows **Navigation order saved**.

You can select **Show on mobile** for five screens or fewer. After the fifth, the other boxes are
not available.

See [Choose your navigation](../01-getting-started/finding-your-way.md#choose-your-navigation).

## Notes and limits

- The **Connected apps** tab is empty when the administrator did not enable OAuth. See
  [Connect AI assistants](./connect-ai-assistants.md).
- Your groups and permissions are not on your profile. Only a superuser can change them. See
  [Users and groups](./users-and-groups.md).
