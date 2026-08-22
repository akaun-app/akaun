<script lang="ts">
  import AccountStatements from "$lib/components/reconciliation/AccountStatements.svelte";

  let { data } = $props();
</script>

{#if data.account.active && data.account.postingEligible}
  <AccountStatements {data} />
{/if}
