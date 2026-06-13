<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api";
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import Loading from "$lib/Loading.svelte";
  import type { TaskStatus, TaskSummary } from "$lib/types";

  let tasks = $state<TaskSummary[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let newTitle = $state("");
  let busy = $state(false);

  const STATUS_META: Record<TaskStatus, { emoji: string; label: string }> = {
    todo: { emoji: "⚪", label: "לעשות" },
    doing: { emoji: "🔵", label: "בתהליך" },
    done: { emoji: "✅", label: "הושלם" },
  };

  const PRIORITY_EMOJI = ["⚪", "🟡", "🔴"];

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ tasks: TaskSummary[] }>("/tasks");
      tasks = res.tasks;
      error = null;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בטעינה";
    } finally {
      loading = false;
    }
  }

  async function create() {
    const title = newTitle.trim();
    if (!title || busy) return;
    busy = true;
    try {
      await api.post("/tasks", { title });
      newTitle = "";
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה ביצירה";
    } finally {
      busy = false;
    }
  }

  async function cycle(task: TaskSummary, action: "status" | "priority") {
    try {
      const res = await api.patch<{ task: TaskSummary }>(`/tasks/${task.id}`, { action });
      // status change may move a task to "done" (it drops out of the board on reload).
      if (action === "status" && res.task.status === "done") {
        tasks = tasks.filter((t) => t.id !== task.id);
      } else {
        Object.assign(task, res.task);
      }
    } catch (e) {
      error = e instanceof ApiError ? e.message : "שגיאה בעדכון";
    }
  }

  onMount(load);
</script>

<svelte:head><title>משימות</title></svelte:head>

<h1 class="text-2xl font-bold mb-4">משימות</h1>

<form
  class="flex gap-2 mb-4"
  onsubmit={(e) => {
    e.preventDefault();
    create();
  }}
>
  <input
    class="flex-1 rounded-xl border border-tg-secondary bg-tg-secondary px-3 py-2"
    placeholder="משימה חדשה…"
    bind:value={newTitle}
  />
  <button
    type="submit"
    class="rounded-xl bg-tg-button text-tg-button-text px-4 py-2 disabled:opacity-50"
    disabled={busy || !newTitle.trim()}
  >
    הוסף
  </button>
</form>

{#if loading}
  <Loading />
{:else if error}
  <p class="text-red-500">{error}</p>
{:else if tasks.length === 0}
  <p class="text-tg-hint text-sm">אין משימות פתוחות.</p>
{:else}
  <ul class="space-y-2">
    {#each tasks as task (task.id)}
      <li
        class="flex items-center gap-2 bg-tg-secondary rounded-xl p-3"
        animate:flip={{ duration: 200 }}
        transition:fade={{ duration: 150 }}
      >
        <button
          type="button"
          class="text-xl"
          onclick={() => cycle(task, "status")}
          aria-label="שנה סטטוס"
        >
          {STATUS_META[task.status].emoji}
        </button>
        <span class="flex-1">{task.title}</span>
        <button
          type="button"
          class="text-xl"
          onclick={() => cycle(task, "priority")}
          aria-label="שנה עדיפות"
        >
          {PRIORITY_EMOJI[task.priority] ?? "⚪"}
        </button>
      </li>
    {/each}
  </ul>
{/if}
