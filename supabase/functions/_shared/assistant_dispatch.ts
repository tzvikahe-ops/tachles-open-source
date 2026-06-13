import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./profiles.ts";
import { type Routed, routeMessage } from "./router.ts";
import { createReminder } from "./bridge/reminders.ts";
import { addItems, getOrCreateList } from "./bridge/lists.ts";
import { createTask } from "./bridge/tasks.ts";
import { createBubble, extractTags, extractUrl } from "./wellspring/memories.ts";
import { createEvent, ensureFreshToken } from "./integrations/google.ts";
import { getToken } from "./integrations/oauth.ts";
import { upsertLocalGoogleEvent } from "./integrations/calendar_sync.ts";
import { syncBubble, syncTask } from "./integrations/obsidian.ts";
import { answerRecallQuestion } from "./agents/memory_agent.ts";
import { logMetric, normalizeMetric } from "./health/metrics.ts";
import { logEvent } from "./events.ts";

export interface AssistantAction {
  intent: Routed["intent"];
  status: "created" | "needs_input";
  message: string;
  entity_type?: string;
  entity_id?: string;
  entity?: unknown;
}

async function dispatchRouted(
  supabase: SupabaseClient,
  profile: Profile,
  routed: Routed,
  inputSource: "text" | "voice",
): Promise<AssistantAction> {
  await logEvent(supabase, profile.id, {
    kind: "intent_routed",
    source: "system",
    payload: { intent: routed.intent, input: inputSource },
  });

  switch (routed.intent) {
    case "reminder": {
      const runAt = new Date(routed.run_at);
      const id = await createReminder(supabase, {
        ownerId: profile.id,
        title: routed.title,
        body: routed.body,
        scheduleType: routed.schedule_type,
        runAt,
        recurrence: routed.recurrence,
        timezone: profile.timezone,
      });
      await logEvent(supabase, profile.id, {
        kind: "reminder_created",
        payload: { title: routed.title, run_at: runAt.toISOString() },
        relatedEntity: { type: "reminder", id },
      });
      return {
        intent: routed.intent,
        status: "created",
        message: `יצרתי תזכורת: ${routed.title}`,
        entity_type: "reminder",
        entity_id: id,
      };
    }
    case "calendar_event": {
      const stored = await getToken(supabase, profile.id, "google");
      if (!stored) {
        return {
          intent: routed.intent,
          status: "needs_input",
          message: "כדי להוסיף את האירוע צריך לחבר Google Calendar במסך היומן.",
        };
      }
      const token = await ensureFreshToken(supabase, profile.id, stored);
      const remote = await createEvent(token, {
        title: routed.title,
        description: routed.description,
        location: routed.location,
        startIso: routed.start_at,
        endIso: routed.end_at,
        allDay: routed.all_day,
        timezone: profile.timezone,
      });
      const event = await upsertLocalGoogleEvent(supabase, profile.id, "primary", remote);
      await logEvent(supabase, profile.id, {
        kind: "calendar_event_created",
        payload: { title: event.title },
        relatedEntity: { type: "calendar_event", id: event.id },
      });
      return {
        intent: routed.intent,
        status: "created",
        message: `הוספתי ליומן: ${event.title}`,
        entity_type: "calendar_event",
        entity_id: event.id,
        entity: event,
      };
    }
    case "list_add": {
      const listName = routed.list_name ?? "כללי";
      const listId = await getOrCreateList(supabase, profile.id, listName);
      const added = await addItems(supabase, listId, routed.items, inputSource);
      await logEvent(supabase, profile.id, {
        kind: "list_item_added",
        payload: { list_name: listName, count: added },
        relatedEntity: { type: "list", id: listId },
      });
      const suffix = routed.suggested_followup ? ` ${routed.suggested_followup}` : "";
      return {
        intent: routed.intent,
        status: "created",
        message: added > 0
          ? `הוספתי ${added} פריטים לרשימה ${listName}.${suffix}`
          : `יצרתי את הרשימה ${listName}.${suffix}`,
        entity_type: "list",
        entity_id: listId,
      };
    }
    case "memory_save": {
      const bubble = await createBubble(supabase, {
        ownerId: profile.id,
        content: routed.content,
        tags: routed.tags.length ? routed.tags : extractTags(routed.content),
        sourceUrl: extractUrl(routed.content),
        type: routed.bubble_type ?? undefined,
      });
      await logEvent(supabase, profile.id, {
        kind: "bubble_created",
        payload: { type: bubble.type, preview: bubble.content.slice(0, 120) },
        relatedEntity: { type: "bubble", id: bubble.id },
      });
      await syncBubble(supabase, profile.id, bubble, bubble.created_at);
      return {
        intent: routed.intent,
        status: "created",
        message: "שמרתי את זה בזיכרון.",
        entity_type: "memory",
        entity_id: bubble.id,
        entity: bubble,
      };
    }
    case "task_create": {
      const task = await createTask(supabase, profile.id, routed.title);
      await logEvent(supabase, profile.id, {
        kind: "task_created",
        payload: { title: task.title, priority: task.priority },
        relatedEntity: { type: "task", id: task.id },
      });
      await syncTask(supabase, profile.id, task, [], new Date().toISOString());
      return {
        intent: routed.intent,
        status: "created",
        message: `יצרתי משימה: ${task.title}`,
        entity_type: "task",
        entity_id: task.id,
        entity: task,
      };
    }
    case "health_log": {
      const metric = normalizeMetric(routed.metric);
      if (!metric) {
        return {
          intent: routed.intent,
          status: "needs_input",
          message: "לא הצלחתי לזהות את מדד הבריאות.",
        };
      }
      const id = await logMetric(supabase, profile.id, metric, routed.value, {
        unit: routed.unit ?? undefined,
        note: routed.note ?? undefined,
        source: "manual",
      });
      await logEvent(supabase, profile.id, {
        kind: "health_logged",
        payload: { metric, value: routed.value },
        relatedEntity: { type: "health_metric", id },
      });
      return {
        intent: routed.intent,
        status: "created",
        message: "רשמתי את מדד הבריאות.",
        entity_type: "health_metric",
        entity_id: id,
      };
    }
    case "recall_question": {
      return {
        intent: routed.intent,
        status: "created",
        message: await answerRecallQuestion(supabase, profile, routed.question),
      };
    }
    case "conditional_reminder": {
      const windowDays = Number(routed.condition_params.window_days);
      const runAt = new Date(
        Date.now() + (Number.isFinite(windowDays) ? windowDays : 1) * 86_400_000,
      ).toISOString();
      const { data, error } = await supabase
        .from("reminders")
        .insert({
          owner_id: profile.id,
          title: routed.title,
          body: routed.body,
          kind: "conditional",
          schedule_type: "once",
          run_at: runAt,
          timezone: profile.timezone,
          condition_type: routed.condition_type,
          condition_params: { ...routed.condition_params, event_kind: routed.event_kind },
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !data) {
        throw new Error(`conditional reminder insert failed: ${error?.message ?? "no row"}`);
      }
      await logEvent(supabase, profile.id, {
        kind: "reminder_created",
        payload: { kind: "conditional", title: routed.title },
        relatedEntity: { type: "reminder", id: data.id },
      });
      return {
        intent: routed.intent,
        status: "created",
        message: `יצרתי תזכורת מותנית: ${routed.title}`,
        entity_type: "reminder",
        entity_id: data.id,
      };
    }
    case "unclear":
      return {
        intent: routed.intent,
        status: "needs_input",
        message: routed.clarification,
      };
  }
}

export async function routeAndDispatchAssistantText(
  supabase: SupabaseClient,
  profile: Profile,
  text: string,
  inputSource: "text" | "voice" = "text",
): Promise<AssistantAction[]> {
  const routedItems = await routeMessage(text, new Date().toISOString(), profile.timezone);
  const actions: AssistantAction[] = [];
  for (const routed of routedItems) {
    actions.push(await dispatchRouted(supabase, profile, routed, inputSource));
  }
  return actions;
}
