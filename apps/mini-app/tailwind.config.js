import rtl from "tailwindcss-rtl";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  theme: {
    extend: {
      colors: {
        // Mapped to Telegram theme params at runtime (see app.css / tg.ts).
        tg: {
          bg: "var(--tg-bg, #ffffff)",
          text: "var(--tg-text, #111827)",
          hint: "var(--tg-hint, #6b7280)",
          link: "var(--tg-link, #2563eb)",
          button: "var(--tg-button, #2563eb)",
          "button-text": "var(--tg-button-text, #ffffff)",
          secondary: "var(--tg-secondary-bg, #f3f4f6)",
        },
      },
    },
  },
  plugins: [rtl],
};
