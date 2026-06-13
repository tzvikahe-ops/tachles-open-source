import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, Inbox, Link2, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { App } from "./App";
import { apiFetch, ApiError } from "./lib/api";
import { authConfigured, supabase } from "./lib/supabase";

type AuthState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; session: Session };

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState>(
    authConfigured ? { kind: "loading" } : { kind: "anonymous" },
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuth(data.session
        ? { kind: "authenticated", session: data.session }
        : { kind: "anonymous" });
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session ? { kind: "authenticated", session } : { kind: "anonymous" });
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const params = new URLSearchParams(window.location.search);
  const isShareTarget = window.location.pathname === "/share";

  if (!authConfigured) {
    return isShareTarget
      ? <SharedCaptureScreen session={null} params={params} />
      : <App demoMode />;
  }
  if (auth.kind === "loading") return <LoadingScreen />;
  if (auth.kind === "anonymous") return <AuthScreen />;

  return <AuthorizedApp session={auth.session} params={params} isShareTarget={isShareTarget} />;
}

function AuthorizedApp({
  session,
  params,
  isShareTarget,
}: {
  session: Session;
  params: URLSearchParams;
  isShareTarget: boolean;
}) {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied" | "error">("checking");

  useEffect(() => {
    let active = true;
    apiFetch(session, "/me")
      .then(() => {
        if (active) setAccess("allowed");
      })
      .catch((error) => {
        if (!active) return;
        setAccess(error instanceof ApiError && error.code === "account_not_allowed"
          ? "denied"
          : "error");
      });
    return () => {
      active = false;
    };
  }, [session]);

  if (access === "checking") return <LoadingScreen />;
  if (access === "denied") return <PrivateDeploymentScreen />;
  if (access === "error") {
    return (
      <main className="centered-screen">
        <p>לא הצלחתי לבדוק את הרשאת החשבון. נסו לרענן את האפליקציה.</p>
      </main>
    );
  }
  if (isShareTarget) return <SharedCaptureScreen session={session} params={params} />;
  const linkCode = params.get("code");
  if (window.location.pathname === "/link" || linkCode) {
    return <LinkAccountScreen session={session} initialCode={linkCode ?? ""} />;
  }
  return <App demoMode={false} session={session} />;
}

function PrivateDeploymentScreen() {
  const signOut = async () => {
    await supabase?.auth.signOut();
    window.location.assign("/");
  };
  return (
    <main className="auth-screen private-deployment">
      <div className="link-icon"><LockKeyhole size={28} /></div>
      <div className="auth-copy">
        <div className="auth-brand">תכלס</div>
        <h1>הפריסה הזו פרטית</h1>
        <p>
          זהו העותק האישי של בעל הפרויקט. אפשר להתקין עותק עצמאי מהקוד הפתוח ב־GitHub.
        </p>
      </div>
      <div className="auth-actions">
        <a
          className="google-button"
          href="https://github.com/tzvikahe-ops/tachles-open-source"
          target="_blank"
          rel="noreferrer"
        >
          פתיחת הפרויקט ב־GitHub
        </a>
        <button className="text-button" type="button" onClick={() => void signOut()}>
          יציאה מהחשבון
        </button>
      </div>
    </main>
  );
}

