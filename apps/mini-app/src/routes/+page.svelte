<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { hapticSelection, isTelegram } from "$lib/tg";
  import { formatRelative, formatTime, greetingForHour } from "$lib/format";
  import Loading from "$lib/Loading.svelte";
  import type { HomeData } from "$lib/types";

  let data = $state<HomeData | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  const EVENT_LABELS: Record<string, string> = {
    reminder_created: "תזכורת נוצרה",
    reminder_sent: "תזכורת נשלחה",
    bubble_created: "בועה נשמרה",
    task_created: "משימה נוצרה",
    list_item_added: "פריט נוסף לרשימה",
    health_logged: "בריאות נרשמה",
    message_in: "הודעה",
    command: "פקודה",
  };

  const EVENT_ICONS: Record<string, string> = {
    reminder_created: "🔔",
    reminder_sent: "🔔",
    bubble_created: "🧠",
    task_created: "✅",
    list_item_added: "📝",
    health_logged: "❤️",
    message_in: "💬",
    command: "⌘",
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = greetingForHour(hour);

  // First word of display_name only; falls back gracefully.
  function firstName(name: string | null): string {
    if (!name) return "";
    return name.trim().split(/\s+/)[0] ?? "";
  }

  onMount(async () => {
    try {
      data = await api.get<HomeData>("/home");
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  });
</script>

{#if !isTelegram()}
  <p class="text-tg-hint text-sm">
    יש לפתוח את האפליקציה מתוך טלגרם (כפתור התפריט של הבוט).
  </p>
{:else if loading}
  <Loading rows={4} />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if data}
  <!-- Hero greeting -->
  <header class="mb-5">
    <div class="text-2xl font-bold leading-tight">
      {greeting}{#if firstName(data.display_name)}, {firstName(data.display_name)}{/if} 👋
    </div>
    <div class="text-sm text-tg-hint mt-0.5">
      {new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(now)}
    </div>
  </header>

  <!-- Counts strip -->
  <div class="grid grid-cols-3 gap-2 mb-6">
    <a
      href="/calendar"
      onclick={() => hapticSelection()}
      class="bg-tg-secondary rounded-2xl p-3 flex flex-col items-start gap-1 active:scale-[0.98] transition-transform"
    >
      <span class="text-xl">📅</span>
      <span class="text-2xl font-bold leading-none">{data.events_today.length}</span>
      <span class="text-xs text-tg-hint">היום</span>
    </a>
    <button
      type="button"
      onclick={() => { hapticSelection(); document.getElementById("reminders-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
      class="bg-tg-secondary rounded-2xl p-3 flex flex-col items-start gap-1 active:scale-[0.98] transition-transform text-right"
    >
      <span class="text-xl">🔔</span>
      <span class="text-2xl font-bold leading-none">{data.reminders_next.length}</span>
      <span class="text-xs text-tg-hint">תזכורות</span>
    </button>
    <a
      href="/tasks"
      onclick={() => hapticSelection()}
      class="bg-tg-secondary rounded-2xl p-3 flex flex-col items-start gap-1 active:scale-[0.98] transition-transform"
    >
      <span class="text-xl">✅</span>
      <span class="text-2xl font-bold leading-none">{data.tasks_open}</span>
      <span class="text-xs text-tg-hint">משימות</span>
    </a>
  </div>

  <!-- Today's events -->
  <section class="mb-6">
    <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
      <span>📅</span><span>היום</span>
    </h2>
    {#if data.events_today.length === 0}
      <div class="border border-dashed border-tg-secondary rounded-2xl p-5 text-center">
        <div class="text-3xl mb-1">🌤️</div>
        <p class="text-sm text-tg-hint">היום פנוי. רגוע.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.events_today as ev (ev.id)}
          <li class="bg-tg-secondary rounded-2xl p-3 flex items-start gap-3">
            <div class="flex flex-col items-center min-w-12 pt-0.5">
              {#if ev.all_day}
                <span class="text-xs text-tg-hint">כל היום</span>
              {:else}
                <span class="font-bold text-base leading-tight">{formatTime(ev.start_at)}</span>
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{ev.title}</div>
              {#if ev.location}
                <div class="text-xs text-tg-hint truncate mt-0.5">📍 {ev.location}</div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Upcoming reminders -->
  <section class="mb-6" id="reminders-section">
    <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
      <span>🔔</span><span>תזכורות קרובות</span>
    </h2>
    {#if data.reminders_next.length === 0}
      <div class="border border-dashed border-tg-secondary rounded-2xl p-5 text-center">
        <div class="text-3xl mb-1">✨</div>
        <p class="text-sm text-tg-hint">אין תזכורות פעילות.</p>
        <p class="text-xs text-tg-hint mt-1">כתבו לבוט: "תזכיר לי מחר ב-9 לקרוא לאמא"</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.reminders_next as r (r.id)}
          <li class="bg-tg-secondary rounded-2xl p-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{r.title}</div>
              {#if r.run_at}
                <div class="text-xs text-tg-hint mt-0.5">{formatRelative(r.run_at)}</div>
              {/if}
            </div>
            {#if r.schedule_type === "recurring"}
              <span class="text-xs text-tg-hint shrink-0">↻</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Recent activity -->
  <section>
    <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
      <span>📥</span><span>לאחרונה</span>
    </h2>
    {#if data.inbox.length === 0}
      <p class="text-tg-hint text-sm">אין פעילות אחרונה.</p>
    {:else}
      <ul class="space-y-0.5">
        {#each data.inbox as e (e.id)}
          <li class="flex items-center gap-2 text-sm py-2 border-b border-tg-secondary last:border-0">
            <span class="text-base shrink-0">{EVENT_ICONS[e.kind] ?? "•"}</span>
            <span class="flex-1 truncate">{EVENT_LABELS[e.kind] ?? e.kind}</span>
            <span class="text-tg-hint text-xs shrink-0">{formatRelative(e.occurred_at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
