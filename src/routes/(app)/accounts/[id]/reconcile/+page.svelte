<script lang="ts">
  import AccountStatements from "$lib/components/reconciliation/AccountStatements.svelte";

  let { data } = $props();
</script>

<AccountStatements {data} />
