<script lang="ts">
  import * as Select from "$lib/components/ui/select/index.js";
  import type { AccountView } from "$lib/server/ledger/types.js";

  /**
   * One side of a transfer on an import review card (006 FR-058): an account
   * that holds money, such as the bank, cash, a card or the marketplace
   * wallet. The server sends the accounts that can be one (`transferAccounts`)
   * and the card leaves out the other side, so the two always differ. The
   * server checks the pair again on save and on confirm.
   */
  let {
    accounts,
    value,
    label,
    onChange,
  }: {
    accounts: AccountView[];
    value: number | null;
    /** What the select is, for a screen reader: "Transfer from", say. */
    label: string;
    onChange: (value: number) => void;
  } = $props();

  function name(account: AccountView): string {
    return `${account.code} · ${account.name}`;
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
  <Select.Trigger class="rinput w-full" aria-label={label}>
    {#if value == null}
      Select account
    {:else}
      {@const selected = accounts.find((account) => account.id === value)}
      {selected ? name(selected) : "Select account"}
    {/if}
  </Select.Trigger>
  <Select.Content>
    {#each accounts as account (account.id)}
      <Select.Item value={String(account.id)} label={name(account)} />
    {/each}
  </Select.Content>
</Select.Root>
