export type SessionMode = "ssh";

export type SessionInfo = {
  id: string;
  mode: SessionMode;
  label: string;
  host: string;
  username: string;
  homeDir: string;
  cwd: string;
  uploadRoot: string;
  createdAt: number;
};

export type RemoteFile = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

export type AttachmentKind = "image" | "file";

export type Attachment = {
  id: string;
  token: string;
  kind: AttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  file: File;
  previewUrl?: string;
  remotePath?: string;
  uploadStatus: "pending" | "uploading" | "uploaded" | "failed";
  errorMessage?: string;
};

export type ConnectPayload = {
  mode?: SessionMode;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type UploadedFile = {
  token: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  remotePath: string;
  status: "uploaded";
};
