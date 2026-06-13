import { createServiceClient } from "../_shared/supabase.ts";
import { listOwnersWithProvider } from "../_shared/integrations/oauth.ts";
import { syncGoogleCalendar } from "../_shared/integrations/calendar_sync.ts";
import { requireHeaderSecret } from "../_shared/request_auth.ts";

// Pulls calendar events for every owner with a Google integration token.
// Invoked by pg_cron (see migration 0006). Returns per-owner stats.

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("DISPATCH_SECRET");
  const authError = requireHeaderSecret(expectedSecret, req.headers.get("x-dispatch-secret"));
  if (authError) return authError;

  const supabase = createServiceClient();
  const owners = await listOwnersWithProvider(supabase, "google");
  const results: Array<
    {
      owner_id: string;
      ok: boolean;
      upserted?: number;
      removed?: number;
      calendars?: number;
      error?: string;
    }
  > = [];

  for (const { owner_id } of owners) {
    try {
      const r = await syncGoogleCalendar(supabase, owner_id);
      results.push({ owner_id, ok: true, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`sync failed for ${owner_id}:`, msg);
      results.push({ owner_id, ok: false, error: msg });
    }
  }

  return new Response(JSON.stringify({ ok: true, count: owners.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
