import type { SupabaseClient } from "@supabase/supabase-js";

// Audit trail. Every interaction, mutation, and proactive message should be
// logged here. Reads power: /inbox, /timeline, agent context, anti-chaos
// counts, conditional reminders. Best-effort — failures swallowed so the
// caller's primary flow isn't blocked.

export type EventKind =
  // user-initiated
  | "message_in"
  | "command"
  | "callback"
  | "intent_routed"
  | "voice_in"
  | "media_in"
  // mutations the bot performed on behalf of the user
  | "bubble_created"
  | "bubble_type_changed"
  | "bubble_updated"
  | "bubble_deleted"
  | "task_created"
  | "task_status_changed"
  | "task_priority_changed"
  | "task_deleted"
  | "project_created"
  | "project_updated"
  | "project_plan_proposed"
  | "project_plan_approved"
  | "capture_created"
  | "capture_processed"
  | "research_completed"
  | "list_item_added"
  | "list_item_toggled"
  | "list_item_deleted"
  | "reminder_created"
  | "reminder_cancelled"
  | "reminder_fired"
  | "calendar_event_created"
  | "calendar_event_updated"
  | "calendar_event_deleted"
  | "summary_sent"
  | "share_created"
  | "share_received"
  | "share_revoked"
  | "friend_added"
  | "oauth_connected"
  | "oauth_disconnected"
  | "obsidian_synced"
  // agent-initiated
  | "proactive_sent"
  | "agent_noop"
  // domain ingest (Phase 7+)
  | "health_logged"
  // generic / future
  | "fact_extracted"
  | "snapshot_taken";

export type EventSource = "user" | "system" | "agent" | "integration";

export interface RelatedEntity {
  type: string;
  id: string;
}

export interface LogEventInput {
  kind: EventKind;
  payload?: Record<string, unknown>;
  source?: EventSource;
  relatedEntity?: RelatedEntity | null;
  occurredAt?: string | Date;
}

export async function logEvent(
  supabase: SupabaseClient,
  ownerId: string,
  input: LogEventInput,
): Promise<void> {
  try {
    const occurred = input.occurredAt
      ? (typeof input.occurredAt === "string" ? input.occurredAt : input.occurredAt.toISOString())
      : new Date().toISOString();
    const { error } = await supabase.from("events").insert({
      owner_id: ownerId,
      kind: input.kind,
      source: input.source ?? "user",
      payload: input.payload ?? {},
      related_entity: input.relatedEntity ?? null,
      occurred_at: occurred,
    });
    if (error) console.error("logEvent insert failed:", error.message, input.kind);
  } catch (err) {
    console.error("logEvent threw:", err);
  }
}

export interface EventRow {
  id: string;
  kind: EventKind;
  source: EventSource;
  payload: Record<string, unknown>;
  related_entity: RelatedEntity | null;
  occurred_at: string;
}

const SELECT = "id, kind, source, payload, related_entity, occurred_at";

export async function listRecentEvents(
  supabase: SupabaseClient,
  ownerId: string,
  limit = 50,
  sinceIso?: string,
): Promise<EventRow[]> {
  let q = supabase
    .from("events")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (sinceIso) q = q.gte("occurred_at", sinceIso);
  const { data, error } = await q.returns<EventRow[]>();
  if (error) throw new Error(`listRecentEvents failed: ${error.message}`);
  return data ?? [];
}

export async function countEventsSince(
  supabase: SupabaseClient,
  ownerId: string,
  kind: EventKind,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .gte("occurred_at", sinceIso);
  if (error) throw new Error(`countEventsSince failed: ${error.message}`);
  return count ?? 0;
}

// Returns the timestamp of the most recent event matching kind + optional
// payload predicate. Used by conditional reminders (inactivity / streak_break).
export async function lastEventAt(
  supabase: SupabaseClient,
  ownerId: string,
  kind: EventKind,
  payloadMatch?: Record<string, unknown>,
): Promise<string | null> {
  let q = supabase
    .from("events")
    .select("occurred_at")
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .order("occurred_at", { ascending: false })
    .limit(1);
  // contains-match on the jsonb payload (subset).
  if (payloadMatch && Object.keys(payloadMatch).length > 0) {
    q = q.contains("payload", payloadMatch);
  }
  const { data } = await q.maybeSingle<{ occurred_at: string }>();
  return data?.occurred_at ?? null;
}
