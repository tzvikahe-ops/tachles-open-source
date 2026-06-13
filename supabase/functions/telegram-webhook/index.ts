import { createServiceClient } from "../_shared/supabase.ts";
import { requireHeaderSecret } from "../_shared/request_auth.ts";
import {
  answerCallbackQuery,
  editMessageText,
  getFileLink,
  replyKeyboard,
  sendMessage,
} from "../_shared/telegram.ts";
import { getOrCreateProfile, type Profile } from "../_shared/profiles.ts";
import { parseReminder } from "../_shared/llm.ts";
import {
  type Routed,
  type RoutedCalendarEvent,
  type RoutedReminder,
  routeMessage,
} from "../_shared/router.ts";
import { AudioTooLargeError, splitDictation, transcribeVoice } from "../_shared/transcription.ts";
import {
  cancelReminder,
  createReminder,
  listActiveReminders,
  snoozeReminder,
} from "../_shared/bridge/reminders.ts";
import { nextLocalTime } from "../_shared/tz.ts";
import {
  addItems,
  deleteItem,
  getListItems,
  getOrCreateList,
  getOwnedList,
  type ListItem,
  listLists,
  setActiveList,
  toggleItem,
} from "../_shared/bridge/lists.ts";
import {
  type BubbleSummary,
  type BubbleType,
  createBubble,
  deleteBubble,
  extractTags,
  extractUrl,
  listPinnedBubbles,
  listRecentBubbles,
  searchBubbles,
  setBubbleType,
  setPinned,
} from "../_shared/wellspring/memories.ts";
import {
  createTask,
  cycleTaskPriority,
  cycleTaskStatus,
  deleteTask,
  getOwnedTask,
  getSubtasks,
  listTopTasks,
  setActiveTask,
  type TaskStatus,
  type TaskSummary,
} from "../_shared/bridge/tasks.ts";
import { createOAuthState, deleteToken, getToken } from "../_shared/integrations/oauth.ts";
import {
  buildAuthorizeUrl,
  createEvent,
  deleteEvent,
  ensureFreshToken,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_SCOPES,
  updateEvent,
} from "../_shared/integrations/google.ts";
import {
  deleteLocalEvent,
  getOwnedEvent,
  listOwnerEventsBetween,
  type OwnedEvent,
  syncGoogleCalendar,
  updateLocalEventTimes,
} from "../_shared/integrations/calendar_sync.ts";
import { collectContext, llmSummary } from "../_shared/integrations/daily_summary.ts";
import { disableDailySummary } from "../_shared/bridge/daily_summary_reminder.ts";
import { getSettings } from "../_shared/user_settings.ts";
import { captureFileToBubble } from "../_shared/wellspring/file_capture.ts";
import { type EventRow, listRecentEvents, logEvent } from "../_shared/events.ts";
import { createProfileLinkCode, ProfileLinkError } from "../_shared/profile_linking.ts";
import { type DailySnapshot, listRecentSnapshots } from "../_shared/snapshots.ts";
import { extractAndSave, listActiveFacts } from "../_shared/agents/fact_extractor.ts";
import { answerRecallQuestion, looksLikeRecallQuestion } from "../_shared/agents/memory_agent.ts";
import { buildTimeline, parseTimelineWindow } from "../_shared/agents/timeline.ts";
import {
  averageLast7Days,
  HEALTH_METRICS,
  listRecentMetrics,
  logMetric,
  METRIC_LABELS,
  normalizeMetric,
} from "../_shared/health/metrics.ts";
import { findFriendByUsername, listFriends, unfriend } from "../_shared/social/friends.ts";
import { consumeInvite, createInvite } from "../_shared/social/invites.ts";
import {
  inbox,
  outbox,
  type ResourceType,
  shareResource,
  unshareResource,
} from "../_shared/social/shares.ts";
import { mimeEmoji, searchDrive } from "../_shared/integrations/google_drive.ts";
import { unifiedSearch } from "../_shared/search.ts";
import { extractActions } from "../_shared/integrations/image_to_action.ts";
import {
  deleteBubbleExport,
  deleteTaskExport,
  disableObsidian,
  enableObsidian,
  fullResync,
  syncBubble,
  syncTask,
} from "../_shared/integrations/obsidian.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/types.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_LIST_NAME = "כללי";

const WELCOME = `שלום! אני <b>תכלס</b> 🤝
העוזר האישי שלך — שכבת זיכרון דיגיטלית עם שני צדדים:

🜂 <b>המעיין</b> — לזכור: ידע, השראה והרהורים.
🌉 <b>הגשר</b> — לפעול: תזכורות, רשימות ומשימות.

מה אפשר כבר עכשיו:
• פשוט כתבו לי בשפה חופשית — אני מבין מה לעשות:
  "תזכיר לי מחר ב-9 לקנות חלב" → תזכורת
  "תוסיף לקניות: לחם, חלב, גבינה" → רשימה
  "תזכור שריבית דריבית היא הכוח השמיני" → בועת זיכרון
  "להכין מצגת לישיבה" → משימה
• הקלטה קולית 🎤 — תיווסף לרשימה הפעילה.

/reminders — התזכורות הפעילות
/lists — הרשימות שלך
/memories — המעיין שלך
/tasks — לוח המשימות
/today — הסיכום היומי שלך
/connect — חיבור יומן Google
/help — עזרה`;

const HELP = `<b>תכלס — עזרה</b>

הדרך העיקרית: <b>פשוט כתבו לי בשפה חופשית</b> ואני מזהה מה לעשות —
תזכורת / אירוע ביומן / רשימה / בועת זיכרון / משימה / בריאות.
דוגמאות: "תזכיר לי מחר ב-9 לקנות חלב", "תוסיף לקניות: לחם וחלב",
"תזכור שריבית דריבית היא הכוח השמיני", "ישנתי 7 שעות".
אפשר גם הקלטה קולית 🎤, ותמונה/מסמך 📄 שאחלץ ואשמור כבועה.
אם לא הבנתי — אבקש הבהרה ואציג תפריט.

/menu — תפריט ראשי עם כל המשטחים

<b>תזכורות</b>
/reminders — התזכורות הפעילות (כשתזכורת מגיעה אפשר לדחות בלחיצה)

<b>רשימות</b>
/lists — כל הרשימות (בחירה קובעת רשימה פעילה)
/newlist שם — רשימה חדשה ופעילה

<b>המעיין (זיכרון)</b>
/memories — כל הבועות, עם סינון לפי סוג: 📚 ידע · 💡 השראה · 🪞 הרהור
/recall מילה — חיפוש סמנטי בבועות
/find ביטוי — חיפוש משולב בבועות, ברשימות ובמשימות

<b>משימות</b>
/tasks — לוח המשימות (בחירה פותחת וקובעת משימה פעילה)
/task כותרת — משימה חדשה

<b>יומן ו-Google</b>
/connect — חיבור Google Calendar (הוסיפו "drive" גם ל-Drive)
/today — סיכום היום · /events — האירועים הקרובים
/summary on 07:00 — סיכום יומי אוטומטי (/summary off לכיבוי)
/drive ביטוי — חיפוש ב-Drive

<b>חברים ושיתוף</b>
/invite — הזמנת חבר · /friends — החברים שלי
/share list שם @חבר — שיתוף (גם task/bubble) · /shared — מה שותף איתי

<b>אפליקציית הווב</b>
/linkweb — קוד חד-פעמי לקישור החשבון לאפליקציה

<b>תובנות וסוכנים</b>
/inbox — הפעולות האחרונות · /timeline שבוע — סיכום נרטיבי
/health — ממוצעי בריאות · /focus — מיקוד יומי · /stats — דשבורד שבועי
/agents — סוכנים פרואקטיביים
/obsidian on — סנכרון ל-Obsidian דרך Drive`;

const MAIN_MENU_TEXT = `<b>תפריט תכלס</b>
פשוט כתבו לי בשפה חופשית — או בחרו פעולה:

<b>· מבט מהיר</b>  היום, תזכורות, אירועים ביומן
<b>· כלים</b>  רשימות, משימות, בועות, סוכנים
<b>· עזרה</b>  פוקוס היום, מדריך מהיר`;

// Inline /menu keyboard. Grouped by purpose (quick-look → tools → help) so the
// layout reflects the section headers in MAIN_MENU_TEXT. Each button carries
// menu:<key>; the callback handler routes <key> to the matching list/overview
// handler.
function mainMenuKeyboard() {
  const btn = (text: string, key: string) => ({
    text,
    callback_data: `menu:${key}`,
  });
  return {
    inline_keyboard: [
      // Quick-look: what's happening now.
      [btn("📅 היום", "today"), btn("🔔 תזכורות", "reminders")],
      [btn("📆 אירועים", "events"), btn("📥 תיבת נכנס", "inbox")],
      // Tools: where things get done.
      [btn("📝 רשימות", "lists"), btn("✅ משימות", "tasks")],
      [btn("🧠 בועות", "memories"), btn("🤖 סוכנים", "agents")],
      // Help.
      [btn("🎯 פוקוס", "focus"), btn("⚙️ עזרה", "help")],
    ],
  };
}

// Persistent bottom Reply Keyboard. Taps arrive as plain text, mapped to a
// command via BAR_MAP at the top of handleMessage.
const BOTTOM_BAR = replyKeyboard([
  ["📅 היום", "🔔 תזכורות", "📝 רשימות"],
  ["🧠 בועות", "✅ משימות", "⚙️ עוד"],
], { is_persistent: true });

const BAR_MAP: Record<string, string> = {
  "📅 היום": "/today",
  "🔔 תזכורות": "/reminders",
  "📝 רשימות": "/lists",
  "🧠 בועות": "/memories",
  "✅ משימות": "/tasks",
  "⚙️ עוד": "/menu",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatLocal(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

interface RenderedMessage {
  text: string;
  reply_markup: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
}

function renderList(name: string, items: ListItem[]): RenderedMessage {
  const lines = [`<b>📝 ${escapeHtml(name)}</b>`];
  if (items.length === 0) {
    lines.push("(ריקה — שלחו הקלטה קולית או /add כדי להוסיף)");
  }
  const buttons: { text: string; callback_data: string }[][] = [];
  for (const it of items) {
    lines.push(`${it.is_done ? "✅" : "⬜"} ${escapeHtml(it.content)}`);
    buttons.push([
      {
        text: `${it.is_done ? "↩️" : "✓"} ${truncate(it.content, 18)}`,
        callback_data: `toggle:${it.id}`,
      },
      { text: "🗑️", callback_data: `delitem:${it.id}` },
    ]);
  }
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: buttons } };
}

const BUBBLE_TYPES: BubbleType[] = ["knowledge", "inspiration", "reflection"];

function typeEmoji(type: BubbleType): string {
  return type === "inspiration" ? "💡" : type === "reflection" ? "🪞" : "📚";
}

function tagsLine(tags: string[]): string {
  return tags.length ? tags.map((t) => `#${escapeHtml(t)}`).join(" ") : "";
}

const TYPE_LABELS: Record<BubbleType, string> = {
  knowledge: "📚 ידע",
  inspiration: "💡 השראה",
  reflection: "🪞 הרהור",
};

const TYPE_LEGEND = `<b>סוגי בועות במעיין:</b>
📚 <b>ידע</b> — עובדות, ציטוטים, קישורים, מידע לחיפוש עתידי
💡 <b>השראה</b> — רעיונות, תובנות, דברים שמעוררים יצירתיות
🪞 <b>הרהור</b> — מחשבות אישיות, רגעי התבוננות, יומן רגשי`;

function bubbleFilterButtons(active: BubbleType | null) {
  const types: (BubbleType | null)[] = [
    null,
    "knowledge",
    "inspiration",
    "reflection",
  ];
  return types.map((t) => ({
    text: `${t === null ? "🜂 הכל" : TYPE_LABELS[t]}${t === active ? " ✓" : ""}`,
    callback_data: t === null ? "bfilter:all" : `bfilter:${t}`,
  }));
}

// Telegram message body cap is 4096 chars; HTML escaping can inflate text, so
// be conservative.
const TELEGRAM_TEXT_LIMIT = 3500;

function renderBubbleConfirm(b: BubbleSummary): RenderedMessage {
  const safeContent = escapeHtml(truncate(b.content, TELEGRAM_TEXT_LIMIT));
  const lines = [`${typeEmoji(b.type)} <b>נשמר במעיין</b>`, safeContent];
  const tags = tagsLine(b.tags);
  if (tags) lines.push(tags);
  const typeRow = BUBBLE_TYPES.map((t) => ({
    text: `${TYPE_LABELS[t]}${b.type === t ? " ✓" : ""}`,
    callback_data: `bset:${t}:${b.id}`,
  }));
  return {
    text: lines.join("\n"),
    reply_markup: {
      inline_keyboard: [typeRow, [{
        text: "🗑️ מחק",
        callback_data: `bdel:${b.id}`,
      }]],
    },
  };
}

