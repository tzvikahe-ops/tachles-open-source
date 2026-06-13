import { useState } from "react";
import { Trash2 } from "lucide-react";
import { BottomSheet } from "../../components/BottomSheet";
import type { Memory, MemoryType } from "./types";

export type MemoryDraft = {
  title: string;
  content: string;
  type: MemoryType;
  tags: string;
  source_url: string;
};

export function MemorySheet(
  { memory, busy, onSave, onDelete, onClose }: {
    memory: Memory | null;
    busy: boolean;
    onSave: (draft: MemoryDraft) => void;
    onDelete: (() => void) | null;
    onClose: () => void;
  },
) {
  const [draft, setDraft] = useState<MemoryDraft>({
    title: memory?.title ?? "",
    content: memory?.content ?? "",
    type: memory?.type ?? "knowledge",
    tags: memory?.tags.join(", ") ?? "",
    source_url: memory?.source_url ?? "",
  });
  return (
    <BottomSheet title={memory ? "עריכת זיכרון" : "זיכרון חדש"} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.content.trim()) onSave(draft);
        }}
      >
        <label>
          כותרת<input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="אופציונלי"
          />
        </label>
        <label>
          תוכן<textarea
            rows={7}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
        </label>
        <label>
          סוג<select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as MemoryType })}
          >
            <option value="knowledge">ידע</option>
            <option value="inspiration">השראה</option>
            <option value="reflection">הרהור</option>
          </select>
        </label>
        <label>
          תגיות<input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="עבודה, רעיון, לקרוא"
          />
        </label>
        <label>
          כתובת מקור<input
            dir="ltr"
            value={draft.source_url}
            onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
            placeholder="https://"
          />
        </label>
        {!draft.content.trim()
          ? <small className="field-error">תוכן הזיכרון הוא שדה חובה.</small>
          : null}
        <div className="sheet-actions">
          {onDelete
            ? (
              <button type="button" className="delete-link" onClick={onDelete}>
                <Trash2 size={17} /> מחיקה
              </button>
            )
            : <span />}
          <button type="submit" className="primary-button" disabled={!draft.content.trim() || busy}>
            {busy ? "שומר..." : "שמירה"}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
