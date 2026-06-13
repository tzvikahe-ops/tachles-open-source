import { createServiceClient } from "../_shared/supabase.ts";
import { consumeOAuthState, upsertToken } from "../_shared/integrations/oauth.ts";
import { exchangeCode } from "../_shared/integrations/google.ts";
import { enableObsidian } from "../_shared/integrations/obsidian.ts";
import { sendMessage } from "../_shared/telegram.ts";
import { escapeHtml } from "../_shared/html.ts";

// Receives the OAuth redirect from Google (and later Microsoft). Verifies the
// state CSRF token, exchanges the auth code for tokens, stores them, and
// notifies the user in Telegram. Returns a tiny HTML page so the user knows
// they can close the tab.

function htmlResponse(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;
       min-height:100vh;margin:0;background:#0b1020;color:#e8ebff;text-align:center;padding:1rem}
  .card{max-width:32rem;padding:2rem;border-radius:1rem;background:rgba(255,255,255,.04);
        box-shadow:0 8px 40px rgba(0,0,0,.25)}
  h1{margin:0 0 .5rem;font-size:1.5rem}
  p{opacity:.85;line-height:1.6}
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
  // Edge Runtime sometimes mis-detects HTML when given a JS string; sending
  // explicit UTF-8 bytes + capital-case Content-Type forces the browser to
  // render rather than show source.
  const bytes = new TextEncoder().encode(html);
  return new Response(bytes, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(
      "ההרשאה בוטלה",
      `התקבלה הודעה מ-Google: <code>${escapeHtml(error)}</code>`,
      400,
    );
  }
  if (!code || !state) {
    return htmlResponse("בקשה לא תקינה", "חסרים פרמטרים. אפשר לסגור את החלון.", 400);
  }

  const supabase = createServiceClient();
  const consumed = await consumeOAuthState(supabase, state);
  if (!consumed) {
    return htmlResponse("פג תוקף", "הקישור פג תוקף או כבר נוצל. שלחו /connect שוב בבוט.", 400);
  }

  if (consumed.provider !== "google") {
    return htmlResponse(
      "ספק לא נתמך",
      `הספק ${escapeHtml(consumed.provider)} עוד לא נתמך כאן.`,
      400,
    );
  }

  try {
    const token = await exchangeCode(code);
    await upsertToken(supabase, consumed.owner_id, "google", token);
  } catch (err) {
    console.error("oauth exchange/store failed:", err);
    try {
      if (consumed.chat_id !== null) {
        await sendMessage(
          consumed.chat_id,
          "❌ לא הצלחתי להשלים את חיבור היומן. נסו שוב מ-/connect.",
        );
      }
    } catch (_) { /* ignore */ }
    return htmlResponse("שגיאה", "לא הצלחתי לסיים את ההרשאה. נסו שוב מהבוט.", 500);
  }

  if (consumed.return_url) {
    const returnUrl = new URL(consumed.return_url);
    if (consumed.intent === "calendar") {
      returnUrl.searchParams.set("integration", "calendar-connected");
      return Response.redirect(returnUrl, 303);
    }
    try {
      await enableObsidian(supabase, consumed.owner_id);
      returnUrl.searchParams.set("integration", "obsidian-connected");
      return Response.redirect(returnUrl, 303);
    } catch (err) {
      console.error("web obsidian enable failed:", err);
      returnUrl.searchParams.set("integration", "obsidian-error");
      return Response.redirect(returnUrl, 303);
    }
  }

  if (consumed.chat_id !== null) {
    try {
      await sendMessage(
        consumed.chat_id,
        "✅ יומן Google מחובר! מהיום אסנכרן ארועים ואוכל לבנות סיכום יומי. נסו /today או /summary.",
      );
    } catch (_) { /* ignore */ }
  }

  return htmlResponse(
    "מחובר ✅",
    "החיבור ל-Google הצליח. אפשר לחזור לטלגרם — כבר שלחתי לך הודעה.",
  );
});
