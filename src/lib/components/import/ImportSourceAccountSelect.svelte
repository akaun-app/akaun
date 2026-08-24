<script lang="ts">
  import * as Select from "$lib/components/ui/select/index.js";
  import { groupImportSourceAccounts } from "$lib/import-account-groups.js";
  import type { AccountView } from "$lib/server/ledger/types.js";

  let {
    accounts,
    payableAccountId,
    value,
    incomeFirst = false,
    onChange,
  }: {
    accounts: AccountView[];
    payableAccountId: number | null;
    value: number | null;
    incomeFirst?: boolean;
    onChange: (value: number) => void;
  } = $props();

  const groups = $derived(
    groupImportSourceAccounts(accounts, payableAccountId),
  );
  const orderedGroups = $derived(
    incomeFirst
      ? [
          { label: "Income", accounts: groups.income },
          { label: "Payment", accounts: groups.payment },
        ]
      : [
          { label: "Payment", accounts: groups.payment },
          { label: "Income", accounts: groups.income },
        ],
  );

  function label(account: AccountView): string {
    return `${account.code} · ${(account.path ?? [account.name]).join(" › ")}`;
  }
</script>

<Select.Root
  type="single"
  value={value == null ? "" : String(value)}
  onValueChange={(next) => {
    const id = Number(next);
    if (Number.isInteger(id) && id > 0) onChange(id);
  }}
>
  <Select.Trigger class="rinput w-full">
    {#if value == null}
      Select account
    {:else}
      {@const selected = accounts.find((account) => account.id === value)}
      {selected ? label(selected) : "Select account"}
    {/if}
  </Select.Trigger>
  <Select.Content>
    {#each orderedGroups as group (group.label)}
      {#if group.accounts.length > 0}
        <Select.Group>
          <Select.GroupHeading>{group.label}</Select.GroupHeading>
          {#each group.accounts as account (account.id)}
            <Select.Item value={String(account.id)} label={label(account)} />
          {/each}
        </Select.Group>
      {/if}
    {/each}
  </Select.Content>
</Select.Root>
