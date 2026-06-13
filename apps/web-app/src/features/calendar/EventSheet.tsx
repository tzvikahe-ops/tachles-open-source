import { useState } from "react";
import { Trash2 } from "lucide-react";
import { BottomSheet } from "../../components/BottomSheet";
import type { CalendarEvent, EventDraft } from "./types";

function localInput(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function EventSheet({
  event,
  initialDate,
  busy,
  conflict,
  onSave,
  onDelete,
  onClose,
}: {
  event: CalendarEvent | null;
  initialDate: string;
  busy: boolean;
  conflict: boolean;
  onSave: (draft: EventDraft) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const initialStart = event?.start_at ?? `${initialDate}T09:00:00`;
  const initialEnd = event?.end_at ?? `${initialDate}T10:00:00`;
  const [draft, setDraft] = useState<EventDraft>({
    title: event?.title ?? "",
    description: event?.description ?? "",
    location: event?.location ?? "",
    start_at: localInput(initialStart),
    end_at: localInput(initialEnd),
    all_day: event?.all_day ?? false,
  });
  const valid = draft.title.trim() && new Date(draft.end_at) > new Date(draft.start_at);

  return (
    <BottomSheet title={event ? "עריכת אירוע" : "אירוע חדש"} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (valid) onSave(draft);
        }}
      >
        {conflict
          ? <p className="form-warning">האירוע השתנה ב־Google. הצגנו את הגרסה העדכנית.</p>
          : null}
        <label>
          כותרת<input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="toggle-field">
          <span>אירוע של יום שלם</span>
          <input
            type="checkbox"
            checked={draft.all_day}
            onChange={(e) => setDraft({ ...draft, all_day: e.target.checked })}
          />
        </label>
        <div className="form-grid">
          <label>
            התחלה<input
              type={draft.all_day ? "date" : "datetime-local"}
              value={draft.all_day ? draft.start_at.slice(0, 10) : draft.start_at}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  start_at: draft.all_day ? `${e.target.value}T00:00` : e.target.value,
                })}
            />
          </label>
          <label>
            סיום<input
              type={draft.all_day ? "date" : "datetime-local"}
              value={draft.all_day ? draft.end_at.slice(0, 10) : draft.end_at}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  end_at: draft.all_day ? `${e.target.value}T00:00` : e.target.value,
                })}
            />
          </label>
        </div>
        <label>
          מיקום<input
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          />
        </label>
        <label>
          תיאור<textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        {!valid
          ? <small className="field-error">צריך כותרת ושעת סיום מאוחרת משעת ההתחלה.</small>
          : null}
        <div className="sheet-actions">
          {onDelete
            ? (
              <button type="button" className="delete-link" onClick={onDelete}>
                <Trash2 size={17} /> מחיקה
              </button>
            )
            : <span />}
          <button type="submit" className="primary-button" disabled={!valid || busy}>
            {busy ? "שומר..." : "שמירה"}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