function SharedCaptureScreen({
  session,
  params,
}: {
  session: Session | null;
  params: URLSearchParams;
}) {
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [text, setText] = useState(params.get("text") ?? "");
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() && !text.trim() && !url.trim()) {
      setStatus("לא הגיע תוכן שאפשר לשמור.");
      return;
    }
    setBusy(true);
    try {
      if (session) {
        await apiFetch(session, "/captures", {
          method: "POST",
          body: JSON.stringify({ source: "web_share", title, text, url }),
        });
      } else {
        const captures = JSON.parse(
          window.localStorage.getItem("tachles-demo-captures") ?? "[]",
        ) as unknown[];
        captures.unshift({ title, text, url, createdAt: new Date().toISOString() });
        window.localStorage.setItem("tachles-demo-captures", JSON.stringify(captures.slice(0, 20)));
      }
      setStatus("נשמר בתיבת הקליטה.");
      window.setTimeout(() => {
        window.history.replaceState({}, "", "/");
        window.location.reload();
      }, 700);
    } catch {
      setStatus("לא הצלחתי לשמור כרגע.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="share-screen">
      <div className="link-icon"><Inbox size={28} /></div>
      <p className="date-line">נשלח לתכלס</p>
      <h1>מה לשמור מהשיתוף הזה?</h1>
      <p>הפריט ייכנס לתיבת הקליטה. אחר כך אפשר להפוך אותו למשימה, זיכרון או מקור לפרויקט.</p>
      <label>
        כותרת
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        תוכן
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} />
      </label>
      <label>
        קישור
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
          dir="ltr"
        />
      </label>
      <button className="primary-button" type="button" onClick={save} disabled={busy}>
        {busy ? "שומר..." : "שמירה בתכלס"}
      </button>
      {status ? <p className="link-status" role="status">{status}</p> : null}
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="centered-screen" aria-label="טוען">
      <LoaderCircle className="spin" size={28} />
    </main>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const googleLogin = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setStatus("לא הצלחתי לפתוח את ההתחברות. נסו שוב.");
      setBusy(false);
    }
  };

  const magicLink = async () => {
    if (!supabase || !email.trim()) {
      setStatus("צריך להזין כתובת אימייל.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    setStatus(error
      ? "לא הצלחתי לשלוח את הקישור. בדקו את הכתובת ונסו שוב."
      : "שלחתי קישור כניסה לאימייל.");
  };

  return (
    <main className="auth-screen">
      <div className="auth-notebook" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="auth-copy">
        <div className="auth-brand">תכלס</div>
        <h1>המחברת האישית שחושבת איתך</h1>
        <p>תזכורות, רשימות, משימות וזיכרונות במקום אחד שקט.</p>
      </div>

      <div className="auth-actions">
        <button className="google-button" type="button" onClick={googleLogin} disabled={busy}>
          <span className="google-mark">G</span>
          כניסה עם Google
        </button>

        <div className="auth-divider"><span>או</span></div>

        <label htmlFor="email">כניסה באמצעות אימייל</label>
        <div className="email-entry">
          <Mail size={19} strokeWidth={1.7} />
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
          <button type="button" onClick={magicLink} disabled={busy} aria-label="שליחת קישור כניסה">
            <ArrowRight size={19} />
          </button>
        </div>
        {status ? <p className="auth-status" role="status">{status}</p> : null}
      </div>
    </main>
  );
}

function LinkAccountScreen({
  session,
  initialCode,
}: {
  session: Session;
  initialCode: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkAccount = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await apiFetch(session, "/account/link", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      window.history.replaceState({}, "", "/");
      setStatus("החשבון קושר. הנתונים מהבוט מחכים לך באפליקציה.");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_has_data") {
        setStatus("יש מידע בשני החשבונות, ולכן לא איחדתי אותם אוטומטית.");
      } else if (err instanceof ApiError && err.code === "invalid_or_expired") {
        setStatus("הקוד שגוי או שפג תוקפו. אפשר להפיק קוד חדש בבוט.");
      } else {
        setStatus("לא הצלחתי לקשר את החשבון כרגע.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="link-screen">
      <div className="link-icon"><Link2 size={28} /></div>
      <p className="date-line">חיבור לטלגרם</p>
      <h1>להביא את כל מה שכבר שמרת</h1>
      <p>שלחו בבוט את הפקודה <bdi>/linkweb</bdi> והזינו כאן את הקוד החד־פעמי.</p>
      <input
        className="link-code-input"
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        inputMode="text"
        autoCapitalize="characters"
        maxLength={9}
        placeholder="ABCD-EFGH"
        aria-label="קוד קישור"
      />
      <button className="primary-button" type="button" onClick={linkAccount} disabled={busy}>
        {busy ? "מקשר..." : "קישור החשבון"}
      </button>
      {status ? <p className="link-status" role="status">{status}</p> : null}
      <button
        className="text-button link-skip"
        type="button"
        onClick={() => {
          window.history.replaceState({}, "", "/");
          window.location.reload();
        }}
      >
        להמשיך בלי קישור
      </button>
    </main>
  );
}
