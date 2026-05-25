import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  Home,
  Loader2,
  RefreshCw,
  TerminalSquare,
  UploadCloud
} from "lucide-react";
import { listFiles } from "@/lib/api";
import { formatBytes, formatDateTime, parentPath, pathBasename } from "@/lib/format";
import type { RemoteFile, SessionInfo } from "@/types/domain";

type FileExplorerProps = {
  session: SessionInfo | null;
  onInsertPath: (path: string) => void;
};

export function FileExplorer({ session, onInsertPath }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      setCurrentPath("");
      setFiles([]);
      setSelectedPath("");
      return;
    }
    void loadPath(session.cwd);
  }, [session]);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath),
    [files, selectedPath]
  );

  async function loadPath(path: string) {
    if (!session) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await listFiles(session.id, path);
      setCurrentPath(response.path);
      setFiles(response.files);
      setSelectedPath("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  function openEntry(file: RemoteFile) {
    setSelectedPath(file.path);
    if (file.type === "directory") {
      void loadPath(file.path);
    }
  }

  function renderIcon(file: RemoteFile) {
    if (file.type === "directory") return <Folder size={15} />;
    if (/\.(ts|tsx|js|jsx|json|md|css|html|log)$/i.test(file.name)) return <FileCode2 size={15} />;
    return <File size={15} />;
  }

  return (
    <aside className="file-explorer" aria-label="원격 파일 탐색기">
      <div className="panel-title">
        <div>
          <strong>EXPLORER</strong>
          <span>{session ? session.host : "세션 없음"}</span>
        </div>
        <button
          className="icon-action"
          type="button"
          onClick={() => currentPath && void loadPath(currentPath)}
          disabled={!session || isLoading}
          aria-label="새로고침"
          title="새로고침"
        >
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      <div className="path-row">
        <button
          className="icon-action"
          type="button"
          onClick={() => session && void loadPath(session.homeDir)}
          disabled={!session}
          aria-label="홈 디렉터리"
          title="홈 디렉터리"
        >
          <Home size={15} />
        </button>
        <button
          className="icon-action"
          type="button"
          onClick={() => session && void loadPath(parentPath(currentPath, session.homeDir))}
          disabled={!session || currentPath === session.homeDir}
          aria-label="상위 폴더"
          title="상위 폴더"
        >
          <ChevronRight size={15} className="up-icon" />
        </button>
        <input
          value={currentPath}
          onChange={(event) => setCurrentPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadPath(currentPath);
          }}
          disabled={!session}
          aria-label="현재 원격 경로"
        />
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div className="file-table" role="tree">
        {!session ? (
          <div className="empty-state">
            <TerminalSquare size={22} />
            <strong>SSH 세션을 연결하세요</strong>
            <span>연결 후 원격 파일 시스템을 탐색할 수 있습니다.</span>
          </div>
        ) : files.length ? (
          files.map((file) => (
            <button
              className={`file-row ${selectedPath === file.path ? "is-selected" : ""}`}
              type="button"
              key={file.path}
              onClick={() => setSelectedPath(file.path)}
              onDoubleClick={() => openEntry(file)}
            >
              <span className="file-row__icon">
                {file.type === "directory" && selectedPath === file.path ? <FolderOpen size={15} /> : renderIcon(file)}
              </span>
              <span className="file-row__name">{file.name}</span>
              <span className="file-row__size">{file.type === "directory" ? "-" : formatBytes(file.size)}</span>
              <span className="file-row__date">{formatDateTime(file.modifiedAt)}</span>
            </button>
          ))
        ) : (
          <div className="empty-state">
            <Folder size={22} />
            <strong>폴더가 비어 있습니다</strong>
            <span>경로를 바꾸거나 새로고침하세요.</span>
          </div>
        )}
      </div>

      <div className="explorer-footer">
        <div>
          <span>선택</span>
          <strong>{selectedFile ? pathBasename(selectedFile.path) : "-"}</strong>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={!selectedFile}
          onClick={() => selectedFile && onInsertPath(selectedFile.path)}
        >
          <UploadCloud size={15} />
          경로 삽입
        </button>
      </div>
    </aside>
  );
}
