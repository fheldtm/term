import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AlertCircle,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { FileExplorer } from "@/components/FileExplorer";
import { TerminalPanel, type TerminalHandle } from "@/components/TerminalPanel";
import { IconButton } from "@/components/ui";
import { createSession, disconnectSession } from "@/lib/api";
import type { ConnectPayload, SessionInfo } from "@/types/domain";

type ToastState = {
  tone: "ok" | "error" | "info";
  message: string;
};

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(300);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function connect(payload: ConnectPayload) {
    setIsConnecting(true);
    try {
      if (session) await disconnectSession(session.id);
      const nextSession = await createSession(payload);
      setSession(nextSession);
      setToast({ tone: "ok", message: `${nextSession.label} 연결됨` });
      return nextSession;
    } catch (error) {
      setToast({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnect() {
    if (!session) return;
    setIsConnecting(true);
    try {
      await disconnectSession(session.id);
      setSession(null);
      setToast({ tone: "info", message: "세션을 종료했습니다." });
    } catch (error) {
      setToast({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsConnecting(false);
    }
  }

  function submitPayload(payload: string) {
    terminalRef.current?.send(payload);
  }

  function insertPath(path: string) {
    composerRef.current?.insertText(path);
  }

  function startExplorerResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    document.body.classList.add("is-resizing-explorer");

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(560, Math.max(220, startWidth + moveEvent.clientX - startX));
      setExplorerWidth(nextWidth);
    }

    function stopResize() {
      document.body.classList.remove("is-resizing-explorer");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  return (
    <div className="app-shell">
      <ConnectionPanel
        session={session}
        isConnecting={isConnecting}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      {toast ? (
        <div className={`toast is-${toast.tone}`} role="status">
          {toast.tone === "error" ? <AlertCircle size={16} /> : <Cpu size={16} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기">
            닫기
          </button>
        </div>
      ) : null}

      <main
        className={`workspace ${isExplorerOpen ? "" : "is-explorer-closed"}`}
        style={{
          gridTemplateColumns: isExplorerOpen
            ? `${explorerWidth}px 6px minmax(0, 1fr)`
            : "0 0 minmax(0, 1fr)"
        }}
      >
        <FileExplorer session={session} onInsertPath={insertPath} />
        <div
          className="explorer-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="파일 탐색기 너비 조절"
          onPointerDown={startExplorerResize}
        />
        <section className="terminal-workbench">
          <IconButton
            variant="explorerToggle"
            onClick={() => setIsExplorerOpen((value) => !value)}
            aria-label="파일 탐색기 토글"
            title="파일 탐색기 토글"
          >
            {isExplorerOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </IconButton>
          <TerminalPanel ref={terminalRef} session={session} />
          <Composer ref={composerRef} session={session} onSubmitPayload={submitPayload} />
        </section>
      </main>
    </div>
  );
}
