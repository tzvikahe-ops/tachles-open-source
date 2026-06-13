<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api, ApiError } from "$lib/api";
  import Loading from "$lib/Loading.svelte";
  import type { ListSummary } from "$lib/types";

  let lists = $state<ListSummary[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let newName = $state("");
  let creating = $state(false);

  async function load() {
    try {
      const res = await api.get<{ lists: ListSummary[] }>("/lists");
      lists = res.lists;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    try {
      const res = await api.post<{ id: string }>("/lists", { name });
      newName = "";
      await goto(`/lists/${res.id}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה ביצירה";
    } finally {
      creating = false;
    }
  }

  onMount(load);
</script>

<h1 class="text-2xl font-bold mb-4">רשימות</h1>

<form
  class="flex gap-2 mb-4"
  onsubmit={(e) => {
    e.preventDefault();
    create();
  }}
>
  <input
    class="flex-1 rounded-xl border border-tg-secondary bg-tg-secondary px-3 py-2"
    placeholder="רשימה חדשה…"
    bind:value={newName}
  />
  <button
    type="submit"
    class="rounded-xl bg-tg-button text-tg-button-text px-4 py-2 disabled:opacity-50"
    disabled={creating || !newName.trim()}
  >
    הוסף
  </button>
</form>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if lists.length === 0}
  <p class="text-tg-hint text-sm">אין רשימות עדיין.</p>
{:else}
  <ul class="space-y-2">
    {#each lists as list (list.id)}
      <li>
        <a
          href={`/lists/${list.id}`}
          class="flex justify-between items-center bg-tg-secondary rounded-xl p-3"
        >
          <span class="font-medium">{list.name}</span>
          <span class="text-sm text-tg-hint">{list.item_count}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
