import type { PayerDecision } from "../types.js";

/**
 * Who a pre-upgrade reimbursement is owed to (FR-036b), and who an unpaid,
 * unclaimed expense is owed to (FR-036c).
 *
 * A claim recorded before the upgrade names no person — only the user account
 * that created it. This works out who that was, by rule rather than by asking,
 * and says which rule answered so the upgrade's report can show it.
 *
 * This is exactly the logic Principle V calls "wrong silently": pick the wrong
 * contact and the records still balance, the totals still match, and nothing
 * looks broken. So it is pure — plain rows in, a decision out, no database —
 * and `convert.ts` keeps one job: writing down what this decided.
 *
 * A wrong attribution is corrected by merging the two contacts, which moves
 * every record at once and keeps a payment and the expenses it covers naming
 * the same person.
 */

export type UserRow = {
  id: number;
  username: string;
  email: string;
  name: string | null;
};

export type ContactRow = {
  id: number;
  legalName: string;
  email: string | null;
};

/** The username the seeded administrator login is created under (db/client.ts). */
const SEEDED_ADMIN_USERNAME = "admin";

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Step 1 — a contact whose email matches the account's. */
function byEmail(user: UserRow, contacts: ContactRow[]): ContactRow | null {
  const email = normalise(user.email);
  // An account with no email must never match a contact with no email: two
  // blanks are not the same person.
  if (!email) return null;
  return contacts.find((c) => normalise(c.email) === email) ?? null;
}

/** Step 2 — a contact whose name matches the account's. */
function byName(user: UserRow, contacts: ContactRow[]): ContactRow | null {
  const name = normalise(user.name);
  if (!name) return null;
  return contacts.find((c) => normalise(c.legalName) === name) ?? null;
}

/**
 * The name a created contact gets: the account's name, then its username, then
 * the part of its email before the `@` — so a contact can never be created
 * without one.
 */
export function nameForNewContact(user: UserRow): string {
  const name = user.name?.trim();
  if (name) return name;

  const username = user.username.trim();
  if (username) return username;

  const local = user.email.split("@")[0]?.trim();
  if (local) return local;

  // Nothing to go on at all. Better a placeholder somebody can rename than a
  // contact with no name, or a record with nobody against it.
  return `User ${user.id}`;
}

/**
 * Works out who a reimbursement created by `creator` is owed to.
 *
 * `users` is every user account on the installation, needed only for step 3.
 */
export function resolvePayer(
  creator: UserRow,
  users: UserRow[],
  contacts: ContactRow[],
): PayerDecision {
  const emailMatch = byEmail(creator, contacts);
  if (emailMatch) {
    return { step: "email-match", contactId: emailMatch.id, createName: null };
  }

  const nameMatch = byName(creator, contacts);
  if (nameMatch) {
    return { step: "name-match", contactId: nameMatch.id, createName: null };
  }

  // Step 3 — the seeded administrator is a system login, not a person, so a
  // reimbursement it created was really made by whoever runs the installation.
  // Only when there is exactly one other account is there a single answer;
  // with none or several, this step is skipped rather than guessed at.
  if (creator.username === SEEDED_ADMIN_USERNAME) {
    const others = users.filter((u) => u.id !== creator.id);
    if (others.length === 1) {
      const soleUser = others[0];

      const soleEmail = byEmail(soleUser, contacts);
      if (soleEmail) {
        return {
          step: "sole-user-email-match",
          contactId: soleEmail.id,
          createName: null,
        };
      }

      const soleName = byName(soleUser, contacts);
      if (soleName) {
        return {
          step: "sole-user-name-match",
          contactId: soleName.id,
          createName: null,
        };
      }

      // Nothing matched, but this user is still who the reimbursement was for,
      // so the contact to create is named after them rather than after the
      // administrator login.
      return {
        step: "created-contact",
        contactId: null,
        createName: nameForNewContact(soleUser),
      };
    }
  }

  // Step 4 — nothing matched, so a contact is created as an individual with the
  // Employee role. `convert.ts` writes it; naming it is decided here.
  return {
    step: "created-contact",
    contactId: null,
    createName: nameForNewContact(creator),
  };
}

/**
 * An expense that was never marked paid and was never on a reimbursement
 * (FR-036c). Where it names a contact it stays owed to them, exactly as a
 * personally-paid expense does. Where it names nobody there is no one to owe,
 * so it falls back to the default bank account — and is reported, so the user
 * sees which records were treated that way rather than finding out later.
 */
export function resolveUnclaimedExpense(
  contactId: number | null,
): PayerDecision {
  return contactId === null
    ? { step: "bank-fallback", contactId: null, createName: null }
    : { step: "named-contact", contactId, createName: null };
}
