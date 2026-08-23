import type {
  UpgradeReport,
  UpgradeState,
  VerifyResult,
} from "$lib/server/ledger/types.js";
import { AccountType } from "$lib/enums.js";
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
import { isMoneyPotAccount } from "$lib/server/ledger/account-type.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  defaultAccountId,
  listAccounts,
} from "$lib/server/queries/accounts.js";
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
import { getAccountDefaults } from "$lib/server/services/account-defaults.js";

/**
 * A category IS an account (FR-006a) — the everyday word on screen, the chart of
 * accounts underneath. There is no second list and no mapping between the two,
 * so what Settings offers and what an expense screen offers can never drift.
 */
export const load: PageServerLoad = async ({ locals }) => {
  // Categories are accounts, and accounts are created, renamed and archived on
  // the Accounts screen. Settings no longer lists them (FR-019, FR-020); this
  // one ability is still read, because the default-account setting below writes
  // an account (FR-011).
  const canManageAccounts = hasPermission(locals, "accounts", "change");

  // Which account new records start with, and the accounts it may be (FR-011).
  // With one account there is nothing to ask, so the setting stays off screen.
  // Money pots only: equipment is an asset but nothing is ever paid from it.
  const moneyAccounts = listAccounts(db, { type: AccountType.Asset })
    .filter(isMoneyPotAccount)
    .map((a) => ({
      id: a.id,
      name: a.name,
    }));
  const ledgerDefaultAccountId = defaultAccountId(db);
  const accountDefaults = getAccountDefaults(db);
  const defaultAccountOptions = listAccounts(db).map((account) => ({
    id: account.id,
    code: account.code ?? account.id,
    name: account.name,
    type: account.type,
    subType: account.subType,
    parentId: account.parentId ?? null,
    active: account.active ?? false,
    hasChildren: account.hasChildren ?? false,
    postingEligible: account.postingEligible ?? false,
    directBalanceMinor: account.directBalanceMinor ?? 0,
    rolledUpBalanceMinor: account.rolledUpBalanceMinor ?? 0,
    path: account.path ?? [account.name],
  }));

  // What the one-off update to the new way of recording did, and whether the
  // books balance. Only the part meant to be read is sent — the before/after
  // snapshot behind it is working data, not something to put on a screen.
  //
  // Read straight from the settings row now. The module that wrote it is
  // retired with the tables it converted (research.md R-06), but what it
  // recorded is still worth showing: it is the account of a one-off change to
  // this installation's own books, and nothing rewrites it.
  const canSeeBooks = hasPermission(locals, "reports", "view");
  const upgradeRaw = canSeeBooks
    ? getSetting(db, SETTING_KEYS.ledgerUpgradeState)
    : null;
  const emptyReport: UpgradeReport = {
    uncategorisedRecordIds: [],
    missingAttachments: [],
    roundingDifferences: [],
    payerAttributions: [],
    bankFallbackRecordIds: [],
    unrepointedAllocationIds: [],
  };
  let upgrade: {
    finishedAt: string | null;
    verify: VerifyResult | null;
    report: UpgradeReport;
  } | null = null;
  if (upgradeRaw) {
    try {
      const state = JSON.parse(upgradeRaw) as Partial<UpgradeState>;
      upgrade = {
        finishedAt: state.finishedAt ?? null,
        verify: state.verify ?? null,
        report: state.report ?? emptyReport,
      };
    } catch {
      // An unreadable row says nothing; the screen simply shows no notes.
      upgrade = null;
    }
  }

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
    canManageAccounts,
    moneyAccounts,
    ledgerDefaultAccountId,
    accountDefaults,
    defaultAccountOptions,
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
        listAccounts(db, { type: AccountType.Asset }).some(
          (a) => a.id === parsed.data && isMoneyPotAccount(a),
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
