import { useState } from "react";
import { KeyRound, Loader2, Plug, Server, Unplug } from "lucide-react";
import type { ConnectPayload, SessionInfo } from "@/types/domain";

type ConnectionPanelProps = {
  session: SessionInfo | null;
  isConnecting: boolean;
  onConnect: (payload: ConnectPayload) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

export function ConnectionPanel({
  session,
  isConnecting,
  onConnect,
  onDisconnect
}: ConnectionPanelProps) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [isExpanded, setIsExpanded] = useState(false);

  async function submit() {
    await onConnect({
      mode: "ssh",
      host,
      port,
      username,
      password: authMode === "password" ? password : undefined,
      privateKey: authMode === "key" ? privateKey : undefined
    });
  }

  return (
    <section className="connection-panel" aria-label="SSH connection">
      <div className="connection-panel__main">
        <div className="connection-status">
          <Server size={17} />
          <div>
            <strong>{session ? session.label : "연결되지 않음"}</strong>
            <span>
              {session
                ? `SSH · ${session.cwd}`
                : "SSH 정보를 입력하세요"}
            </span>
          </div>
        </div>

        <div className="connection-actions">
          <button className="ghost-button" type="button" onClick={() => setIsExpanded((value) => !value)}>
            <KeyRound size={15} />
            SSH 설정
          </button>
          {session ? (
            <button className="danger-button" type="button" onClick={() => void onDisconnect()} disabled={isConnecting}>
              <Unplug size={15} />
              연결 종료
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => void submit()} disabled={isConnecting}>
              {isConnecting ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
              연결
            </button>
          )}
        </div>
      </div>

      <div className={`connection-panel__details ${isExpanded ? "is-open" : ""}`}>
        <div className="field">
          <label htmlFor="host">Host</label>
          <input id="host" value={host} onChange={(event) => setHost(event.target.value)} />
        </div>
        <div className="field field--short">
          <label htmlFor="port">Port</label>
          <input
            id="port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="username">User</label>
          <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="segmented" aria-label="인증 방식">
          <button
            type="button"
            className={authMode === "password" ? "is-active" : ""}
            onClick={() => setAuthMode("password")}
          >
            Password
          </button>
          <button
            type="button"
            className={authMode === "key" ? "is-active" : ""}
            onClick={() => setAuthMode("key")}
          >
            Key
          </button>
        </div>
        {authMode === "password" ? (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
        ) : (
          <div className="field field--wide">
            <label htmlFor="privateKey">Private key</label>
            <textarea
              id="privateKey"
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </div>
        )}
      </div>
    </section>
  );
}
