<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { fade } from "svelte/transition";
  import Loading from "$lib/Loading.svelte";
  import type { BubbleSummary, BubbleType } from "$lib/types";

  let memories = $state<BubbleSummary[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let filter = $state<BubbleType | "">("");
  let query = $state("");
  let newContent = $state("");
  let busy = $state(false);

  const TYPE_META: Record<BubbleType, { emoji: string; label: string }> = {
    knowledge: { emoji: "📚", label: "ידע" },
    inspiration: { emoji: "💡", label: "השראה" },
    reflection: { emoji: "🪞", label: "הרהור" },
  };

  const chips: ({ value: BubbleType | ""; label: string })[] = [
    { value: "", label: "הכל" },
    { value: "knowledge", label: "📚 ידע" },
    { value: "inspiration", label: "💡 השראה" },
    { value: "reflection", label: "🪞 הרהור" },
  ];

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (filter) params.set("filter", filter);
      const qs = params.toString();
      const res = await api.get<{ memories: BubbleSummary[] }>(
        `/memories${qs ? `?${qs}` : ""}`,
      );
      memories = res.memories;
      error = null;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  }

  function setFilter(value: BubbleType | "") {
    filter = value;
    load();
  }

  async function add() {
    const content = newContent.trim();
    if (!content || busy) return;
    busy = true;
    try {
      await api.post("/memories", { content });
      newContent = "";
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בשמירה";
    } finally {
      busy = false;
    }
  }

  async function remove(b: BubbleSummary) {
    try {
      await api.del(`/memories/${b.id}`);
      memories = memories.filter((m) => m.id !== b.id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה במחיקה";
    }
  }

  onMount(load);
</script>

<h1 class="text-2xl font-bold mb-4">בועות זיכרון</h1>

<form
  class="flex gap-2 mb-3"
  onsubmit={(e) => {
    e.preventDefault();
    add();
  }}
>
  <input
    class="flex-1 rounded-xl border border-tg-secondary bg-tg-secondary px-3 py-2"
    placeholder="בועה חדשה…"
    bind:value={newContent}
  />
  <button
    type="submit"
    class="rounded-xl bg-tg-button text-tg-button-text px-4 py-2 disabled:opacity-50"
    disabled={busy || !newContent.trim()}
  >
    שמור
  </button>
</form>

<form
  class="mb-3"
  onsubmit={(e) => {
    e.preventDefault();
    load();
  }}
>
  <input
    class="w-full rounded-xl border border-tg-secondary bg-tg-secondary px-3 py-2"
    placeholder="🔍 חיפוש סמנטי…"
    bind:value={query}
  />
</form>

<div class="flex gap-2 mb-4 overflow-x-auto">
  {#each chips as chip (chip.value)}
    <button
      type="button"
      class="whitespace-nowrap rounded-full px-3 py-1 text-sm
             {filter === chip.value
        ? 'bg-tg-button text-tg-button-text'
        : 'bg-tg-secondary text-tg-hint'}"
      onclick={() => setFilter(chip.value)}
    >
      {chip.label}
    </button>
  {/each}
</div>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if memories.length === 0}
  <p class="text-tg-hint text-sm">אין בועות.</p>
{:else}
  <ul class="space-y-2">
    {#each memories as b (b.id)}
      <li class="bg-tg-secondary rounded-xl p-3" transition:fade={{ duration: 150 }}>
        <div class="flex justify-between gap-2">
          <span class="text-sm text-tg-hint">
            {TYPE_META[b.type].emoji} {TYPE_META[b.type].label}
          </span>
          <button
            type="button"
            class="text-tg-hint text-sm"
            onclick={() => remove(b)}
            aria-label="מחק"
          >
            🗑️
          </button>
        </div>
        {#if b.title}
          <div class="font-medium mt-1">{b.title}</div>
        {/if}
        <p class="mt-1 whitespace-pre-wrap">{b.content}</p>
        {#if b.tags.length}
          <div class="mt-2 text-sm text-tg-link">
            {#each b.tags as tag (tag)}<span class="me-2">#{tag}</span>{/each}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
