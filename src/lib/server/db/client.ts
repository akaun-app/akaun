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
  applySubTypeBackfill,
  classifyDatabaseFile,
  upgradeDatabaseFile,
} from "./auto-upgrade.js";
import {
  legacyDropAllowed,
  readLegacyDropStateAt,
} from "./legacy-drop-guard.js";
import {
  users,
  groups,
  groupPermissions,
  userPermissions,
  userGroups,
  documentTemplates,
} from "./schema.js";
import {
  mergeRecordsPermissions,
  type PermissionRow,
} from "../permissions/merge-records.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { TemplateDocumentType, TemplateFont } from "$lib/enums.js";
import { makeDefaultLayout } from "../pdf/template-types.js";

const log = createLogger("db");

const DEFAULT_ADMIN_PASSWORD = "akaun-admin";

function createDb() {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });

  // The installation upgrades itself, with no command and no setting (002
  // FR-037). Both states below are ones it cannot get out of on its own: a book
  // still on migration 0005 cannot start at all, because the guard below refuses
  // rather than let 0015 drop the tables its records are still in; and a book
  // converted to double-entry by an earlier release but never standardized starts
  // with every type and code null, no saved defaults, and the 18 seed accounts
  // inserted beside its own.
  //
  // The conversion runs against a copy and installs it only once every check has
  // passed, so a failure leaves this file byte-identical and the server does not
  // start — a half-standardized chart is worse than a refusal.
  const fileState = classifyDatabaseFile(DATABASE_PATH);
  if (fileState === "legacy_0005" || fileState === "ledger") {
    try {
      const result = upgradeDatabaseFile({ databasePath: DATABASE_PATH });
      log.info(
        {
          inputState: result.inputState,
          status: result.status,
          backupPath: result.backupPath,
          legacy: result.legacy,
          chart: result.chart,
        },
        "Converted the books to the standardized chart of accounts",
      );
      for (const item of result.chart.attentionItems) log.warn(item);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, "Automatic conversion failed");
      console.error(
        `\nThis installation's books could not be converted, so the server has not started. Your database has not been changed.\n\n${reason}\n`,
      );
      process.exit(1);
    }
  }

  // Before the database is opened for writing at all, and deliberately so.
  //
  // Kept as the last line of defence now that the conversion above runs by
  // itself: after a successful conversion this passes, and if the conversion was
  // skipped — an unsupported partial schema — it still refuses. Two independent
  // gates on the one invariant that cannot be undone from inside the app.
  //
  // This release's migration drops the tables an unconverted installation still
  // keeps its records in. If the conversion has not run, the server does not
  // start — and the file has to be left *byte-identical*, which is why the check
  // reads through its own read-only connection: opening this database for
  // writing sets `journal_mode` and checkpoints the WAL on close, which rewrites
  // the main file even when nothing logically changed (FR-037a, research.md
  // R-05).
  const allowed = legacyDropAllowed(readLegacyDropStateAt(DATABASE_PATH));
  if (!allowed.ok) {
    log.error(allowed.reason);
    console.error(`\n${allowed.reason}\n`);
    process.exit(1);
  }

  const raw = new Database(DATABASE_PATH);
  raw.exec("PRAGMA journal_mode = WAL;");

  const db = drizzle(raw, { schema });

  // Foreign keys are OFF for the migration and ON for everything after it, and
  // the order matters.
  //
  // A SQLite table is altered by rebuilding it: create the new shape, copy the
  // rows, drop the original, rename. With enforcement ON, that `DROP TABLE`
  // runs an implicit DELETE of every row first — which fires ON DELETE CASCADE
  // on the children. Rebuilding `invoices` would take its lines with it, and
  // rebuilding `bank_statements` would take every extracted statement line.
  //
  // The PRAGMA cannot go in the migration file: Drizzle wraps each migration in
  // BEGIN … COMMIT, and SQLite ignores `PRAGMA foreign_keys` inside a
  // transaction. So it is set here, on the connection, around the call.
  raw.exec("PRAGMA foreign_keys = OFF;");
  migrate(db, { migrationsFolder: "drizzle" });
  raw.exec("PRAGMA foreign_keys = ON;");

  // And then checked, because "off during the migration" is only safe if the
  // migration left the references intact. A violation here means a rebuild
  // above copied a row whose parent no longer exists.
  const violations = raw.query("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    log.error(
      { violations: violations.length },
      "Foreign key violations after migration",
    );
  }

  // Every boot, not gated on the conversion above: most installations reading
  // this are already past it, and the four seeded defaults still need their
  // sub-type set the first time this schema version runs against them.
  applySubTypeBackfill(raw);

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
      records: {
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
      // `adjustments` is deliberately absent: no seeded group may write a record
      // between any two accounts or add a third side. It is granted explicitly
      // or not at all (FR-031a).
    },
  },
  {
    name: "Data Entry",
    description:
      "Adds new records but cannot edit, claim or delete existing ones.",
    isSuperuser: false,
    permissions: {
      records: {
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
      records: {
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

/**
 * Collapses the `expenses` and `income` permissions into one `records`
 * permission, and renames `journal` to `adjustments` (FR-029, FR-031b).
 *
 * Writes **both** `group_permissions` and `user_permissions`.
 * `dropClaimPermissions()` is the precedent for retiring a resource string and
 * it touched groups only; repeating that omission here would silently discard
 * every per-user override, which is exactly the failure FR-029 forbids
 * (research.md R-04).
 *
 * The merge itself is pure and lives in `permissions/merge-records.ts`. This
 * applier only reads rows, hands them over and writes the answer back, guarded
 * by a settings key so it runs once: the merge is idempotent, but a rerun would
 * re-grant a permission an administrator removed afterwards.
 */
export function applyRecordsPermission(): void {
  if (getSetting(db, SETTING_KEYS.recordsPermissionMerged) === "1") return;

  const groupRows = db
    .select({
      ownerId: groupPermissions.groupId,
      resource: groupPermissions.resource,
      canView: groupPermissions.canView,
      canAdd: groupPermissions.canAdd,
      canChange: groupPermissions.canChange,
      canDelete: groupPermissions.canDelete,
    })
    .from(groupPermissions)
    .all() as PermissionRow[];

  const userRows = db
    .select({
      ownerId: userPermissions.userId,
      resource: userPermissions.resource,
      canView: userPermissions.canView,
      canAdd: userPermissions.canAdd,
      canChange: userPermissions.canChange,
      canDelete: userPermissions.canDelete,
    })
    .from(userPermissions)
    .all() as PermissionRow[];

  const mergedGroups = mergeRecordsPermissions(groupRows);
  const mergedUsers = mergeRecordsPermissions(userRows);

  // Replace wholesale rather than patch: the merge collapses two primary keys
  // onto one, so there is no in-place edit that is correct at every step.
  db.transaction((tx) => {
    tx.delete(groupPermissions).run();
    if (mergedGroups.length > 0) {
      tx.insert(groupPermissions)
        .values(
          mergedGroups.map((r) => ({
            groupId: r.ownerId,
            resource: r.resource,
            canView: r.canView,
            canAdd: r.canAdd,
            canChange: r.canChange,
            canDelete: r.canDelete,
          })),
        )
        .run();
    }

    tx.delete(userPermissions).run();
    if (mergedUsers.length > 0) {
      tx.insert(userPermissions)
        .values(
          mergedUsers.map((r) => ({
            userId: r.ownerId,
            resource: r.resource,
            canView: r.canView,
            canAdd: r.canAdd,
            canChange: r.canChange,
            canDelete: r.canDelete,
          })),
        )
        .run();
    }
  });

  setSetting(db, SETTING_KEYS.recordsPermissionMerged, "1");
  log.info(
    { groups: mergedGroups.length, users: mergedUsers.length },
    "Merged the expenses and income permissions into records",
  );
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
