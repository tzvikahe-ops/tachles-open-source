import { createServiceClient } from "../_shared/supabase.ts";
import { requireHeaderSecret } from "../_shared/request_auth.ts";
import {
  cronDue,
  getAgentModule,
  lastRunAt,
  listEnabledAgents,
  listProfiles,
  needsAntiChaosAdHoc,
  needsHealthAdHoc,
} from "../_shared/agents/registry.ts";
import { runAgent } from "../_shared/agents/runner.ts";
// Importing each agent module here is what registers it in the registry.
import "../_shared/agents/chief_of_staff.ts";
import "../_shared/agents/anti_chaos.ts";
import "../_shared/agents/health_intelligence.ts";
import "../_shared/agents/smart_morning.ts";

// Cron entry point: every 15 minutes pg_cron POSTs here. We walk all enabled
// agents × all profiles and fire those whose cron expression matches the
// current minute in the user's local timezone. Trigger-only agents (no
// schedule_cron) are skipped here; they fire from the webhook directly.
// After the scheduled pass we also run ad-hoc triggers (overload, health
// streak) so important signals don't wait for the next cron window.

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  const authError = requireHeaderSecret(
    expected,
    req.headers.get("x-dispatch-secret"),
  );
  if (authError) return authError;

  const supabase = createServiceClient();
  const now = new Date();
  const agents = await listEnabledAgents(supabase);
  const profiles = await listProfiles(supabase);

  let fired = 0;
  let sent = 0;
  let adhocFired = 0;
  let adhocSent = 0;

  for (const agent of agents) {
    if (!agent.schedule_cron) continue;
    const mod = getAgentModule(agent.name);
    if (!mod) continue;
    // Use the module's prompt at runtime so we don't have to migrate to edit it.
    const liveAgent = { ...agent, system_prompt: mod.systemPrompt };
    for (const profile of profiles) {
      const last = await lastRunAt(supabase, agent.id, profile.id);
      if (!cronDue(agent.schedule_cron, now, last, profile.timezone)) continue;
      fired++;
      try {
        const result = await runAgent(
          supabase,
          liveAgent,
          profile,
          mod.loadContext,
          mod.actionKeyboard,
        );
        if (result.status === "sent") sent++;
      } catch (err) {
        console.error(`agent ${agent.name} for ${profile.id} threw:`, err);
      }
    }
  }

  // Ad-hoc triggers — only for the two agents that support them today.
  const antiChaos = agents.find((a) => a.name === "anti_chaos");
  const health = agents.find((a) => a.name === "health_intelligence");
  for (const profile of profiles) {
    if (antiChaos) {
      const mod = getAgentModule(antiChaos.name);
      const last = await lastRunAt(supabase, antiChaos.id, profile.id);
      if (mod && (await needsAntiChaosAdHoc(supabase, profile.id, last))) {
        adhocFired++;
        try {
          const result = await runAgent(
            supabase,
            { ...antiChaos, system_prompt: mod.systemPrompt },
            profile,
            mod.loadContext,
            mod.actionKeyboard,
          );
          if (result.status === "sent") adhocSent++;
        } catch (err) {
          console.error(`adhoc anti_chaos for ${profile.id} threw:`, err);
        }
      }
    }
    if (health) {
      const mod = getAgentModule(health.name);
      const last = await lastRunAt(supabase, health.id, profile.id);
      if (mod && (await needsHealthAdHoc(supabase, profile.id, last))) {
        adhocFired++;
        try {
          const result = await runAgent(
            supabase,
            { ...health, system_prompt: mod.systemPrompt },
            profile,
            mod.loadContext,
            mod.actionKeyboard,
          );
          if (result.status === "sent") adhocSent++;
        } catch (err) {
          console.error(
            `adhoc health_intelligence for ${profile.id} threw:`,
            err,
          );
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      fired,
      sent,
      adhoc_fired: adhocFired,
      adhoc_sent: adhocSent,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
