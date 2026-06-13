export function requireHeaderSecret(
  expected: string | undefined,
  provided: string | null,
): Response | null {
  if (!expected) {
    return new Response("server misconfigured", { status: 500 });
  }
  if (provided !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}
