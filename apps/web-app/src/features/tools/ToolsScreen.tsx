import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity,
  Bot,
  Check,
  ChevronLeft,
  Circle,
  Cloud,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { ApiError, apiFetch } from "../../lib/api";

type ToolTab =
  | "overview"
  | "tasks"
  | "lists"
  | "health"
  | "agents"
  | "search"
  | "timeline"
  | "social";
type ListSummary = { id: string; name: string; item_count: number };
type ListItem = { id: string; content: string; is_done: boolean };
type Agent = { id: string; name: string; role: string; enabled: boolean; sent_last_7d: number };
type Friend = { profile_id: string; display_name: string | null };
type Share = {
  id: string;
  resource_type: string;
  resource_title: string | null;
  owner_display_name: string | null;
};
type SearchResults = {
  bubbles: Array<{ id: string; content: string }>;
  listItems: Array<{ id: string; content: string; list_name: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
};
type Shareable = { id: string; label: string; type: "list" | "task" | "bubble" | "reminder" };
type Task = {
  id: string;
  title: string;
  status: "todo" | "doing" | "waiting" | "done";
  priority: number;
  waiting_for: string | null;
};
type Snapshot = {
  snapshot_date: string;
  snapshot: {
    open_tasks: number;
    done_tasks_week: number;
    bubbles_added_week: number;
    reminders_fired_week: number;
    proactive_sent_week: number;
  };
};

const tabs: Array<{ id: ToolTab; label: string; icon: typeof ListChecks }> = [
  { id: "overview", label: "סקירה", icon: LayoutDashboard },
  { id: "tasks", label: "משימות", icon: ClipboardList },
  { id: "lists", label: "רשימות", icon: ListChecks },
  { id: "health", label: "בריאות", icon: HeartPulse },
  { id: "agents", label: "סוכנים", icon: Bot },
  { id: "search", label: "חיפוש", icon: Search },
  { id: "timeline", label: "ציר זמן", icon: Activity },
  { id: "social", label: "שיתוף", icon: Share2 },
];

const metricLabels: Record<string, string> = {
  sleep_hours: "שינה בשעות",
  mood_1_10: "מצב רוח",
  workout_minutes: "אימון בדקות",
  meds_taken: "תרופות",
  water_ml: "מים במ״ל",
  weight_kg: "משקל",
  pain_1_10: "כאב",
  steps: "צעדים",
};

export function ToolsScreen({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<ToolTab>(() =>
    new URLSearchParams(window.location.search).get("view") === "agents"
      ? "agents"
      : "overview"
  );
  return (
    <section className="tools-view">
      <div className="projects-title">
        <p className="date-line">כל היכולות במקום אחד</p>
        <h1>כלים</h1>
        <p>אותן יכולות של הבוט, ישירות מתוך האפליקציה.</p>
      </div>
      <div className="tool-tabs" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              type="button"
              onClick={() => setTab(item.id)}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </div>
      {tab === "lists"
        ? <ListsPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "overview"
        ? <OverviewPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "tasks"
        ? <TasksPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "health"
        ? <HealthPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "agents"
        ? <AgentsPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "search"
        ? <SearchPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "timeline"
        ? <TimelinePanel session={session} demoMode={demoMode} notify={notify} />
        : null}
      {tab === "social"
        ? <SocialPanel session={session} demoMode={demoMode} notify={notify} />
        : null}
    </section>
  );
}

function OverviewPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [people, setPeople] = useState<Array<{ predicate: string; object: unknown }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; kind: string; occurred_at: string }>>([]);
  useEffect(() => {
    if (!session || demoMode) return;
    Promise.all([
      apiFetch<{ snapshots: Snapshot[] }>(session, "/stats"),
      apiFetch<{ people: Array<{ predicate: string; object: unknown }> }>(session, "/people"),
      apiFetch<{ events: Array<{ id: string; kind: string; occurred_at: string }> }>(
        session,
        "/activity",
      ),
    ]).then(([stats, facts, activity]) => {
      setSnapshot(stats.snapshots[0] ?? null);
      setPeople(facts.people);
      setEvents(activity.events.slice(0, 8));
    }).catch(() => notify("לא הצלחתי לטעון את תמונת המצב."));
  }, [session, demoMode]);
  const values = snapshot?.snapshot;
  return (
    <article className="tool-panel">
      <h2>תמונת מצב</h2>
      <div className="metric-grid">
        <Metric label="משימות פתוחות" value={values?.open_tasks} />
        <Metric label="הושלמו השבוע" value={values?.done_tasks_week} />
        <Metric label="זיכרונות השבוע" value={values?.bubbles_added_week} />
        <Metric label="תזכורות שנשלחו" value={values?.reminders_fired_week} />
        <Metric label="פניות יזומות" value={values?.proactive_sent_week} />
      </div>
      {people.length > 0
        ? (
          <div className="overview-section">
            <h3>אנשים חשובים</h3>
            {people.map((fact, index) => (
              <p key={`${fact.predicate}-${index}`}>{String(fact.object)}</p>
            ))}
          </div>
        )
        : null}
      <div className="overview-section">
        <h3>פעילות אחרונה</h3>
        {events.map((event) => (
          <p key={event.id}>
            <strong>{event.kind.replaceAll("_", " ")}</strong>
            <small>{new Date(event.occurred_at).toLocaleString("he-IL")}</small>
          </p>
        ))}
        {events.length === 0 ? <p className="empty-note">עוד אין פעילות להצגה.</p> : null}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function TasksPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [subtasks, setSubtasks] = useState<Record<string, Task[]>>({});
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  const load = async () => {
    if (!session || demoMode) return;
    const data = await apiFetch<{ tasks: Task[] }>(session, "/tasks");
    setTasks(data.tasks);
  };
  useEffect(() => {
    void load().catch(() => notify("לא הצלחתי לטעון את המשימות."));
  }, [session, demoMode]);
  const create = async () => {
    if (!session || !title.trim()) return;
    await apiFetch(session, "/tasks", {
      method: "POST",
      body: JSON.stringify({ title: title.trim() }),
    });
    setTitle("");
    await load();
  };
  const patch = async (task: Task, changes: Partial<Task>) => {
    if (!session) return;
    const data = await apiFetch<{ task: Task }>(session, `/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    setTasks((current) => current.map((row) => row.id === task.id ? data.task : row));
  };
  const remove = async (task: Task) => {
    if (!session) return;
    await apiFetch(session, `/tasks/${task.id}`, { method: "DELETE" });
    setTasks((current) => current.filter((row) => row.id !== task.id));
  };
  const loadSubtasks = async (taskId: string) => {
    if (!session) return;
    if (subtasks[taskId]) {
      setSubtasks((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      return;
    }
    const data = await apiFetch<{ tasks: Task[] }>(session, `/tasks/${taskId}/subtasks`);
    setSubtasks((current) => ({ ...current, [taskId]: data.tasks }));
  };
  const addSubtask = async (taskId: string) => {
    const subtaskTitle = subtaskDrafts[taskId]?.trim();
    if (!session || !subtaskTitle) return;
    const data = await apiFetch<{ task: Task }>(session, "/tasks", {
      method: "POST",
      body: JSON.stringify({ title: subtaskTitle, parent_task_id: taskId }),
    });
    setSubtasks((current) => ({
      ...current,
      [taskId]: [...(current[taskId] ?? []), data.task],
    }));
    setSubtaskDrafts((current) => ({ ...current, [taskId]: "" }));
  };
  const toggleSubtask = async (parentId: string, subtask: Task) => {
    if (!session) return;
    const status = subtask.status === "done" ? "todo" : "done";
    const data = await apiFetch<{ task: Task }>(session, `/tasks/${subtask.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setSubtasks((current) => ({
      ...current,
      [parentId]: current[parentId].map((row) => row.id === subtask.id ? data.task : row),
    }));
  };
  const removeSubtask = async (parentId: string, subtaskId: string) => {
    if (!session) return;
    await apiFetch(session, `/tasks/${subtaskId}`, { method: "DELETE" });
    setSubtasks((current) => ({
      ...current,
      [parentId]: current[parentId].filter((row) => row.id !== subtaskId),
    }));
  };
  return (
    <article className="tool-panel">
      <h2>לוח משימות</h2>
      <div className="tool-inline-form">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void create()}
          placeholder="משימה חדשה"
        />
        <button type="button" onClick={() => void create()}>הוספה</button>
      </div>
      <div className="task-tool-list">
        {tasks.map((task) => (
          <div key={task.id}>
            <input
              value={task.title}
              aria-label="שם המשימה"
              onChange={(event) =>
                setTasks((current) =>
                  current.map((row) =>
                    row.id === task.id ? { ...row, title: event.target.value } : row
                  )
                )}
              onBlur={() => void patch(task, { title: task.title })}
            />
            <div>
              <select
                value={task.status}
                onChange={(event) =>
                  void patch(task, {
                    status: event.target.value as Task["status"],
                    waiting_for: event.target.value === "waiting"
                      ? task.waiting_for ?? "מישהו"
                      : null,
                  })}
              >
                <option value="todo">לביצוע</option>
                <option value="doing">בתהליך</option>
                <option value="waiting">ממתין</option>
                <option value="done">הושלם</option>
              </select>
              <select
                value={task.priority}
                onChange={(event) => void patch(task, { priority: Number(event.target.value) })}
              >
                <option value={0}>רגילה</option>
                <option value={1}>חשובה</option>
                <option value={2}>דחופה</option>
              </select>
              <button type="button" aria-label="מחיקת משימה" onClick={() => void remove(task)}>
                <Trash2 size={16} />
              </button>
            </div>
            <button
              className="subtask-toggle"
              type="button"
              onClick={() => void loadSubtasks(task.id)}
            >
              {subtasks[task.id] ? "סגירת תתי־משימות" : "תתי־משימות"}
            </button>
            {subtasks[task.id]
              ? (
                <div className="subtask-list">
                  {subtasks[task.id].map((subtask) => (
                    <div key={subtask.id}>
                      <button type="button" onClick={() => void toggleSubtask(task.id, subtask)}>
                        {subtask.status === "done" ? <Check size={15} /> : <Circle size={15} />}
                        <span>{subtask.title}</span>
                      </button>
                      <button
                        type="button"
                        aria-label="מחיקת תת־משימה"
                        onClick={() => void removeSubtask(task.id, subtask.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="subtask-form">
                    <input
                      value={subtaskDrafts[task.id] ?? ""}
                      onChange={(event) =>
                        setSubtaskDrafts((current) => ({
                          ...current,
                          [task.id]: event.target.value,
                        }))}
                      placeholder="תת־משימה חדשה"
                    />
                    <button type="button" onClick={() => void addSubtask(task.id)}>הוספה</button>
                  </div>
                </div>
              )
              : null}
          </div>
        ))}
        {tasks.length === 0 ? <p className="empty-note">אין משימות פתוחות.</p> : null}
      </div>
    </article>
  );
}

function ListsPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [active, setActive] = useState<ListSummary | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const loadLists = async () => {
    if (!session || demoMode) return;
    const data = await apiFetch<{ lists: ListSummary[] }>(session, "/lists");
    setLists(data.lists);
  };
  useEffect(() => {
    void loadLists().catch(() => notify("לא הצלחתי לטעון את הרשימות."));
  }, [session, demoMode]);

  const openList = async (list: ListSummary) => {
    setActive(list);
    if (!session || demoMode) return;
    const data = await apiFetch<{ items: ListItem[] }>(session, `/lists/${list.id}`);
    setItems(data.items);
  };
  const createList = async () => {
    if (!name.trim() || !session || demoMode) return;
    await apiFetch(session, "/lists", { method: "POST", body: JSON.stringify({ name }) });
    setName("");
    await loadLists();
    notify("הרשימה נוצרה.");
  };
  const addItem = async () => {
    if (!active || !content.trim() || !session || demoMode) return;
    const data = await apiFetch<{ items: ListItem[] }>(session, `/lists/${active.id}/items`, {
      method: "POST",
      body: JSON.stringify({ items: content.split(/[\n,;]+/).map((item) => item.trim()) }),
    });
    setItems(data.items);
    setContent("");
  };
  const toggle = async (item: ListItem) => {
    if (!session || demoMode) return;
    const data = await apiFetch<{ items: ListItem[] }>(session, `/list-items/${item.id}`, {
      method: "PATCH",
    });
    setItems(data.items);
  };
  const remove = async (item: ListItem) => {
    if (!session || demoMode) return;
    await apiFetch(session, `/list-items/${item.id}`, { method: "DELETE" });
    setItems((current) => current.filter((row) => row.id !== item.id));
  };

  if (active) {
    return (
      <article className="tool-panel">
        <button className="tool-back" type="button" onClick={() => setActive(null)}>
          <ChevronLeft size={18} /> כל הרשימות
        </button>
        <h2>{active.name}</h2>
        <div className="tool-inline-form">
          <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="חלב, לחם, ביצים" />
          <button type="button" onClick={() => void addItem()}>הוספה</button>
        </div>
        <div className="tool-list">
          {items.map((item) => (
            <div key={item.id} className={item.is_done ? "is-done" : ""}>
              <button type="button" onClick={() => void toggle(item)}>
                {item.is_done ? <Check size={17} /> : <Circle size={17} />}
                <span>{item.content}</span>
              </button>
              <button type="button" aria-label="מחיקה" onClick={() => void remove(item)}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {items.length === 0 ? <p className="empty-note">הרשימה עדיין ריקה.</p> : null}
        </div>
      </article>
    );
  }

  return (
    <article className="tool-panel">
      <h2>הרשימות שלי</h2>
      <div className="tool-inline-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="שם לרשימה חדשה" />
        <button type="button" onClick={() => void createList()}>יצירה</button>
      </div>
      <div className="tool-card-grid">
        {lists.map((list) => (
          <button key={list.id} type="button" onClick={() => void openList(list)}>
            <ListChecks size={19} />
            <strong>{list.name}</strong>
            <small>{list.item_count} פריטים</small>
          </button>
        ))}
        {lists.length === 0 ? <p className="empty-note">עוד אין רשימות.</p> : null}
      </div>
    </article>
  );
}

function HealthPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [metric, setMetric] = useState("sleep_hours");
  const [value, setValue] = useState("");
  const [averages, setAverages] = useState<Record<string, number | null>>({});
  const load = async () => {
    if (!session || demoMode) return;
    const data = await apiFetch<{ averages: Record<string, number | null> }>(session, "/health");
    setAverages(data.averages);
  };
  useEffect(() => {
    void load().catch(() => notify("לא הצלחתי לטעון את נתוני הבריאות."));
  }, [session, demoMode]);
  const save = async () => {
    if (!session || demoMode || !value) return;
    await apiFetch(session, "/health", {
      method: "POST",
      body: JSON.stringify({ metric, value: Number(value) }),
    });
    setValue("");
    await load();
    notify("המדד נשמר.");
  };
  return (
    <article className="tool-panel">
      <h2>מעקב בריאות</h2>
      <div className="tool-health-form">
        <select value={metric} onChange={(event) => setMetric(event.target.value)}>
          {Object.entries(metricLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input type="number" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="ערך" />
        <button type="button" onClick={() => void save()}>שמירה</button>
      </div>
      <div className="metric-grid">
        {Object.entries(metricLabels).map(([id, label]) => (
          <div key={id}>
            <small>{label}</small>
            <strong>{averages[id] == null ? "—" : Number(averages[id]).toFixed(1)}</strong>
            <span>ממוצע 7 ימים</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function AgentsPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!session || demoMode) return;
    apiFetch<{ agents: Agent[] }>(session, "/agents")
      .then((data) => setAgents(data.agents))
      .catch(() => notify("לא הצלחתי לטעון את הסוכנים."));
  }, [session, demoMode]);
  const toggle = async (agent: Agent) => {
    if (!session || demoMode) return;
    const enabled = !agent.enabled;
    setAgents((current) => current.map((row) => row.id === agent.id ? { ...row, enabled } : row));
    try {
      await apiFetch(session, `/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setAgents((current) => current.map((row) => row.id === agent.id ? agent : row));
      notify("לא הצלחתי לעדכן את הסוכן.");
    }
  };
  return (
    <article className="tool-panel">
      <h2>סוכנים פרואקטיביים</h2>
      <p>הודעות חשובות יגיעו כ־Push גם בלי Telegram.</p>
      <div className="agent-list">
        {agents.map((agent) => (
          <div key={agent.id}>
            <span>
              <strong>{agent.role}</strong>
              <small>{agent.sent_last_7d} הודעות בשבוע האחרון</small>
            </span>
            <button
              className={agent.enabled ? "toggle-on" : ""}
              type="button"
              aria-pressed={agent.enabled}
              onClick={() => void toggle(agent)}
            >
              {agent.enabled ? "פעיל" : "כבוי"}
            </button>
          </div>
        ))}
      </div>
    </article>
  );
}

function SearchPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [drive, setDrive] = useState<Array<{ id: string; name: string; webViewLink?: string }>>([]);
  const run = async () => {
    if (!session || demoMode || !query.trim()) return;
    try {
      const [local, driveResult] = await Promise.all([
        apiFetch<SearchResults>(session, `/search?q=${encodeURIComponent(query)}`),
        apiFetch<{ files: Array<{ id: string; name: string; webViewLink?: string }> }>(
          session,
          `/drive?q=${encodeURIComponent(query)}`,
        ).catch((error) => {
          if (error instanceof ApiError && error.code === "google_not_connected") return { files: [] };
          throw error;
        }),
      ]);
      setResults(local);
      setDrive(driveResult.files);
    } catch {
      notify("החיפוש לא הושלם.");
    }
  };
  return (
    <article className="tool-panel">
      <h2>חיפוש אחד בכל מקום</h2>
      <div className="tool-inline-form">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="מה לחפש?" onKeyDown={(event) => event.key === "Enter" && void run()} />
        <button type="button" onClick={() => void run()}>חיפוש</button>
      </div>
      {results
        ? (
          <div className="search-results">
            {[...results.bubbles.map((row) => ({ label: row.content, meta: "זיכרון" })),
              ...results.listItems.map((row) => ({ label: row.content, meta: `רשימה: ${row.list_name}` })),
              ...results.tasks.map((row) => ({ label: row.title, meta: "משימה" })),
              ...drive.map((row) => ({ label: row.name, meta: "Google Drive", url: row.webViewLink }))].map((row, index) => (
                <a
                  key={`${row.meta}-${index}`}
                  href={"url" in row && typeof row.url === "string" ? row.url : undefined}
                  target={"url" in row && typeof row.url === "string" ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  <strong>{row.label}</strong>
                  <small>{row.meta}</small>
                </a>
              ))}
          </div>
        )
        : null}
    </article>
  );
}

function TimelinePanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [windowName, setWindowName] = useState("שבוע");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const build = async () => {
    if (!session || demoMode) return;
    setBusy(true);
    try {
      const data = await apiFetch<{ text: string }>(session, `/timeline?window=${encodeURIComponent(windowName)}`);
      setText(data.text);
    } catch {
      notify("לא הצלחתי לבנות את ציר הזמן.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="tool-panel">
      <h2>הסיפור של התקופה</h2>
      <div className="tool-inline-form">
        <select value={windowName} onChange={(event) => setWindowName(event.target.value)}>
          <option value="שבוע">שבוע אחרון</option>
          <option value="חודש">חודש אחרון</option>
          <option value="90">90 ימים</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void build()}>
          {busy ? "בונה..." : "יצירת סיכום"}
        </button>
      </div>
      {text ? <div className="timeline-narrative">{text}</div> : null}
    </article>
  );
}

function SocialPanel({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [friendId, setFriendId] = useState("");
  const [resource, setResource] = useState("");
  const [shareables, setShareables] = useState<Shareable[]>([]);
  const load = async () => {
    if (!session || demoMode) return;
    const [friendData, shareData, lists, tasks, memories, reminders] = await Promise.all([
      apiFetch<{ friends: Friend[] }>(session, "/friends"),
      apiFetch<{ shares: Share[] }>(session, "/shares"),
      apiFetch<{ lists: ListSummary[] }>(session, "/lists"),
      apiFetch<{ tasks: Array<{ id: string; title: string }> }>(session, "/tasks"),
      apiFetch<{ memories: Array<{ id: string; content: string }> }>(session, "/memories?limit=30"),
      apiFetch<{ reminders: Array<{ id: string; title: string }> }>(session, "/reminders"),
    ]);
    setFriends(friendData.friends);
    setShares(shareData.shares);
    setShareables([
      ...lists.lists.map((row) => ({ id: row.id, label: row.name, type: "list" as const })),
      ...tasks.tasks.map((row) => ({ id: row.id, label: row.title, type: "task" as const })),
      ...memories.memories.map((row) => ({ id: row.id, label: row.content.slice(0, 60), type: "bubble" as const })),
      ...reminders.reminders.map((row) => ({ id: row.id, label: row.title, type: "reminder" as const })),
    ]);
  };
  useEffect(() => {
    void load().catch(() => notify("לא הצלחתי לטעון את השיתופים."));
  }, [session, demoMode]);
  const createInvite = async () => {
    if (!session || demoMode) return;
    const data = await apiFetch<{ url: string }>(session, "/friends/invite", { method: "POST" });
    setInviteUrl(data.url);
    await navigator.clipboard?.writeText(data.url).catch(() => undefined);
    notify("קישור ההזמנה הועתק.");
  };
  const share = async () => {
    if (!session || !friendId || !resource) return;
    const [type, id] = resource.split(":");
    await apiFetch(session, "/shares", {
      method: "POST",
      body: JSON.stringify({ friend_id: friendId, resource_type: type, resource_id: id }),
    });
    notify("הפריט שותף.");
  };
  return (
    <article className="tool-panel">
      <h2>חברים ושיתוף</h2>
      <button className="wide-tool-button" type="button" onClick={() => void createInvite()}>
        <Share2 size={18} /> יצירת קישור הזמנה
      </button>
      {inviteUrl ? <input className="share-url" readOnly value={inviteUrl} dir="ltr" /> : null}
      {friends.length > 0
        ? (
          <div className="share-form">
            <select value={friendId} onChange={(event) => setFriendId(event.target.value)}>
              <option value="">בחירת חבר</option>
              {friends.map((friend) => <option key={friend.profile_id} value={friend.profile_id}>{friend.display_name ?? "חבר"}</option>)}
            </select>
            <select value={resource} onChange={(event) => setResource(event.target.value)}>
              <option value="">בחירת פריט</option>
              {shareables.map((item) => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.label}</option>)}
            </select>
            <button type="button" onClick={() => void share()}>שיתוף</button>
          </div>
        )
        : <p className="empty-note">צרו קישור הזמנה כדי לחבר חבר ראשון.</p>}
      <div className="shared-inbox">
        <h3>שותף איתי</h3>
        {shares.map((share) => (
          <div key={share.id}>
            <strong>{share.resource_title ?? "פריט משותף"}</strong>
            <small>{share.owner_display_name ?? "חבר"} · {share.resource_type}</small>
          </div>
        ))}
      </div>
    </article>
  );
}
