import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { isTauriRuntime } from "@/lib/api";
import type { SessionInfo } from "@/types/domain";

export type TerminalHandle = {
  send: (data: string) => void;
  focus: () => void;
};

type TerminalPanelProps = {
  session: SessionInfo | null;
  onConnectionStateChange?: (state: "idle" | "connecting" | "connected" | "closed" | "error") => void;
};

export const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(
  ({ session, onConnectionStateChange }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const tauriSessionRef = useRef<string | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const [status, setStatus] = useState("세션 대기 중");

    useImperativeHandle(ref, () => ({
      send(data: string) {
        if (isTauriRuntime()) {
          const sessionId = tauriSessionRef.current;
          if (!sessionId) {
            terminalRef.current?.writeln("\r\n[terminal] session is not connected");
            return;
          }
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("terminal_input", { sessionId, data })
          );
          terminalRef.current?.focus();
          return;
        }

        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
          terminalRef.current?.focus();
        } else {
          terminalRef.current?.writeln("\r\n[terminal] socket is not connected");
        }
      },
      focus() {
        terminalRef.current?.focus();
      }
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"D2Coding", monospace',
        fontSize: 13,
        fontWeight: 400,
        fontWeightBold: 700,
        lineHeight: 1.18,
        letterSpacing: 0,
        scrollback: 6000,
        theme: {
          background: "#07110c",
          foreground: "#d8e2d5",
          cursor: "#f4f6ee",
          black: "#06100b",
          red: "#e05a46",
          green: "#58d57b",
          yellow: "#d8ad4d",
          blue: "#76b9ff",
          magenta: "#bd8aff",
          cyan: "#66d5cc",
          white: "#edf4ea",
          brightBlack: "#526255",
          brightRed: "#ff856e",
          brightGreen: "#78f099",
          brightYellow: "#f4ca68",
          brightBlue: "#9ed0ff",
          brightMagenta: "#d8b5ff",
          brightCyan: "#8be8df",
          brightWhite: "#ffffff"
        }
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(container);
      fit.fit();
      terminalRef.current = terminal;
      fitRef.current = fit;

      const resizeObserver = new ResizeObserver(() => {
        fit.fit();
        sendResize();
      });
      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
        socketRef.current?.close();
        terminal.dispose();
        terminalRef.current = null;
        fitRef.current = null;
        socketRef.current = null;
      };
    }, []);

    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal) return;

      socketRef.current?.close();
      socketRef.current = null;
      tauriSessionRef.current = null;
      terminal.reset();

      if (!session) {
        setStatus("세션 대기 중");
        onConnectionStateChange?.("idle");
        terminal.writeln("SSH 세션을 연결하세요.");
        return;
      }

      setStatus("터미널 연결 중");
      onConnectionStateChange?.("connecting");

      if (isTauriRuntime()) {
        let unlistenOutput: (() => void) | undefined;
        let unlistenError: (() => void) | undefined;
        let disposed = false;
        tauriSessionRef.current = session.id;

        void Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event")
        ])
          .then(async ([{ invoke }, { listen }]) => {
            unlistenOutput = await listen<{ sessionId: string; data: string }>(
              "terminal-output",
              (event) => {
                if (event.payload.sessionId === session.id) {
                  terminal.write(event.payload.data);
                }
              }
            );
            unlistenError = await listen<{ sessionId: string; message: string }>(
              "terminal-error",
              (event) => {
                if (event.payload.sessionId === session.id) {
                  terminal.writeln(`\r\n[terminal] ${event.payload.message}`);
                  setStatus("터미널 오류");
                  onConnectionStateChange?.("error");
                }
              }
            );

            if (disposed) return;
            await invoke("terminal_open", { sessionId: session.id });
            setStatus("터미널 연결됨");
            onConnectionStateChange?.("connected");
            setTimeout(sendResize, 20);
          })
          .catch((error) => {
            terminal.writeln(`\r\n[terminal] ${error instanceof Error ? error.message : String(error)}`);
            setStatus("터미널 오류");
            onConnectionStateChange?.("error");
          });

        const dataSubscription = terminal.onData((data) => {
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("terminal_input", { sessionId: session.id, data })
          );
        });

        return () => {
          disposed = true;
          dataSubscription.dispose();
          unlistenOutput?.();
          unlistenError?.();
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("terminal_input", { sessionId: session.id, data: "\u0004" }).catch(() => undefined)
          );
        };
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal/${session.id}`);
      socketRef.current = socket;

      const dataSubscription = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });

      socket.addEventListener("open", () => {
        setStatus("터미널 연결됨");
        onConnectionStateChange?.("connected");
        setTimeout(sendResize, 20);
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string };
          if (message.type === "output" && message.data) {
            terminal.write(message.data);
          }
          if (message.type === "error") {
            terminal.writeln(`\r\n[terminal] ${message.message || "unknown error"}`);
            setStatus("터미널 오류");
            onConnectionStateChange?.("error");
          }
        } catch {
          terminal.write(String(event.data));
        }
      });

      socket.addEventListener("close", () => {
        setStatus("터미널 종료됨");
        onConnectionStateChange?.("closed");
      });

      socket.addEventListener("error", () => {
        setStatus("터미널 오류");
        onConnectionStateChange?.("error");
      });

      return () => {
        dataSubscription.dispose();
        socket.close();
      };
    }, [onConnectionStateChange, session]);

    function sendResize() {
      const socket = socketRef.current;
      const terminal = terminalRef.current;
      if (!terminal) return;
      if (isTauriRuntime()) {
        const sessionId = tauriSessionRef.current;
        if (!sessionId) return;
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("terminal_resize", { sessionId, cols: terminal.cols, rows: terminal.rows })
        );
        return;
      }
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    }

    return (
      <section className="terminal-panel" aria-label="SSH terminal">
        <div className="terminal-panel__bar">
          <span>{session ? session.label : "No session"}</span>
          <span>{status}</span>
        </div>
        <div ref={containerRef} className="terminal-panel__surface" />
      </section>
    );
  }
);

TerminalPanel.displayName = "TerminalPanel";
