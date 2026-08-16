import { MONEY_POT_ROLES } from "$lib/server/ledger/account-type.js";
import type { PageServerLoad, Actions } from "./$types.js";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import { listTemplates } from "$lib/server/queries/templates.js";
import {
  getSetting,
  setSetting,
  SETTING_KEYS,
  hasAnyDocuments,
} from "$lib/server/settings.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  canDeleteAccount,
  defaultAccountId,
  listAccounts,
} from "$lib/server/queries/accounts.js";
import {
  createAccount,
  patchAccount,
  removeAccount,
} from "$lib/server/services/accounts.js";
import { readUpgradeState } from "$lib/server/ledger/upgrade/index.js";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import type { AccountView } from "$lib/server/ledger/types.js";
import {
  saveCompanyLogo,
  deleteFile,
  sniffAllowedType,
  MAX_LOGO_BYTES,
} from "$lib/server/file-storage.js";
import {
  DEFAULT_SEQUENCE_TEMPLATE,
  validateTemplate,
} from "$lib/sequence-template.js";
import {
  getAllProviders,
  insertProvider,
  updateProvider,
  deleteProvider,
  reorderProviders,
} from "$lib/server/llmProviders.js";
import type { ProviderType } from "$lib/server/import/providers/index.js";
import { fail } from "@sveltejs/kit";

/**
 * A category IS an account (FR-006a) — the everyday word on screen, the chart of
 * accounts underneath. There is no second list and no mapping between the two,
 * so what Settings offers and what an expense screen offers can never drift.
 */
const CATEGORY_ROLE = {
  expense: AccountRole.ExpenseCategory,
  income: AccountRole.IncomeCategory,
} as const;

/** Just what the chips on the Category tab need to know about each account. */
function toCategoryRows(rows: AccountView[]) {
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    // One of the accounts the app needs to work — it cannot be taken away.
    isSystem: a.isSystem,
    // Already used by records, so removing it would throw history away.
    // Taking it off the list stops it being offered instead.
    inUse: a.movementCount > 0,
  }));
}

export const load: PageServerLoad = async ({ locals }) => {
  const expenseCategories = toCategoryRows(
    listAccounts(db, { role: CATEGORY_ROLE.expense }),
  );
  const incomeCategories = toCategoryRows(
    listAccounts(db, { role: CATEGORY_ROLE.income }),
  );
  const canManageCategories = hasPermission(locals, "accounts", "change");

  // Which account new records start with, and the accounts it may be (FR-011).
  // With one account there is nothing to ask, so the setting stays off screen.
  const moneyAccounts = listAccounts(db, { role: MONEY_POT_ROLES }).map(
    (a) => ({
      id: a.id,
      name: a.name,
    }),
  );
  const ledgerDefaultAccountId = defaultAccountId(db);

  // What the one-off update to the new way of recording did, and whether the
  // books balance. Only the part meant to be read is sent — the before/after
  // snapshot behind it is working data, not something to put on a screen.
  const canSeeBooks = hasPermission(locals, "reports", "view");
  const upgradeState = canSeeBooks ? readUpgradeState(db) : null;
  const upgrade = upgradeState
    ? {
        finishedAt: upgradeState.finishedAt,
        verify: upgradeState.verify,
        report: upgradeState.report,
      }
    : null;

  const sequenceTemplate =
    getSetting(db, SETTING_KEYS.sequenceTemplate) ?? DEFAULT_SEQUENCE_TEMPLATE;
  const currency = getSetting(db, SETTING_KEYS.currencyCode) ?? "USD";
  const locked = hasAnyDocuments(db);
  const currencyLocked = locked;
  const sequenceTemplateLocked = locked;

  const autoImportParallelTasks = parseInt(
    getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? "3",
    10,
  );
  const autoImportCategoryHints =
    (getSetting(db, SETTING_KEYS.autoImportCategoryHints) ?? "true") === "true";
  const autoImportRateLimitMs = parseInt(
    getSetting(db, SETTING_KEYS.autoImportRateLimitMs) ?? "0",
    10,
  );
  const autoImportCustomInstructions =
    getSetting(db, SETTING_KEYS.autoImportCustomInstructions) ?? "";

  const companyName = getSetting(db, SETTING_KEYS.companyName) ?? "";
  const companyAddress = getSetting(db, SETTING_KEYS.companyAddress) ?? "";
  const companyRegistrationNo =
    getSetting(db, SETTING_KEYS.companyRegistrationNo) ?? "";
  const companyLogoPath = getSetting(db, SETTING_KEYS.companyLogoPath) ?? "";
  const companyLogoUrl = companyLogoPath
    ? `/api/files/${encodeURIComponent(companyLogoPath)}`
    : null;

  const providers = getAllProviders(db).map((p) => ({
    ...p,
    hasApiKey: p.apiKey.length > 0,
    apiKey: "", // never send actual key to browser
  }));

  return {
    expenseCategories,
    incomeCategories,
    canManageCategories,
    moneyAccounts,
    ledgerDefaultAccountId,
    canSeeBooks,
    upgrade,
    sequenceTemplate,
    currency,
    currencyLocked,
    sequenceTemplateLocked,
    username: locals.user!.username,
    autoImportParallelTasks,
    autoImportCategoryHints,
    autoImportRateLimitMs,
    autoImportCustomInstructions,
    companyName,
    companyAddress,
    companyRegistrationNo,
    companyLogoUrl,
    providers,
    templates: listTemplates(db),
  };
};

