<script lang="ts">
  import RecordsPage from "$lib/components/records/RecordsPage.svelte";

  let { data, form } = $props();
</script>

<RecordsPage {data} {form} openId={null} />
