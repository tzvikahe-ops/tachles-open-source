import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BellRing, RefreshCw } from "lucide-react";
import { apiFetch } from "../../lib/api";

type PushStatus = "loading" | "unsupported" | "denied" | "disabled" | "enabled";
type PushFailure = { stage: string; name: string; message: string } | null;

type PushConfig = {
  available: boolean;
  public_key: string | null;
  subscriptions: number;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function supportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true;
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sameApplicationServerKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = new Uint8Array(urlBase64ToUint8Array(publicKey));
  const actual = new Uint8Array(current);
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    updateViaCache: "none",
  });
  await registration.update().catch(() => undefined);
  if (registration.active) return registration;

  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("service_worker_timeout")), 10000)
    ),
  ]);
}

async function resetPushWorker(): Promise<ServiceWorkerRegistration> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    const subscription = await registration.pushManager.getSubscription().catch(() => null);
    await subscription?.unsubscribe().catch(() => false);
    await registration.unregister();
  }
  return await readyServiceWorker();
}

async function saveSubscription(session: Session, subscription: PushSubscription) {
  const json = subscription.toJSON();
  await apiFetch(session, "/push", {
    method: "POST",
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      expiration_time: subscription.expirationTime,
      keys: json.keys,
    }),
  });
}

export function PushNotificationCard({
  session,
  demoMode,
  notify,
}: {
  session: Session | null;
  demoMode: boolean;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PushFailure>(null);

  const refresh = useCallback(async () => {
    if (demoMode || !session) {
      setStatus(supportsPush() ? "disabled" : "unsupported");
      return;
    }
    if (!supportsPush()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const nextConfig = await apiFetch<PushConfig>(session, "/push");
      setConfig(nextConfig);
      const registration = await readyServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (
        subscription && nextConfig.public_key &&
        !sameApplicationServerKey(subscription, nextConfig.public_key)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (subscription) {
        await saveSubscription(session, subscription);
        setStatus("enabled");
      } else {
        setStatus("disabled");
      }
    } catch {
      setStatus("disabled");
    }
  }, [demoMode, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    if (demoMode || !session) {
      notify("בחשבון מחובר אפשר להפעיל התראות Push במכשיר.");
      return;
    }
    if (!supportsPush()) {
      setStatus("unsupported");
      return;
    }
    if (isIos() && !isStandalone()) {
      notify("ב־iPhone צריך להוסיף את תכלס למסך הבית ולפתוח אותה משם.");
      return;
    }
    setBusy(true);
    setFailure(null);
    let stage = "permission";
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled");
        notify("לא ניתנה הרשאה להתראות.");
        return;
      }
      const nextConfig = config ?? await apiFetch<PushConfig>(session, "/push");
      setConfig(nextConfig);
      if (!nextConfig.available || !nextConfig.public_key) {
        notify("שירות ההתראות עדיין לא הוגדר בשרת.");
        return;
      }
      stage = "service_worker";
      const registration = await readyServiceWorker();
      stage = "subscription";
      let existing = await registration.pushManager.getSubscription();
      if (existing && !sameApplicationServerKey(existing, nextConfig.public_key)) {
        await existing.unsubscribe();
        existing = null;
      }
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(nextConfig.public_key),
      });
      stage = "save";
      await saveSubscription(session, subscription);
      setStatus("enabled");
      setFailure(null);
      notify("ההתראות הופעלו במכשיר הזה.");
    } catch (error) {
      console.error("push enable failed", { stage, error });
      const name = error instanceof DOMException ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ stage, name: name || "Error", message });
      if (name === "NotAllowedError") {
        setStatus("denied");
        notify("ההתראות חסומות במכשיר. יש לאפשר אותן בהגדרות האתר.");
      } else if (stage === "service_worker") {
        notify("רכיב ההתראות לא נטען. רעננו את האפליקציה ונסו שוב.");
      } else if (stage === "subscription" && name === "AbortError") {
        notify("שירות ה־Push של המכשיר לא זמין. נסו לאחר הפעלה מחדש של האפליקציה.");
      } else if (stage === "save") {
        notify("המכשיר נרשם, אבל השמירה בשרת נכשלה. נסו שוב.");
      } else {
        notify("לא הצלחתי להפעיל התראות. נסו לרענן את האפליקציה.");
      }
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    if (!session || !supportsPush()) return;
    setBusy(true);
    setFailure(null);
    try {
      await resetPushWorker();
      setStatus("disabled");
      notify("רכיב ההתראות אופס. לחצו עכשיו על הפעלת התראות.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ stage: "reset", name: "Error", message });
      notify("לא הצלחתי לאפס את רכיב ההתראות.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!session || !supportsPush()) return;
    setBusy(true);
    try {
      const registration = await readyServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await apiFetch(session, "/push", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("disabled");
      notify("ההתראות כובו במכשיר הזה.");
    } catch {
      notify("לא הצלחתי לכבות את ההתראות כרגע.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await apiFetch(session, "/push/test", { method: "POST" });
      notify("שלחתי התראת בדיקה.");
    } catch {
      notify("התראת הבדיקה לא נשלחה.");
    } finally {
      setBusy(false);
    }
  };

  const enabled = status === "enabled";
  const statusLabel = enabled
    ? "פעיל"
    : status === "denied"
    ? "חסום במכשיר"
    : status === "unsupported"
    ? "לא נתמך"
    : "כבוי";

  return (
    <article className="integration-card push-card">
      <div className="integration-heading">
        <span className="integration-icon">
          <BellRing size={23} />
        </span>
        <div>
          <span className="section-kicker">התראות Push</span>
          <h2>תזכורות גם כשהאפליקציה סגורה</h2>
        </div>
        <span className={`status-pill ${enabled ? "is-on" : ""}`}>{statusLabel}</span>
      </div>
      <p>
        כשיגיע הזמן, תכלס תציג התראה במכשיר הזה. אפשר להפעיל בנפרד בכל טלפון או מחשב.
      </p>
      {status === "denied"
        ? (
          <small className="integration-note">
            ההתראות חסומות בהגדרות הדפדפן. צריך לאפשר אותן עבור תכלס ואז לחזור לכאן.
          </small>
        )
        : status === "unsupported"
        ? (
          <small className="integration-note">
            במכשירי iPhone יש להתקין את תכלס למסך הבית ולפתוח אותה משם.
          </small>
        )
        : null}
      {failure
        ? (
          <div className="push-diagnostic" role="alert">
            <strong>פרטי התקלה</strong>
            <span dir="ltr">
              {failure.stage} · {failure.name}
              {failure.message ? ` · ${failure.message}` : ""}
            </span>
          </div>
        )
        : null}
      <div className="integration-actions push-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => void (enabled ? disable() : enable())}
          disabled={busy || status === "loading" || status === "unsupported"}
        >
          {busy ? <RefreshCw size={18} className="spin" /> : <BellRing size={18} />}
          {enabled ? "כיבוי במכשיר הזה" : "הפעלת התראות"}
        </button>
        {enabled
          ? (
            <button className="secondary-button" type="button" onClick={() => void test()} disabled={busy}>
              בדיקת התראה
            </button>
          )
          : null}
        {failure
          ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void repair()}
              disabled={busy}
            >
              איפוס ותיקון
            </button>
          )
          : null}
      </div>
    </article>
  );
}
