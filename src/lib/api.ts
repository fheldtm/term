import type { ConnectPayload, RemoteFile, SessionInfo, UploadedFile } from "@/types/domain";

type FileListResponse = {
  path: string;
  files: RemoteFile[];
};

type UploadResponse = {
  uploadDir: string;
  files: UploadedFile[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message;
  } catch {
    return response.statusText;
  }
}

export function createSession(payload: ConnectPayload) {
  return request<SessionInfo>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function disconnectSession(sessionId: string) {
  return request<{ ok: boolean }>(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
}

export function listFiles(sessionId: string, remotePath: string) {
  return request<FileListResponse>(
    `/api/sessions/${sessionId}/files?path=${encodeURIComponent(remotePath)}`
  );
}

export function uploadFiles(
  sessionId: string,
  files: File[],
  metadata: Array<{ token: string; originalName: string; mimeType: string; sizeBytes: number }>
) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.append("metadata", JSON.stringify(metadata));

  return request<UploadResponse>(`/api/sessions/${sessionId}/upload`, {
    method: "POST",
    body: form
  });
}
