import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Bell,
  BellRing,
  BookOpenText,
  CalendarDays,
  Check,
  ChevronLeft,
  Circle,
  Clock3,
  Cloud,
  ExternalLink,
  FolderKanban,
  HardDrive,
  Home,
  Link2,
  Menu,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { ApiError, apiFetch } from "./lib/api";
import { CalendarScreen } from "./features/calendar/CalendarScreen";
import { MemoryScreen } from "./features/memory/MemoryScreen";
import { RemindersScreen } from "./features/reminders/RemindersScreen";
import { PushNotificationCard } from "./features/push/PushNotificationCard";
import { ToolsScreen } from "./features/tools/ToolsScreen";
import {
  ProjectActionSheet,
  type ProjectActionMode,
} from "./features/projects/ProjectActionSheet";

type LaterItem = {
  id: string;
  title: string;
  meta: string;
  done: boolean;
  status: "todo" | "doing" | "waiting" | "done";
};

const initialItems: LaterItem[] = [
  { id: "1", title: "לקנות חלב ולחם", meta: "רשימת קניות", done: false, status: "todo" },
  {
    id: "2",
    title: "לקבל הצעת מחיר מהמוסך",
    meta: "ממתין לאבי · מעקב מחר",
    done: false,
    status: "waiting",
  },
  { id: "3", title: "לסגור מלון לסוף השבוע", meta: "משימה", done: true, status: "done" },
];

type ApiTask = {
  id: string;
  title: string;
  status: "todo" | "doing" | "waiting" | "done";
  project_id: string | null;
  waiting_for: string | null;
  follow_up_at: string | null;
};

type ApiProject = {
  id: string;
  title: string;
  goal: string | null;
  status: "active" | "paused" | "done" | "archived";
  target_date: string | null;
  current_summary: string | null;
  next_step: string | null;
};

type ObsidianStatus = {
  enabled: boolean;
  google_connected: boolean;
  folder_url: string | null;
  exported_count: number;
};

type CaptureMode = "smart" | "task" | "memory" | "reminder" | "event" | "list";

type AssistantAction = {
  intent: string;
  status: "created" | "needs_input";
  message: string;
  entity_type?: string;
  entity?: ApiTask;
};

const captureModes: Array<{ id: CaptureMode; label: string; hint: string }> = [
  { id: "smart", label: "חכם", hint: "אני אבין לבד" },
  { id: "task", label: "משימה", hint: "משהו שצריך לעשות" },
  { id: "memory", label: "זיכרון", hint: "רעיון או מידע לשמור" },
  { id: "reminder", label: "תזכורת", hint: "כולל מועד" },
  { id: "event", label: "אירוע", hint: "להוסיף ליומן" },
  { id: "list", label: "רשימה", hint: "כמה פריטים יחד" },
];

const navItems = [
  { id: "home", label: "בית", icon: Home },
  { id: "calendar", label: "יומן", icon: CalendarDays },
  { id: "projects", label: "פרויקטים", icon: FolderKanban },
  { id: "memory", label: "זיכרון", icon: BookOpenText },
  { id: "more", label: "כלים", icon: Menu },
] as const;

function toLaterItem(task: ApiTask): LaterItem {
  const meta = task.status === "waiting"
    ? task.waiting_for ? `ממתין ל${task.waiting_for}` : "ממתין לתשובה"
    : task.status === "doing"
    ? "בתהליך"
    : task.project_id
    ? "משימת פרויקט"
    : "משימה";
  return {
    id: task.id,
    title: task.title,
    meta,
    done: task.status === "done",
    status: task.status,
  };
}

