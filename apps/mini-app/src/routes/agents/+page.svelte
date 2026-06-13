<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import Loading from "$lib/Loading.svelte";
  import type { AgentSummary } from "$lib/types";

  let agents = $state<AgentSummary[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);

  const HEBREW: Record<string, string> = {
    chief_of_staff: "ראש המטה",
    anti_chaos: "אנטי-כאוס",
    health_intelligence: "תובנות בריאות",
  };

  async function load() {
    try {
      const res = await api.get<{ agents: AgentSummary[] }>("/agents");
      agents = res.agents;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  }

  async function toggle(agent: AgentSummary) {
    const next = !agent.enabled;
    agent.enabled = next; // optimistic
    try {
      await api.patch(`/agents/${agent.id}`, { enabled: next });
    } catch (e) {
      agent.enabled = !next;
      error = e instanceof ApiError ? e.message : "שגיאה בעדכון";
    }
  }

  onMount(load);
</script>

<a href="/settings" class="text-tg-link text-sm">← הגדרות</a>
<h1 class="text-2xl font-bold mt-1 mb-4">סוכנים פרואקטיביים</h1>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if agents.length === 0}
  <p class="text-tg-hint text-sm">אין סוכנים רשומים.</p>
{:else}
  <ul class="space-y-2">
    {#each agents as agent (agent.id)}
      <li class="flex items-center gap-3 bg-tg-secondary rounded-xl p-3">
        <div class="flex-1">
          <div class="font-medium">{HEBREW[agent.name] ?? agent.name}</div>
          <div class="text-sm text-tg-hint">{agent.role}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={agent.enabled}
          aria-label="הפעל/כבה"
          class="w-12 h-7 rounded-full transition-colors shrink-0 relative
                 {agent.enabled ? 'bg-tg-button' : 'bg-gray-400'}"
          onclick={() => toggle(agent)}
        >
          <span
            class="absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all
                   {agent.enabled ? 'start-0.5' : 'end-0.5'}"
          ></span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
