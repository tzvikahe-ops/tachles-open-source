<script lang="ts">
  let { rows = 3 }: { rows?: number } = $props();
</script>

<div class="space-y-2" aria-busy="true" aria-label="טוען">
  {#each Array(rows) as _, i (i)}
    <div class="bg-tg-secondary rounded-xl p-3 animate-pulse">
      <div class="h-4 bg-tg-hint/20 rounded w-2/3"></div>
      <div class="h-3 bg-tg-hint/20 rounded w-1/3 mt-2"></div>
    </div>
  {/each}
</div>
