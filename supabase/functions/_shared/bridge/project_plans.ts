import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "./projects.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface ProposedTask {
  title: string;
  estimated_minutes: number | null;
  priority: 0 | 1 | 2;
  due_at: string | null;
}

export interface ProposedMilestone {
  title: string;
  outcome: string;
  tasks: ProposedTask[];
}

export interface ProjectPlan {
  summary: string;
  milestones: ProposedMilestone[];
  risks: string[];
}

const TOOL = {
  name: "propose_project_plan",
  description: "Create a practical Hebrew execution plan that the user can review before approval.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      milestones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            outcome: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  estimated_minutes: { type: ["integer", "null"], minimum: 5, maximum: 1440 },
                  priority: { type: "integer", minimum: 0, maximum: 2 },
                  due_at: { type: ["string", "null"] },
                },
                required: ["title", "estimated_minutes", "priority", "due_at"],
              },
            },
          },
          required: ["title", "outcome", "tasks"],
        },
      },
      risks: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "milestones", "risks"],
  },
} as const;

interface AnthropicResponse {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
}

export function normalizeProjectPlan(value: unknown): ProjectPlan {
  const raw = value as Partial<ProjectPlan>;
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.slice(0, 8).map((milestone) => ({
      title: String(milestone.title ?? "").trim(),
      outcome: String(milestone.outcome ?? "").trim(),
      tasks: Array.isArray(milestone.tasks)
        ? milestone.tasks.slice(0, 12).map((task) => ({
          title: String(task.title ?? "").trim(),
          estimated_minutes: Number.isInteger(task.estimated_minutes)
            ? Math.min(1440, Math.max(5, Number(task.estimated_minutes)))
            : null,
          priority: [0, 1, 2].includes(Number(task.priority))
            ? Number(task.priority) as 0 | 1 | 2
            : 0,
          due_at: typeof task.due_at === "string" && task.due_at ? task.due_at : null,
        })).filter((task) => task.title)
        : [],
    })).filter((milestone) => milestone.title && milestone.tasks.length > 0)
    : [];
  if (milestones.length === 0) throw new Error("plan has no actionable milestones");
  return {
    summary: String(raw.summary ?? "").trim(),
    milestones,
    risks: Array.isArray(raw.risks)
      ? raw.risks.slice(0, 8).map(String).map((risk) => risk.trim()).filter(Boolean)
      : [],
  };
}

export async function generateProjectPlan(project: Project, context = ""): Promise<ProjectPlan> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  const model = Deno.env.get("LLM_MODEL")?.trim() || DEFAULT_MODEL;
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2400,
      system: [{
        type: "text",
        text:
          "אתה מתכנן פרויקטים אישיים. בנה תוכנית מעשית וקצרה בעברית. אל תמציא תאריכים אם אין יעד. כל משימה צריכה להיות פעולה אחת ברורה. החזר הצעה בלבד.",
        cache_control: { type: "ephemeral" },
      }],
      tools: [{ ...TOOL, cache_control: { type: "ephemeral" } }],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: JSON.stringify({
          title: project.title,
          goal: project.goal,
          target_date: project.target_date,
          current_summary: project.current_summary,
          next_step: project.next_step,
          additional_context: context.slice(0, 12000),
        }),
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  }
  const data = await response.json() as AnthropicResponse;
  const block = data.content?.find((item) => item.type === "tool_use" && item.name === TOOL.name);
  if (!block) throw new Error("No project plan tool response");
  return normalizeProjectPlan(block.input);
}

export async function saveProjectPlanProposal(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
  plan: ProjectPlan,
): Promise<{ id: string; plan: ProjectPlan; status: string; created_at: string }> {
  const { data, error } = await supabase
    .from("project_plan_proposals")
    .insert({ owner_id: ownerId, project_id: projectId, plan })
    .select("id, plan, status, created_at")
    .single<{ id: string; plan: ProjectPlan; status: string; created_at: string }>();
  if (error || !data) {
    throw new Error(`saveProjectPlanProposal failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function approveProjectPlan(
  supabase: SupabaseClient,
  ownerId: string,
  proposalId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("approve_project_plan", {
    p_owner_id: ownerId,
    p_proposal_id: proposalId,
  });
  if (error) throw new Error(`approveProjectPlan failed: ${error.message}`);
  return Number(data ?? 0);
}
