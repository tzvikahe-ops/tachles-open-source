<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { formatTime, formatDay, dayKey } from "$lib/format";
  import Loading from "$lib/Loading.svelte";
  import type { StoredEvent } from "$lib/types";

  let events = $state<StoredEvent[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);

  // Next 14 days from now.
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString();

  const grouped = $derived.by(() => {
    const map = new Map<string, StoredEvent[]>();
    for (const ev of events) {
      const key = dayKey(ev.start_at);
      const bucket = map.get(key) ?? [];
      bucket.push(ev);
      map.set(key, bucket);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  onMount(async () => {
    try {
      const res = await api.get<{ events: StoredEvent[] }>(
        `/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      events = res.events;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  });
</script>

<h1 class="text-2xl font-bold mb-4">יומן</h1>

{#if loading}
  <Loading rows={4} />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if events.length === 0}
  <p class="text-tg-hint text-sm">אין אירועים בשבועיים הקרובים.</p>
{:else}
  {#each grouped as [key, dayEvents] (key)}
    <section class="mb-5">
      <h2 class="text-sm font-semibold text-tg-hint mb-2">
        {formatDay(dayEvents[0].start_at)}
      </h2>
      <ul class="space-y-2">
        {#each dayEvents as ev (ev.id)}
          <li class="bg-tg-secondary rounded-xl p-3">
            <div class="flex justify-between gap-2">
              <span class="font-medium">{ev.title}</span>
              <span class="text-sm text-tg-hint whitespace-nowrap">
                {ev.all_day ? "כל היום" : formatTime(ev.start_at)}
              </span>
            </div>
            {#if ev.location}
              <div class="text-sm text-tg-hint mt-1">📍 {ev.location}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{/if}