export function App({
  demoMode = true,
  session = null,
}: {
  demoMode?: boolean;
  session?: Session | null;
}) {
  const [items, setItems] = useState<LaterItem[]>(demoMode ? initialItems : []);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [activeNav, setActiveNav] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    if (params.get("view") === "reminders") return "reminders";
    if (params.get("view") === "agents") return "more";
    return integration === "calendar-connected" ? "calendar" : integration ? "more" : "home";
  });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [obsidian, setObsidian] = useState<ObsidianStatus | null>(null);
  const [obsidianBusy, setObsidianBusy] = useState(false);
  const [projectAction, setProjectAction] = useState<ProjectActionMode | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("smart");
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const micHeldRef = useRef(false);
  const recordingStartingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);

  useEffect(() => {
    if (!session) return;
    let active = true;
    Promise.all([
      apiFetch<{ projects: ApiProject[] }>(session, "/projects"),
      apiFetch<{ tasks: ApiTask[] }>(session, "/tasks"),
      apiFetch<ObsidianStatus>(session, "/integrations/obsidian"),
    ]).then(([projectData, taskData, obsidianData]) => {
      if (!active) return;
      setProjects(projectData.projects);
      setItems(taskData.tasks.map(toLaterItem));
      setObsidian(obsidianData);
      const integration = new URLSearchParams(window.location.search).get("integration");
      if (integration === "obsidian-connected") {
        setNotice("Obsidian מחובר. אפשר לסנכרן את המחברת.");
        window.history.replaceState({}, "", "/");
      } else if (integration === "obsidian-error") {
        setNotice("החיבור ל־Obsidian לא הושלם.");
        window.history.replaceState({}, "", "/");
      } else if (integration === "calendar-connected") {
        setNotice("Google Calendar מחובר. היומן מוכן.");
        setActiveNav("calendar");
        window.history.replaceState({}, "", "/");
      }
    }).catch(() => {
      if (active) setNotice("לא הצלחתי לטעון את המחברת כרגע.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session || demoMode) return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (!invite) return;
    apiFetch(session, "/friends/consume", {
      method: "POST",
      body: JSON.stringify({ token: invite }),
    }).then(() => {
      setNotice("החיבור לחבר הושלם.");
      params.delete("invite");
      window.history.replaceState({}, "", `${window.location.pathname}${
        params.size ? `?${params}` : ""
      }`);
    }).catch(() => setNotice("קישור ההזמנה אינו תקף או שפג תוקפו."));
  }, [session, demoMode]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
  }, []);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const connectObsidian = async () => {
    if (!session) {
      setNotice("במצב ההדגמה החיבור אינו משנה את Google Drive.");
      return;
    }
    setObsidianBusy(true);
    try {
      const result = await apiFetch<{ url: string }>(
        session,
        "/integrations/obsidian/connect",
        { method: "POST" },
      );
      window.location.assign(result.url);
    } catch {
      setNotice("לא הצלחתי לפתוח את החיבור ל־Google Drive.");
      setObsidianBusy(false);
    }
  };

  const syncObsidian = async () => {
    if (!session) {
      setNotice("בהפעלה אמיתית כל הזיכרונות והמשימות ייכתבו כקובצי Markdown.");
      return;
    }
    setObsidianBusy(true);
    try {
      const result = await apiFetch<{ bubbles: number; tasks: number }>(
        session,
        "/integrations/obsidian/sync",
        { method: "POST" },
      );
      setObsidian((current) =>
        current ? { ...current, exported_count: result.bubbles + result.tasks } : current
      );
      setNotice(`סונכרנו ${result.bubbles} זיכרונות ו־${result.tasks} משימות.`);
    } catch {
      setNotice("הסנכרון נכשל. כדאי לבדוק שהרשאת Drive עדיין פעילה.");
    } finally {
      setObsidianBusy(false);
    }
  };

  const toggleItem = async (id: string) => {
    const previous = items.find((item) => item.id === id);
    if (!previous) return;
    const status = previous.done ? "todo" : "done";
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, done: !item.done, status, meta: status === "done" ? "הושלם" : "משימה" }
          : item
      )
    );
    if (!session) return;
    try {
      await apiFetch(session, `/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch {
      setItems((current) => current.map((item) => item.id === id ? previous : item));
      setNotice("לא הצלחתי לעדכן את המשימה.");
    }
  };

  const reloadTasks = useCallback(async () => {
    if (!session) return;
    const result = await apiFetch<{ tasks: ApiTask[] }>(session, "/tasks");
    setItems(result.tasks.map(toLaterItem));
  }, [session]);

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text) {
      setNotice("אפשר פשוט לכתוב מה צריך לעשות");
      return;
    }
    setCaptureBusy(true);
    setDraft("");
    if (session) {
      try {
        const response = await apiFetch<{ actions: AssistantAction[] }>(
          session,
          "/assistant/text",
          {
          method: "POST",
            body: JSON.stringify({ text, mode: captureMode }),
          },
        );
        const tasks = response.actions
          .filter((action) => action.entity_type === "task" && action.entity)
          .map((action) => action.entity as ApiTask);
        if (tasks.length > 0) {
          setItems((current) => [...tasks.map(toLaterItem), ...current]);
        }
        setNotice(response.actions.map((action) => action.message).join(" "));
        setCaptureMode("smart");
      } catch {
        setDraft(text);
        setNotice("לא הצלחתי לשמור כרגע.");
      }
    } else {
      setItems((current) => [
        { id: String(Date.now()), title: text, meta: "נוסף עכשיו", done: false, status: "todo" },
        ...current,
      ]);
      setNotice("רשמתי. זה מחכה לך בהמשך היום.");
    }
    setCaptureBusy(false);
  };

  const uploadFile = async (file: File) => {
    if (!session) {
      setNotice("העלאת קבצים זמינה לאחר כניסה.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setNotice("הקובץ גדול מדי. אפשר להעלות עד 20MB.");
      return;
    }
    setCaptureBusy(true);
    setNotice(`מעלה את ${file.name}...`);
    try {
      const form = new FormData();
      form.append("file", file);
      if (file.type.startsWith("image/") && (captureMode === "task" || captureMode === "list")) {
        form.append("mode", "actions");
      }
      if (draft.trim()) form.append("caption", draft.trim());
      const response = await apiFetch<{ message: string; tasks?: ApiTask[] }>(
        session,
        "/assistant/file",
        { method: "POST", body: form },
      );
      if (response.tasks?.length) {
        setItems((current) => [...response.tasks!.map(toLaterItem), ...current]);
      }
      setDraft("");
      setCaptureMode("smart");
      setNotice(response.message);
    } catch (error) {
      if (error instanceof ApiError && error.code === "file_too_large") {
        setNotice("הקובץ גדול מדי. אפשר להעלות עד 20MB.");
      } else if (error instanceof ApiError && error.code === "file_required") {
        setNotice("הקובץ לא הגיע לשרת. נסו לבחור אותו שוב.");
      } else {
        setNotice("לא הצלחתי לשמור את הקובץ. נסו שוב.");
      }
    } finally {
      setCaptureBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const uploadRecording = async (blob: Blob) => {
    if (!session) {
      setNotice("הקלטה חכמה זמינה לאחר כניסה.");
      return;
    }
    setCaptureBusy(true);
    setNotice("מתמלל ומבצע...");
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.append("audio", new File([blob], `recording.${extension}`, { type: blob.type }));
      const response = await apiFetch<{
        transcript: string;
        actions: AssistantAction[];
      }>(session, "/assistant/voice", { method: "POST", body: form });
      const tasks = response.actions
        .filter((action) => action.entity_type === "task" && action.entity)
        .map((action) => action.entity as ApiTask);
      if (tasks.length > 0) {
        setItems((current) => [...tasks.map(toLaterItem), ...current]);
      }
      const result = response.actions.map((action) => action.message).join(" ");
      setNotice(`שמעתי: ${response.transcript}. ${result}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "audio_too_large") {
        setNotice("ההקלטה ארוכה מדי. נסו להקליט קטע קצר יותר.");
      } else if (error instanceof ApiError && error.code === "empty_transcript") {
        setNotice("לא הצלחתי לשמוע מילים בהקלטה.");
      } else if (error instanceof ApiError && error.code === "audio_required") {
        setNotice("ההקלטה לא הגיעה לשרת. נסו שוב.");
      } else {
        setNotice("לא הצלחתי לתמלל את ההקלטה. נסו שוב.");
      }
    } finally {
      setCaptureBusy(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const startRecording = async () => {
    if (recording || recordingStartingRef.current || captureBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("הדפדפן הזה לא תומך בהקלטה. אפשר להשתמש בהכתבה של המקלדת.");
      return;
    }
    recordingStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!micHeldRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setNotice("המיקרופון מוכן. לחצו והחזיקו כדי להקליט.");
        return;
      }
      const supportedType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        supportedType ? { mimeType: supportedType } : undefined,
      );
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Date.now() - recordingStartedAtRef.current;
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);
        recordingStartedAtRef.current = 0;
        if (duration < 500 || blob.size === 0) {
          setNotice("ההקלטה קצרה מדי. לחצו והחזיקו בזמן הדיבור.");
          return;
        }
        void uploadRecording(blob);
      };
      recorder.start(250);
      setRecordingSeconds(0);
      setRecording(true);
      setNotice("מקליט... שחררו כדי לשלוח.");
    } catch {
      setNotice("לא התקבלה הרשאה למיקרופון.");
    } finally {
      recordingStartingRef.current = false;
    }
  };

  const beginMicHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (captureBusy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    micHeldRef.current = true;
    void startRecording();
  };

  const endMicHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    micHeldRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopRecording();
  };

  const cancelMicHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    micHeldRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopRecording();
  };

  const chooseCaptureMode = (mode: CaptureMode) => {
    setCaptureMode(mode);
    setCaptureMenuOpen(false);
    window.setTimeout(() => draftInputRef.current?.focus(), 0);
  };

  const openProjects = () => {
    setActiveNav("projects");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeProject = projects[0] ?? null;
  const projectTitle = activeProject?.title ??
    (demoMode ? "להכין את תכלס להשקה" : "הפרויקט הראשון שלך");
  const projectGoal = activeProject?.goal ??
    (demoMode
      ? "אפליקציית PWA שעובדת באופן עצמאי לצד הבוט."
      : "אפשר ליצור פרויקט חדש ולרכז בו משימות, ידע וקישורים.");
  const projectNext = activeProject?.next_step ??
    (demoMode ? "לחבר את מסך הבית לנתונים האמיתיים" : "להגדיר מטרה וצעד ראשון");
  const progress = items.length === 0
    ? 0
    : Math.round(items.filter((item) => item.done).length / items.length * 100);
  const timelineItems = demoMode
    ? [
      { title: "זהות וקישור חשבונות", meta: "הושלם", className: "is-complete" },
      { title: "פרויקטים ותיבת קליטה", meta: "עובדים עכשיו", className: "is-current" },
      { title: "אימות Push במכשיר", meta: "ממתין להגדרת VAPID", className: "is-waiting" },
      { title: "מחקר ותכנון יום", meta: "השלב הבא", className: "" },
    ]
    : items.slice(0, 8).map((item) => ({
      title: item.title,
      meta: item.meta,
      className: item.done
        ? "is-complete"
        : item.status === "doing"
        ? "is-current"
        : item.status === "waiting"
        ? "is-waiting"
        : "",
    }));

  return (
    <div className="app-frame">
      <div className="paper-grain" aria-hidden="true" />

      <header className="topbar">
        <button
          className="icon-button notification-button"
          type="button"
          aria-label="תזכורות"
          onClick={() => setActiveNav("reminders")}
        >
          <Bell size={21} strokeWidth={1.8} />
          <span className="notification-dot" />
        </button>
        <div className="brand-mark" aria-label="תכלס">
          <span className="brand-stitch" />
          <span>תכלס</span>
        </div>
      </header>

      {demoMode ? <div className="demo-ribbon">תצוגת הדגמה</div> : null}

      <main>
        <div hidden={activeNav !== "calendar"}>
          <CalendarScreen session={session} demoMode={demoMode} notify={showNotice} />
        </div>

        <div hidden={activeNav !== "memory"}>
          <MemoryScreen session={session} demoMode={demoMode} notify={showNotice} />
        </div>

        <div hidden={activeNav !== "reminders"}>
          <RemindersScreen
            session={session}
            demoMode={demoMode}
            active={activeNav === "reminders"}
            notify={showNotice}
          />
        </div>

        <section className="projects-view" hidden={activeNav !== "projects"}>
          <div className="projects-title">
            <p className="date-line">המחברת בפעולה</p>
            <h1>פרויקטים</h1>
            <p>כל מה שצריך כדי לקדם תוצאה אחת, בלי לפזר את החומר בין מקומות.</p>
          </div>

          <article className="project-page-card">
            <div className="project-heading">
              <span className="section-kicker">
                <FolderKanban size={16} strokeWidth={1.8} />
                פעיל
              </span>
              <span className="project-progress">{demoMode ? 43 : progress}%</span>
            </div>
            <h2>{projectTitle}</h2>
            <p className="project-goal">מטרה: {projectGoal}</p>
            <div
              className="project-track"
              aria-label={`${demoMode ? 43 : progress} אחוז הושלמו`}
            >
              <span style={{ width: `${demoMode ? 43 : progress}%` }} />
            </div>
            <div className="project-next">
              <small>הצעד הבא</small>
              <strong>{projectNext}</strong>
            </div>
          </article>

          <div className="project-actions">
            <button type="button" onClick={() => setProjectAction("plan")}>
              <WandSparkles size={18} />
              הצעת תוכנית
            </button>
            <button type="button" onClick={() => setProjectAction("research")}>
              <Search size={18} />
              מחקר
            </button>
          </div>

          <section className="timeline-card" aria-labelledby="timeline-title">
            <div className="section-header">
              <div>
                <span className="terracotta-rule" />
                <h2 id="timeline-title">הדרך מכאן</h2>
              </div>
            </div>
            {timelineItems.length > 0
              ? (
                <ol className="project-timeline">
                  {timelineItems.map((item) => (
                    <li key={`${item.title}-${item.meta}`} className={item.className}>
                      <span />
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.meta}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              )
              : <p className="empty-note">עוד אין משימות בפרויקט.</p>}
          </section>

          <section className="knowledge-card">
            <div>
              <span className="section-kicker">
                <Link2 size={16} /> מאגר הידע של הפרויקט
              </span>
              <h2>{demoMode ? "3 מקורות מחוברים" : "מאגר הידע מוכן"}</h2>
            </div>
            {demoMode
              ? (
                <div className="knowledge-chips">
                  <span>תוכנית הביצוע</span>
                  <span>מחקר מתחרים</span>
                  <span>החלטות עיצוב</span>
                </div>
              )
              : <p className="empty-note">קישורים, מחקרים וזיכרונות שתשייכו יופיעו כאן.</p>}
          </section>
        </section>

        <div hidden={activeNav !== "home"}>
          <section className="greeting">
            <p className="date-line">שבת, 13 ביוני</p>
            <h1>בוקר טוב</h1>
            <p className="greeting-note">
              {loading ? "פותח את המחברת..." : "היום די פתוח. יש דבר אחד שכדאי לסגור בבוקר."}
            </p>
          </section>

          <section className="focus-sheet" aria-labelledby="focus-title">
            <div className="sheet-tape" aria-hidden="true" />
            <div className="sheet-heading">
              <div>
                <span className="section-kicker">
                  <Sparkles size={16} strokeWidth={1.8} />
                  המיקוד שלך
                </span>
                <h2 id="focus-title">מה חשוב עכשיו</h2>
              </div>
              <span className="time-note">10:30</span>
            </div>

            <button
              className="focus-task"
              type="button"
              onClick={() => setNotice("מעולה. סימנתי שהתחלת.")}
            >
              <span className="focus-check">
                <Circle size={24} strokeWidth={1.5} />
              </span>
              <span className="focus-copy">
                <strong>לקחת את הרכב לטיפול</strong>
                <small>יוצאים בעוד שעה · 18 דקות נסיעה</small>
              </span>
              <ChevronLeft size={21} strokeWidth={1.7} />
            </button>
          </section>

          <section className="project-glimpse" aria-labelledby="project-title">
            <div className="project-heading">
              <span className="section-kicker">
                <FolderKanban size={16} strokeWidth={1.8} />
                פרויקט פעיל
              </span>
              <span className="project-progress">
                {demoMode
                  ? "3 מתוך 7"
                  : `${items.filter((item) => item.done).length} מתוך ${items.length}`}
              </span>
            </div>
            <h2 id="project-title">{projectTitle}</h2>
            <p>הצעד הבא: {projectNext}.</p>
            <div className="project-track" aria-label="43 אחוז הושלמו">
              <span />
            </div>
            <div className="project-footer">
              <span>
                <Clock3 size={14} /> יעד: סוף יוני
              </span>
              <button
                type="button"
                className="text-button"
                onClick={openProjects}
              >
                לפתוח
              </button>
            </div>
          </section>

          <section className="later-section" aria-labelledby="later-title">
            <div className="section-header">
              <div>
                <span className="terracotta-rule" aria-hidden="true" />
                <h2 id="later-title">אחר כך</h2>
              </div>
              <button type="button" className="text-button">
                לראות הכל
              </button>
            </div>

            <div className="task-list">
              {items.length === 0 && !loading
                ? <p className="empty-note">אין משימות פתוחות. אפשר לכתוב אחת בשורה למטה.</p>
                : items.map((item) => (
                  <button
                    key={item.id}
                    className={`task-row ${item.done ? "is-done" : ""}`}
                    type="button"
                    onClick={() => void toggleItem(item.id)}
                  >
                    <span className="round-check">
                      {item.done ? <Check size={16} strokeWidth={2.5} /> : null}
                    </span>
                    <span className="task-copy">
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </span>
                  </button>
                ))}
            </div>
          </section>

          <section className="memory-glimpse" aria-label="מהמעיין">
            <BookOpenText size={20} strokeWidth={1.7} />
            <div>
              <span>משהו ששמרת</span>
              <p>“דברים קטנים נסגרים טוב יותר כשהם מקבלים שעה.”</p>
            </div>
          </section>
        </div>

        <section className="settings-view" hidden={activeNav !== "more"}>
          <ToolsScreen session={session} demoMode={demoMode} notify={showNotice} />

          <div className="projects-title">
            <p className="date-line">חיבורים וגיבוי</p>
            <h1>חיבורים</h1>
            <p>שירותים שמרחיבים את המחברת בלי להפוך אותה למסובכת.</p>
          </div>

          <button
            className="more-feature-link"
            type="button"
            onClick={() => setActiveNav("reminders")}
          >
            <span className="integration-icon">
              <BellRing size={23} />
            </span>
            <span>
              <strong>התזכורות שלי</strong>
              <small>צפייה וביטול של תזכורות פעילות</small>
            </span>
            <ChevronLeft size={20} />
          </button>

          <PushNotificationCard
            session={session}
            demoMode={demoMode}
            notify={showNotice}
          />

          <article className="integration-card">
            <div className="integration-heading">
              <span className="integration-icon">
                <HardDrive size={23} />
              </span>
              <div>
                <span className="section-kicker">Obsidian</span>
                <h2>הכספת המקומית שלך</h2>
              </div>
              <span className={`status-pill ${obsidian?.enabled ? "is-on" : ""}`}>
                {obsidian?.enabled ? "מחובר" : "לא מחובר"}
              </span>
            </div>
            <p>
              תכלס שומרת עותקי Markdown של זיכרונות, משימות וסיכומים בתוך תיקיית Google Drive שאפשר
              לפתוח כ־Vault ב־Obsidian.
            </p>
            <div className="sync-direction">
              <Cloud size={18} />
              <span>תכלס</span>
              <span aria-hidden="true">←</span>
              <span>Obsidian</span>
            </div>
            {obsidian?.enabled
              ? (
                <>
                  <div className="integration-stats">
                    <span>פריטים שיוצאו</span>
                    <strong>{obsidian.exported_count}</strong>
                  </div>
                  <div className="integration-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void syncObsidian()}
                      disabled={obsidianBusy}
                    >
                      <RefreshCw size={18} className={obsidianBusy ? "spin" : ""} />
                      {obsidianBusy ? "מסנכרן..." : "סנכרון עכשיו"}
                    </button>
                    {obsidian.folder_url
                      ? (
                        <a href={obsidian.folder_url} target="_blank" rel="noreferrer">
                          <ExternalLink size={17} />
                          פתיחת התיקייה
                        </a>
                      )
                      : null}
                  </div>
                </>
              )
              : (
                <button
                  className="primary-button integration-connect"
                  type="button"
                  onClick={() => void connectObsidian()}
                  disabled={obsidianBusy}
                >
                  <Cloud size={18} />
                  {obsidianBusy ? "פותח את Google..." : "חיבור Google Drive"}
                </button>
              )}
            <small className="integration-note">
              הסנכרון חד־כיווני. עריכה ב־Obsidian לא משנה את המידע בתכלס.
            </small>
          </article>

          <article className="setup-steps">
            <span className="terracotta-rule" />
            <h2>אחרי החיבור במחשב</h2>
            <ol>
              <li>מתקינים Google Drive Desktop וממתינים שהתיקייה תופיע במחשב.</li>
              <li>פותחים את Obsidian ובוחרים “Open folder as vault”.</li>
              <li>בוחרים את התיקייה Tachles מתוך Google Drive.</li>
            </ol>
          </article>
        </section>
      </main>

      {notice ? <div className="toast" role="status">{notice}</div> : null}

      {projectAction
        ? (
          <ProjectActionSheet
            mode={projectAction}
            session={session}
            demoMode={demoMode}
            project={activeProject}
            onClose={() => setProjectAction(null)}
            onProjectCreated={(project) => setProjects((current) => [project, ...current])}
            onTasksCreated={reloadTasks}
            notify={showNotice}
          />
        )
        : null}

      <div className="bottom-zone">
        {captureMenuOpen
          ? (
            <div className="capture-menu" role="menu" aria-label="סוג רישום">
              <div className="capture-menu-head">
                <strong>מה לרשום?</strong>
                <button
                  type="button"
                  aria-label="סגירת תפריט"
                  onClick={() => setCaptureMenuOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="capture-menu-grid">
                {captureModes.map((mode) => (
                  <button
                    key={mode.id}
                    className={captureMode === mode.id ? "active" : ""}
                    type="button"
                    role="menuitem"
                    onClick={() => chooseCaptureMode(mode.id)}
                  >
                    <strong>{mode.label}</strong>
                    <span>{mode.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )
          : null}
        {recording
          ? (
            <div className="recording-status" role="status">
              <span className="recording-dot" />
              מקליט {Math.floor(recordingSeconds / 60)}:
              {String(recordingSeconds % 60).padStart(2, "0")}
              <span className="recording-release">שחררו לשליחה</span>
            </div>
          )
          : null}
        <div className="capture-bar">
          <button
            className="capture-more"
            type="button"
            aria-label="אפשרויות נוספות"
            aria-expanded={captureMenuOpen}
            onClick={() => setCaptureMenuOpen((open) => !open)}
            disabled={captureBusy || recording}
          >
            <Plus size={24} strokeWidth={1.8} />
          </button>
          <input
            ref={draftInputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !captureBusy) void submitDraft();
            }}
            aria-label="כתיבה לתכלס"
            placeholder={captureMode === "smart"
              ? "לכתוב לתכלס..."
              : `${captureModes.find((mode) => mode.id === captureMode)?.label}: מה לרשום?`}
            disabled={captureBusy || recording}
          />
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*,application/pdf,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <button
            className="capture-icon"
            type="button"
            aria-label="הוספת קובץ"
            onClick={() => fileInputRef.current?.click()}
            disabled={captureBusy || recording}
          >
            <Paperclip size={20} strokeWidth={1.8} />
          </button>
          <button
            className={`capture-icon ${recording ? "recording" : ""}`}
            type="button"
            aria-label="לחצו והחזיקו להקלטה"
            onPointerDown={beginMicHold}
            onPointerUp={endMicHold}
            onPointerCancel={cancelMicHold}
            onContextMenu={(event) => event.preventDefault()}
            disabled={captureBusy}
          >
            <Mic size={20} strokeWidth={recording ? 2.5 : 1.8} />
          </button>
          <button
            className="send-button"
            type="button"
            aria-label="שליחה"
            onClick={() => void submitDraft()}
            disabled={captureBusy || recording}
          >
            {captureBusy
              ? <RefreshCw size={18} className="spin" />
              : <Send size={19} strokeWidth={1.9} />}
          </button>
        </div>

        <nav className="bottom-nav" aria-label="ניווט ראשי">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                className={active ? "active" : ""}
                type="button"
                onClick={() => {
                  setActiveNav(item.id);
                }}
              >
                <Icon size={22} strokeWidth={active ? 2.1 : 1.65} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
