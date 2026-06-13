import type { Session } from "@supabase/supabase-js";

const apiBase = import.meta.env.VITE_API_BASE?.replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!apiBase) throw new ApiError(0, "api_not_configured");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(response.status, String(body.error ?? "request_failed"), body);
  }
  return body as T;
}
