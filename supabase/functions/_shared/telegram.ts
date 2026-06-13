import type { BotCommand, MenuButton, ReplyKeyboardMarkup, ReplyKeyboardRemove } from "./types.ts";

const API = "https://api.telegram.org";

function botToken(): string {
  const t = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!t) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return t;
}

export async function callTelegram(
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    const desc = String(data.description ?? "");
    // editMessageText is idempotent — re-sending the same body is a no-op,
    // not an error. Telegram returns this when buttons/text didn't change.
    if (desc.includes("message is not modified")) return null;
    throw new Error(`Telegram ${method} failed: ${desc || res.status}`);
  }
  return data.result;
}

export function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

// Resolve a Telegram file_id to a downloadable URL (valid for ~1 hour).
export async function getFileLink(fileId: string): Promise<string> {
  const result = await callTelegram("getFile", { file_id: fileId }) as { file_path: string };
  return `${API}/file/bot${botToken()}/${result.file_path}`;
}

export function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<unknown> {
  return callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

// Register the bot's slash-command list (shown in Telegram's "/" autocomplete).
// Pass language_code to scope the list to a locale; omit for the default list.
export async function setMyCommands(
  commands: BotCommand[],
  language_code?: string,
): Promise<void> {
  await callTelegram("setMyCommands", {
    commands,
    ...(language_code ? { language_code } : {}),
  });
}

// Configure the chat menu button (the "≡"/menu next to the input field).
export async function setChatMenuButton(
  menu_button: MenuButton,
  chat_id?: number,
): Promise<void> {
  await callTelegram("setChatMenuButton", {
    menu_button,
    ...(chat_id ? { chat_id } : {}),
  });
}

// Build a persistent bottom Reply Keyboard from rows of button labels.
export function replyKeyboard(
  rows: string[][],
  opts: { is_persistent?: boolean } = {},
): ReplyKeyboardMarkup {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: opts.is_persistent ?? false,
  };
}

export const removeKeyboard: ReplyKeyboardRemove = { remove_keyboard: true };