/** One row of a staged category list. A null id means "the user just added it". */
const categoryEntrySchema = z.object({
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1).max(80),
});

/** Both lists, as the Category tab wants them to end up. */
const categoriesSchema = z.object({
  // At least one of each: an expense or income screen with nothing to pick
  // from cannot record anything.
  expense: z.array(categoryEntrySchema).min(1),
  income: z.array(categoryEntrySchema).min(1),
});

/** What one staged list asks of the accounts behind it. */
function planCategoryChanges(
  role: AccountRoleCode,
  entries: z.infer<typeof categoryEntrySchema>[],
) {
  const existing = listAccounts(db, { role });
  const keptIds = new Set(entries.map((e) => e.id).filter((id) => id !== null));
  const seen = new Set<string>();
  const duplicated: string[] = [];

  for (const entry of entries) {
    const key = entry.name.toLocaleLowerCase();
    if (seen.has(key)) duplicated.push(entry.name);
    seen.add(key);
  }

  return {
    duplicated,
    create: entries.filter((e) => e.id === null).map((e) => e.name),
    rename: entries.flatMap((e) =>
      e.id !== null && existing.some((a) => a.id === e.id && a.name !== e.name)
        ? [{ id: e.id, name: e.name }]
        : [],
    ),
    drop: existing.filter((a) => !keptIds.has(a.id)),
  };
}

