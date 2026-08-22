<script lang="ts">
  import { toast } from "svelte-sonner";
  import type {
    AccountDefaultView,
    AccountView,
  } from "$lib/components/accounts/account-types.js";

  let {
    defaults,
    accounts,
    disabled = false,
  }: {
    defaults: AccountDefaultView[];
    accounts: AccountView[];
    disabled?: boolean;
  } = $props();

  const labels: Record<number, { title: string; help: string }> = {
    1: {
      title: "Accounts receivable",
      help: "Used when an invoice is sent or a customer pays.",
    },
    2: {
      title: "Accounts payable",
      help: "Used when somebody else pays a business expense.",
    },
    3: {
      title: "Opening balances",
      help: "Balances the amounts present when these books begin.",
    },
    4: {
      title: "Sales revenue",
      help: "Used when an invoice does not choose another revenue account.",
    },
    5: {
      title: "Uncategorised expense",
      help: "Used when an imported expense has no matching expense account.",
    },
    6: {
      title: "Default transaction account",
      help: "The account new income and expenses default to.",
    },
  };
  // svelte-ignore state_referenced_locally
  let selected = $state<Record<number, number>>(
    Object.fromEntries(
      defaults.map((item) => [item.purpose, item.account?.id ?? 0]),
    ),
  );
  let saving = $state(false);

  async function save() {
    saving = true;
    try {
      const response = await fetch("/api/settings/account-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaults: defaults.map((item) => ({
            purpose: item.purpose,
            accountId: selected[item.purpose],
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.reason ??
            body.error ??
            "The default accounts could not be updated.",
        );
      }
      toast.success("Default accounts updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The default accounts could not be updated.",
      );
    } finally {
      saving = false;
    }
  }
</script>

<section class="rounded-xl border border-border bg-card p-5">
  <h2 class="text-base font-semibold">Default accounts</h2>
  <p class="mt-1 text-sm text-muted-foreground">
    Choose where the app records each automatic side of a transaction.
  </p>
  <div class="mt-5 grid gap-4 md:grid-cols-2">
    {#each defaults as item (item.purpose)}
      <label class="grid gap-1.5 text-sm">
        <span class="font-medium">{labels[item.purpose].title}</span>
        <span class="text-xs text-muted-foreground"
          >{labels[item.purpose].help}</span
        >
        <select
          class="h-10 rounded-md border border-input bg-background px-3"
          bind:value={selected[item.purpose]}
          disabled={disabled || saving}
        >
          <option value={0}>Choose an account</option>
          {#each accounts.filter((account) => account.type === item.requiredType && account.postingEligible) as account (account.id)}
            <option value={account.id}
              >{account.code} — {account.path.join(" › ")}</option
            >
          {/each}
        </select>
      </label>
    {/each}
  </div>
  <button
    type="button"
    class="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
    disabled={disabled ||
      saving ||
      defaults.some((item) => !selected[item.purpose])}
    onclick={save}
  >
    {saving ? "Saving…" : "Save defaults"}
  </button>
</section>
