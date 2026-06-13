import { createServiceClient } from "../_shared/supabase.ts";
import { logEvent } from "../_shared/events.ts";
import { buildSnapshot, persistSnapshot } from "../_shared/snapshots.ts";
import { listProfiles } from "../_shared/agents/registry.ts";
import { requireHeaderSecret } from "../_shared/request_auth.ts";

// Runs once per day via pg_cron and writes a state_snapshots row per user.
// Idempotent (upsert by (owner_id, snapshot_date)).

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  const authError = requireHeaderSecret(expected, req.headers.get("x-dispatch-secret"));
  if (authError) return authError;

  const supabase = createServiceClient();
  const profiles = await listProfiles(supabase);
  let count = 0;
  for (const profile of profiles) {
    try {
      const snap = await buildSnapshot(supabase, profile);
      await persistSnapshot(supabase, profile, snap);
      await logEvent(supabase, profile.id, {
        kind: "snapshot_taken",
        source: "system",
        payload: snap as unknown as Record<string, unknown>,
      });
      count++;
    } catch (err) {
      console.error(`snapshot failed for ${profile.id}:`, err);
    }
  }
  return new Response(JSON.stringify({ ok: true, count }), {
    headers: { "Content-Type": "application/json" },
  });
});
