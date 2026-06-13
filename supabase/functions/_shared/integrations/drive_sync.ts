import type { StoredToken } from "./oauth.ts";

// Low-level Google Drive write helpers used by the Obsidian export. All
// operations stay within the drive.file scope (only files our app created).

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function authHeaders(token: StoredToken): Record<string, string> {
  return { authorization: `Bearer ${token.access_token}` };
}

async function jsonOrThrow(res: Response, label: string): Promise<unknown> {
  if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text()}`);
  return await res.json();
}

interface DriveFileRef {
  id: string;
  name: string;
}

// Looks up a folder named `name` inside `parentId` (or root if undefined).
// Returns null if none. Search is scoped to files our app created (drive.file).
export async function findFolder(
  token: StoredToken,
  name: string,
  parentId?: string,
): Promise<DriveFileRef | null> {
  const safe = name.replace(/['\\]/g, " ");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const q =
    `mimeType = 'application/vnd.google-apps.folder' and name = '${safe}' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: "1",
  });
  const data = await jsonOrThrow(
    await fetch(`${DRIVE_API}/files?${params}`, { headers: authHeaders(token) }),
    "findFolder",
  ) as { files?: DriveFileRef[] };
  return data.files?.[0] ?? null;
}

export async function createFolder(
  token: StoredToken,
  name: string,
  parentId?: string,
): Promise<DriveFileRef> {
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: parentId ? [parentId] : undefined,
  };
  const data = await jsonOrThrow(
    await fetch(`${DRIVE_API}/files?fields=id,name`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "createFolder",
  ) as DriveFileRef;
  return data;
}

export async function ensureFolder(
  token: StoredToken,
  name: string,
  parentId?: string,
): Promise<DriveFileRef> {
  return (await findFolder(token, name, parentId)) ?? await createFolder(token, name, parentId);
}

// Multipart upload: metadata + body in a single request.
function multipartBody(metadata: Record<string, unknown>, body: string, mimeType: string): {
  body: string;
  boundary: string;
} {
  const boundary = `tachles-${crypto.randomUUID()}`;
  const payload =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${
      JSON.stringify(metadata)
    }\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${body}\r\n--${boundary}--`;
  return { body: payload, boundary };
}

export async function uploadFile(
  token: StoredToken,
  parentFolderId: string,
  name: string,
  content: string,
  mimeType = "text/markdown",
): Promise<string> {
  const { body, boundary } = multipartBody(
    { name, parents: [parentFolderId], mimeType },
    content,
    mimeType,
  );
  const data = await jsonOrThrow(
    await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }),
    "uploadFile",
  ) as { id: string };
  return data.id;
}

// Replace a file's content (and optionally rename). Used when a bubble/task
// is edited and we want to keep the same Drive file id.
export async function updateFile(
  token: StoredToken,
  fileId: string,
  content: string,
  newName?: string,
  mimeType = "text/markdown",
): Promise<void> {
  // 1. Update bytes via media upload.
  await jsonOrThrow(
    await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "content-type": mimeType },
      body: content,
    }),
    "updateFile content",
  );
  // 2. Optionally rename (metadata-only patch).
  if (newName) {
    await jsonOrThrow(
      await fetch(`${DRIVE_API}/files/${fileId}`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ name: newName }),
      }),
      "updateFile rename",
    );
  }
}

export async function deleteFile(token: StoredToken, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  // 404 means already gone — fine.
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteFile ${res.status}: ${await res.text()}`);
  }
}
