<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { api, ApiError } from "$lib/api";
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import Loading from "$lib/Loading.svelte";
  import type { ListItem } from "$lib/types";

  const listId = $derived($page.params.id);

  let name = $state("");
  let items = $state<ListItem[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let newItem = $state("");
  let busy = $state(false);

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ list: { id: string; name: string }; items: ListItem[] }>(
        `/lists/${listId}`,
      );
      name = res.list.name;
      items = res.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  }

  async function addItem() {
    const content = newItem.trim();
    if (!content || busy) return;
    busy = true;
    try {
      await api.post(`/lists/${listId}/items`, { items: [content] });
      newItem = "";
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בהוספה";
    } finally {
      busy = false;
    }
  }

  async function toggle(item: ListItem) {
    // Optimistic flip; reload on failure.
    item.is_done = !item.is_done;
    try {
      await api.patch(`/items/${item.id}`, { action: "toggle" });
    } catch {
      await load();
    }
  }

  async function remove(item: ListItem) {
    try {
      await api.del(`/items/${item.id}`);
      items = items.filter((i) => i.id !== item.id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה במחיקה";
    }
  }

  onMount(load);
</script>

<a href="/lists" class="text-tg-link text-sm">← רשימות</a>
<h1 class="text-2xl font-bold mt-1 mb-4">{name || "רשימה"}</h1>

<form
  class="flex gap-2 mb-4"
  onsubmit={(e) => {
    e.preventDefault();
    addItem();
  }}
>
  <input
    class="flex-1 rounded-xl border border-tg-secondary bg-tg-secondary px-3 py-2"
    placeholder="פריט חדש…"
    bind:value={newItem}
  />
  <button
    type="submit"
    class="rounded-xl bg-tg-button text-tg-button-text px-4 py-2 disabled:opacity-50"
    disabled={busy || !newItem.trim()}
  >
    הוסף
  </button>
</form>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if items.length === 0}
  <p class="text-tg-hint text-sm">הרשימה ריקה.</p>
{:else}
  <ul class="space-y-1">
    {#each items as item (item.id)}
      <li
        class="flex items-center gap-3 bg-tg-secondary rounded-xl p-3"
        animate:flip={{ duration: 200 }}
        transition:fade={{ duration: 150 }}
      >
        <input
          type="checkbox"
          checked={item.is_done}
          onchange={() => toggle(item)}
          class="w-5 h-5 shrink-0"
        />
        <span class="flex-1 {item.is_done ? 'line-through text-tg-hint' : ''}">
          {item.content}
        </span>
        <button
          type="button"
          class="text-tg-hint text-sm"
          onclick={() => remove(item)}
          aria-label="מחק"
        >
          🗑️
        </button>
      </li>
    {/each}
  </ul>
{/if}