export const actions: Actions = {
  saveGeneral: async ({ locals, request }) => {
    const data = await request.formData();
    const code = String(data.get("currencyCode") ?? "")
      .trim()
      .toUpperCase();

    // Which account a new expense or income starts with (FR-011). Only sent
    // by the browser when there is more than one to choose between.
    const chosenAccount = String(data.get("defaultAccountId") ?? "").trim();
    if (chosenAccount) {
      if (!hasPermission(locals, "accounts", "change")) {
        return fail(403, { error: "Forbidden" });
      }
      const parsed = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(chosenAccount);
      const known =
        parsed.success &&
        listAccounts(db, { role: MONEY_POT_ROLES }).some(
          (a) => a.id === parsed.data,
        );
      if (!known) {
        return fail(400, { error: "Choose one of your own accounts." });
      }
      setSetting(db, SETTING_KEYS.ledgerDefaultAccountId, String(parsed.data));
    }

    if (code) {
      const currentCode = getSetting(db, SETTING_KEYS.currencyCode) ?? "USD";
      if (hasAnyDocuments(db)) {
        if (code !== currentCode) {
          return fail(400, {
            error:
              "Currency is locked once any document exists — changing it would corrupt historical amounts.",
          });
        }
      } else if (/^[A-Z]{3}$/.test(code)) {
        setSetting(db, SETTING_KEYS.currencyCode, code);
      }
    }

    return { success: true, action: "saveGeneral" };
  },

  saveCompany: async ({ request }) => {
    const data = await request.formData();
    const companyName = String(data.get("companyName") ?? "").trim();
    const companyAddress = String(data.get("companyAddress") ?? "").trim();
    const companyRegistrationNo = String(
      data.get("companyRegistrationNo") ?? "",
    ).trim();
    const removeLogo = data.get("removeLogo") === "true";
    const logoFile = data.get("companyLogo");

    if (logoFile instanceof File && logoFile.size > 0) {
      if (logoFile.size > MAX_LOGO_BYTES) {
        return fail(413, { error: "Logo image must be 5MB or smaller." });
      }
      const buffer = Buffer.from(await logoFile.arrayBuffer());
      const type = sniffAllowedType(buffer);
      if (type !== "jpeg" && type !== "png") {
        return fail(415, { error: "Logo must be a JPEG or PNG image." });
      }
      const oldPath = getSetting(db, SETTING_KEYS.companyLogoPath);
      const rel = saveCompanyLogo(buffer, logoFile.name);
      setSetting(db, SETTING_KEYS.companyLogoPath, rel);
      if (oldPath) deleteFile(oldPath);
    } else if (removeLogo) {
      const oldPath = getSetting(db, SETTING_KEYS.companyLogoPath);
      if (oldPath) {
        setSetting(db, SETTING_KEYS.companyLogoPath, "");
        deleteFile(oldPath);
      }
    }

    setSetting(db, SETTING_KEYS.companyName, companyName);
    setSetting(db, SETTING_KEYS.companyAddress, companyAddress);
    setSetting(db, SETTING_KEYS.companyRegistrationNo, companyRegistrationNo);

    return { success: true, action: "saveCompany" };
  },

  /**
   * The Category tab's one Save.
   *
   * The browser stages every add and removal locally and sends the two lists it
   * wants to end up with; the difference against what is there now is worked out
   * here. A row with no id is one the user added and nothing has created yet.
   *
   * Everything goes through the accounts service, never a raw insert, so each
   * change writes its own audit entry and reaches other open tabs by itself.
   */
  saveCategories: async ({ locals, request }) => {
    if (!hasPermission(locals, "accounts", "change")) {
      return fail(403, { error: "Forbidden" });
    }

    const data = await request.formData();
    let payload: z.infer<typeof categoriesSchema>;
    try {
      const parsed = categoriesSchema.safeParse(
        JSON.parse(String(data.get("categories") ?? "")),
      );
      if (!parsed.success) {
        return fail(400, {
          error: "Give every category a name, and keep at least one of each.",
        });
      }
      payload = parsed.data;
    } catch {
      return fail(400, { error: "Invalid categories data" });
    }

    const plans = (["expense", "income"] as const).map((side) => ({
      role: CATEGORY_ROLE[side] as AccountRoleCode,
      ...planCategoryChanges(CATEGORY_ROLE[side], payload[side]),
    }));

    const duplicated = plans.flatMap((plan) => plan.duplicated);
    if (duplicated.length > 0) {
      return fail(400, {
        error: `You already have a category called “${duplicated[0]}”.`,
      });
    }
    if (
      plans.some((plan) => plan.create.length > 0) &&
      !hasPermission(locals, "accounts", "add")
    ) {
      return fail(403, { error: "Forbidden" });
    }
    if (
      plans.some((plan) => plan.drop.length > 0) &&
      !hasPermission(locals, "accounts", "delete")
    ) {
      return fail(403, { error: "Forbidden" });
    }

    const userId = locals.user!.id;
    for (const plan of plans) {
      // Removals first, so a name freed here can be used again below.
      for (const account of plan.drop) {
        // A category no record has used is genuinely gone; one that has
        // history stays and simply stops being offered (FR-009).
        const result = canDeleteAccount(db, account.id).ok
          ? removeAccount(db, account.id, userId)
          : patchAccount(db, account.id, userId, { archived: true });
        if (!result.ok) return fail(409, { error: result.reason });
      }
      for (const renamed of plan.rename) {
        const result = patchAccount(db, renamed.id, userId, {
          name: renamed.name,
        });
        if (!result.ok) return fail(409, { error: result.reason });
      }
      for (const name of plan.create) {
        const result = createAccount(db, userId, { role: plan.role, name });
        if (!result.ok) return fail(409, { error: result.reason });
      }
    }

    return { success: true, action: "saveCategories" };
  },

  saveSequenceTemplate: async ({ request }) => {
    if (hasAnyDocuments(db)) {
      return fail(400, {
        error:
          "Sequence number format is locked once any document exists — changing it would break historical document numbering.",
      });
    }
    const data = await request.formData();
    const template = String(data.get("template") ?? "").trim();
    const err = validateTemplate(template);
    if (err) return fail(400, { error: err });
    setSetting(db, SETTING_KEYS.sequenceTemplate, template);
    return { success: true, action: "saveSequenceTemplate" };
  },

  updateProvider: async ({ request }) => {
    const data = await request.formData();
    const id = String(data.get("id") ?? "").trim();
    if (!id) return fail(400, { error: "Provider ID is required" });

    const updates: Record<string, unknown> = {};
    const name = String(data.get("name") ?? "").trim();
    const apiKey = String(data.get("apiKey") ?? "").trim();
    const model = String(data.get("model") ?? "").trim();
    const baseUrlRaw = data.get("baseUrl");

    if (name) updates.name = name;
    if (model) updates.model = model;
    if (apiKey) updates.apiKey = apiKey;
    if (baseUrlRaw !== null)
      updates.baseUrl = String(baseUrlRaw).trim() || null;

    updateProvider(db, id, updates as Parameters<typeof updateProvider>[2]);

    return { success: true, action: "updateProvider" };
  },

  deleteProvider: async ({ request }) => {
    const data = await request.formData();
    const id = String(data.get("id") ?? "").trim();
    if (!id) return fail(400, { error: "Provider ID is required" });

    deleteProvider(db, id);

    return { success: true, action: "deleteProvider" };
  },

  saveIntelligence: async ({ request }) => {
    const data = await request.formData();
    const raw = String(data.get("providers") ?? "[]");

    type ExistingEntry = { id: string; enabled: boolean };
    type NewEntry = {
      isNew: true;
      tempId: string;
      type: string;
      name: string;
      apiKey: string;
      model: string;
      baseUrl: string | null;
      enabled: boolean;
    };

    const VALID_TYPES: ProviderType[] = [
      "openrouter",
      "google_ai_studio",
      "groq",
    ];

    let entries: (ExistingEntry | NewEntry)[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not array");
      entries = parsed.map((e) => {
        if (e?.isNew) {
          const tempId = String(e.tempId ?? "");
          if (!tempId) throw new Error("missing tempId");
          return {
            isNew: true,
            tempId,
            type: String(e.type ?? "").trim(),
            name: String(e.name ?? "").trim(),
            apiKey: String(e.apiKey ?? "").trim(),
            model: String(e.model ?? "").trim(),
            baseUrl: String(e.baseUrl ?? "").trim() || null,
            enabled: Boolean(e.enabled),
          } satisfies NewEntry;
        }
        return { id: String(e?.id ?? ""), enabled: Boolean(e?.enabled) };
      });
      if (entries.some((e) => !("isNew" in e) && !e.id))
        throw new Error("missing id");
    } catch {
      return fail(400, { error: "Invalid provider list data" });
    }

    const tempIdToRealId = new Map<string, string>();
    for (const e of entries) {
      if (!("isNew" in e)) continue;
      if (!VALID_TYPES.includes(e.type as ProviderType))
        return fail(400, { error: "Invalid provider type" });
      if (!e.name) return fail(400, { error: "Name is required" });
      if (!e.model) return fail(400, { error: "Model is required" });

      const created = insertProvider(db, {
        type: e.type as ProviderType,
        name: e.name,
        apiKey: e.apiKey,
        model: e.model,
        baseUrl: e.baseUrl ?? undefined,
      });
      tempIdToRealId.set(e.tempId, created.id);
    }

    const resolveId = (e: ExistingEntry | NewEntry) =>
      "isNew" in e ? tempIdToRealId.get(e.tempId)! : e.id;

    reorderProviders(db, entries.map(resolveId));

    const current = new Map(getAllProviders(db).map((p) => [p.id, p.enabled]));
    for (const e of entries) {
      const id = resolveId(e);
      if (current.get(id) !== e.enabled) {
        updateProvider(db, id, { enabled: e.enabled });
      }
    }

    const parallelTasks = Math.min(
      10,
      Math.max(1, parseInt(String(data.get("parallelTasks") ?? "3"), 10)),
    );
    const categoryHints = data.get("categoryHints") === "true";
    const rateLimitMs = Math.min(
      30000,
      Math.max(0, parseInt(String(data.get("rateLimitMs") ?? "0"), 10) || 0),
    );
    const customInstructions = String(data.get("customInstructions") ?? "")
      .trim()
      .slice(0, 2000);

    setSetting(db, SETTING_KEYS.autoImportParallelTasks, String(parallelTasks));
    setSetting(db, SETTING_KEYS.autoImportCategoryHints, String(categoryHints));
    setSetting(db, SETTING_KEYS.autoImportRateLimitMs, String(rateLimitMs));
    setSetting(
      db,
      SETTING_KEYS.autoImportCustomInstructions,
      customInstructions,
    );

    return { success: true, action: "saveIntelligence" };
  },
};
