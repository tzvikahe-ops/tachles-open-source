import type { SupabaseClient } from "@supabase/supabase-js";

// הגשר / Bridge — tasks with subtasks (self-referencing parent), a 3-state
// status and a 3-level priority. No due dates yet (those arrive with calendar).

export type TaskStatus = "todo" | "doing" | "waiting" | "done";

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  parent_task_id: string | null;
  project_id: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  energy_level: "low" | "medium" | "high" | null;
  schedule_mode: "flexible" | "fixed";
  scheduled_start: string | null;
  scheduled_end: string | null;
  waiting_for: string | null;
  waiting_reason: string | null;
  follow_up_at: string | null;
}

const SELECT = [
  "id",
  "title",
  "status",
  "priority",
  "parent_task_id",
  "project_id",
  "due_at",
  "estimated_minutes",
  "energy_level",
  "schedule_mode",
  "scheduled_start",
  "scheduled_end",
  "waiting_for",
  "waiting_reason",
  "follow_up_at",
].join(", ");

// Pure transitions (unit-tested).
export function nextStatus(s: TaskStatus): TaskStatus {
  return s === "todo" ? "doing" : s === "doing" || s === "waiting" ? "done" : "todo";
}

export function nextPriority(p: number): number {
  return (p + 1) % 3;
}

export async function createTask(
  supabase: SupabaseClient,
  ownerId: string,
  title: string,
  parentTaskId: string | null = null,
  options: {
    projectId?: string | null;
    dueAt?: string | null;
    estimatedMinutes?: number | null;
    energyLevel?: "low" | "medium" | "high" | null;
  } = {},
): Promise<TaskSummary> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      owner_id: ownerId,
      title,
      parent_task_id: parentTaskId,
      project_id: options.projectId ?? null,
      due_at: options.dueAt ?? null,
      estimated_minutes: options.estimatedMinutes ?? null,
      energy_level: options.energyLevel ?? null,
    })
    .select(SELECT)
    .single<TaskSummary>();
  if (error || !data) {
    throw new Error(`createTask failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function listProjectTasks(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
): Promise<TaskSummary[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .order("status")
    .order("priority", { ascending: false })
    .order("position")
    .returns<TaskSummary[]>();
  if (error) throw new Error(`listProjectTasks failed: ${error.message}`);
  return data ?? [];
}

export async function updateTask(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
  patch: Partial<
    Pick<
      TaskSummary,
      | "title"
      | "status"
      | "priority"
      | "project_id"
      | "due_at"
      | "estimated_minutes"
      | "energy_level"
      | "schedule_mode"
      | "scheduled_start"
      | "scheduled_end"
      | "waiting_for"
      | "waiting_reason"
      | "follow_up_at"
    >
  >,
): Promise<TaskSummary | null> {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  if ("status" in clean && clean.status !== "waiting") {
    if (clean.waiting_for === undefined) clean.waiting_for = null;
    if (clean.waiting_reason === undefined) clean.waiting_reason = null;
    if (clean.follow_up_at === undefined) clean.follow_up_at = null;
  }
  const { data, error } = await supabase
    .from("tasks")
    .update(clean)
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .maybeSingle<TaskSummary>();
  if (error) throw new Error(`updateTask failed: ${error.message}`);
  return data ?? null;
}

export async function getOwnedTask(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<TaskSummary | null> {
  const { data } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .maybeSingle<TaskSummary>();
  return data ?? null;
}

// Top-level tasks that are not done (the active board).
export async function listTopTasks(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<TaskSummary[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .is("parent_task_id", null)
    .neq("status", "done")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<TaskSummary[]>();
  if (error) throw new Error(`listTopTasks failed: ${error.message}`);
  return data ?? [];
}

export async function getSubtasks(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<TaskSummary[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .eq("parent_task_id", taskId)
    .order("created_at", { ascending: true })
    .returns<TaskSummary[]>();
  if (error) throw new Error(`getSubtasks failed: ${error.message}`);
  return data ?? [];
}

export async function cycleTaskStatus(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<TaskSummary | null> {
  const current = await getOwnedTask(supabase, ownerId, taskId);
  if (!current) return null;
  const { data } = await supabase
    .from("tasks")
    .update({ status: nextStatus(current.status) })
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .maybeSingle<TaskSummary>();
  return data ?? null;
}

export async function cycleTaskPriority(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<TaskSummary | null> {
  const current = await getOwnedTask(supabase, ownerId, taskId);
  if (!current) return null;
  const { data } = await supabase
    .from("tasks")
    .update({ priority: nextPriority(current.priority) })
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .maybeSingle<TaskSummary>();
  return data ?? null;
}

// Delete a task (subtasks cascade). Returns { parentId } when owned, else null.
export async function deleteTask(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<{ parentId: string | null } | null> {
  const { data } = await supabase
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .select("parent_task_id")
    .maybeSingle<{ parent_task_id: string | null }>();
  return data ? { parentId: data.parent_task_id } : null;
}

export async function setActiveTask(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<void> {
  await supabase.from("profiles").update({ active_task_id: taskId }).eq("id", ownerId);
}
