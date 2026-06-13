import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BellRing, CalendarClock, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { apiFetch } from "../../lib/api";

type Reminder = {
  id: string;
  title: string;
  run_at: string | null;
  schedule_type: "once" | "recurring";
};

const demoReminders: Reminder[] = [
  {
    id: "demo-reminder",
    title: "להתקשר למוסך",
    run_at: new Date(Date.now() + 86_400_000).toISOString(),
    schedule_type: "once",
  },
];

function formatReminderTime(value: string | null): string {
  if (!value) return "ממתינה לקביעת מועד";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RemindersScreen({
  session,
  demoMode,
  active,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  active: boolean;
  notify: (message: string) => void;
}) {
  const [reminders, setReminders] = useState<Reminder[]>(demoMode ? demoReminders : []);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<Reminder | null>(null);

  const loadReminders = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const result = await apiFetch<{ reminders: Reminder[] }>(session, "/reminders");
      setReminders(result.reminders);
    } catch {
      notify("לא הצלחתי לטעון את התזכורות.");
    } finally {
      setLoading(false);
    }
  }, [notify, session]);

  useEffect(() => {
    if (active) void loadReminders();
  }, [active, loadReminders]);

  const cancelSelected = async () => {
    if (!deleting) return;
    const reminder = deleting;
    setDeleting(null);
    if (!session) {
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
      notify("התזכורת בוטלה בתצוגת ההדגמה.");
      return;
    }
    try {
      await apiFetch(session, `/reminders/${reminder.id}`, { method: "DELETE" });
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
      notify("התזכורת בוטלה.");
    } catch {
      notify("לא הצלחתי לבטל את התזכורת.");
    }
  };

  return (
    <section className="reminders-view">
      <div className="projects-title reminders-title">
        <p className="date-line">הגשר</p>
        <div className="reminders-heading">
          <div>
            <h1>תזכורות</h1>
            <p>כל מה שביקשת מתכלס להזכיר, מסודר לפי המועד הקרוב.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="רענון תזכורות"
            onClick={() => void loadReminders()}
            disabled={loading || !session}
          >
            <RefreshCw size={20} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {loading && reminders.length === 0
        ? (
          <div className="feature-empty">
            <RefreshCw size={25} className="spin" />
            <p>טוען את התזכורות...</p>
          </div>
        )
        : reminders.length === 0
        ? (
          <div className="feature-empty">
            <BellRing size={32} />
            <h2>אין תזכורות פעילות</h2>
            <p>אפשר לכתוב למטה: „תזכיר לי מחר בשמונה להתקשר למוסך”.</p>
          </div>
        )
        : (
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <article className="reminder-card" key={reminder.id}>
                <span className="reminder-icon">
                  <CalendarClock size={22} />
                </span>
                <div className="reminder-copy">
                  <strong>{reminder.title}</strong>
                  <span>{formatReminderTime(reminder.run_at)}</span>
                  {reminder.schedule_type === "recurring" ? <small>תזכורת חוזרת</small> : null}
                </div>
                <button
                  className="reminder-delete"
                  type="button"
                  aria-label={`ביטול התזכורת ${reminder.title}`}
                  onClick={() => setDeleting(reminder)}
                >
                  <Trash2 size={19} />
                </button>
              </article>
            ))}
          </div>
        )}

      {deleting
        ? (
          <ConfirmDialog
            title="לבטל את התזכורת?"
            body={`„${deleting.title}” לא תישלח במועד שנקבע.`}
            confirmLabel="ביטול התזכורת"
            busyLabel="מבטל..."
            onCancel={() => setDeleting(null)}
            onConfirm={() => void cancelSelected()}
          />
        )
        : null}
    </section>
  );
}