function renderBubbleList(
  heading: string,
  bubbles: BubbleSummary[],
  filter: BubbleType | null = null,
  showLegend = false,
): RenderedMessage {
  const lines = [`<b>${heading}</b>`];
  if (showLegend) lines.push("", TYPE_LEGEND);
  if (bubbles.length === 0) lines.push("", "(אין בועות בקטגוריה הזו עדיין)");
  const buttons: { text: string; callback_data: string }[][] = [];
  for (const b of bubbles) {
    const tags = tagsLine(b.tags);
    lines.push(
      `${typeEmoji(b.type)} ${escapeHtml(truncate(b.content, 70))}${tags ? "\n   " + tags : ""}`,
    );
    buttons.push([{
      text: `🗑️ ${truncate(b.content, 20)}`,
      callback_data: `bdel:${b.id}`,
    }]);
  }
  // Filter buttons in a single row at the top.
  buttons.unshift(bubbleFilterButtons(filter));
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: buttons } };
}

function statusEmoji(s: TaskStatus): string {
  return s === "done" ? "✅" : s === "doing" ? "🔄" : "⬜";
}

function prioEmoji(p: number): string {
  return p >= 2 ? "🔴" : p === 1 ? "🟡" : "⚪";
}

function renderTaskDetail(
  task: TaskSummary,
  subtasks: TaskSummary[],
): RenderedMessage {
  const root = task.id;
  const lines = [
    `${statusEmoji(task.status)} <b>${escapeHtml(task.title)}</b> ${prioEmoji(task.priority)}`,
  ];
  const buttons: { text: string; callback_data: string }[][] = [
    [
      { text: "🔄 סטטוס", callback_data: `tstatus:${task.id}:${root}` },
      {
        text: `${prioEmoji(task.priority)} עדיפות`,
        callback_data: `tprio:${task.id}:${root}`,
      },
      { text: "🗑️ מחק", callback_data: `tdel:${task.id}:${root}` },
    ],
  ];
  if (subtasks.length > 0) lines.push("", "<b>תתי־משימות:</b>");
  for (const st of subtasks) {
    lines.push(`${statusEmoji(st.status)} ${escapeHtml(st.title)}`);
    buttons.push([
      {
        text: `${statusEmoji(st.status)} ${truncate(st.title, 20)}`,
        callback_data: `tstatus:${st.id}:${root}`,
      },
      { text: "🗑️", callback_data: `tdel:${st.id}:${root}` },
    ]);
  }
  lines.push("", "להוספת תת־משימה: /subtask טקסט");
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: buttons } };
}

async function renderTaskDetailById(
  supabase: SupabaseClient,
  ownerId: string,
  taskId: string,
): Promise<RenderedMessage | null> {
  const task = await getOwnedTask(supabase, ownerId, taskId);
  if (!task) return null;
  return renderTaskDetail(task, await getSubtasks(supabase, ownerId, taskId));
}

async function resolveActiveList(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<{ id: string; name: string }> {
  if (profile.active_list_id) {
    const existing = await getOwnedList(
      supabase,
      profile.id,
      profile.active_list_id,
    );
    if (existing) return existing;
  }
  const id = await getOrCreateList(supabase, profile.id, DEFAULT_LIST_NAME);
  await setActiveList(supabase, profile.id, id);
  return { id, name: DEFAULT_LIST_NAME };
}

async function createAndConfirmReminder(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  parsed: RoutedReminder,
): Promise<void> {
  const runAt = new Date(parsed.run_at);
  if (isNaN(runAt.getTime())) {
    await sendMessage(chatId, "התאריך לא ברור לי — נסו לנסח אחרת 🙏");
    return;
  }

  const id = await createReminder(supabase, {
    ownerId: profile.id,
    title: parsed.title,
    body: parsed.body,
    scheduleType: parsed.schedule_type,
    runAt,
    recurrence: parsed.recurrence,
    timezone: profile.timezone,
  });

  await logEvent(supabase, profile.id, {
    kind: "reminder_created",
    payload: {
      title: parsed.title,
      run_at: parsed.run_at,
      recurring: parsed.schedule_type === "recurring",
    },
    relatedEntity: { type: "reminder", id },
  });

  const lines = [
    "✅ נקבעה תזכורת:",
    `<b>${escapeHtml(parsed.title)}</b>`,
    `🕐 ${formatLocal(parsed.run_at, profile.timezone)}`,
  ];
  if (parsed.schedule_type === "recurring") lines.push("🔁 חוזרת");

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [[{ text: "בטל ❌", callback_data: `cancel:${id}` }]],
    },
  });
}

async function handleReminderRequest(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  requestText: string,
): Promise<void> {
  if (!requestText) {
    await sendMessage(
      chatId,
      'מה להזכיר לך? לדוגמה: "תזכיר לי מחר ב-9 לקנות חלב".',
    );
    return;
  }

  let parsed;
  try {
    parsed = await parseReminder(
      requestText,
      new Date().toISOString(),
      profile.timezone,
    );
  } catch (err) {
    console.error("parseReminder failed:", err);
    await sendMessage(
      chatId,
      "לא הצלחתי לעבד את הבקשה כרגע — נסו שוב בעוד רגע 🙏",
    );
    return;
  }

  if (!parsed.understood || !parsed.run_at) {
    await sendMessage(
      chatId,
      parsed.clarification ??
        'לא הצלחתי להבין מתי להזכיר. נסו למשל: "כל יום ראשון ב-8 לשלוח דוח".',
    );
    return;
  }

  await createAndConfirmReminder(supabase, profile, chatId, {
    intent: "reminder",
    title: parsed.title ?? truncate(requestText, 80),
    body: parsed.body,
    schedule_type: parsed.schedule_type,
    run_at: parsed.run_at,
    recurrence: parsed.recurrence,
  });
}

