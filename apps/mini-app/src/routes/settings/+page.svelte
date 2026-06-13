<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import Loading from "$lib/Loading.svelte";
  import type { Me } from "$lib/types";

  let me = $state<Me | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      me = await api.get<Me>("/me");
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  });
</script>

<h1 class="text-2xl font-bold mb-4">הגדרות</h1>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if me}
  <div class="space-y-3">
    <div class="bg-tg-secondary rounded-xl p-3 flex justify-between">
      <span class="text-tg-hint">שם</span>
      <span class="font-medium">{me.display_name ?? "—"}</span>
    </div>
    <div class="bg-tg-secondary rounded-xl p-3 flex justify-between">
      <span class="text-tg-hint">אזור זמן</span>
      <span class="font-medium">{me.timezone}</span>
    </div>
    <div class="bg-tg-secondary rounded-xl p-3 flex justify-between">
      <span class="text-tg-hint">Google Calendar</span>
      <span class="font-medium">
        {me.google_connected ? "✅ מחובר" : "לא מחובר"}
      </span>
    </div>
    {#if !me.google_connected}
      <p class="text-sm text-tg-hint">
        לחיבור יומן Google, שלחו <code>/connect</code> לבוט בצ'אט.
      </p>
    {/if}

    <a
      href="/agents"
      class="block bg-tg-secondary rounded-xl p-3 flex justify-between items-center"
    >
      <span class="font-medium">🤖 סוכנים פרואקטיביים</span>
      <span class="text-tg-hint">‹</span>
    </a>

  </div>
{/if}
