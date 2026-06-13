// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface TelegramWebApp {
    initData: string;
    initDataUnsafe?: { start_param?: string };
    colorScheme: "light" | "dark";
    themeParams: Record<string, string>;
    ready: () => void;
    expand: () => void;
    HapticFeedback?: {
      impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
      notificationOccurred?: (type: "error" | "success" | "warning") => void;
      selectionChanged?: () => void;
    };
  }

  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export {};
