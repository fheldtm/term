import type { ConnectPayload, RemoteFile, SessionInfo, UploadedFile } from "@/types/domain";

type FileListResponse = {
  path: string;
  files: RemoteFile[];
};

type UploadResponse = {
  uploadDir: string;
  files: UploadedFile[];
};

type TauriUploadInput = {
  token: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

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
  if (isTauriRuntime()) {
    return tauriInvoke<SessionInfo>("create_session", { payload });
  }
  return request<SessionInfo>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function disconnectSession(sessionId: string) {
  if (isTauriRuntime()) {
    return tauriInvoke<void>("disconnect_session", { sessionId }).then(() => ({ ok: true }));
  }
  return request<{ ok: boolean }>(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
}

export function listFiles(sessionId: string, remotePath: string) {
  if (isTauriRuntime()) {
    return tauriInvoke<FileListResponse>("list_files", { sessionId, path: remotePath });
  }
  return request<FileListResponse>(
    `/api/sessions/${sessionId}/files?path=${encodeURIComponent(remotePath)}`
  );
}

export function uploadFiles(
  sessionId: string,
  files: File[],
  metadata: Array<{ token: string; originalName: string; mimeType: string; sizeBytes: number }>
) {
  if (isTauriRuntime()) {
    return Promise.all(
      files.map(async (file, index): Promise<TauriUploadInput> => {
        const meta = metadata[index];
        return {
          token: meta.token,
          originalName: meta.originalName,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          dataBase64: await fileToBase64(file)
        };
      })
    ).then((encodedFiles) =>
      tauriInvoke<UploadResponse>("upload_files", {
        sessionId,
        files: encodedFiles
      })
    );
  }

  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));
  form.append("metadata", JSON.stringify(metadata));

  return request<UploadResponse>(`/api/sessions/${sessionId}/upload`, {
    method: "POST",
    body: form
  });
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("failed to read file")));
    reader.readAsDataURL(file);
  });
}
