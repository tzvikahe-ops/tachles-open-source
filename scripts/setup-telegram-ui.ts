// One-time (idempotent) Telegram UI setup. Run after a deploy to register the
// Hebrew slash-command list and the chat menu button.
//
//   deno run -A scripts/setup-telegram-ui.ts
//
// Reads TELEGRAM_BOT_TOKEN from the environment; if absent, it loads .env.local
// from the repo root. Set MINI_APP_URL to point the menu button at the Mini App
// (Level 3); otherwise the menu button falls back to the command list.

import { setChatMenuButton, setMyCommands } from "../supabase/functions/_shared/telegram.ts";
import type { BotCommand, MenuButton } from "../supabase/functions/_shared/types.ts";

// Main commands — these appear in Telegram's "/" autocomplete. Everything else
// stays functional but hidden (see docs/telegram-ux-plan.md §1.2).
const COMMANDS: BotCommand[] = [
  { command: "menu", description: "תפריט ראשי" },
  { command: "today", description: "מה היום" },
  { command: "reminders", description: "תזכורות" },
  { command: "lists", description: "רשימות" },
  { command: "memories", description: "בועות זיכרון" },
  { command: "tasks", description: "משימות" },
  { command: "events", description: "אירועים ביומן" },
  { command: "agents", description: "סוכנים פרואקטיביים" },
  { command: "inbox", description: "מה קרה לאחרונה" },
  { command: "connect", description: "חיבור Google" },
  { command: "help", description: "עזרה" },
];

async function loadEnvLocal(): Promise<void> {
  if (Deno.env.get("TELEGRAM_BOT_TOKEN")) return;
  let raw: string;
  try {
    raw = await Deno.readTextFile(new URL("../.env.local", import.meta.url));
  } catch {
    return; // No .env.local — rely on whatever is already in the environment.
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Deno.env.get(key)) Deno.env.set(key, value);
  }
}

async function main(): Promise<void> {
  await loadEnvLocal();
  if (!Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    console.error(
      "Missing TELEGRAM_BOT_TOKEN (set it in the environment or .env.local).",
    );
    Deno.exit(1);
  }

  await setMyCommands(COMMANDS);
  await setMyCommands(COMMANDS, "he");
  console.log(`✓ Registered ${COMMANDS.length} commands (default + he).`);

  const miniAppUrl = Deno.env.get("MINI_APP_URL");
  const menuButton: MenuButton = miniAppUrl
    ? { type: "web_app", text: "תכלס 🚀", web_app: { url: miniAppUrl } }
    : { type: "default" };
  await setChatMenuButton(menuButton);
  console.log(
    miniAppUrl
      ? `✓ Menu button → Mini App (${miniAppUrl}).`
      : "✓ Menu button → command list (default).",
  );
}

await main();
