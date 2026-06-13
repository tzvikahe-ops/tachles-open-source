export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function webEmailAllowed(email: string | null | undefined): boolean {
  const allowed = parseAllowedEmails(Deno.env.get("WEB_ALLOWED_EMAILS"));
  return allowed.size === 0 || Boolean(email && allowed.has(email.trim().toLowerCase()));
}
