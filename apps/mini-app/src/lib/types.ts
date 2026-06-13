// Response shapes mirrored from supabase/functions/api/index.ts.

export interface ReminderSummary {
  id: string;
  title: string;
  run_at: string | null;
  schedule_type: "once" | "recurring";
}

export interface ListSummary {
  id: string;
  name: string;
  item_count: number;
}

export interface ListItem {
  id: string;
  content: string;
  is_done: boolean;
  position: number;
}

export interface StoredEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
}

export interface EventRow {
  id: string;
  kind: string;
  source: string;
  payload: Record<string, unknown>;
  related_entity: { type: string; id: string } | null;
  occurred_at: string;
}

export interface HomeData {
  display_name: string | null;
  events_today: StoredEvent[];
  reminders_next: ReminderSummary[];
  tasks_open: number;
  inbox: EventRow[];
}

export type BubbleType = "knowledge" | "inspiration" | "reflection";

export interface BubbleSummary {
  id: string;
  type: BubbleType;
  title: string | null;
  content: string;
  tags: string[];
}

export type TaskStatus = "todo" | "doing" | "done";

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  parent_task_id: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  schedule_cron: string | null;
  enabled: boolean;
}

export interface Me {
  id: string;
  display_name: string | null;
  timezone: string;
  role: string;
  google_connected: boolean;
}
