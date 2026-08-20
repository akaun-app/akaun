<script lang="ts">
  import CategoriesPage from "$lib/components/accounts/CategoriesPage.svelte";

  let { data, form } = $props();
</script>

<CategoriesPage {data} {form} openId={data.openAccountId} />
