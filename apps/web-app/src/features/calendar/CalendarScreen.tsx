import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CalendarPlus, Clock3, MapPin, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ApiError, apiFetch } from "../../lib/api";
import { EventSheet } from "./EventSheet";
import type { CalendarEvent, EventDraft } from "./types";

const demoEvents: CalendarEvent[] = [
  {
    id: "demo-1",
    title: "טיפול לרכב",
    description: "להביא את ספר הטיפולים",
    location: "המוסך של אבי",
    start_at: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(),
    end_at: new Date(new Date().setHours(11, 30, 0, 0)).toISOString(),
    all_day: false,
    google_etag: null,
    google_updated_at: null,
    html_link: null,
  },
];

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const displayTime = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function CalendarScreen(
  { session, demoMode, notify }: {
    session: Session | null;
    demoMode: boolean;
    notify: (message: string) => void;
  },
) {
  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    }), []);
  const [selected, setSelected] = useState(dateKey(days[0]));
  const [events, setEvents] = useState<CalendarEvent[]>(demoMode ? demoEvents : []);
  const [connected, setConnected] = useState(demoMode);
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const from = new Date(`${selected}T00:00:00`);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const [status, data] = await Promise.all([
        apiFetch<{ connected: boolean }>(session, "/calendar/status"),
        apiFetch<{ events: CalendarEvent[] }>(
          session,
          `/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${
            encodeURIComponent(to.toISOString())
          }`,
        ),
      ]);
      setConnected(status.connected);
      setEvents(data.events);
    } catch {
      notify("לא הצלחתי לטעון את היומן.");
    } finally {
      setLoading(false);
    }
  }, [notify, selected, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!session) return notify("במצב הדגמה היומן אינו משנה את Google.");
    const { url } = await apiFetch<{ url: string }>(session, "/calendar/connect", {
      method: "POST",
    });
    window.location.assign(url);
  };

  const save = async (draft: EventDraft) => {
    const payload = {
      ...draft,
      start_at: new Date(draft.start_at).toISOString(),
      end_at: new Date(draft.end_at).toISOString(),
      expected_etag: editing !== "new" ? editing?.google_etag : null,
    };
    if (!session) {
      const next = {
        ...payload,
        id: editing === "new" ? `demo-${Date.now()}` : editing!.id,
        google_etag: null,
        google_updated_at: null,
        html_link: null,
      };
      setEvents((current) =>
        editing === "new"
          ? [...current, next]
          : current.map((item) => item.id === next.id ? next : item)
      );
      setEditing(null);
      notify("האירוע נשמר בתצוגת ההדגמה.");
      return;
    }
    setBusy(true);
    try {
      const path = editing === "new" ? "/calendar/events" : `/calendar/events/${editing!.id}`;
      const result = await apiFetch<{ event: CalendarEvent }>(session, path, {
        method: editing === "new" ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      setEvents((current) =>
        editing === "new"
          ? [...current, result.event]
          : current.map((item) => item.id === result.event.id ? result.event : item)
      );
      setEditing(null);
      setConflict(false);
      notify("האירוע נשמר.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "calendar_conflict") {
        const latest = error.details.event as CalendarEvent;
        setEditing(latest);
        setConflict(true);
        setEvents((current) => current.map((item) => item.id === latest.id ? latest : item));
      } else notify("לא הצלחתי לשמור את האירוע.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      if (session) await apiFetch(session, `/calendar/events/${deleting.id}`, { method: "DELETE" });
      setEvents((current) => current.filter((item) => item.id !== deleting.id));
      setDeleting(null);
      setEditing(null);
      notify("האירוע נמחק.");
    } catch {
      notify("לא הצלחתי למחוק את האירוע.");
    } finally {
      setBusy(false);
    }
  };

  const visible = events.filter((event) =>
    event.start_at.slice(0, 10) === selected || dateKey(new Date(event.start_at)) === selected
  ).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <section className="feature-screen">
      <div className="feature-heading">
        <div>
          <p className="date-line">הגשר</p>
          <h1>יומן</h1>
          <p>היום והשבוע הקרוב, בלי רעש מסביב.</p>
        </div>
        <button
          className="round-action"
          type="button"
          onClick={() => setEditing("new")}
          aria-label="אירוע חדש"
        >
          <CalendarPlus size={21} />
        </button>
      </div>
      <div className="week-strip">
        {days.map((day) => (
          <button
            key={dateKey(day)}
            className={selected === dateKey(day) ? "active" : ""}
            onClick={() => setSelected(dateKey(day))}
          >
            <small>{new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(day)}</small>
            <strong>{day.getDate()}</strong>
          </button>
        ))}
      </div>
      {!connected
        ? (
          <div className="feature-empty">
            <CalendarPlus size={30} />
            <h2>מחברים את Google Calendar</h2>
            <p>אחרי החיבור אפשר לראות, ליצור, לערוך ולמחוק אירועים.</p>
            <button className="primary-button" onClick={() => void connect()}>חיבור היומן</button>
          </div>
        )
        : (
          <>
            <div className="feature-toolbar">
              <strong>
                {new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(
                  new Date(`${selected}T12:00:00`),
                )}
              </strong>
              <button
                onClick={async () => {
                  if (session) {
                    setBusy(true);
                    try {
                      await apiFetch(session, "/calendar/sync", { method: "POST" });
                      await load();
                      notify("היומן סונכרן.");
                    } finally {
                      setBusy(false);
                    }
                  }
                }}
                disabled={busy}
              >
                <RefreshCw size={16} className={busy ? "spin" : ""} /> סנכרון
              </button>
            </div>
            {loading
              ? <p className="feature-loading">טוען אירועים...</p>
              : visible.length === 0
              ? (
                <div className="feature-empty compact">
                  <Clock3 size={28} />
                  <h2>היום פנוי</h2>
                  <p>אפשר להוסיף אירוע או פשוט להשאיר מקום לנשימה.</p>
                </div>
              )
              : (
                <div className="event-list">
                  {visible.map((event) => (
                    <button
                      className="event-card"
                      key={event.id}
                      onClick={() => {
                        setConflict(false);
                        setEditing(event);
                      }}
                    >
                      <span className="event-time">
                        {event.all_day
                          ? "כל היום"
                          : `${displayTime(event.start_at)}–${displayTime(event.end_at)}`}
                      </span>
                      <div>
                        <strong>{event.title}</strong>
                        {event.location
                          ? (
                            <small>
                              <MapPin size={13} />
                              {event.location}
                            </small>
                          )
                          : null}
                        {event.description ? <p>{event.description}</p> : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
          </>
        )}
      {editing
        ? (
          <EventSheet
            key={editing === "new" ? "new" : `${editing.id}-${editing.google_etag}`}
            event={editing === "new" ? null : editing}
            initialDate={selected}
            busy={busy}
            conflict={conflict}
            onSave={(draft) => void save(draft)}
            onDelete={editing === "new" ? null : () => setDeleting(editing)}
            onClose={() => {
              setEditing(null);
              setConflict(false);
            }}
          />
        )
        : null}
      {deleting
        ? (
          <ConfirmDialog
            title="למחוק את האירוע?"
            body={`האירוע „${deleting.title}” יימחק גם מ־Google Calendar.`}
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => setDeleting(null)}
          />
        )
        : null}
    </section>
  );
}
