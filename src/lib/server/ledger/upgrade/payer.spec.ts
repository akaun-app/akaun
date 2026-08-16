import { describe, expect, it } from "vitest";
import {
  nameForNewContact,
  resolvePayer,
  resolveUnclaimedExpense,
} from "./payer.js";
import type { ContactRow, UserRow } from "./payer.js";

const ADMIN: UserRow = {
  id: 1,
  username: "admin",
  email: "admin@localhost",
  name: null,
};

const HAO: UserRow = {
  id: 2,
  username: "haoquan",
  email: "hao-quan.tang@vitrox.com",
  name: "Hao Quan Tang",
};

function contact(
  id: number,
  legalName: string,
  email: string | null = null,
): ContactRow {
  return { id, legalName, email };
}

describe("matching the account that created a reimbursement to a person", () => {
  it("takes an email match first", () => {
    const decision = resolvePayer(
      HAO,
      [ADMIN, HAO],
      [
        contact(10, "Someone Else", "hao-quan.tang@vitrox.com"),
        contact(11, "Hao Quan Tang"),
      ],
    );
    expect(decision.step).toBe("email-match");
    expect(decision.contactId).toBe(10);
  });

  it("falls to a name match when no email matches", () => {
    const decision = resolvePayer(
      HAO,
      [ADMIN, HAO],
      [contact(11, "Hao Quan Tang")],
    );
    expect(decision.step).toBe("name-match");
    expect(decision.contactId).toBe(11);
  });

  it("ignores case and surrounding space on both", () => {
    const decision = resolvePayer(
      { ...HAO, email: "  HAO-QUAN.TANG@VITROX.COM " },
      [ADMIN, HAO],
      [contact(12, "Nobody", "hao-quan.tang@vitrox.com")],
    );
    expect(decision.step).toBe("email-match");
    expect(decision.contactId).toBe(12);

    const byName = resolvePayer(
      { ...HAO, name: "  hao quan tang  " },
      [ADMIN, HAO],
      [contact(13, "HAO QUAN TANG")],
    );
    expect(byName.step).toBe("name-match");
    expect(byName.contactId).toBe(13);
  });

  it("never matches an account with no email against a contact with no email", () => {
    const decision = resolvePayer(ADMIN, [ADMIN], [contact(14, "Blank", null)]);
    expect(decision.step).not.toBe("email-match");
  });
});

describe("the seeded administrator, which is a login rather than a person", () => {
  it("resolves through the installation's one real user", () => {
    const decision = resolvePayer(
      ADMIN,
      [ADMIN, HAO],
      [contact(20, "Hao Quan Tang")],
    );
    expect(decision.step).toBe("sole-user-name-match");
    expect(decision.contactId).toBe(20);
  });

  it("prefers that user's email over their name, as at the top level", () => {
    const decision = resolvePayer(
      ADMIN,
      [ADMIN, HAO],
      [
        contact(21, "Different Name", "hao-quan.tang@vitrox.com"),
        contact(22, "Hao Quan Tang"),
      ],
    );
    expect(decision.step).toBe("sole-user-email-match");
    expect(decision.contactId).toBe(21);
  });

  it("creates a contact instead when the administrator is the only account", () => {
    const decision = resolvePayer(ADMIN, [ADMIN], []);
    expect(decision.step).toBe("created-contact");
    expect(decision.contactId).toBeNull();
  });

  it("creates a contact instead when there is more than one other account", () => {
    const second: UserRow = {
      id: 3,
      username: "sam",
      email: "sam@x.com",
      name: "Sam",
    };
    const decision = resolvePayer(
      ADMIN,
      [ADMIN, HAO, second],
      [contact(23, "Hao Quan Tang"), contact(24, "Sam")],
    );
    // Two real users mean no single answer, so the step is skipped rather than
    // one of them being guessed at.
    expect(decision.step).toBe("created-contact");
  });

  it("still takes a direct match on the administrator account itself first", () => {
    const decision = resolvePayer(
      ADMIN,
      [ADMIN, HAO],
      [contact(25, "System Administrator", "admin@localhost")],
    );
    expect(decision.step).toBe("email-match");
    expect(decision.contactId).toBe(25);
  });
});

describe("naming a contact that has to be created", () => {
  it("uses the account's name when it has one", () => {
    expect(nameForNewContact(HAO)).toBe("Hao Quan Tang");
  });

  it("falls back to the username when the name is missing", () => {
    expect(nameForNewContact({ ...HAO, name: null })).toBe("haoquan");
    expect(nameForNewContact({ ...HAO, name: "   " })).toBe("haoquan");
  });

  it("falls back to the part of the email before the @ when there is no username", () => {
    expect(nameForNewContact({ ...HAO, name: null, username: "" })).toBe(
      "hao-quan.tang",
    );
  });

  it("never returns an empty name", () => {
    const nameless: UserRow = { id: 9, username: "", email: "", name: null };
    expect(nameForNewContact(nameless).length).toBeGreaterThan(0);
  });

  it("is what a created-contact decision carries", () => {
    const decision = resolvePayer({ ...HAO, name: null }, [HAO], []);
    expect(decision.step).toBe("created-contact");
    expect(decision.createName).toBe("haoquan");
  });
});

describe("an expense that was never paid and was never on a reimbursement", () => {
  it("stays owed to the contact it names", () => {
    const decision = resolveUnclaimedExpense(77);
    expect(decision.step).toBe("named-contact");
    expect(decision.contactId).toBe(77);
  });

  it("falls back to the bank when it names nobody, and says so", () => {
    const decision = resolveUnclaimedExpense(null);
    expect(decision.step).toBe("bank-fallback");
    expect(decision.contactId).toBeNull();
  });
});
