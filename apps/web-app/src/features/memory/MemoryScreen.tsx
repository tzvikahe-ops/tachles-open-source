import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpenText, ExternalLink, Plus, Search } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { apiFetch } from "../../lib/api";
import { type MemoryDraft, MemorySheet } from "./MemorySheet";
import type { Memory, MemoryType } from "./types";

const labels: Record<MemoryType, string> = {
  knowledge: "ידע",
  inspiration: "השראה",
  reflection: "הרהור",
};
const demoMemories: Memory[] = [
  {
    id: "m1",
    type: "reflection",
    title: "שעת מיקוד",
    content: "דברים קטנים נסגרים טוב יותר כשהם מקבלים שעה ביומן.",
    tags: ["מיקוד", "הרגלים"],
    source_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "m2",
    type: "knowledge",
    title: "PWA",
    content: "המסך הראשי צריך לתת ערך גם בלי לפתוח שיחה עם הבוט.",
    tags: ["תכלס"],
    source_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export function MemoryScreen(
  { session, demoMode, notify }: {
    session: Session | null;
    demoMode: boolean;
    notify: (message: string) => void;
  },
) {
  const [memories, setMemories] = useState<Memory[]>(demoMode ? demoMemories : []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (query.trim()) params.set("q", query.trim());
    if (filter !== "all") params.set("type", filter);
    try {
      const data = await apiFetch<{ memories: Memory[] }>(session, `/memories?${params}`);
      setMemories(data.memories);
    } catch {
      notify("לא הצלחתי לטעון את הזיכרונות.");
    } finally {
      setLoading(false);
    }
  }, [filter, notify, query, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 280);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (draft: MemoryDraft) => {
    const payload = {
      ...draft,
      title: draft.title.trim() || null,
      content: draft.content.trim(),
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      source_url: draft.source_url.trim() || null,
    };
    if (!session) {
      const memory: Memory = {
        ...payload,
        id: editing === "new" ? `demo-${Date.now()}` : editing!.id,
        created_at: editing === "new" ? new Date().toISOString() : editing!.created_at,
        updated_at: new Date().toISOString(),
      };
      setMemories((current) =>
        editing === "new"
          ? [memory, ...current]
          : current.map((item) => item.id === memory.id ? memory : item)
      );
      setEditing(null);
      notify("הזיכרון נשמר בתצוגת ההדגמה.");
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ memory: Memory }>(
        session,
        editing === "new" ? "/memories" : `/memories/${editing!.id}`,
        { method: editing === "new" ? "POST" : "PATCH", body: JSON.stringify(payload) },
      );
      setMemories((current) =>
        editing === "new"
          ? [result.memory, ...current]
          : current.map((item) => item.id === result.memory.id ? result.memory : item)
      );
      setEditing(null);
      notify("הזיכרון נשמר.");
    } catch {
      notify("לא הצלחתי לשמור את הזיכרון.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      if (session) await apiFetch(session, `/memories/${deleting.id}`, { method: "DELETE" });
      setMemories((current) => current.filter((item) => item.id !== deleting.id));
      setDeleting(null);
      setEditing(null);
      notify("הזיכרון נמחק.");
    } catch {
      notify("לא הצלחתי למחוק את הזיכרון.");
    } finally {
      setBusy(false);
    }
  };

  const visible = session
    ? memories
    : memories.filter((memory) =>
      (filter === "all" || memory.type === filter) &&
      `${memory.title ?? ""} ${memory.content}`.includes(query)
    );
  return (
    <section className="feature-screen memory-screen">
      <div className="feature-heading">
        <div>
          <p className="date-line">המעיין</p>
          <h1>זיכרון</h1>
          <p>רעיונות, ידע והרהורים שמחכים בדיוק לרגע הנכון.</p>
        </div>
        <button
          className="round-action"
          type="button"
          onClick={() => setEditing("new")}
          aria-label="זיכרון חדש"
        >
          <Plus size={22} />
        </button>
      </div>
      <label className="memory-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="לחפש בזיכרון..."
        />
      </label>
      <div className="filter-pills">
        {(["all", "knowledge", "inspiration", "reflection"] as const).map((type) => (
          <button
            key={type}
            className={filter === type ? "active" : ""}
            onClick={() => setFilter(type)}
          >
            {type === "all" ? "הכול" : labels[type]}
          </button>
        ))}
      </div>
      {loading
        ? <p className="feature-loading">מחפש במחברת...</p>
        : visible.length === 0
        ? (
          <div className="feature-empty compact">
            <BookOpenText size={29} />
            <h2>עוד אין כאן זיכרונות</h2>
            <p>אפשר לשמור רעיון, ציטוט או משהו שלא רוצים לאבד.</p>
          </div>
        )
        : (
          <div className="memory-stream">
            {visible.map((memory) => (
              <article
                className={`memory-card type-${memory.type}`}
                key={memory.id}
                onClick={() => setEditing(memory)}
              >
                <span className="memory-type">{labels[memory.type]}</span>
                {memory.title ? <h2>{memory.title}</h2> : null}
                <p>{memory.content}</p>
                <footer>
                  <div>{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                  {memory.source_url
                    ? (
                      <a
                        href={memory.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="פתיחת המקור"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )
                    : null}
                </footer>
              </article>
            ))}
          </div>
        )}
      {editing
        ? (
          <MemorySheet
            key={editing === "new" ? "new" : `${editing.id}-${editing.updated_at}`}
            memory={editing === "new" ? null : editing}
            busy={busy}
            onSave={(draft) => void save(draft)}
            onDelete={editing === "new" ? null : () => setDeleting(editing)}
            onClose={() => setEditing(null)}
          />
        )
        : null}
      {deleting
        ? (
          <ConfirmDialog
            title="למחוק את הזיכרון?"
            body={`הזיכרון „${
              deleting.title ?? deleting.content.slice(0, 35)
            }” יימחק גם מעותק Obsidian, אם קיים.`}
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => setDeleting(null)}
          />
        )
        : null}
    </section>
  );
}
