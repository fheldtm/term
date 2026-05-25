import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
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
import { Button, IconButton, Input } from "@/components/ui";
import { listFiles } from "@/lib/api";
import { formatBytes, formatDateTime, parentPath, pathBasename } from "@/lib/format";
import type { RemoteFile, SessionInfo } from "@/types/domain";

type FileExplorerProps = {
  session: SessionInfo | null;
  onInsertPath: (path: string) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  target: RemoteFile | null;
};

export function FileExplorer({ session, onInsertPath }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) {
      setCurrentPath("");
      setFiles([]);
      setSelectedPath("");
      setContextMenu(null);
      return;
    }
    void loadPath(session.cwd);
  }, [session]);

  useEffect(() => {
    if (!contextMenu) return;

    function closeContextMenu() {
      setContextMenu(null);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeContextMenu();
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath),
    [files, selectedPath]
  );
  const homePath = session?.homeDir ?? "";

  async function loadPath(path: string) {
    if (!session) return;
    const nextPath = path.trim() || session.homeDir;
    setIsLoading(true);
    setError("");
    setContextMenu(null);
    try {
      const response = await listFiles(session.id, nextPath);
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

  function selectEntry(file: RemoteFile, clickCount: number) {
    setSelectedPath(file.path);
    if (clickCount >= 2 && file.type === "directory") {
      void loadPath(file.path);
    }
  }

  function openContextMenu(event: MouseEvent, target: RemoteFile | null = null) {
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();

    if (target) setSelectedPath(target.path);

    const menuWidth = 278;
    const menuHeight = 198;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      x: Math.max(8, x),
      y: Math.max(8, y),
      target
    });
  }

  function runContextAction(action: () => void) {
    setContextMenu(null);
    action();
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
        <IconButton
          variant="toolbar"
          onClick={() => currentPath && void loadPath(currentPath)}
          disabled={!session || isLoading}
          aria-label="새로고침"
          title="새로고침"
        >
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </IconButton>
      </div>

      <div className="path-row">
        <IconButton
          variant="toolbar"
          onClick={() => session && void loadPath(session.homeDir)}
          disabled={!session}
          aria-label="홈 디렉터리"
          title="홈 디렉터리"
        >
          <Home size={15} />
        </IconButton>
        <IconButton
          variant="toolbar"
          onClick={() => session && void loadPath(parentPath(currentPath, session.homeDir))}
          disabled={!session || currentPath === session.homeDir}
          aria-label="상위 폴더"
          title="상위 폴더"
        >
          <ChevronRight size={15} className="up-icon" />
        </IconButton>
        <Input
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

      <div className="file-table" role="tree" onContextMenu={(event) => openContextMenu(event)}>
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
              onClick={(event) => selectEntry(file, event.detail)}
              onContextMenu={(event) => openContextMenu(event, file)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && file.type === "directory") {
                  event.preventDefault();
                  openEntry(file);
                }
              }}
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
        <Button
          variant="secondary"
          disabled={!selectedFile}
          onClick={() => selectedFile && onInsertPath(selectedFile.path)}
        >
          <UploadCloud size={15} />
          경로 삽입
        </Button>
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Button
            variant="menuItem"
            role="menuitem"
            disabled={contextMenu.target?.type !== "directory"}
            onClick={() => {
              const target = contextMenu.target;
              if (target) runContextAction(() => openEntry(target));
            }}
          >
            <FolderOpen size={14} />
            열기
          </Button>
          <Button
            variant="menuItem"
            role="menuitem"
            disabled={!contextMenu.target}
            onClick={() => {
              const target = contextMenu.target;
              if (target) runContextAction(() => onInsertPath(target.path));
            }}
          >
            <UploadCloud size={14} />
            경로 삽입
          </Button>
          <Button variant="menuItem" role="menuitem" onClick={() => runContextAction(() => void loadPath(currentPath))}>
            <RefreshCw size={14} />
            새로고침
          </Button>
          <Button variant="menuItem" role="menuitem" onClick={() => runContextAction(() => void loadPath(homePath))}>
            <Home size={14} />
            홈으로
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
