import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Check,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";
import { BottomSheet } from "../../components/BottomSheet";
import { apiFetch } from "../../lib/api";

export type ProjectActionMode = "plan" | "research";

export type ProjectSummary = {
  id: string;
  title: string;
  goal: string | null;
  status: "active" | "paused" | "done" | "archived";
  target_date: string | null;
  current_summary: string | null;
  next_step: string | null;
};

type ProposedTask = {
  title: string;
  estimated_minutes: number | null;
  priority: 0 | 1 | 2;
  due_at: string | null;
};

type ProjectPlan = {
  summary: string;
  milestones: Array<{
    title: string;
    outcome: string;
    tasks: ProposedTask[];
  }>;
  risks: string[];
};

type PlanProposal = {
  id: string;
  plan: ProjectPlan;
  status: string;
  created_at: string;
};

type ResearchSource = {
  title: string | null;
  url: string;
};

type ResearchBrief = {
  id: string;
  query: string;
  answer: string;
  sources: ResearchSource[];
};

export function ProjectActionSheet({
  mode,
  session,
  demoMode,
  project,
  onClose,
  onProjectCreated,
  onTasksCreated,
  notify,
}: {
  mode: ProjectActionMode;
  session: Session | null;
  demoMode: boolean;
  project: ProjectSummary | null;
  onClose: () => void;
  onProjectCreated: (project: ProjectSummary) => void;
  onTasksCreated: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [currentProject, setCurrentProject] = useState(project);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectGoal, setProjectGoal] = useState("");
  const [planContext, setPlanContext] = useState("");
  const [researchQuery, setResearchQuery] = useState("");
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [research, setResearch] = useState<ResearchBrief | null>(null);
  const [busy, setBusy] = useState(false);

  const generatePlan = async (target: ProjectSummary) => {
    setBusy(true);
    try {
      if (!session) {
        setProposal({
          id: "demo-plan",
          status: "proposed",
          created_at: new Date().toISOString(),
          plan: {
            summary: "תוכנית קצרה שמתחילה בהגדרת התוצאה ומתקדמת לביצוע.",
            milestones: [{
              title: "הכנה",
              outcome: "מטרה ברורה וחומר מרוכז",
              tasks: [
                { title: "לחדד את התוצאה הרצויה", estimated_minutes: 20, priority: 2, due_at: null },
                { title: "לרכז את החומרים הקיימים", estimated_minutes: 30, priority: 1, due_at: null },
              ],
            }],
            risks: ["היקף לא ברור עלול לעכב את הצעד הראשון"],
          },
        });
        return;
      }
      const result = await apiFetch<{ proposal: PlanProposal }>(
        session,
        `/projects/${target.id}/plan`,
        {
          method: "POST",
          body: JSON.stringify({ context: planContext.trim() }),
        },
      );
      setProposal(result.proposal);
    } catch {
      notify("לא הצלחתי להכין תוכנית כרגע.");
    } finally {
      setBusy(false);
    }
  };

  const runResearch = async (target: ProjectSummary) => {
    const query = researchQuery.trim();
    if (!query) {
      notify("צריך לכתוב מה תרצה לחקור.");
      return;
    }
    setBusy(true);
    try {
      if (!session) {
        setResearch({
          id: "demo-research",
          query,
          answer: "זו תוצאת הדגמה. בהפעלה אמיתית יופיע כאן מחקר עדכני בעברית עם מקורות.",
          sources: [{ title: "מקור לדוגמה", url: "https://example.com" }],
        });
        return;
      }
      const result = await apiFetch<{ research: ResearchBrief }>(session, "/research", {
        method: "POST",
        body: JSON.stringify({ query, project_id: target.id }),
      });
      setResearch(result.research);
    } catch {
      notify("המחקר לא הושלם. נסו שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  const createProjectAndContinue = async () => {
    const title = projectTitle.trim();
    if (!title) {
      notify("צריך לתת לפרויקט שם.");
      return;
    }
    setBusy(true);
    try {
      const created = session
        ? (await apiFetch<{ project: ProjectSummary }>(session, "/projects", {
          method: "POST",
          body: JSON.stringify({
            title,
            goal: projectGoal.trim() || null,
            next_step: mode === "plan" ? "לבדוק ולאשר תוכנית ביצוע" : "להשלים מחקר ראשון",
          }),
        })).project
        : {
          id: "demo-project",
          title,
          goal: projectGoal.trim() || null,
          status: "active" as const,
          target_date: null,
          current_summary: null,
          next_step: mode === "plan" ? "לבדוק ולאשר תוכנית ביצוע" : "להשלים מחקר ראשון",
        };
      setCurrentProject(created);
      onProjectCreated(created);
      if (mode === "plan") {
        await generatePlan(created);
      } else {
        setBusy(false);
      }
    } catch {
      notify("לא הצלחתי ליצור את הפרויקט.");
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const created = session
        ? (await apiFetch<{ tasks_created: number }>(
          session,
          `/plans/${proposal.id}/approve`,
          { method: "POST" },
        )).tasks_created
        : proposal.plan.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0);
      await onTasksCreated();
      notify(`התוכנית אושרה ונוספו ${created} משימות.`);
      onClose();
    } catch {
      notify("לא הצלחתי לאשר את התוכנית.");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "plan" ? "הצעת תוכנית" : "מחקר עם מקורות";

  return (
    <BottomSheet title={title} onClose={onClose}>
      {!currentProject
        ? (
          <div className="sheet-form project-create-step">
            <p className="sheet-intro">
              כדי שהתוצאה תישמר במקום הנכון, מתחילים בפרויקט אמיתי במחברת.
            </p>
            <label>
              שם הפרויקט
              <input
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                placeholder="לדוגמה: שיפוץ המטבח"
                autoFocus
              />
            </label>
            <label>
              מה רוצים להשיג?
              <textarea
                value={projectGoal}
                onChange={(event) => setProjectGoal(event.target.value)}
                placeholder="תוצאה ברורה וקצרה"
                rows={3}
              />
            </label>
            <div className="sheet-actions">
              <button className="primary-button" type="button" onClick={createProjectAndContinue} disabled={busy}>
                {busy ? <RefreshCw size={18} className="spin" /> : <Check size={18} />}
                יצירת פרויקט והמשך
              </button>
            </div>
          </div>
        )
        : mode === "plan"
        ? proposal
          ? (
            <div className="project-result">
              <p className="result-summary">{proposal.plan.summary}</p>
              <div className="plan-milestones">
                {proposal.plan.milestones.map((milestone, index) => (
                  <section key={`${milestone.title}-${index}`} className="plan-milestone">
                    <span>{index + 1}</span>
                    <div>
                      <h3>{milestone.title}</h3>
                      <p>{milestone.outcome}</p>
                      <ul>
                        {milestone.tasks.map((task) => (
                          <li key={task.title}>
                            <strong>{task.title}</strong>
                            {task.estimated_minutes ? <small>{task.estimated_minutes} דקות</small> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>
                ))}
              </div>
              {proposal.plan.risks.length > 0
                ? (
                  <section className="plan-risks">
                    <h3><ShieldAlert size={18} /> נקודות שכדאי לשים לב אליהן</h3>
                    <ul>{proposal.plan.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
                  </section>
                )
                : null}
              <div className="sheet-actions">
                <button className="primary-button" type="button" onClick={approvePlan} disabled={busy}>
                  {busy ? <RefreshCw size={18} className="spin" /> : <Check size={18} />}
                  אישור והוספת משימות
                </button>
              </div>
            </div>
          )
          : (
            <div className="sheet-form">
              <p className="sheet-intro">
                אכין תוכנית עבור <strong>{currentProject.title}</strong>. שום משימה לא תיווצר לפני אישורך.
              </p>
              <label>
                הקשר נוסף, אם יש
                <textarea
                  value={planContext}
                  onChange={(event) => setPlanContext(event.target.value)}
                  placeholder="מגבלות, תקציב, לוח זמנים או דברים שכבר נעשו"
                  rows={4}
                />
              </label>
              <div className="sheet-actions">
                <button className="primary-button" type="button" onClick={() => void generatePlan(currentProject)} disabled={busy}>
                  {busy ? <RefreshCw size={18} className="spin" /> : <WandSparkles size={18} />}
                  {busy ? "מכין תוכנית..." : "הכנת הצעה"}
                </button>
              </div>
            </div>
          )
        : research
        ? (
          <div className="project-result research-result">
            <span className="section-kicker">השאלה</span>
            <h3>{research.query}</h3>
            <div className="research-answer">{research.answer}</div>
            {research.sources.length > 0
              ? (
                <section className="research-sources">
                  <h3>מקורות</h3>
                  {research.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                      <span>{source.title || new URL(source.url).hostname}</span>
                      <ExternalLink size={16} />
                    </a>
                  ))}
                </section>
              )
              : null}
          </div>
        )
        : (
          <div className="sheet-form">
            <p className="sheet-intro">
              המחקר יישמר בתוך <strong>{currentProject.title}</strong> ויכלול מקורות שניתן לפתוח.
            </p>
            <label>
              מה לחקור?
              <textarea
                value={researchQuery}
                onChange={(event) => setResearchQuery(event.target.value)}
                placeholder="לדוגמה: מה האפשרויות הטובות ביותר ומה היתרונות והחסרונות של כל אחת?"
                rows={5}
                autoFocus
              />
            </label>
            <div className="sheet-actions">
              <button className="primary-button" type="button" onClick={() => void runResearch(currentProject)} disabled={busy}>
                {busy ? <RefreshCw size={18} className="spin" /> : <Search size={18} />}
                {busy ? "חוקר ומצליב מקורות..." : "התחלת מחקר"}
              </button>
            </div>
          </div>
        )}
    </BottomSheet>
  );
}
