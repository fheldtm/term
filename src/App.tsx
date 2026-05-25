import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal as TerminalIcon
} from "lucide-react";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { FileExplorer } from "@/components/FileExplorer";
import { TerminalPanel, type TerminalHandle } from "@/components/TerminalPanel";
import { createSession, disconnectSession } from "@/lib/api";
import type { ConnectPayload, SessionInfo } from "@/types/domain";

type ToastState = {
  tone: "ok" | "error" | "info";
  message: string;
};

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [terminalState, setTerminalState] = useState<"idle" | "connecting" | "connected" | "closed" | "error">("idle");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleTerminalState = useCallback(
    (state: "idle" | "connecting" | "connected" | "closed" | "error") => {
      setTerminalState(state);
    },
    []
  );

  async function connect(payload: ConnectPayload) {
    setIsConnecting(true);
    try {
      if (session) await disconnectSession(session.id);
      const nextSession = await createSession(payload);
      setSession(nextSession);
      setToast({ tone: "ok", message: `${nextSession.label} 연결됨` });
    } catch (error) {
      setToast({ tone: "error", message: error instanceof Error ? error.message : String(error) });
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

  const statusIcon =
    terminalState === "connected" ? (
      <CheckCircle2 size={15} />
    ) : terminalState === "error" ? (
      <AlertCircle size={15} />
    ) : (
      <Activity size={15} />
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">
            <TerminalIcon size={18} />
          </div>
          <div>
            <h1>SSH Terminal Composer</h1>
            <span>xterm · SFTP uploads · token composer</span>
          </div>
        </div>
        <div className={`terminal-state is-${terminalState}`}>
          {statusIcon}
          <span>{terminalState}</span>
        </div>
      </header>

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

      <main className={`workspace ${isExplorerOpen ? "" : "is-explorer-closed"}`}>
        <FileExplorer session={session} onInsertPath={insertPath} />
        <section className="terminal-workbench">
          <button
            className="explorer-toggle"
            type="button"
            onClick={() => setIsExplorerOpen((value) => !value)}
            aria-label="파일 탐색기 토글"
            title="파일 탐색기 토글"
          >
            {isExplorerOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <TerminalPanel ref={terminalRef} session={session} onConnectionStateChange={handleTerminalState} />
          <Composer ref={composerRef} session={session} onSubmitPayload={submitPayload} />
        </section>
      </main>
    </div>
  );
}
