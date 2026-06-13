import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WebPushSubscriptionRow {
  id: string;
  owner_id: string;
  endpoint: string;
  expiration_time: number | null;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export function notificationBody(body: string, title: string): string {
  const plain = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const withoutRepeatedTitle = plain === title ? "הגיע הזמן." : plain;
  return withoutRepeatedTitle.length > 240
    ? `${withoutRepeatedTitle.slice(0, 237)}...`
    : withoutRepeatedTitle;
}

export function getVapidPublicKey(): string | null {
  return Deno.env.get("VAPID_PUBLIC_KEY")?.trim() || null;
}

function configureWebPush(): boolean {
  const subject = Deno.env.get("VAPID_SUBJECT")?.trim() ||
    "mailto:admin@tachles.app";
  const publicKey = getVapidPublicKey();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function listWebPushSubscriptions(
  supabase: SupabaseClient,
  ownerIds: string[],
): Promise<WebPushSubscriptionRow[]> {
  if (ownerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("web_push_subscriptions")
    .select("id, owner_id, endpoint, expiration_time, p256dh, auth")
    .in("owner_id", ownerIds)
    .returns<WebPushSubscriptionRow[]>();
  if (error) {
    throw new Error(`web push subscription list failed: ${error.message}`);
  }
  return data ?? [];
}

export async function sendWebPush(
  supabase: SupabaseClient,
  subscriptions: WebPushSubscriptionRow[],
  payload: WebPushPayload,
): Promise<{ sent: number; failed: number }> {
  if (subscriptions.length === 0 || !configureWebPush()) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          expirationTime: row.expiration_time,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60, urgency: "high" },
      );
      sent++;
    } catch (error) {
      failed++;
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("web_push_subscriptions").delete().eq("id", row.id);
      } else {
        console.error(`web push delivery failed for ${row.id}:`, error);
      }
    }
  }
  return { sent, failed };
}
