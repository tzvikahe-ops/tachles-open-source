// Thin wrapper over the Telegram WebApp global (injected by telegram-web-app.js
// loaded in app.html). Reads the signed initData and maps theme params to the
// CSS variables the Tailwind `tg.*` colors consume.

function webApp(): TelegramWebApp | undefined {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export function getInitData(): string {
  return webApp()?.initData ?? "";
}

export function isTelegram(): boolean {
  return Boolean(webApp()?.initData);
}

// The `startapp` value from a deep link (t.me/<bot>/<app>?startapp=<value>).
export function getStartParam(): string | undefined {
  return webApp()?.initDataUnsafe?.start_param;
}

// Telegram HapticFeedback shim. No-op in browser / older clients.
export function hapticSelection(): void {
  try {
    webApp()?.HapticFeedback?.selectionChanged?.();
  } catch {
    // ignore
  }
}

export function hapticImpact(style: "light" | "medium" | "heavy" = "light"): void {
  try {
    webApp()?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    // ignore
  }
}

const THEME_MAP: Record<string, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  secondary_bg_color: "--tg-secondary-bg",
};

// Call once on startup: signal readiness, expand to full height, and reflect the
// Telegram theme into CSS variables.
export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  try {
    app.ready();
    app.expand();
  } catch {
    // Older clients may not support every method — ignore.
  }
  const params = app.themeParams ?? {};
  const root = document.documentElement;
  for (const [tgKey, cssVar] of Object.entries(THEME_MAP)) {
    const value = params[tgKey];
    if (value) root.style.setProperty(cssVar, value);
  }
  if (app.colorScheme) root.style.colorScheme = app.colorScheme;
}
