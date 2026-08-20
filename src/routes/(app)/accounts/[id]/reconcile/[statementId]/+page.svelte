<script lang="ts">
  import StatementMatch from "$lib/components/reconciliation/StatementMatch.svelte";

  let { data } = $props();
</script>

<StatementMatch {data} />
