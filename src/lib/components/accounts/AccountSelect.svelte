<script lang="ts">
  import type { AccountView } from './account-types.js';
  let { accounts, value = $bindable<number | null>(null), name, label = 'Account', required = true, type }:
    { accounts: AccountView[]; value?: number | null; name: string; label?: string; required?: boolean; type?: number } = $props();
  const choices = $derived(accounts.filter((account) => account.active && account.postingEligible && (type == null || account.type === type)));
</script>

<div class="field">
  <label class="field-label" for={`account-${name}`}>{label}{required ? ' *' : ''}</label>
  <select id={`account-${name}`} {name} bind:value {required} class="account-select">
    {#if !required}<option value={null}>None</option>{/if}
    {#each choices as account (account.id)}
      <option value={account.id}>{account.code} · {account.path.join(' › ')}</option>
    {/each}
  </select>
</div>

<style>
  .account-select { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--foreground); }
</style>
