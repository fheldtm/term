export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDateTime(timestamp: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function safeFileName(name: string) {
  const cleaned = name.replace(/[\u0000-\u001f<>:"\\|?*]/g, "_").trim();
  return cleaned || "file";
}

export function pathBasename(remotePath: string) {
  const parts = remotePath.split("/").filter(Boolean);
  return parts.at(-1) || remotePath;
}

export function parentPath(remotePath: string, homeDir: string) {
  if (remotePath === homeDir) return homeDir;
  const parent = remotePath.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
  return parent.startsWith(homeDir) ? parent : homeDir;
}
