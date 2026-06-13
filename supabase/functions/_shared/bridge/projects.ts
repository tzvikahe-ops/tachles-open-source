import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectStatus = "active" | "paused" | "done" | "archived";

export interface Project {
  id: string;
  title: string;
  goal: string | null;
  status: ProjectStatus;
  target_date: string | null;
  current_summary: string | null;
  next_step: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT =
  "id, title, goal, status, target_date, current_summary, next_step, created_at, updated_at";

export interface CreateProjectInput {
  title: string;
  goal?: string | null;
  targetDate?: string | null;
  nextStep?: string | null;
}

export async function createProject(
  supabase: SupabaseClient,
  ownerId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const title = input.title.trim();
  if (!title) throw new Error("project title is required");
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: ownerId,
      title,
      goal: input.goal?.trim() || null,
      target_date: input.targetDate || null,
      next_step: input.nextStep?.trim() || null,
    })
    .select(SELECT)
    .single<Project>();
  if (error || !data) {
    throw new Error(`createProject failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function listProjects(
  supabase: SupabaseClient,
  ownerId: string,
  includeArchived = false,
): Promise<Project[]> {
  let query = supabase
    .from("projects")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (!includeArchived) query = query.neq("status", "archived");
  const { data, error } = await query.returns<Project[]>();
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return data ?? [];
}

export async function getOwnedProject(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .eq("id", projectId)
    .maybeSingle<Project>();
  if (error) throw new Error(`getOwnedProject failed: ${error.message}`);
  return data ?? null;
}

export async function updateProject(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
  patch: Partial<
    Pick<Project, "title" | "goal" | "status" | "target_date" | "current_summary" | "next_step">
  >,
): Promise<Project | null> {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  if (typeof clean.title === "string") clean.title = clean.title.trim();
  const { data, error } = await supabase
    .from("projects")
    .update(clean)
    .eq("owner_id", ownerId)
    .eq("id", projectId)
    .select(SELECT)
    .maybeSingle<Project>();
  if (error) throw new Error(`updateProject failed: ${error.message}`);
  return data ?? null;
}

export interface ProjectResource {
  id: string;
  resource_type: "memory" | "file" | "url" | "note";
  resource_id: string | null;
  title: string | null;
  url: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function listProjectResources(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
): Promise<ProjectResource[]> {
  const { data, error } = await supabase
    .from("project_resources")
    .select("id, resource_type, resource_id, title, url, content, metadata, created_at")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .returns<ProjectResource[]>();
  if (error) throw new Error(`listProjectResources failed: ${error.message}`);
  return data ?? [];
}

export async function addProjectResource(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
  input: Omit<ProjectResource, "id" | "created_at">,
): Promise<ProjectResource> {
  const project = await getOwnedProject(supabase, ownerId, projectId);
  if (!project) throw new Error("project not found");
  const { data, error } = await supabase
    .from("project_resources")
    .insert({
      owner_id: ownerId,
      project_id: projectId,
      ...input,
    })
    .select("id, resource_type, resource_id, title, url, content, metadata, created_at")
    .single<ProjectResource>();
  if (error || !data) {
    throw new Error(`addProjectResource failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}
