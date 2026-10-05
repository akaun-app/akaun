<script lang="ts">
  import ContactSelect from "$lib/components/ui/ContactSelect.svelte";
  import type { Role } from "$lib/enums.js";

  let {
    role,
    disabled = false,
    initialLabel,
    matchedContactId,
    suggestions,
    onChange,
  }: {
    role: typeof Role.Supplier | typeof Role.Customer;
    disabled?: boolean;
    initialLabel: string | null;
    matchedContactId: number | null;
    suggestions: { id: number; legalName: string; score?: number }[];
    onChange: (selection: {
      value: number | null;
      newName: string | null;
    }) => void;
  } = $props();

  let selection = $state<{
    value: number | null;
    newName: string | null;
  } | null>(null);
  let outcome = $state<"existing" | "new" | null>(null);
  const value = $derived(selection ? selection.value : matchedContactId);
  const name = $derived(selection ? selection.newName : initialLabel);
  const lookupKey = $derived(
    value != null ? `id:${value}` : `${role}:${name?.trim() ?? ""}`,
  );
  let resolvedKey = $state("");

  // Use the same role-scoped name lookup as confirmation. Fuzzy suggestions
  // alone do not mean the import will reuse a contact.
  $effect(() => {
    const key = lookupKey;
    outcome = null;
    resolvedKey = "";
    if (value != null) {
      outcome = "existing";
      resolvedKey = key;
      return;
    }
    if (!name?.trim()) return;
    const controller = new AbortController();
    fetch("/api/import/contact-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result: { existing: boolean } = await response.json();
        if (controller.signal.aborted) return;
        outcome = result.existing ? "existing" : "new";
        resolvedKey = key;
      })
      .catch(() => {
        /* Leave unresolved contacts without a badge. */
      });
    return () => controller.abort();
  });
</script>

<ContactSelect
  {role}
  {disabled}
  {value}
  newName={selection?.newName ?? null}
  {initialLabel}
  {suggestions}
  onChange={(next) => {
    selection = next;
    onChange(next);
  }}
/>
<div aria-live="polite">
  {#if resolvedKey === lookupKey && outcome}
    <span class="contact-outcome"
      >{outcome === "existing"
        ? "Existing contact"
        : "Will create new contact"}</span
    >
  {/if}
</div>

<style>
  .contact-outcome {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: var(--secondary);
    color: var(--secondary-foreground);
    font-size: 11.5px;
    font-weight: 500;
  }
</style>