async function handleReminderList(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const reminders = await listActiveReminders(supabase, profile.id);
  if (reminders.length === 0) {
    await sendMessage(
      chatId,
      "אין לך תזכורות פעילות כרגע. כתבו לי מה להזכיר 🙂",
    );
    return;
  }

  const lines = ["<b>📋 התזכורות הפעילות שלך:</b>"];
  const buttons: { text: string; callback_data: string }[][] = [];
  reminders.forEach((r, i) => {
    const when = r.run_at ? formatLocal(r.run_at, profile.timezone) : "—";
    const repeat = r.schedule_type === "recurring" ? " 🔁" : "";
    lines.push(
      `${i + 1}. <b>${escapeHtml(r.title)}</b>\n   🕐 ${when}${repeat}`,
    );
    buttons.push([{
      text: `🗑️ ${truncate(r.title, 24)}`,
      callback_data: `cancel:${r.id}`,
    }]);
  });

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleListsOverview(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const lists = await listLists(supabase, profile.id);
  if (lists.length === 0) {
    await sendMessage(
      chatId,
      "אין לך רשימות עדיין. צרו אחת עם /newlist שם, או שלחו לי הקלטה קולית 🎤.",
    );
    return;
  }

  const lines = [
    "<b>🗂️ הרשימות שלך:</b>",
    "בחרו רשימה כדי לפתוח ולקבוע אותה כפעילה:",
  ];
  const buttons = lists.map((l) => [{
    text: `📝 ${truncate(l.name, 24)} (${l.item_count})`,
    callback_data: `openlist:${l.id}`,
  }]);
  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function addItemsToList(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  items: string[],
  listName: string | null,
  source: "text" | "voice",
): Promise<void> {
  if (items.length === 0) {
    await sendMessage(chatId, "לא מצאתי מה להוסיף 🤔");
    return;
  }
  let list: { id: string; name: string };
  if (listName) {
    const id = await getOrCreateList(supabase, profile.id, listName);
    await setActiveList(supabase, profile.id, id);
    list = { id, name: listName };
  } else {
    list = await resolveActiveList(supabase, profile);
  }
  await addItems(supabase, list.id, items, source);
  const view = renderList(list.name, await getListItems(supabase, list.id));
  const prefix = source === "voice" ? `🎤 הוספתי ${items.length} פריטים\n` : "";
  await sendMessage(chatId, prefix + view.text, {
    reply_markup: view.reply_markup,
  });
}

async function handleAddItems(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rawText: string,
  source: "text" | "voice",
): Promise<void> {
  await addItemsToList(
    supabase,
    profile,
    chatId,
    splitDictation(rawText),
    null,
    source,
  );
}

async function handleVoice(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  fileId: string,
): Promise<void> {
  let text: string;
  try {
    text = await transcribeVoice(fileId);
  } catch (err) {
    if (err instanceof AudioTooLargeError) {
      const mb = (err.bytes / (1024 * 1024)).toFixed(1);
      await sendMessage(
        chatId,
        `ההקלטה גדולה מדי (${mb}MB). חתכו אותה לקטעים של עד 10 דקות (~20MB) ושלחו שוב.`,
      );
      return;
    }
    console.error("transcribeVoice failed:", err);
    await sendMessage(chatId, "לא הצלחתי לתמלל את ההקלטה כרגע 🎤 נסו שוב.");
    return;
  }
  if (!text) {
    await sendMessage(chatId, "לא שמעתי טקסט בהקלטה 🤔");
    return;
  }
  // Echo the transcription back so the user can catch Whisper mistakes (common
  // in Hebrew) and understand why an unexpected action was taken.
  await sendMessage(chatId, `🎤 <i>שמעתי:</i> ${escapeHtml(text)}`);
  // Route through the same intelligence pipeline as typed text, so a spoken
  // "תזכיר לי מחר ב-8" becomes a reminder — not a blind list item.
  await handleFreeText(supabase, profile, chatId, text, "voice");
}

async function handleRemember(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  text: string,
): Promise<void> {
  if (!text) {
    await sendMessage(
      chatId,
      "מה לשמור במעיין? לדוגמה: /remember רעיון לפרויקט #השראה",
    );
    return;
  }
  const bubble = await createBubble(supabase, {
    ownerId: profile.id,
    content: text,
    tags: extractTags(text),
    sourceUrl: extractUrl(text),
  });
  await logEvent(supabase, profile.id, {
    kind: "bubble_created",
    payload: {
      type: bubble.type,
      tags: bubble.tags,
      preview: bubble.content.slice(0, 120),
    },
    relatedEntity: { type: "bubble", id: bubble.id },
  });
  await syncBubble(supabase, profile.id, bubble, new Date().toISOString());
  const view = renderBubbleConfirm(bubble);
  await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function handleRecall(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  query: string,
): Promise<void> {
  if (!query) {
    await sendMessage(chatId, "מה לחפש במעיין? לדוגמה: /recall פרודוקטיביות");
    return;
  }
  const results = await searchBubbles(supabase, profile.id, query);
  if (results.length === 0) {
    await sendMessage(
      chatId,
      `לא נמצאו בועות זיכרון עבור "${escapeHtml(query)}".`,
    );
    return;
  }
  const view = renderBubbleList(
    `🔎 תוצאות עבור "${escapeHtml(query)}":`,
    results,
  );
  await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function handleFind(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  query: string,
): Promise<void> {
  if (!query) {
    await sendMessage(
      chatId,
      "מה לחפש? חיפוש משולב על פני המעיין, הרשימות והמשימות. לדוגמה: /find פרויקט",
    );
    return;
  }
  const { bubbles, listItems, tasks } = await unifiedSearch(
    supabase,
    profile.id,
    query,
  );
  if (bubbles.length + listItems.length + tasks.length === 0) {
    await sendMessage(chatId, `לא נמצא כלום עבור "${escapeHtml(query)}".`);
    return;
  }
  const lines = [`<b>🔎 תוצאות ל-"${escapeHtml(query)}":</b>`];
  if (bubbles.length > 0) {
    lines.push("", "<b>🜂 מהמעיין:</b>");
    for (const b of bubbles) {
      lines.push(`${typeEmoji(b.type)} ${escapeHtml(truncate(b.content, 70))}`);
    }
  }
  if (tasks.length > 0) {
    lines.push("", "<b>🌉 משימות:</b>");
    for (const t of tasks) {
      lines.push(
        `${statusEmoji(t.status)} ${prioEmoji(t.priority)} ${escapeHtml(truncate(t.title, 60))}`,
      );
    }
  }
  if (listItems.length > 0) {
    lines.push("", "<b>📝 פריטים ברשימות:</b>");
    for (const it of listItems) {
      const where = it.list_name ? ` <i>(${escapeHtml(it.list_name)})</i>` : "";
      lines.push(
        `${it.is_done ? "✅" : "⬜"} ${escapeHtml(truncate(it.content, 60))}${where}`,
      );
    }
  }
  await sendMessage(chatId, lines.join("\n").slice(0, 3500));
}

function memoriesHeading(filter: BubbleType | null): string {
  if (filter === null) return "🜂 המעיין — כל הבועות האחרונות:";
  return `🜂 המעיין — ${TYPE_LABELS[filter]}:`;
}

async function handleMemories(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  filter: BubbleType | null = null,
): Promise<void> {
  const bubbles = await listRecentBubbles(
    supabase,
    profile.id,
    20,
    filter ?? undefined,
  );
  if (bubbles.length === 0 && filter === null) {
    await sendMessage(
      chatId,
      `המעיין עדיין ריק. שמרו משהו עם /remember 🜂\n\n${TYPE_LEGEND}`,
    );
    return;
  }
  const view = renderBubbleList(memoriesHeading(filter), bubbles, filter, true);
  await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function editMemoriesView(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  messageId: number,
  filter: BubbleType | null,
): Promise<void> {
  const bubbles = await listRecentBubbles(
    supabase,
    profile.id,
    20,
    filter ?? undefined,
  );
  const view = renderBubbleList(memoriesHeading(filter), bubbles, filter, true);
  await editMessageText(chatId, messageId, view.text, {
    reply_markup: view.reply_markup,
  });
}

async function handleTasksOverview(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const tasks = await listTopTasks(supabase, profile.id);
  if (tasks.length === 0) {
    await sendMessage(chatId, "אין משימות פעילות. צרו אחת עם /task כותרת ✍️");
    return;
  }
  const lines = [
    "<b>🌉 המשימות שלך:</b>",
    "בחרו משימה כדי לפתוח ולנהל תתי־משימות:",
  ];
  const buttons = tasks.map((t) => [{
    text: `${statusEmoji(t.status)} ${prioEmoji(t.priority)} ${truncate(t.title, 24)}`,
    callback_data: `topen:${t.id}`,
  }]);
  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleNewTask(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  title: string,
): Promise<void> {
  if (!title) {
    await sendMessage(chatId, "מה הכותרת? לדוגמה: /task להכין מצגת");
    return;
  }
  const task = await createTask(supabase, profile.id, title);
  await setActiveTask(supabase, profile.id, task.id);
  await logEvent(supabase, profile.id, {
    kind: "task_created",
    payload: { title, priority: task.priority },
    relatedEntity: { type: "task", id: task.id },
  });
  await syncTask(supabase, profile.id, task, [], new Date().toISOString());
  const view = renderTaskDetail(task, []);
  await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function handleInviteCreate(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const botUsername = Deno.env.get("BOT_USERNAME") ?? "Tacles_Bot";
  const inv = await createInvite(supabase, profile.id);
  const link = `https://t.me/${botUsername}?start=inv_${inv.token}`;
  const expires = formatLocal(inv.expires_at, profile.timezone);
  await sendMessage(
    chatId,
    `🔗 קישור הזמנה לחבר (תוקף עד ${expires}):\n<code>${
      escapeHtml(link)
    }</code>\n\nשלחו לחבר שאתם רוצים להזמין. כשילחץ /start ייפתח אוטומטית והוא יתחבר אליכם.`,
  );
}

async function handleInviteAccept(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  token: string,
): Promise<void> {
  const result = await consumeInvite(supabase, token, profile.id);
  if (!result) {
    await sendMessage(chatId, "הקישור פג תוקף, כבר נוצל או לא תקף.");
    return;
  }
  await sendMessage(chatId, "🤝 התחברתם בהצלחה! /friends להצגת הרשימה.");
  // Notify the inviter (best effort).
  const { data: inviter } = await supabase
    .from("profiles")
    .select("telegram_user_id")
    .eq("id", result.ownerId)
    .maybeSingle<{ telegram_user_id: number }>();
  if (inviter) {
    try {
      const name = profile.display_name ?? "חבר/ה חדש/ה";
      await sendMessage(
        inviter.telegram_user_id,
        `🤝 ${escapeHtml(name)} הצטרף/ה לרשימת החברים שלכם.`,
      );
    } catch (_) { /* ignore */ }
  }
}

async function handleFriends(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const friends = await listFriends(supabase, profile.id);
  if (friends.length === 0) {
    await sendMessage(
      chatId,
      "אין לכם חברים מחוברים עדיין. /invite ליצירת קישור הזמנה.",
    );
    return;
  }
  const lines = ["<b>🤝 החברים שלכם:</b>"];
  const buttons: { text: string; callback_data: string }[][] = [];
  for (const f of friends) {
    lines.push(`• ${escapeHtml(f.display_name ?? "(ללא שם)")}`);
    buttons.push([{
      text: `❌ הסר ${truncate(f.display_name ?? "חבר", 20)}`,
      callback_data: `unfriend:${f.profile_id}`,
    }]);
  }
  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  list: "📝 רשימה",
  task: "🌉 משימה",
  bubble: "🜂 בועה",
  reminder: "⏰ תזכורת",
};

async function handleSharedInbox(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const items = await inbox(supabase, profile.id);
  if (items.length === 0) {
    await sendMessage(chatId, "אין דברים ששותפו איתכם.");
    return;
  }
  const lines = ["<b>📥 שותף איתכם:</b>"];
  for (const it of items) {
    const who = it.owner_display_name ?? "חבר";
    lines.push(
      `${RESOURCE_LABELS[it.resource_type]} ${
        escapeHtml(it.resource_title ?? "(ללא כותרת)")
      } — מאת ${escapeHtml(who)}`,
    );
  }
  await sendMessage(chatId, lines.join("\n"));
}

async function handleShareCommand(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  // /share list <list-name> @friend  OR  /share status  OR  /share obsidian <query>
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens[0] === "obsidian") {
    const query = tokens.slice(1).join(" ").trim();
    if (!query) {
      await sendMessage(
        chatId,
        "שימוש: <code>/share obsidian &lt;חיפוש&gt;</code> — דוחף בועה ספציפית לוולט שלך ב-Drive.",
      );
      return;
    }
    const matches = await searchBubbles(supabase, profile.id, query, 1);
    if (matches.length === 0) {
      await sendMessage(chatId, `לא מצאתי בועה עבור "${escapeHtml(query)}".`);
      return;
    }
    const bubble = matches[0];
    const { data: obs } = await supabase
      .from("user_settings")
      .select("obsidian_enabled")
      .eq("owner_id", profile.id)
      .maybeSingle<{ obsidian_enabled: boolean }>();
    if (!obs?.obsidian_enabled) {
      await sendMessage(
        chatId,
        "צריך להפעיל קודם <code>/obsidian on</code> כדי לדחוף לוולט.",
      );
      return;
    }
    await syncBubble(supabase, profile.id, bubble, new Date().toISOString());
    await sendMessage(
      chatId,
      `📤 נדחפה לוולט: <i>${escapeHtml(bubble.content.slice(0, 200))}</i>`,
    );
    return;
  }
  if (tokens[0] === "status" || tokens.length === 0) {
    const items = await outbox(supabase, profile.id);
    if (items.length === 0) {
      await sendMessage(
        chatId,
        "לא שיתפתם דבר עדיין. שימוש: /share list <שם רשימה> @חבר",
      );
      return;
    }
    const lines = ["<b>📤 שיתפתם:</b>"];
    const buttons: { text: string; callback_data: string }[][] = [];
    for (const it of items) {
      const with_ = it.owner_display_name ?? "חבר";
      lines.push(
        `${RESOURCE_LABELS[it.resource_type]} ${escapeHtml(it.resource_title ?? "(ללא כותרת)")} → ${
          escapeHtml(with_)
        }`,
      );
      buttons.push([{
        text: `🚫 בטל שיתוף`,
        callback_data: `unshare:${it.id}`,
      }]);
    }
    await sendMessage(chatId, lines.join("\n"), {
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  const type = tokens[0] as ResourceType;
  if (!["list", "task", "bubble"].includes(type)) {
    await sendMessage(chatId, "שימוש: /share list <שם> @חבר  |  /share status");
    return;
  }
  if (tokens.length < 3) {
    await sendMessage(chatId, "חסרים פרטים. דוגמה: /share list קניות @דנה");
    return;
  }
  const friendQuery = tokens[tokens.length - 1];
  const nameQuery = tokens.slice(1, -1).join(" ");

  const friend = await findFriendByUsername(supabase, profile.id, friendQuery);
  if (!friend) {
    await sendMessage(
      chatId,
      `לא מצאתי חבר/ה בשם ${escapeHtml(friendQuery)}. /friends להצגת הרשימה.`,
    );
    return;
  }

  let resourceId: string | null = null;
  if (type === "list") {
    const { data } = await supabase
      .from("lists")
      .select("id, name")
      .eq("owner_id", profile.id)
      .ilike("name", `%${nameQuery.replace(/[%_]/g, " ")}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; name: string }>();
    resourceId = data?.id ?? null;
  } else if (type === "task") {
    const { data } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("owner_id", profile.id)
      .is("parent_task_id", null)
      .ilike("title", `%${nameQuery.replace(/[%_]/g, " ")}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; title: string }>();
    resourceId = data?.id ?? null;
  } else if (type === "bubble") {
    const { data } = await supabase
      .from("memory_bubbles")
      .select("id")
      .eq("owner_id", profile.id)
      .ilike("content", `%${nameQuery.replace(/[%_]/g, " ")}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    resourceId = data?.id ?? null;
  }
  if (!resourceId) {
    await sendMessage(
      chatId,
      `לא מצאתי ${RESOURCE_LABELS[type]} בשם "${escapeHtml(nameQuery)}".`,
    );
    return;
  }
  try {
    await shareResource(
      supabase,
      profile.id,
      friend.profile_id,
      type,
      resourceId,
    );
  } catch (err) {
    console.error("shareResource failed:", err);
    await sendMessage(chatId, "לא הצלחתי לשתף.");
    return;
  }
  await sendMessage(
    chatId,
    `✅ שותף עם ${escapeHtml(friend.display_name ?? "חבר/ה")}.`,
  );
  // Notify recipient.
  try {
    await sendMessage(
      friend.telegram_user_id,
      `🤝 ${escapeHtml(profile.display_name ?? "חבר/ה")} שיתף/ה איתך ${
        RESOURCE_LABELS[type]
      }. /shared להצגה.`,
    );
  } catch (_) { /* ignore */ }
}

const EXTRACT_TRIGGERS = [
  /^\/extract\b/i,
  /\bextract\b/i,
  /חלץ|תוציא|פריטי פעולה/,
];

function captionWantsExtraction(caption: string | null): boolean {
  if (!caption) return false;
  return EXTRACT_TRIGGERS.some((re) => re.test(caption));
}

async function handleImageActions(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  fileId: string,
  caption: string | null,
): Promise<void> {
  await sendMessage(chatId, "🔍 מחלץ פעולות מהתמונה...");
  const link = await getFileLink(fileId);
  const res = await fetch(link);
  if (!res.ok) {
    await sendMessage(chatId, "לא הצלחתי להוריד את התמונה.");
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const base64 = btoa(bin);

  let result;
  try {
    result = await extractActions(base64, mimeType, caption);
  } catch (err) {
    console.error("extractActions failed:", err);
    await sendMessage(chatId, "לא הצלחתי לחלץ פעולות 😕");
    return;
  }
  if (result.items.length === 0) {
    await sendMessage(chatId, result.summary ?? "לא מצאתי פריטי פעולה בתמונה.");
    return;
  }

  const taskItems = result.items.filter((i) => i.kind === "task");
  const listItems = result.items.filter((i) => i.kind === "list_item");

  if (taskItems.length > 0) {
    const now = new Date().toISOString();
    for (const it of taskItems) {
      const t = await createTask(supabase, profile.id, it.text);
      await syncTask(supabase, profile.id, t, [], now);
    }
  }
  if (listItems.length > 0) {
    await addItemsToList(
      supabase,
      profile,
      chatId,
      listItems.map((i) => i.text),
      null,
      "text",
    );
  }

  const lines = [`✅ חולצו ${result.items.length} פריטים:`];
  if (taskItems.length > 0) {
    lines.push(`<b>🌉 משימות (${taskItems.length}):</b>`);
    for (const t of taskItems) lines.push(`• ${escapeHtml(t.text)}`);
  }
  if (listItems.length > 0 && taskItems.length > 0) {
    lines.push("");
    lines.push(
      `<b>📝 פריטי רשימה (${listItems.length}):</b> נוספו לרשימה הפעילה.`,
    );
  }
  if (taskItems.length > 0) {
    await sendMessage(chatId, lines.join("\n"));
  }
}

async function handleMediaCapture(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  message: TelegramMessage,
): Promise<void> {
  let telegramFileId: string;
  let kind: "photo" | "document";
  let mimeType: string | null = null;
  let filename: string | null = null;
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((
      a,
      b,
    ) => (a.width * a.height >= b.width * b.height ? a : b));
    telegramFileId = largest.file_id;
    kind = "photo";
    mimeType = "image/jpeg";
    filename = `photo_${largest.file_unique_id}.jpg`;
  } else if (message.document) {
    telegramFileId = message.document.file_id;
    kind = "document";
    mimeType = message.document.mime_type ?? null;
    filename = message.document.file_name ?? null;
  } else {
    return;
  }

  // Image-to-Action shortcut: if the caption hints at extraction, route there
  // instead of OCR-to-bubble.
  if (kind === "photo" && captionWantsExtraction(message.caption ?? null)) {
    await handleImageActions(
      supabase,
      profile,
      chatId,
      telegramFileId,
      message.caption ?? null,
    );
    return;
  }

  await sendMessage(
    chatId,
    kind === "photo" ? "📸 קולט תמונה..." : "📄 קולט מסמך...",
  );

  try {
    const result = await captureFileToBubble(supabase, {
      ownerId: profile.id,
      telegramFileId,
      caption: message.caption ?? null,
      kind,
      declaredMimeType: mimeType,
      declaredFilename: filename,
    });
    await syncBubble(
      supabase,
      profile.id,
      result.bubble,
      new Date().toISOString(),
    );
    const view = renderBubbleConfirm(result.bubble);
    await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
  } catch (err) {
    console.error("captureFileToBubble failed:", err);
    await sendMessage(chatId, "לא הצלחתי לשמור את הקובץ כרגע 😕");
  }
}

async function handleConnect(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const wantsDrive = rest.toLowerCase().includes("drive");
  const scopes = wantsDrive
    ? [...GOOGLE_CALENDAR_SCOPES, ...GOOGLE_DRIVE_SCOPES]
    : GOOGLE_CALENDAR_SCOPES;
  let state: string;
  try {
    state = await createOAuthState(
      supabase,
      profile.id,
      "google",
      chatId,
      scopes,
    );
  } catch (err) {
    console.error("createOAuthState failed:", err);
    await sendMessage(chatId, "לא הצלחתי להתחיל את ההתחברות 😕");
    return;
  }
  let url: string;
  try {
    url = buildAuthorizeUrl(state, scopes);
  } catch (err) {
    console.error("buildAuthorizeUrl failed:", err);
    await sendMessage(
      chatId,
      "החיבור ל-Google עוד לא מוגדר בצד השרת. אנא הגדירו GOOGLE_CLIENT_ID/SECRET.",
    );
    return;
  }
  const what = wantsDrive ? "Google Calendar + Drive" : "Google Calendar";
  await sendMessage(
    chatId,
    `🔗 כדי לחבר את ${escapeHtml(what)}, לחצו על הקישור והעניקו הרשאה:`,
    {
      reply_markup: { inline_keyboard: [[{ text: "התחבר ל-Google", url }]] },
      disable_web_page_preview: true,
    },
  );
}

async function handleDisconnect(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const removed = await deleteToken(supabase, profile.id, "google");
  await sendMessage(
    chatId,
    removed ? "🔌 חיבור Google נותק. /connect כדי לחבר מחדש." : "אין חיבור Google פעיל.",
  );
}

async function handleToday(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const token = await getToken(supabase, profile.id, "google");
  if (token) {
    try {
      await syncGoogleCalendar(supabase, profile.id);
    } catch (err) {
      console.error("inline sync failed (continuing with cached events):", err);
    }
  }
  const ctx = await collectContext(supabase, profile);
  const text = await llmSummary(ctx);
  await sendMessage(chatId, text);
}

async function handleObsidian(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const action = rest.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (action === "" || action === "status") {
    const s = await getSettings(supabase, profile.id);
    if (s?.daily_summary_enabled === undefined) {
      // settings row might not exist yet; treat as disabled
    }
    const isOn = s &&
      ((s as unknown) as { obsidian_enabled?: boolean }).obsidian_enabled ===
        true;
    const folderId = isOn
      ? ((s as unknown) as { obsidian_drive_folder_id?: string })
        .obsidian_drive_folder_id
      : null;
    if (!isOn) {
      await sendMessage(
        chatId,
        "📂 <b>Obsidian sync כבוי.</b>\n\nלהפעלה: <code>/obsidian on</code>\n" +
          "(דורש חיבור Google עם הרשאת Drive — /connect drive)",
      );
      return;
    }
    const link = folderId ? `https://drive.google.com/drive/folders/${folderId}` : "";
    await sendMessage(
      chatId,
      `📂 <b>Obsidian sync פעיל.</b>\n` +
        `התיקייה ב-Drive: <a href="${link}">Tachles</a>\n\n` +
        `סנכרון מלא של כל הנכסים: <code>/obsidian sync</code>\n` +
        `כיבוי: <code>/obsidian off</code>`,
      { disable_web_page_preview: true },
    );
    return;
  }
  if (action === "off") {
    await disableObsidian(supabase, profile.id);
    await sendMessage(
      chatId,
      "📂 כיביתי את ה-sync. הקבצים שכבר נכתבו לDrive נשארים — לא נגעתי בהם.",
    );
    return;
  }
  if (action === "on") {
    try {
      const { folderId } = await enableObsidian(supabase, profile.id);
      const link = `https://drive.google.com/drive/folders/${folderId}`;
      await sendMessage(
        chatId,
        `✅ <b>Obsidian sync פעיל.</b>\n\n` +
          `יצרתי תיקייה <a href="${link}">Tachles</a> ב-Drive שלך.\n` +
          `כל בועה / משימה / סיכום יומי חדש ייכתב שם כקובץ markdown.\n\n` +
          `<b>מה הלאה:</b>\n` +
          `1. התקן את Google Drive Desktop במחשב כדי לסנכרן את התיקייה לוקאלית.\n` +
          `2. פתח את Obsidian → "Open folder as vault" → בחר את התיקייה Tachles הלוקאלית.\n` +
          `3. <code>/obsidian sync</code> כדי לייצא את כל מה שיש לך עכשיו (לא רק מכאן והלאה).`,
        { disable_web_page_preview: true },
      );
    } catch (err) {
      console.error("enableObsidian failed:", err);
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not connected") || msg.includes("Google")) {
        await sendMessage(
          chatId,
          "צריך להתחבר ל-Google Drive קודם: <code>/connect drive</code>",
        );
      } else {
        await sendMessage(chatId, "לא הצלחתי להפעיל — נסו שוב.");
      }
    }
    return;
  }
  if (action === "sync") {
    await sendMessage(chatId, "🔄 מסנכרן את כל הבועות והמשימות ל-Drive...");
    try {
      const { bubbles, tasks } = await fullResync(supabase, profile.id);
      await sendMessage(
        chatId,
        `✅ סיימתי. ${bubbles} בועות + ${tasks} משימות נכתבו ל-Drive.`,
      );
    } catch (err) {
      console.error("fullResync failed:", err);
      await sendMessage(
        chatId,
        "הסנכרון נכשל באמצע. נסו שוב או בדקו /obsidian status.",
      );
    }
    return;
  }
  await sendMessage(
    chatId,
    "שימוש: <code>/obsidian on</code> | <code>/obsidian off</code> | <code>/obsidian sync</code> | <code>/obsidian status</code>",
  );
}

const EVENT_LABELS: Record<string, string> = {
  message_in: "💬 הודעה",
  command: "⚙️ פקודה",
  callback: "👆 כפתור",
  intent_routed: "🧭 נותב",
  voice_in: "🎤 קול",
  media_in: "📷 מדיה",
  bubble_created: "🜂 בועה חדשה",
  bubble_type_changed: "🜂 בועה — סוג",
  bubble_deleted: "🗑️ בועה נמחקה",
  task_created: "🌉 משימה חדשה",
  task_status_changed: "🔄 סטטוס משימה",
  task_priority_changed: "🔴 עדיפות משימה",
  task_deleted: "🗑️ משימה נמחקה",
  reminder_created: "⏰ תזכורת",
  reminder_cancelled: "🗑️ תזכורת בוטלה",
  reminder_fired: "🔔 תזכורת",
  calendar_event_created: "📅 ארוע",
  summary_sent: "🌅 סיכום יומי",
  share_created: "🤝 שיתפתי",
  share_received: "📥 שותף איתי",
  proactive_sent: "🤖 הודעה מסוכן",
  agent_noop: "🤖 sokenz שותק",
  health_logged: "💪 בריאות",
  oauth_connected: "🔗 חיבור",
  obsidian_synced: "📂 Obsidian",
};

function dayBucket(iso: string, timezone: string): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
  const eventDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
    .format(new Date(iso));
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
    .format(
      new Date(Date.now() - 86_400_000),
    );
  if (eventDay === today) return "היום";
  if (eventDay === yesterday) return "אתמול";
  return eventDay;
}

function eventPreview(e: EventRow): string {
  const label = EVENT_LABELS[e.kind] ?? e.kind;
  const p = e.payload ?? {};
  if (e.kind === "message_in") {
    return `${label}: ${escapeHtml(String(p.preview ?? ""))}`;
  }
  if (e.kind === "command") {
    return `${label} ${escapeHtml(String(p.cmd ?? ""))}`;
  }
  if (e.kind === "bubble_created") {
    return `${label} (${escapeHtml(String(p.type ?? ""))}): ${escapeHtml(String(p.preview ?? ""))}`;
  }
  if (e.kind === "task_created") {
    return `${label}: ${escapeHtml(String(p.title ?? ""))}`;
  }
  if (e.kind === "task_status_changed") {
    return `${label} → ${escapeHtml(String(p.status ?? ""))}`;
  }
  if (e.kind === "reminder_created") {
    return `${label}: ${escapeHtml(String(p.title ?? ""))}`;
  }
  if (e.kind === "intent_routed") {
    return `${label} → ${escapeHtml(String(p.intent ?? ""))}`;
  }
  if (e.kind === "proactive_sent") {
    return `${label} (${escapeHtml(String(p.agent ?? ""))}): ${
      escapeHtml(String(p.text_preview ?? ""))
    }`;
  }
  if (e.kind === "summary_sent") return label;
  if (e.kind === "health_logged") {
    return `${label} ${escapeHtml(String(p.metric ?? ""))}=${escapeHtml(String(p.value ?? ""))}`;
  }
  return label;
}

async function handleTimeline(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const win = parseTimelineWindow(rest, profile.timezone);
  await sendMessage(chatId, `🧭 בונה timeline ל-${escapeHtml(win.label)}...`);
  try {
    const text = await buildTimeline(supabase, profile, win);
    await sendMessage(chatId, text.slice(0, 3500));
  } catch (err) {
    console.error("buildTimeline failed:", err);
    await sendMessage(chatId, "לא הצלחתי לבנות timeline.");
  }
}

async function handleRecall2(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  question: string,
): Promise<void> {
  try {
    const text = await answerRecallQuestion(supabase, profile, question);
    await sendMessage(chatId, text.slice(0, 3500));
  } catch (err) {
    console.error("answerRecallQuestion failed:", err);
    await sendMessage(chatId, "לא הצלחתי לחפש בזיכרון.");
  }
}

const AGENT_HEBREW_LABEL: Record<string, string> = {
  chief_of_staff: "ראש מטה",
  anti_chaos: "נגד כאוס",
  health_intelligence: "מודיעין בריאות",
  memory_agent: "סוכן זיכרון",
};

function hebrewSchedule(cron: string | null): string {
  if (!cron) return "מופעל לפי בקשה";
  const map: Record<string, string> = {
    "0 8,19 * * *": "כל יום ב-08:00 וב-19:00",
    "0 9 * * 1": "כל יום שני ב-09:00",
    "0 8 * * 0": "כל יום ראשון ב-08:00",
  };
  return map[cron] ?? cron;
}

async function handleAgentsCommand(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const action = tokens[0] ?? "";
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, role, schedule_cron, enabled")
    .order("name");
  if (!agents || agents.length === 0) {
    await sendMessage(chatId, "אין סוכנים רשומים.");
    return;
  }
  if (action === "" || action === "list" || action === "status") {
    const lines = ["<b>🤖 סוכנים פרואקטיביים:</b>", ""];
    for (const a of agents) {
      const { data: userSetting } = await supabase
        .from("user_agent_settings")
        .select("enabled")
        .eq("agent_id", a.id as string)
        .eq("owner_id", profile.id)
        .maybeSingle<{ enabled: boolean }>();
      const userEnabled = userSetting ? userSetting.enabled : true;
      const effective = (a.enabled as boolean) && userEnabled;
      const { count: sent7d } = await supabase
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", a.id as string)
        .eq("owner_id", profile.id)
        .eq("status", "sent")
        .gte(
          "finished_at",
          new Date(Date.now() - 7 * 86_400_000).toISOString(),
        );
      const nameKey = String(a.name);
      const hebrewName = AGENT_HEBREW_LABEL[nameKey] ?? nameKey;
      lines.push(
        `${effective ? "✅" : "⏸️"} <b>${escapeHtml(hebrewName)}</b> — ${
          escapeHtml(String(a.role))
        }`,
        `   ⏱️ ${escapeHtml(hebrewSchedule(a.schedule_cron as string | null))} · נשלחו ${
          sent7d ?? 0
        } הודעות ב-7 הימים האחרונים`,
        `   <code>${escapeHtml(nameKey)}</code>`,
      );
    }
    lines.push(
      "",
      "<i>להפעלה: /agents enable &lt;מזהה&gt;</i>",
      "<i>לכיבוי: /agents disable &lt;מזהה&gt;</i>",
      "<i>(המזהה הוא הטקסט באנגלית שמופיע מתחת לכל סוכן)</i>",
    );
    await sendMessage(chatId, lines.join("\n"));
    return;
  }
  if ((action === "enable" || action === "disable") && tokens[1]) {
    const target = agents.find((a) => (a.name as string) === tokens[1]);
    if (!target) {
      await sendMessage(chatId, `הסוכן ${escapeHtml(tokens[1])} לא נמצא.`);
      return;
    }
    await supabase.from("user_agent_settings").upsert({
      owner_id: profile.id,
      agent_id: target.id as string,
      enabled: action === "enable",
    });
    const hebrewName = AGENT_HEBREW_LABEL[String(target.name)] ??
      String(target.name);
    await sendMessage(
      chatId,
      action === "enable"
        ? `✅ הסוכן <b>${escapeHtml(hebrewName)}</b> מופעל אצלך.`
        : `⏸️ הסוכן <b>${escapeHtml(hebrewName)}</b> כבוי אצלך.`,
    );
    return;
  }
  await sendMessage(
    chatId,
    "שימוש: /agents · /agents enable &lt;מזהה&gt; · /agents disable &lt;מזהה&gt;",
  );
}

async function handleHealth(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    // Summary mode.
    const lines = ["<b>💪 בריאות — ממוצעים 7 ימים אחרונים:</b>"];
    let any = false;
    for (const m of HEALTH_METRICS) {
      const avg = await averageLast7Days(supabase, profile.id, m);
      if (avg !== null) {
        any = true;
        lines.push(`${METRIC_LABELS[m]}: <b>${avg.toFixed(1)}</b>`);
      }
    }
    if (!any) {
      lines.push(
        "",
        "אין עדיין נתונים. דוגמאות:",
        "<code>/health sleep 6.5</code>",
        "<code>/health mood 7</code>",
        "<code>/health workout 30</code>",
      );
    }
    lines.push("", "<i>היסטוריה: /health log</i>");
    await sendMessage(chatId, lines.join("\n"));
    return;
  }
  if (tokens[0] === "log") {
    const records = await listRecentMetrics(supabase, profile.id, 14, 30);
    if (records.length === 0) {
      await sendMessage(chatId, "אין רשומות.");
      return;
    }
    const lines = ["<b>💪 בריאות — 30 רשומות אחרונות:</b>"];
    for (const r of records) {
      const when = new Intl.DateTimeFormat("he-IL", {
        timeZone: profile.timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(r.occurred_at));
      lines.push(`${when} — ${METRIC_LABELS[r.metric]}: ${r.value}`);
    }
    await sendMessage(chatId, lines.join("\n").slice(0, 3500));
    return;
  }
  // /health <metric> <value>
  const metric = normalizeMetric(tokens[0]);
  if (!metric) {
    await sendMessage(
      chatId,
      "מטריקה לא ידועה. נסו: <code>/health sleep 6.5</code> או <code>/health mood 7</code>",
    );
    return;
  }
  const value = parseFloat(tokens[1] ?? "");
  if (!isFinite(value)) {
    await sendMessage(
      chatId,
      "ערך לא תקין. דוגמה: <code>/health sleep 6.5</code>",
    );
    return;
  }
  const id = await logMetric(supabase, profile.id, metric, value);
  await logEvent(supabase, profile.id, {
    kind: "health_logged",
    payload: { metric, value },
    relatedEntity: { type: "health_metric", id },
  });
  await sendMessage(
    chatId,
    `✅ נרשם: ${METRIC_LABELS[metric]} = <b>${value}</b>`,
  );
}

async function handleInbox(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const events = await listRecentEvents(supabase, profile.id, 40);
  if (events.length === 0) {
    await sendMessage(chatId, "ה-inbox ריק.");
    return;
  }
  const buckets = new Map<string, EventRow[]>();
  for (const e of events) {
    const b = dayBucket(e.occurred_at, profile.timezone);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(e);
  }
  const lines = ["<b>📥 Inbox — 40 פעולות אחרונות:</b>"];
  for (const [bucket, list] of buckets) {
    lines.push("", `<b>${bucket}</b>`);
    for (const e of list) {
      lines.push(`• ${eventPreview(e)}`);
    }
  }
  await sendMessage(chatId, lines.join("\n").slice(0, 3500));
}

// One-shot Claude call for short-form prompts (used by /focus). No tool-use,
// no caching — kept local because nothing else needs this shape.
async function claudeText(
  systemPrompt: string,
  userTurn: string,
): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("LLM_MODEL") ?? "claude-sonnet-4-6";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system: [{
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{ role: "user", content: userTurn }],
      }),
    });
    if (!res.ok) {
      console.error("claudeText non-OK:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const block = data.content?.find((b) => b.type === "text");
    return block?.text?.trim() ?? null;
  } catch (err) {
    console.error("claudeText failed:", err);
    return null;
  }
}

const FOCUS_SYSTEM =
  `אתה עוזר אישי בעברית. בהינתן יומן היום, משימות פתוחות, מטרות ועקרונות של המשתמש —
החזר *בדיוק 3 שורות* בעברית:
- שורה 1: 🎯 הכי חשוב היום (משימה/פגישה אחת)
- שורה 2: ➕ אופציה אם תספיק
- שורה 3: ⏸️ מה לדחות לסוף השבוע / שבוע הבא

קצר וענייני. ללא הסבר. ללא ברכות. בלי הקדמות.`;

async function handleFocus(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [events, tasks, facts] = await Promise.all([
    listOwnerEventsBetween(
      supabase,
      profile.id,
      dayStart.toISOString(),
      dayEnd.toISOString(),
    ),
    listTopTasks(supabase, profile.id),
    listActiveFacts(supabase, profile.id, ["goal", "priority", "value"]),
  ]);
  const ctx = {
    calendar_today: events.slice(0, 8).map((e) => ({
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
    })),
    open_tasks_top5: tasks.slice(0, 5).map((t) => ({
      title: t.title,
      priority: t.priority,
    })),
    user_principles: facts.slice(0, 8).map((f) => ({
      type: f.fact_type,
      predicate: f.predicate,
      object: f.object,
    })),
  };
  const text = await claudeText(FOCUS_SYSTEM, JSON.stringify(ctx));
  if (!text) {
    await sendMessage(
      chatId,
      "לא הצלחתי לחבר את המיקוד עכשיו. נסו שוב בעוד רגע.",
    );
    return;
  }
  await sendMessage(chatId, text);
}

async function handleStats(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const snaps = await listRecentSnapshots(supabase, profile.id, 14);
  if (snaps.length < 3) {
    await sendMessage(
      chatId,
      "צריך עוד ימים כדי שיהיה למה להשוות. הסנאפשוט נשמר כל לילה — חזרו עוד יום-יומיים 📊",
    );
    return;
  }
  const week = snaps.slice(0, 7).map((s) => s.snapshot);
  const prevWeek = snaps.slice(7, 14).map((s) => s.snapshot);
  const sum = (rows: DailySnapshot[], k: keyof DailySnapshot) =>
    rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const avg = (rows: DailySnapshot[], k: keyof DailySnapshot) => {
    const vals = rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return vals.reduce((a, v) => a + v, 0) / vals.length;
  };
  const fmtDelta = (now: number | null, prev: number | null, unit = "") => {
    if (now === null) return "—";
    if (prev === null || prev === 0) return `${now.toFixed(1)}${unit}`;
    const arrow = now > prev ? "↑" : now < prev ? "↓" : "→";
    return `${now.toFixed(1)}${unit} ${arrow} מ-${prev.toFixed(1)}`;
  };
  const lines = ["<b>📊 השבוע האחרון:</b>", ""];
  lines.push(
    `✅ משימות שנסגרו: ${
      fmtDelta(
        sum(week, "done_tasks_week") / 7,
        sum(prevWeek, "done_tasks_week") / 7,
      )
    }`,
  );
  lines.push(
    `💭 בועות חדשות: ${
      fmtDelta(
        sum(week, "bubbles_added_week") / 7,
        sum(prevWeek, "bubbles_added_week") / 7,
      )
    }`,
  );
  const sleep = avg(week, "sleep_hours_avg_7d");
  const sleepPrev = avg(prevWeek, "sleep_hours_avg_7d");
  if (sleep !== null) lines.push(`😴 שינה: ${fmtDelta(sleep, sleepPrev, "ש")}`);
  const mood = avg(week, "mood_avg_7d");
  const moodPrev = avg(prevWeek, "mood_avg_7d");
  if (mood !== null) lines.push(`🙂 מצב רוח: ${fmtDelta(mood, moodPrev)}`);
  const cal = avg(week, "calendar_load_hours_week");
  const calPrev = avg(prevWeek, "calendar_load_hours_week");
  if (cal !== null) lines.push(`🗓️ עומס יומן: ${fmtDelta(cal, calPrev, "ש")}`);
  lines.push("", `<i>(${snaps.length} סנאפשוטים זמינים)</i>`);
  await sendMessage(chatId, lines.join("\n"));
}

async function handleCal(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const arg = rest.trim().toLowerCase();
  let days = 7;
  let filter: string | null = null;
  const daysMatch = arg.match(/(\d+)\s*d/);
  if (daysMatch) days = Math.min(Number(daysMatch[1]), 30);
  const personMatch = rest.match(/(?:עם|with)\s+(.+)/i);
  if (personMatch) filter = personMatch[1].trim();
  const fromIso = new Date().toISOString();
  const toIso = new Date(Date.now() + days * 86_400_000).toISOString();
  let events;
  try {
    events = await listOwnerEventsBetween(supabase, profile.id, fromIso, toIso);
  } catch (err) {
    console.error("listOwnerEventsBetween failed:", err);
    await sendMessage(chatId, "לא הצלחתי לטעון את היומן.");
    return;
  }
  if (filter) {
    const needle = filter.toLowerCase();
    events = events.filter((e) =>
      (e.title ?? "").toLowerCase().includes(needle) ||
      (e.description ?? "").toLowerCase().includes(needle)
    );
  }
  if (events.length === 0) {
    const msg = filter
      ? `אין אירועים עם "${escapeHtml(filter)}" ב-${days} הימים הקרובים.`
      : `אין אירועים ב-${days} הימים הקרובים.`;
    await sendMessage(chatId, msg);
    return;
  }
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: profile.timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const lines = [
    `<b>🗓️ ${days} ימים קרובים${filter ? ` עם "${escapeHtml(filter)}"` : ""}:</b>`,
    "",
  ];
  for (const e of events.slice(0, 15)) {
    lines.push(
      `• <b>${fmt.format(new Date(e.start_at))}</b> — ${escapeHtml(e.title)}`,
    );
    if (e.location) lines.push(`   📍 ${escapeHtml(e.location)}`);
  }
  if (events.length > 15) {
    lines.push("", `<i>...ועוד ${events.length - 15}</i>`);
  }
  await sendMessage(chatId, lines.join("\n"));
}

async function handlePin(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const query = rest.trim();
  if (!query) {
    await sendMessage(
      chatId,
      "מה להצמיד ללוח? לדוגמה: <code>/pin משפחה</code> (יוצמדת הבועה התואמת ביותר).",
    );
    return;
  }
  const matches = await searchBubbles(supabase, profile.id, query, 5);
  if (matches.length === 0) {
    await sendMessage(chatId, `לא נמצאה בועה עבור "${escapeHtml(query)}".`);
    return;
  }
  const bubble = matches[0];
  const ok = await setPinned(supabase, profile.id, bubble.id, true);
  if (!ok) {
    await sendMessage(
      chatId,
      "הלוח מלא (10 הצמדות). הסר אחת ידנית או שחרר עם <code>/unpin</code> כדי להוסיף.",
    );
    return;
  }
  await sendMessage(
    chatId,
    `📌 הוצמדה: <i>${escapeHtml(bubble.content.slice(0, 200))}</i>`,
  );
}

async function handleUnpin(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const query = rest.trim();
  if (!query) {
    await sendMessage(chatId, "מה לשחרר? לדוגמה: <code>/unpin משפחה</code>");
    return;
  }
  const pinned = await listPinnedBubbles(supabase, profile.id);
  const needle = query.toLowerCase();
  const target = pinned.find((b) => b.content.toLowerCase().includes(needle));
  if (!target) {
    await sendMessage(
      chatId,
      `לא נמצאה הצמדה התואמת ל-"${escapeHtml(query)}".`,
    );
    return;
  }
  await setPinned(supabase, profile.id, target.id, false);
  await sendMessage(
    chatId,
    `🔓 שוחררה: <i>${escapeHtml(target.content.slice(0, 200))}</i>`,
  );
}

async function handleBoard(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const pinned = await listPinnedBubbles(supabase, profile.id);
  if (pinned.length === 0) {
    await sendMessage(
      chatId,
      "הלוח ריק. הצמידו בועות עם <code>/pin &lt;חיפוש&gt;</code> כדי שיופיעו כאן ובהקשר של הסוכנים.",
    );
    return;
  }
  const lines = ["<b>📌 הלוח שלך:</b>", ""];
  for (const b of pinned) {
    lines.push(`• ${escapeHtml(b.content.slice(0, 200))}`);
  }
  await sendMessage(chatId, lines.join("\n").slice(0, 3500));
}

async function handlePeople(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const facts = await listActiveFacts(supabase, profile.id, ["relationship"]);
  if (facts.length === 0) {
    await sendMessage(
      chatId,
      'עדיין לא זיהיתי קשרים. הזכירו במשהו כמו "דנה היא אשתי" או "אמא שלי" וזה ייאסף אוטומטית.',
    );
    return;
  }
  // Build a name list — object field usually holds the person's name.
  const names = facts.map((f) => {
    const name = typeof f.object === "string"
      ? f.object
      : (f.object && typeof f.object === "object" && "name" in f.object
        ? String((f.object as Record<string, unknown>).name)
        : f.predicate);
    return { fact: f, name };
  });
  const lines = ["<b>🤝 קשרים:</b>", ""];
  for (const { fact, name } of names) {
    const sinceMs = Date.now() - new Date(fact.valid_from).getTime();
    const days = Math.floor(sinceMs / 86_400_000);
    const ago = days === 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`;
    lines.push(
      `• <b>${escapeHtml(name)}</b> — ${escapeHtml(fact.predicate)} · נשמר ${ago}`,
    );
  }
  await sendMessage(chatId, lines.join("\n"));
}

async function handleDrive(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const query = rest.trim();
  if (!query) {
    await sendMessage(chatId, "מה לחפש ב-Drive? לדוגמה: /drive חוזה");
    return;
  }
  let files;
  try {
    files = await searchDrive(supabase, profile.id, query, 8);
  } catch (err) {
    console.error("searchDrive failed:", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not connected")) {
      await sendMessage(
        chatId,
        "Google Drive לא מחובר. /connect drive כדי לחבר.",
      );
    } else {
      await sendMessage(chatId, "החיפוש ב-Drive נכשל.");
    }
    return;
  }
  if (files.length === 0) {
    await sendMessage(chatId, `לא נמצאו קבצים עבור "${escapeHtml(query)}".`);
    return;
  }
  const lines = [`<b>🔎 תוצאות ל-"${escapeHtml(query)}":</b>`];
  for (const f of files) {
    const link = f.webViewLink
      ? `<a href="${f.webViewLink}">${escapeHtml(f.name)}</a>`
      : escapeHtml(f.name);
    lines.push(`${mimeEmoji(f.mimeType)} ${link}`);
  }
  await sendMessage(chatId, lines.join("\n"), {
    disable_web_page_preview: true,
  });
}

// The morning brief is the `smart_morning` proactive agent (fires 07:00 local,
// on by default). /summary is a friendly alias to toggle it per-user via
// user_agent_settings — and to clean up any legacy daily_calendar_summary
// dynamic reminder so users never get two morning messages.
async function handleSummary(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  rest: string,
): Promise<void> {
  const tokens = rest.split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase() ?? "";

  const { data: agentRow } = await supabase
    .from("agents")
    .select("id")
    .eq("name", "smart_morning")
    .maybeSingle<{ id: string }>();
  if (!agentRow) {
    await sendMessage(chatId, "סיכום הבוקר לא זמין כרגע.");
    return;
  }
  const agentId = agentRow.id;

  const isEnabled = async (): Promise<boolean> => {
    const { data } = await supabase
      .from("user_agent_settings")
      .select("enabled")
      .eq("owner_id", profile.id)
      .eq("agent_id", agentId)
      .maybeSingle<{ enabled: boolean }>();
    return data ? data.enabled : true; // default on
  };
  const setEnabled = async (enabled: boolean): Promise<void> => {
    await supabase.from("user_agent_settings").upsert({
      owner_id: profile.id,
      agent_id: agentId,
      enabled,
    });
  };

  if (!action || action === "status") {
    const on = await isEnabled();
    await sendMessage(
      chatId,
      on
        ? "☀️ סיכום הבוקר פעיל — מגיע כל בוקר ב-07:00. כיבוי: /summary off"
        : "🌙 סיכום הבוקר כבוי. הפעלה: /summary on",
    );
    return;
  }
  if (action === "off") {
    await setEnabled(false);
    await disableDailySummary(supabase, profile.id); // retire any legacy reminder
    await sendMessage(chatId, "🌙 כיביתי את סיכום הבוקר. /summary on לחזרה.");
    return;
  }
  if (action === "on") {
    await setEnabled(true);
    await disableDailySummary(supabase, profile.id); // retire any legacy reminder
    const note = tokens[1] ? "\n(הסיכום מגיע אוטומטית ב-07:00 לפי השעון המקומי שלך.)" : "";
    await sendMessage(chatId, `☀️ סיכום הבוקר פעיל — כל בוקר ב-07:00.${note}`);
    return;
  }
  await sendMessage(
    chatId,
    "שימוש: /summary on  |  /summary off  |  /summary status",
  );
}

async function handleCalendarEventCreation(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  routed: RoutedCalendarEvent,
): Promise<void> {
  const stored = await getToken(supabase, profile.id, "google");
  if (!stored) {
    // Fallback: no Google connected → create a reminder so the user still gets value.
    await createAndConfirmReminder(supabase, profile, chatId, {
      intent: "reminder",
      title: routed.title,
      body: routed.description ?? routed.location ?? null,
      schedule_type: "once",
      run_at: routed.start_at,
      recurrence: null,
    });
    await sendMessage(
      chatId,
      "📌 שמרתי כתזכורת — לחיבור יומן אמיתי הפעילו /connect.",
    );
    return;
  }
  try {
    const token = await ensureFreshToken(supabase, profile.id, stored);
    const created = await createEvent(token, {
      title: routed.title,
      description: routed.description,
      location: routed.location,
      startIso: routed.start_at,
      endIso: routed.end_at,
      allDay: routed.all_day,
      timezone: profile.timezone,
    });
    const when = routed.all_day
      ? new Intl.DateTimeFormat("he-IL", {
        timeZone: profile.timezone,
        dateStyle: "full",
      }).format(new Date(routed.start_at))
      : formatLocal(routed.start_at, profile.timezone);
    const lines = [
      "📅 נקבע ביומן Google:",
      `<b>${escapeHtml(routed.title)}</b>`,
      `🕐 ${when}`,
    ];
    if (routed.location) lines.push(`📍 ${escapeHtml(routed.location)}`);
    const buttons = created.htmlLink
      ? [[{ text: "פתח ב-Google Calendar", url: created.htmlLink }]]
      : [];
    await sendMessage(chatId, lines.join("\n"), {
      reply_markup: { inline_keyboard: buttons },
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("createEvent failed:", err);
    await sendMessage(
      chatId,
      "לא הצלחתי לקבוע את האירוע. ייתכן וצריך לחבר מחדש את היומן עם הרשאות חדשות: /connect",
    );
  }
}

function formatEventWhen(
  ev: { start_at: string; end_at: string; all_day: boolean },
  tz: string,
): string {
  if (ev.all_day) {
    return "📅 " +
      new Intl.DateTimeFormat("he-IL", { timeZone: tz, dateStyle: "full" })
        .format(
          new Date(ev.start_at),
        );
  }
  const day = new Intl.DateTimeFormat("he-IL", {
    timeZone: tz,
    dateStyle: "full",
  }).format(
    new Date(ev.start_at),
  );
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("he-IL", { timeZone: tz, timeStyle: "short" })
      .format(new Date(iso));
  return `🕐 ${day}, ${clock(ev.start_at)}–${clock(ev.end_at)}`;
}

function renderEventDetail(ev: OwnedEvent, tz: string): RenderedMessage {
  const lines = [`📅 <b>${escapeHtml(ev.title)}</b>`, formatEventWhen(ev, tz)];
  if (ev.location) lines.push(`📍 ${escapeHtml(ev.location)}`);
  if (ev.description) lines.push("", escapeHtml(truncate(ev.description, 500)));
  const buttons: { text: string; callback_data: string }[][] = [];
  // Minute-level reschedule only makes sense for timed events.
  if (!ev.all_day) {
    buttons.push([
      { text: "+15 דק׳", callback_data: `evmv:${ev.id}:15` },
      { text: "+30 דק׳", callback_data: `evmv:${ev.id}:30` },
      { text: "+שעה", callback_data: `evmv:${ev.id}:60` },
    ]);
  }
  buttons.push([
    { text: "📅 +יום", callback_data: `evmv:${ev.id}:1440` },
    { text: "🔄 רענן", callback_data: `evopen:${ev.id}` },
  ]);
  buttons.push([{ text: "🗑️ מחק אירוע", callback_data: `evdel:${ev.id}` }]);
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: buttons } };
}

async function handleEventsList(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
): Promise<void> {
  const token = await getToken(supabase, profile.id, "google");
  if (!token) {
    await sendMessage(
      chatId,
      "היומן לא מחובר. /connect כדי לחבר Google Calendar.",
    );
    return;
  }
  // Best-effort fresh pull so the list reflects upstream changes.
  try {
    await syncGoogleCalendar(supabase, profile.id);
  } catch (err) {
    console.error("inline sync failed (continuing with cached events):", err);
  }
  const now = new Date();
  const to = new Date(now.getTime() + 14 * 86_400_000);
  const events = await listOwnerEventsBetween(
    supabase,
    profile.id,
    now.toISOString(),
    to.toISOString(),
  );
  if (events.length === 0) {
    await sendMessage(chatId, "אין אירועים קרובים ב-14 הימים הבאים.");
    return;
  }
  const lines = [
    "<b>📅 האירועים הקרובים שלך:</b>",
    "בחרו אירוע כדי לערוך או למחוק:",
  ];
  const buttons = events.slice(0, 20).map((e) => [{
    text: `${e.all_day ? "📅" : "🕐"} ${truncate(e.title, 32)}`,
    callback_data: `evopen:${e.id}`,
  }]);
  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// Shift an event's start+end by `deltaMinutes`, propagating to Google and the
// local cache. Returns the updated event, or null if Google isn't connected.
async function rescheduleEvent(
  supabase: SupabaseClient,
  profile: Profile,
  ev: OwnedEvent,
  deltaMinutes: number,
): Promise<OwnedEvent | null> {
  const stored = await getToken(supabase, profile.id, "google");
  if (!stored) return null;
  const token = await ensureFreshToken(supabase, profile.id, stored);
  const newStart = new Date(
    new Date(ev.start_at).getTime() + deltaMinutes * 60_000,
  ).toISOString();
  const newEnd = new Date(new Date(ev.end_at).getTime() + deltaMinutes * 60_000)
    .toISOString();
  await updateEvent(token, ev.calendar_id, ev.external_id, {
    startIso: newStart,
    endIso: newEnd,
    allDay: ev.all_day,
    timezone: profile.timezone,
  });
  await updateLocalEventTimes(supabase, profile.id, ev.id, newStart, newEnd);
  return { ...ev, start_at: newStart, end_at: newEnd };
}

async function handleFreeText(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  text: string,
  inputSource: "text" | "voice" = "text",
): Promise<void> {
  // Recall-shaped questions short-circuit the router and go straight to the
  // memory agent — they're not "create a thing" intents and we save an LLM
  // call. If the heuristic doesn't trigger but the router classifies as
  // recall_question, we dispatch to the same handler below.
  if (looksLikeRecallQuestion(text)) {
    await logEvent(supabase, profile.id, {
      kind: "intent_routed",
      source: "system",
      payload: {
        intent: "recall_question",
        text_preview: text.slice(0, 200),
        input: inputSource,
      },
    });
    await handleRecall2(supabase, profile, chatId, text);
    return;
  }

  // Run fact extraction in parallel with routing+dispatch via the Edge
  // Runtime's waitUntil (keeps the task alive after the response is sent).
  // Falls through gracefully when EdgeRuntime isn't available (local dev).
  const extractionPromise = extractAndSave(supabase, profile.id, text, null)
    .catch((err) => {
      console.error("extractAndSave failed:", err);
      return 0;
    });
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(extractionPromise);

  let routedItems;
  try {
    routedItems = await routeMessage(
      text,
      new Date().toISOString(),
      profile.timezone,
    );
  } catch (err) {
    console.error("routeMessage failed:", err);
    await sendMessage(
      chatId,
      "לא הצלחתי לעבד את הבקשה כרגע — נסו שוב בעוד רגע 🙏",
    );
    return;
  }

  if (routedItems.length === 0) {
    await sendMessage(
      chatId,
      "לא הבנתי לגמרי — אפשר לנסח אחרת, או לבחור מהתפריט:",
      { reply_markup: mainMenuKeyboard() },
    );
    return;
  }

  for (const routed of routedItems) {
    await logEvent(supabase, profile.id, {
      kind: "intent_routed",
      source: "system",
      payload: {
        intent: routed.intent,
        text_preview: text.slice(0, 200),
        input: inputSource,
      },
    });
    await dispatchRoutedItem(supabase, profile, chatId, text, routed);
  }
}

async function dispatchRoutedItem(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  _originalText: string,
  routed: Routed,
): Promise<void> {
  switch (routed.intent) {
    case "reminder":
      await createAndConfirmReminder(supabase, profile, chatId, routed);
      return;
    case "calendar_event":
      await handleCalendarEventCreation(supabase, profile, chatId, routed);
      return;
    case "list_add":
      if (routed.items.length === 0 && routed.list_name) {
        // Create-empty-named-list path (e.g. "תעשה רשימת קניות משותפת" — no items
        // yet, but the user wants the list to exist so they can act on it next).
        const id = await getOrCreateList(
          supabase,
          profile.id,
          routed.list_name,
        );
        await setActiveList(supabase, profile.id, id);
        await sendMessage(
          chatId,
          `✅ נוצרה רשימה <b>${escapeHtml(routed.list_name)}</b>.`,
        );
      } else {
        await addItemsToList(
          supabase,
          profile,
          chatId,
          routed.items,
          routed.list_name,
          "text",
        );
      }
      if (routed.suggested_followup) {
        await sendMessage(chatId, `💡 ${routed.suggested_followup}`);
      }
      return;
    case "memory_save": {
      const bubble = await createBubble(supabase, {
        ownerId: profile.id,
        content: routed.content,
        tags: routed.tags.length ? routed.tags : extractTags(routed.content),
        sourceUrl: extractUrl(routed.content),
        type: routed.bubble_type ?? undefined,
      });
      await logEvent(supabase, profile.id, {
        kind: "bubble_created",
        payload: {
          type: bubble.type,
          tags: bubble.tags,
          preview: bubble.content.slice(0, 120),
        },
        relatedEntity: { type: "bubble", id: bubble.id },
      });
      await syncBubble(supabase, profile.id, bubble, new Date().toISOString());
      const view = renderBubbleConfirm(bubble);
      await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
      return;
    }
    case "task_create": {
      const task = await createTask(supabase, profile.id, routed.title);
      await setActiveTask(supabase, profile.id, task.id);
      await logEvent(supabase, profile.id, {
        kind: "task_created",
        payload: { title: routed.title, priority: task.priority },
        relatedEntity: { type: "task", id: task.id },
      });
      await syncTask(supabase, profile.id, task, [], new Date().toISOString());
      const view = renderTaskDetail(task, []);
      await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
      return;
    }
    case "health_log": {
      const metric = normalizeMetric(routed.metric);
      if (!metric) {
        await sendMessage(
          chatId,
          `לא זיהיתי את המטריקה "${
            escapeHtml(routed.metric)
          }". נסו: שינה / מצב רוח / אימון / מים / משקל / כאב / צעדים.`,
        );
        return;
      }
      const id = await logMetric(supabase, profile.id, metric, routed.value, {
        unit: routed.unit ?? undefined,
        note: routed.note ?? undefined,
        source: "manual",
      });
      await logEvent(supabase, profile.id, {
        kind: "health_logged",
        payload: { metric, value: routed.value },
        relatedEntity: { type: "health_metric", id },
      });
      await sendMessage(
        chatId,
        `✅ נרשם: ${METRIC_LABELS[metric]} = <b>${routed.value}</b>`,
      );
      return;
    }
    case "recall_question":
      await handleRecall2(supabase, profile, chatId, routed.question);
      return;
    case "conditional_reminder": {
      const params = routed.condition_params ?? {};
      const windowDays = Number(
        (params as Record<string, unknown>).window_days,
      );
      const initialRunAt = new Date(
        Date.now() +
          (Number.isFinite(windowDays) ? windowDays : 1) * 86_400_000,
      ).toISOString();
      const { data, error } = await supabase
        .from("reminders")
        .insert({
          owner_id: profile.id,
          title: routed.title,
          body: routed.body,
          kind: "conditional",
          schedule_type: "once",
          run_at: initialRunAt,
          timezone: profile.timezone,
          condition_type: routed.condition_type,
          condition_params: { ...params, event_kind: routed.event_kind },
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !data) {
        console.error("conditional reminder insert failed:", error);
        await sendMessage(chatId, "לא הצלחתי לשמור את התזכורת המותנית.");
        return;
      }
      await logEvent(supabase, profile.id, {
        kind: "reminder_created",
        payload: {
          kind: "conditional",
          title: routed.title,
          condition_type: routed.condition_type,
          event_kind: routed.event_kind,
        },
        relatedEntity: { type: "reminder", id: data.id },
      });
      await sendMessage(
        chatId,
        `✅ תזכורת מותנית נשמרה: <b>${
          escapeHtml(routed.title)
        }</b>\nתיבדק כל יום ותישלח רק אם התנאי מתקיים.`,
      );
      return;
    }
    case "unclear":
      await sendMessage(
        chatId,
        routed.clarification ??
          "לא הבנתי לגמרי — אפשר לנסח אחרת, או לבחור מהתפריט:",
        { reply_markup: mainMenuKeyboard() },
      );
      return;
  }
}

async function handleSubtask(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  title: string,
): Promise<void> {
  if (!title) {
    await sendMessage(
      chatId,
      "מה הכותרת של תת־המשימה? לדוגמה: /subtask לאסוף נתונים",
    );
    return;
  }
  const parentId = profile.active_task_id;
  if (!parentId || !(await getOwnedTask(supabase, profile.id, parentId))) {
    await sendMessage(
      chatId,
      "אין משימה פעילה. פתחו אחת מ-/tasks או צרו עם /task.",
    );
    return;
  }
  await createTask(supabase, profile.id, title, parentId);
  // Resync the parent task so its Obsidian file reflects the new subtask list.
  const parent = await getOwnedTask(supabase, profile.id, parentId);
  if (parent) {
    const subs = await getSubtasks(supabase, profile.id, parentId);
    await syncTask(
      supabase,
      profile.id,
      parent,
      subs,
      new Date().toISOString(),
    );
  }
  const view = await renderTaskDetailById(supabase, profile.id, parentId);
  if (view) {
    await sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
  }
}

async function handleListCallback(
  supabase: SupabaseClient,
  profile: Profile,
  chatId: number,
  messageId: number,
  listId: string,
): Promise<void> {
  const list = await getOwnedList(supabase, profile.id, listId);
  if (!list) return;
  const view = renderList(list.name, await getListItems(supabase, list.id));
  await editMessageText(chatId, messageId, view.text, {
    reply_markup: view.reply_markup,
  });
}

async function handleCallback(
  supabase: SupabaseClient,
  cq: TelegramCallbackQuery,
): Promise<void> {
  const data = cq.data ?? "";
  const sep = data.indexOf(":");
  const action = sep === -1 ? data : data.slice(0, sep);
  const arg = sep === -1 ? "" : data.slice(sep + 1);

  const profile = await getOrCreateProfile(supabase, cq.from);
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;

  await logEvent(supabase, profile.id, {
    kind: "callback",
    source: "user",
    payload: { action, arg: arg.slice(0, 80) },
  });

  switch (action) {
    case "menu": {
      await answerCallbackQuery(cq.id);
      if (!chatId) return;
      switch (arg) {
        case "today":
          await handleToday(supabase, profile, chatId);
          return;
        case "reminders":
          await handleReminderList(supabase, profile, chatId);
          return;
        case "lists":
          await handleListsOverview(supabase, profile, chatId);
          return;
        case "memories":
          await handleMemories(supabase, profile, chatId, null);
          return;
        case "tasks":
          await handleTasksOverview(supabase, profile, chatId);
          return;
        case "events":
          await handleEventsList(supabase, profile, chatId);
          return;
        case "agents":
          await handleAgentsCommand(supabase, profile, chatId, "");
          return;
        case "inbox":
          await handleInbox(supabase, profile, chatId);
          return;
        case "focus":
          await handleFocus(supabase, profile, chatId);
          return;
        case "help":
          await sendMessage(chatId, HELP);
          return;
      }
      return;
    }
    case "cancel": {
      const ok = await cancelReminder(supabase, profile.id, arg);
      if (ok) {
        await logEvent(supabase, profile.id, {
          kind: "reminder_cancelled",
          relatedEntity: { type: "reminder", id: arg },
        });
      }
      await answerCallbackQuery(cq.id, ok ? "בוטל" : "כבר לא פעיל");
      if (chatId && messageId) {
        await editMessageText(
          chatId,
          messageId,
          ok ? "🗑️ התזכורת בוטלה." : "התזכורת כבר אינה פעילה.",
        );
      }
      return;
    }
    case "snz": {
      // arg = "<code>:<reminderId>" where code is minutes or "morning".
      const colon = arg.indexOf(":");
      const code = arg.slice(0, colon);
      const reminderId = arg.slice(colon + 1);
      const runAt = code === "morning"
        ? nextLocalTime(profile.timezone, 8, 0)
        : new Date(Date.now() + Number(code) * 60_000);
      let res: { id: string; title: string } | null = null;
      try {
        res = await snoozeReminder(supabase, profile.id, reminderId, runAt);
      } catch (err) {
        console.error("snoozeReminder failed:", err);
      }
      await answerCallbackQuery(cq.id, res ? "נדחה ⏰" : "לא נמצא");
      if (res) {
        await logEvent(supabase, profile.id, {
          kind: "reminder_created",
          payload: {
            title: res.title,
            snoozed: true,
            run_at: runAt.toISOString(),
          },
          relatedEntity: { type: "reminder", id: res.id },
        });
        if (chatId && messageId) {
          // Drop the snooze buttons and note the new time. The callback message
          // text is plain (entities stripped), so re-escaping is safe.
          const original = cq.message?.text ?? res.title;
          await editMessageText(
            chatId,
            messageId,
            `${escapeHtml(original)}\n\n⏰ נדחה ל-${
              formatLocal(runAt.toISOString(), profile.timezone)
            }`,
          );
        }
      }
      return;
    }
    case "openlist": {
      await setActiveList(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, "רשימה פעילה");
      if (chatId && messageId) {
        await handleListCallback(supabase, profile, chatId, messageId, arg);
      }
      return;
    }
    case "toggle": {
      const listId = await toggleItem(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id);
      if (listId && chatId && messageId) {
        await handleListCallback(supabase, profile, chatId, messageId, listId);
      }
      return;
    }
    case "delitem": {
      const listId = await deleteItem(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, listId ? "נמחק" : "לא נמצא");
      if (listId && chatId && messageId) {
        await handleListCallback(supabase, profile, chatId, messageId, listId);
      }
      return;
    }
    case "bset": {
      const colon = arg.indexOf(":");
      const type = arg.slice(0, colon) as BubbleType;
      const bubbleId = arg.slice(colon + 1);
      const updated = await setBubbleType(supabase, profile.id, bubbleId, type);
      await answerCallbackQuery(cq.id, updated ? "סוג עודכן" : "לא נמצא");
      if (updated) {
        // Re-sync to Obsidian since the type (and thus the destination subfolder) may have changed.
        await syncBubble(
          supabase,
          profile.id,
          updated,
          new Date().toISOString(),
        );
      }
      if (updated && chatId && messageId) {
        const view = renderBubbleConfirm(updated);
        await editMessageText(chatId, messageId, view.text, {
          reply_markup: view.reply_markup,
        });
      }
      return;
    }
    case "bdel": {
      const ok = await deleteBubble(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, ok ? "נמחק" : "לא נמצא");
      if (ok) {
        await deleteBubbleExport(supabase, profile.id, arg);
        await logEvent(supabase, profile.id, {
          kind: "bubble_deleted",
          relatedEntity: { type: "bubble", id: arg },
        });
      }
      if (ok && chatId && messageId) {
        await editMessageText(chatId, messageId, "🗑️ הבועה נמחקה.");
      }
      return;
    }
    case "topen": {
      await setActiveTask(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, "משימה פעילה");
      if (chatId && messageId) {
        const view = await renderTaskDetailById(supabase, profile.id, arg);
        if (view) {
          await editMessageText(chatId, messageId, view.text, {
            reply_markup: view.reply_markup,
          });
        }
      }
      return;
    }
    case "tstatus":
    case "tprio": {
      const colon = arg.indexOf(":");
      const taskId = arg.slice(0, colon);
      const root = arg.slice(colon + 1);
      const updated = action === "tstatus"
        ? await cycleTaskStatus(supabase, profile.id, taskId)
        : await cycleTaskPriority(supabase, profile.id, taskId);
      await answerCallbackQuery(cq.id, updated ? "עודכן" : "לא נמצא");
      if (updated) {
        await logEvent(supabase, profile.id, {
          kind: action === "tstatus" ? "task_status_changed" : "task_priority_changed",
          payload: action === "tstatus"
            ? { status: updated.status }
            : { priority: updated.priority },
          relatedEntity: { type: "task", id: taskId },
        });
        // Re-sync the root task so its file reflects the change.
        const rootTask = await getOwnedTask(supabase, profile.id, root);
        if (rootTask) {
          const subs = await getSubtasks(supabase, profile.id, root);
          await syncTask(
            supabase,
            profile.id,
            rootTask,
            subs,
            new Date().toISOString(),
          );
        }
      }
      if (updated && chatId && messageId) {
        const view = await renderTaskDetailById(supabase, profile.id, root);
        if (view) {
          await editMessageText(chatId, messageId, view.text, {
            reply_markup: view.reply_markup,
          });
        }
      }
      return;
    }
    case "tdel": {
      const colon = arg.indexOf(":");
      const taskId = arg.slice(0, colon);
      const root = arg.slice(colon + 1);
      const result = await deleteTask(supabase, profile.id, taskId);
      await answerCallbackQuery(cq.id, result ? "נמחק" : "לא נמצא");
      if (result) {
        await logEvent(supabase, profile.id, {
          kind: "task_deleted",
          relatedEntity: { type: "task", id: taskId },
        });
        if (taskId === root) {
          // Top-level deletion → delete the Obsidian file too.
          await deleteTaskExport(supabase, profile.id, taskId);
        } else {
          // Subtask deletion → re-sync the root task so its file drops it.
          const rootTask = await getOwnedTask(supabase, profile.id, root);
          if (rootTask) {
            const subs = await getSubtasks(supabase, profile.id, root);
            await syncTask(
              supabase,
              profile.id,
              rootTask,
              subs,
              new Date().toISOString(),
            );
          }
        }
      }
      if (result && chatId && messageId) {
        if (taskId === root) {
          await editMessageText(chatId, messageId, "🗑️ המשימה נמחקה.");
        } else {
          const view = await renderTaskDetailById(supabase, profile.id, root);
          if (view) {
            await editMessageText(chatId, messageId, view.text, {
              reply_markup: view.reply_markup,
            });
          }
        }
      }
      return;
    }
    case "bfilter": {
      await answerCallbackQuery(cq.id);
      if (!chatId || !messageId) return;
      const filter = arg === "all" ? null : (arg as BubbleType);
      await editMemoriesView(supabase, profile, chatId, messageId, filter);
      return;
    }
    case "unfriend": {
      const ok = await unfriend(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, ok ? "הוסר" : "לא נמצא");
      if (ok && chatId && messageId) {
        await editMessageText(chatId, messageId, "🤝 הקשר הוסר.");
      }
      return;
    }
    case "unshare": {
      const ok = await unshareResource(supabase, profile.id, arg);
      await answerCallbackQuery(cq.id, ok ? "שיתוף בוטל" : "לא נמצא");
      if (ok && chatId && messageId) {
        await editMessageText(chatId, messageId, "🚫 השיתוף בוטל.");
      }
      return;
    }
    case "evopen": {
      await answerCallbackQuery(cq.id);
      if (!chatId || !messageId) return;
      const ev = await getOwnedEvent(supabase, profile.id, arg);
      if (!ev) {
        await editMessageText(chatId, messageId, "האירוע כבר לא קיים ביומן.");
        return;
      }
      const view = renderEventDetail(ev, profile.timezone);
      await editMessageText(chatId, messageId, view.text, {
        reply_markup: view.reply_markup,
      });
      return;
    }
    case "evmv": {
      const colon = arg.indexOf(":");
      const eventId = arg.slice(0, colon);
      const delta = Number(arg.slice(colon + 1));
      const ev = await getOwnedEvent(supabase, profile.id, eventId);
      if (!ev) {
        await answerCallbackQuery(cq.id, "לא נמצא");
        return;
      }
      let updated: OwnedEvent | null = null;
      try {
        updated = await rescheduleEvent(supabase, profile, ev, delta);
      } catch (err) {
        console.error("rescheduleEvent failed:", err);
      }
      await answerCallbackQuery(cq.id, updated ? "עודכן" : "נכשל");
      if (updated && chatId && messageId) {
        const view = renderEventDetail(updated, profile.timezone);
        await editMessageText(chatId, messageId, view.text, {
          reply_markup: view.reply_markup,
        });
      }
      return;
    }
    case "evdel": {
      const ev = await getOwnedEvent(supabase, profile.id, arg);
      if (!ev) {
        await answerCallbackQuery(cq.id, "לא נמצא");
        return;
      }
      const stored = await getToken(supabase, profile.id, "google");
      let ok = false;
      if (stored) {
        try {
          const token = await ensureFreshToken(supabase, profile.id, stored);
          await deleteEvent(token, ev.calendar_id, ev.external_id);
          await deleteLocalEvent(supabase, profile.id, ev.id);
          ok = true;
        } catch (err) {
          console.error("deleteEvent failed:", err);
        }
      }
      await answerCallbackQuery(cq.id, ok ? "נמחק" : "נכשל");
      if (ok && chatId && messageId) {
        await editMessageText(
          chatId,
          messageId,
          `🗑️ האירוע "${escapeHtml(ev.title)}" נמחק מהיומן.`,
        );
      }
      return;
    }
    case "agentfb": {
      const colon = arg.indexOf(":");
      const runId = colon === -1 ? arg : arg.slice(0, colon);
      const verdict = colon === -1 ? "" : arg.slice(colon + 1);
      if (verdict !== "useful" && verdict !== "noisy") {
        await answerCallbackQuery(cq.id);
        return;
      }
      await supabase.from("agent_runs").update({ feedback: verdict }).eq(
        "id",
        runId,
      ).eq(
        "owner_id",
        profile.id,
      );
      await answerCallbackQuery(
        cq.id,
        verdict === "useful" ? "תודה 🙏" : "נרשם — אכוון פחות 🤫",
      );
      // After 3 consecutive 'noisy' on the same agent, bump its per-user
      // min_confidence_to_send by 0.1 (capped at 0.95). Idempotent: only acts
      // when the previous 2 ratings are also 'noisy'.
      if (verdict === "noisy") {
        const { data: run } = await supabase
          .from("agent_runs")
          .select("agent_id")
          .eq("id", runId)
          .maybeSingle<{ agent_id: string }>();
        if (run?.agent_id) {
          const { data: recent } = await supabase
            .from("agent_runs")
            .select("feedback")
            .eq("agent_id", run.agent_id)
            .eq("owner_id", profile.id)
            .not("feedback", "is", null)
            .order("finished_at", { ascending: false })
            .limit(3)
            .returns<{ feedback: string }[]>();
          const lastThree = recent ?? [];
          if (
            lastThree.length === 3 &&
            lastThree.every((r) => r.feedback === "noisy")
          ) {
            const { data: setting } = await supabase
              .from("user_agent_settings")
              .select("policy_override")
              .eq("agent_id", run.agent_id)
              .eq("owner_id", profile.id)
              .maybeSingle<
                { policy_override: Record<string, unknown> | null }
              >();
            const current = (setting?.policy_override?.min_confidence_to_send as number) ??
              0.7;
            const bumped = Math.min(
              0.95,
              Math.round((current + 0.1) * 100) / 100,
            );
            await supabase.from("user_agent_settings").upsert({
              agent_id: run.agent_id,
              owner_id: profile.id,
              enabled: true,
              policy_override: {
                ...(setting?.policy_override ?? {}),
                min_confidence_to_send: bumped,
              },
            });
          }
        }
      }
      return;
    }
    default:
      await answerCallbackQuery(cq.id);
  }
}

async function handleMessage(
  supabase: SupabaseClient,
  message: TelegramMessage,
): Promise<void> {
  const profile = await getOrCreateProfile(supabase, message.from!);
  const chatId = message.chat.id;

  if (message.voice && !message.text) {
    await logEvent(supabase, profile.id, {
      kind: "voice_in",
      source: "user",
      payload: { duration: message.voice.duration },
    });
    await handleVoice(supabase, profile, chatId, message.voice.file_id);
    return;
  }

  // Uploaded/forwarded audio files (message.audio) transcribe and route the
  // same way as voice notes.
  if (message.audio && !message.text) {
    await logEvent(supabase, profile.id, {
      kind: "voice_in",
      source: "user",
      payload: { duration: message.audio.duration, kind: "audio" },
    });
    await handleVoice(supabase, profile, chatId, message.audio.file_id);
    return;
  }

  if ((message.photo && message.photo.length > 0) || message.document) {
    await logEvent(supabase, profile.id, {
      kind: "media_in",
      source: "user",
      payload: {
        kind: message.photo ? "photo" : "document",
        caption: message.caption ?? null,
      },
    });
    await handleMediaCapture(supabase, profile, chatId, message);
    return;
  }

  const rawText = (message.text ?? "").trim();
  // A tap on the persistent bottom bar arrives as plain text — map it to the
  // equivalent command before parsing.
  const text = BAR_MAP[rawText] ?? rawText;
  const firstToken = text.split(/\s+/)[0] ?? "";
  const cmd = firstToken.startsWith("/") ? firstToken.split("@")[0].toLowerCase() : "";
  const rest = text.slice(firstToken.length).trim();

  if (cmd) {
    await logEvent(supabase, profile.id, {
      kind: "command",
      source: "user",
      payload: { cmd, has_args: rest.length > 0 },
    });
  } else if (text) {
    await logEvent(supabase, profile.id, {
      kind: "message_in",
      source: "user",
      payload: { length: text.length, preview: text.slice(0, 120) },
    });
  }

  switch (cmd) {
    case "/start": {
      if (rest.startsWith("inv_")) {
        await handleInviteAccept(supabase, profile, chatId, rest.slice(4));
        return;
      }
      await sendMessage(chatId, WELCOME, { reply_markup: BOTTOM_BAR });
      return;
    }
    case "/menu":
      await sendMessage(chatId, MAIN_MENU_TEXT, {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    case "/help":
      await sendMessage(chatId, HELP);
      return;
    case "/linkweb": {
      try {
        const link = await createProfileLinkCode(supabase, profile.id);
        const webUrl = Deno.env.get("WEB_APP_URL");
        const linkUrl = webUrl
          ? `${webUrl.replace(/\/+$/, "")}/link?code=${encodeURIComponent(link.code)}`
          : null;
        const lines = [
          "🔗 <b>קישור לאפליקציית תכלס</b>",
          "",
          `הקוד החד-פעמי שלך: <code>${escapeHtml(link.code)}</code>`,
          "הקוד תקף ל-10 דקות ואפשר להשתמש בו פעם אחת בלבד.",
          linkUrl
            ? `\n<a href="${escapeHtml(linkUrl)}">פתיחת האפליקציה וקישור החשבון</a>`
            : "\nפתחו את אפליקציית הווב והזינו את הקוד במסך קישור החשבון.",
        ];
        await sendMessage(chatId, lines.join("\n"));
      } catch (err) {
        if (err instanceof ProfileLinkError && err.code === "misconfigured") {
          console.error("profile linking is not configured:", err.message);
          await sendMessage(chatId, "קישור האפליקציה עדיין לא הופעל בשרת.");
          return;
        }
        throw err;
      }
      return;
    }
    case "/reminders":
      await handleReminderList(supabase, profile, chatId);
      return;
    case "/lists":
      await handleListsOverview(supabase, profile, chatId);
      return;
    case "/newlist": {
      if (!rest) {
        await sendMessage(chatId, "איך לקרוא לרשימה? לדוגמה: /newlist קניות");
        return;
      }
      const id = await getOrCreateList(supabase, profile.id, rest);
      await setActiveList(supabase, profile.id, id);
      const view = renderList(rest, await getListItems(supabase, id));
      await sendMessage(
        chatId,
        `✨ הרשימה "${escapeHtml(rest)}" פעילה.\n\n${view.text}`,
        {
          reply_markup: view.reply_markup,
        },
      );
      return;
    }
    case "/add":
      await handleAddItems(supabase, profile, chatId, rest, "text");
      return;
    case "/remember":
    case "/save":
      await handleRemember(supabase, profile, chatId, rest);
      return;
    case "/recall":
    case "/search":
      await handleRecall(supabase, profile, chatId, rest);
      return;
    case "/find":
      await handleFind(supabase, profile, chatId, rest);
      return;
    case "/memories": {
      const arg = rest.toLowerCase();
      const filter: BubbleType | null = arg === "knowledge" || arg === "ידע"
        ? "knowledge"
        : arg === "inspiration" || arg === "השראה"
        ? "inspiration"
        : arg === "reflection" || arg === "הרהור"
        ? "reflection"
        : null;
      await handleMemories(supabase, profile, chatId, filter);
      return;
    }
    case "/knowledge":
      await handleMemories(supabase, profile, chatId, "knowledge");
      return;
    case "/inspiration":
      await handleMemories(supabase, profile, chatId, "inspiration");
      return;
    case "/reflection":
      await handleMemories(supabase, profile, chatId, "reflection");
      return;
    case "/types":
      await sendMessage(chatId, TYPE_LEGEND);
      return;
    case "/tasks":
      await handleTasksOverview(supabase, profile, chatId);
      return;
    case "/task":
      await handleNewTask(supabase, profile, chatId, rest);
      return;
    case "/subtask":
      await handleSubtask(supabase, profile, chatId, rest);
      return;
    case "/remind":
      await handleReminderRequest(supabase, profile, chatId, rest);
      return;
    case "/connect":
      await handleConnect(supabase, profile, chatId, rest);
      return;
    case "/disconnect":
      await handleDisconnect(supabase, profile, chatId);
      return;
    case "/today":
      await handleToday(supabase, profile, chatId);
      return;
    case "/events":
      await handleEventsList(supabase, profile, chatId);
      return;
    case "/summary":
      await handleSummary(supabase, profile, chatId, rest);
      return;
    case "/drive":
      await handleDrive(supabase, profile, chatId, rest);
      return;
    case "/inbox":
      await handleInbox(supabase, profile, chatId);
      return;
    case "/health":
      await handleHealth(supabase, profile, chatId, rest);
      return;
    case "/timeline":
      await handleTimeline(supabase, profile, chatId, rest);
      return;
    case "/agents":
      await handleAgentsCommand(supabase, profile, chatId, rest);
      return;
    case "/focus":
      await handleFocus(supabase, profile, chatId);
      return;
    case "/stats":
      await handleStats(supabase, profile, chatId);
      return;
    case "/cal":
      await handleCal(supabase, profile, chatId, rest);
      return;
    case "/pin":
      await handlePin(supabase, profile, chatId, rest);
      return;
    case "/unpin":
      await handleUnpin(supabase, profile, chatId, rest);
      return;
    case "/board":
      await handleBoard(supabase, profile, chatId);
      return;
    case "/people":
      await handlePeople(supabase, profile, chatId);
      return;
    case "/obsidian":
      await handleObsidian(supabase, profile, chatId, rest);
      return;
    case "/invite":
      await handleInviteCreate(supabase, profile, chatId);
      return;
    case "/friends":
      await handleFriends(supabase, profile, chatId);
      return;
    case "/shared":
      await handleSharedInbox(supabase, profile, chatId);
      return;
    case "/share":
      await handleShareCommand(supabase, profile, chatId, rest);
      return;
    default:
      if (cmd) {
        await sendMessage(chatId, "פקודה לא מוכרת. נסו /help.");
        return;
      }
      if (!text) return;
      await handleFreeText(supabase, profile, chatId, text);
  }
}

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const authError = requireHeaderSecret(
    expectedSecret,
    req.headers.get("x-telegram-bot-api-secret-token"),
  );
  if (authError) return authError;

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    if (update.callback_query?.from) {
      await handleCallback(supabase, update.callback_query);
    } else if (update.message?.from) {
      await handleMessage(supabase, update.message);
    }
  } catch (err) {
    console.error("handler error:", err);
    const chatId = update.message?.chat.id ??
      update.callback_query?.message?.chat.id;
    if (chatId) {
      try {
        await sendMessage(chatId, "אופס, משהו השתבש 🤕 נסו שוב.");
      } catch (_) { /* ignore */ }
    }
  }

  return new Response("ok");
});
