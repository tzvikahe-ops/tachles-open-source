<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { getStartParam, hapticSelection, initTelegram } from "$lib/tg";

  let { children } = $props();

  // Map a deep-link `startapp` value to a route (t.me/<bot>/<app>?startapp=...).
  function startParamToPath(param: string): string | null {
    if (param.startsWith("list_")) return `/lists/${param.slice(5)}`;
    const known = ["calendar", "lists", "tasks", "memories", "agents", "settings"];
    return known.includes(param) ? `/${param}` : null;
  }

  onMount(() => {
    initTelegram();
    const param = getStartParam();
    if (param) {
      const target = startParamToPath(param);
      if (target && $page.url.pathname === "/") goto(target);
    }
  });

  const tabs = [
    { href: "/", label: "בית", icon: "🏠" },
    { href: "/calendar", label: "יומן", icon: "📅" },
    { href: "/lists", label: "רשימות", icon: "📝" },
    { href: "/tasks", label: "משימות", icon: "✅" },
    { href: "/memories", label: "בועות", icon: "🧠" },
    { href: "/agents", label: "סוכנים", icon: "🤖" },
  ];

  function isActive(href: string, path: string): boolean {
    return href === "/" ? path === "/" : path.startsWith(href);
  }
</script>

<div class="min-h-screen flex flex-col bg-tg-bg text-tg-text">
  <header
    class="sticky top-0 z-10 bg-tg-bg/95 backdrop-blur border-b border-tg-secondary
           max-w-xl mx-auto w-full flex items-center justify-between px-4 py-2"
  >
    <span class="font-bold">תכלס</span>
    <a
      href="/settings"
      class="text-xl {$page.url.pathname.startsWith('/settings') ? 'opacity-100' : 'opacity-70'}"
      aria-label="הגדרות"
    >
      ⚙️
    </a>
  </header>

  <main class="flex-1 px-4 pt-4 pb-24 max-w-xl mx-auto w-full">
    {#key $page.url.pathname}
      <div in:fade={{ duration: 120 }}>
        {@render children()}
      </div>
    {/key}
  </main>

  <nav
    class="fixed bottom-0 inset-x-0 border-t border-tg-secondary
           bg-tg-bg/95 backdrop-blur
           max-w-xl mx-auto flex justify-around px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
  >
    {#each tabs as tab (tab.href)}
      {@const active = isActive(tab.href, $page.url.pathname)}
      <a
        href={tab.href}
        onclick={() => hapticSelection()}
        class="relative flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-[10px]
               transition-colors duration-150
               {active
          ? 'text-tg-link font-semibold bg-tg-secondary'
          : 'text-tg-hint hover:text-tg-text'}"
      >
        <span class="text-lg leading-none {active ? '' : 'opacity-80'}">{tab.icon}</span>
        <span class="leading-none">{tab.label}</span>
      </a>
    {/each}
  </nav>
</div>
