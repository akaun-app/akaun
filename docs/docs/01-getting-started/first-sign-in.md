---
sidebar_position: 2
---

# Sign in for the first time

Use this page after you install Akaun. Akaun has no first-run wizard. You sign in with a default
user and then change its password.

## What Akaun makes on the first start

When the server starts for the first time, Akaun makes these items:

- A user with the username `admin` and the password `akaun-admin`. The server also writes this
  password to its log.
- Four groups: **Administrators**, **Bookkeeper**, **Data Entry** and **Reviewer**. The `admin`
  user is in **Administrators**, which is a superuser group.
- A starter set of accounts, for example **Cash**, **Bank** and **Accounts Payable**. See
  [Prepare your book](./set-up-your-book.md).

## Sign in

1. Open the address of your Akaun server in a web browser.
2. In **Username**, type `admin`.
3. In **Password**, type `akaun-admin`.
4. Click **Sign in**.

The **Records** screen opens. The sidebar shows your name and the screens that you can use.

:::caution

Change the default password immediately. All Akaun installations start with the same password.
Until you change it, any person who can open the address can sign in as a superuser.

:::

## Change the default password

1. At the bottom of the sidebar, click the user menu button (three dots) next to your name.
2. Click **Profile**.
3. Click the **Security** tab.
4. In **Current password**, type `akaun-admin`.
5. In **New password**, type a new password. Use 8 characters or more.
6. In **Confirm new password**, type the new password again.
7. Click **Change password**.

Akaun shows **Password changed**. Akaun also disconnects all the connected apps of this user.

:::caution

Do not change the username `admin`. If no user has the username `admin`, Akaun makes a new
`admin` user with the password `akaun-admin` at the next start of the server.

:::

You can change the name and email of the `admin` user. On the **Profile** tab, change
**Display name** or **Email**, and then click **Save changes**. The default email is
`admin@localhost`.

## If you cannot sign in

- **Invalid username or password**: the username or the password is wrong. The username is
  case-sensitive.
- **Too many attempts. Try again in 15 minute(s).**: Akaun allows 5 failed attempts for one
  username from one computer. The 15 minutes start at the first failed attempt. Wait for the
  time that the message gives, and then try again. The number of minutes in the message can be
  smaller.
- **Forbidden (CSRF origin check failed)**: the address in the browser is not the same as the
  `ORIGIN` setting of the server. See [Install Akaun](./install.md#environment-variables).

A correct sign-in sets the count of failed attempts to zero. A restart of the server also sets
it to zero.

## If you forget your password

The **Forgot?** button and the **Ask your admin for access** button on the sign-in page do not
work at this time.

Ask a superuser to give you a new password:

1. The superuser clicks **Users & Groups** in the sidebar.
2. On the **Users** tab, the superuser clicks your row.
3. In **Reset password**, the superuser types a new password.
4. The superuser clicks **Save changes**.

Then sign in with the new password, and change it on your **Profile** page.

:::caution

Only a superuser can give a user a new password. If the only superuser forgets the password,
nobody can reset it in Akaun. Add a second trusted user to the **Administrators**
group. See [Users and groups](../09-administration/users-and-groups.md).

:::

## Notes and limits

- A sign-in stays valid for 30 days in that browser. To end it earlier, open the user menu and
  click **Sign out**.
- The **Keep me signed in** box on the sign-in page does not change the 30 days at this time.

## Next step

[Prepare your book](./set-up-your-book.md).
