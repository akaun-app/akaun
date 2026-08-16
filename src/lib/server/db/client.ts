import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { hash } from "argon2";
import { count, eq } from "drizzle-orm";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { DATABASE_PATH } from "../env.js";
import { createLogger } from "../logger.js";
import * as schema from "./schema.js";
import {
  users,
  groups,
  groupPermissions,
  userGroups,
  documentTemplates,
} from "./schema.js";
import { TemplateDocumentType, TemplateFont } from "$lib/enums.js";
import { makeDefaultLayout } from "../pdf/template-types.js";

const log = createLogger("db");

const DEFAULT_ADMIN_PASSWORD = "akaun-admin";

function createDb() {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  const raw = new Database(DATABASE_PATH);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  return { db, raw };
}

const { db } = createDb();
export { db };

export async function ensureDefaultAdmin(): Promise<void> {
  const exists = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "admin"))
    .get();

  if (!exists) {
    const passwordHash = await hash(DEFAULT_ADMIN_PASSWORD);
    db.insert(users)
      .values({
        email: "admin@localhost",
        username: "admin",
        passwordHash,
        role: "owner",
      })
      .run();
    log.warn(
      `Default admin user created (username: admin, password: ${DEFAULT_ADMIN_PASSWORD}). Log in and change this password immediately.`,
    );
  }
}

const SEED_GROUPS = [
  {
    name: "Administrators",
    description:
      "Unrestricted access to every area, including user management, backups and reset. Cannot be renamed or deleted.",
    isSuperuser: true,
    permissions: {},
  },
  {
    name: "Bookkeeper",
    description: "Maintains day-to-day records across the shared ledger.",
    isSuperuser: false,
    permissions: {
      expenses: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      income: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      import: {
        canView: true,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      contacts: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      // quotations/invoices added Phase 7 — existing deployments: add perms manually in Settings → Users & Groups
      quotations: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      invoices: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      // reconciliation added Phase 8 — existing deployments: add perms manually in Settings → Users & Groups
      reconciliation: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      // accounts/reports added with the double-entry ledger — existing deployments: add perms manually in Settings → Users & Groups.
      // A bookkeeper maintains the chart of accounts (the categories screen writes here) but never deletes one.
      accounts: {
        canView: true,
        canAdd: true,
        canChange: true,
        canDelete: false,
      },
      reports: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      // `journal` is deliberately absent: no seeded group may enter a record's
      // sides by hand. It is granted explicitly or not at all (FR-040).
    },
  },
  {
    name: "Data Entry",
    description:
      "Adds new records but cannot edit, claim or delete existing ones.",
    isSuperuser: false,
    permissions: {
      expenses: {
        canView: false,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      income: {
        canView: false,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      import: {
        canView: false,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      contacts: {
        canView: true,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      // quotations/invoices added Phase 7 — existing deployments: add perms manually in Settings → Users & Groups
      quotations: {
        canView: false,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      invoices: {
        canView: false,
        canAdd: true,
        canChange: false,
        canDelete: false,
      },
      // reconciliation added Phase 8 — existing deployments: add perms manually in Settings → Users & Groups
      reconciliation: {
        canView: false,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      // Data Entry gains neither accounts nor reports: adding a record must not
      // let someone reshape the chart of accounts or read the whole picture.
      accounts: {
        canView: false,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      reports: {
        canView: false,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
    },
  },
  {
    name: "Reviewer",
    description: "Read-only visibility across all financial records.",
    isSuperuser: false,
    permissions: {
      expenses: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      income: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      import: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      contacts: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      // quotations/invoices added Phase 7 — existing deployments: add perms manually in Settings → Users & Groups
      quotations: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      invoices: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      // reconciliation added Phase 8 — existing deployments: add perms manually in Settings → Users & Groups
      reconciliation: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      // accounts/reports added with the double-entry ledger — existing deployments: add perms manually in Settings → Users & Groups
      accounts: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
      reports: {
        canView: true,
        canAdd: false,
        canChange: false,
        canDelete: false,
      },
    },
  },
];

export function ensureDefaultTemplate(): void {
  const total = (
    db.select({ n: count() }).from(documentTemplates).get() as { n: number }
  ).n;
  if (total > 0) return;
  db.insert(documentTemplates)
    .values({
      uuid: crypto.randomUUID(),
      name: "Default",
      documentType: TemplateDocumentType.Both,
      isDefault: 1,
      themeColor: "#1a56db",
      themeFont: TemplateFont.Inter,
      layoutJson: JSON.stringify(makeDefaultLayout()),
    })
    .run();
}

export function ensureGroupSeed(): void {
  // Seed default groups
  for (const seed of SEED_GROUPS) {
    const existing = db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.name, seed.name))
      .get();
    if (!existing) {
      const [group] = db
        .insert(groups)
        .values({
          name: seed.name,
          description: seed.description,
          isSuperuser: seed.isSuperuser,
        })
        .returning({ id: groups.id })
        .all();
      if (!seed.isSuperuser) {
        const permRows = Object.entries(seed.permissions).map(
          ([resource, perms]) => ({
            groupId: group.id,
            resource,
            ...perms,
          }),
        );
        if (permRows.length > 0) {
          db.insert(groupPermissions).values(permRows).run();
        }
      }
      log.info({ group: seed.name }, "Seeded default group");
    }
  }

  // Assign all ungrouped users to Administrators
  const adminGroup = db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.name, "Administrators"))
    .get();
  if (!adminGroup) return;

  const ungrouped = db
    .select({ id: users.id })
    .from(users)
    .all()
    .filter((u) => {
      const membership = db
        .select({ groupId: userGroups.groupId })
        .from(userGroups)
        .where(eq(userGroups.userId, u.id))
        .get();
      return !membership;
    });

  for (const u of ungrouped) {
    db.insert(userGroups)
      .values({ userId: u.id, groupId: adminGroup.id })
      .run();
    log.info({ userId: u.id }, "Assigned ungrouped user to Administrators");
  }
}

// `ensureDefaultCategories()` used to live here and ran on every boot. Its job
// passed to the ledger upgrade's account seeding
// (src/lib/server/ledger/upgrade/accounts.ts), which seeds the same default
// category names as accounts and does it once, so the deprecated `categories`
// table stops being written to (FR-006a, D-06, D-17).
