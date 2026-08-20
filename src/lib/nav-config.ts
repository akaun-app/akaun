import {
  LayoutDashboard,
  Wallet,
  Upload,
  Users,
  ScrollText,
  Receipt,
  Landmark,
  ChartColumn,
} from "@lucide/svelte";
import type { Component } from "svelte";
import type { ResourceName } from "$lib/server/permissions.js";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  Icon: Component<{ size?: number | string }>;
  resource: ResourceName;
};

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    Icon: LayoutDashboard,
    resource: "dashboard",
  },
  // One list of everything that happened with money. Expenses, Income and
  // Journal were three doors into one store, and a transfer belonged to none of
  // them (FR-007, FR-023).
  {
    id: "records",
    label: "Records",
    href: "/records",
    Icon: Wallet,
    resource: "records",
  },
  {
    id: "quotations",
    label: "Quotations",
    href: "/quotations",
    Icon: ScrollText,
    resource: "quotations",
  },
  {
    id: "invoices",
    label: "Invoices",
    href: "/invoices",
    Icon: Receipt,
    resource: "invoices",
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
    Icon: Users,
    resource: "contacts",
  },
  {
    id: "import",
    label: "Auto Import",
    href: "/import",
    Icon: Upload,
    resource: "import",
  },
  // Reconciliation is not a menu item any more: a statement always belonged to
  // exactly one account, so reconciling is reached from that account's drawer
  // at /accounts/[id]/reconcile (FR-023, FR-048).
  {
    id: "accounts",
    label: "Accounts",
    href: "/accounts",
    Icon: Landmark,
    resource: "accounts",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    Icon: ChartColumn,
    resource: "reports",
  },
];

export const MAX_MOBILE_NAV_ITEMS = 5;

// First-time default for users with no saved preference yet — the busiest
// items, kept under MAX_MOBILE_NAV_ITEMS so the cap isn't immediately maxed out.
export const DEFAULT_MOBILE_VISIBLE_IDS = new Set([
  "dashboard",
  "records",
  "import",
]);

// Icon is a Svelte component and isn't serializable through SvelteKit's `load`
// data — server code passes this plain shape down, and client components
// look up the Icon back from DEFAULT_NAV_ITEMS by id.
export type SerializableNavItem = Omit<NavItem, "Icon">;

export const NAV_ICONS_BY_ID: Record<string, NavItem["Icon"]> =
  Object.fromEntries(DEFAULT_NAV_ITEMS.map((item) => [item.id, item.Icon]));
