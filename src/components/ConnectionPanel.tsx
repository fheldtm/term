import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  KeyRound,
  Loader2,
  Plug,
  Save,
  Server,
  Trash2,
  Unplug,
  X
} from "lucide-react";
import {
  Button,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  TextArea
} from "@/components/ui";
import type { ConnectPayload, SessionInfo } from "@/types/domain";

type AuthMode = "password" | "key";

type SavedConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  savedAt: number;
};

type ConnectionForm = {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
  authMode: AuthMode;
};

type ConnectionPanelProps = {
  session: SessionInfo | null;
  isConnecting: boolean;
  onConnect: (payload: ConnectPayload) => Promise<SessionInfo | null>;
  onDisconnect: () => Promise<void>;
  headerAction?: ReactNode;
};

const STORAGE_KEY = "ssh-terminal-composer:saved-connections";
const EMPTY_FORM: ConnectionForm = {
  host: "",
  port: 22,
  username: "",
  password: "",
  privateKey: "",
  passphrase: "",
  authMode: "password"
};

export function ConnectionPanel({
  session,
  isConnecting,
  onConnect,
  onDisconnect,
  headerAction
}: ConnectionPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>(() => readSavedConnections());
  const [selectedId, setSelectedId] = useState("");
  const [saveSecret, setSaveSecret] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const privateKeyInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isModalOpen) return;
    const timer = window.setTimeout(() => hostInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isModalOpen]);

  useEffect(() => {
    writeSavedConnections(savedConnections);
  }, [savedConnections]);

  const selectedConnection = useMemo(
    () => savedConnections.find((item) => item.id === selectedId) || null,
    [savedConnections, selectedId]
  );

  function openModal() {
    setIsModalOpen(true);
    setModalMessage(null);
  }

  function closeModal() {
    if (isConnecting) return;
    setIsModalOpen(false);
    setModalMessage(null);
  }

  function updateField<K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applySavedConnection(connection: SavedConnection) {
    setSelectedId(connection.id);
    setForm({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password || "",
      privateKey: connection.privateKey || "",
      passphrase: connection.passphrase || "",
      authMode: connection.authMode
    });
    setSaveSecret(Boolean(connection.password || connection.privateKey));
    setModalMessage(null);
  }

  async function connectFromForm(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (isConnecting) return;

    const payload = formToPayload(form);
    if (!payload.host || !payload.username) {
      setModalError("Host와 User를 입력하세요.");
      return;
    }

    const nextSession = await onConnect(payload);
    if (!nextSession) return;

    setIsModalOpen(false);
    setModalMessage(null);
  }

  async function connectSaved(connection: SavedConnection) {
    if (isConnecting) return;

    applySavedConnection(connection);
    if (connection.authMode === "password" && !connection.password) {
      setModalError("저장된 비밀번호가 없습니다. 비밀번호 입력 후 Enter로 접속하세요.");
      window.setTimeout(() => passwordInputRef.current?.focus(), 0);
      return;
    }
    if (connection.authMode === "key" && !connection.privateKey) {
      setModalError("저장된 Private key가 없습니다. Key 입력 후 Ctrl+Enter로 접속하세요.");
      window.setTimeout(() => privateKeyInputRef.current?.focus(), 0);
      return;
    }

    const nextSession = await onConnect(savedConnectionToPayload(connection));
    if (nextSession) {
      setIsModalOpen(false);
      setModalMessage(null);
    }
  }

  function saveConnectionFromForm() {
    const payload = formToPayload(form);
    if (!payload.host || !payload.username) {
      setModalError("Host와 User를 입력하세요.");
      return;
    }

    const previousId = selectedConnection?.id;
    const nextConnection = formToSavedConnection(form, saveSecret);

    setSavedConnections((items) => {
      const filtered = items.filter((item) => item.id !== previousId && item.id !== nextConnection.id);
      if (!previousId) return [nextConnection, ...filtered];

      const previousIndex = items.findIndex((item) => item.id === previousId);
      const insertIndex = previousIndex >= 0 ? Math.min(previousIndex, filtered.length) : 0;
      const nextItems = [...filtered];
      nextItems.splice(insertIndex, 0, nextConnection);
      return nextItems;
    });
    setSelectedId(nextConnection.id);
    setModalOk(previousId ? "저장된 연결을 수정했습니다." : "연결을 저장했습니다.");
  }

  function removeSavedConnection(id: string) {
    setSavedConnections((items) => items.filter((item) => item.id !== id));
    if (selectedId === id) {
      setSelectedId("");
      setSaveSecret(false);
    }
  }

  function handleModalKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") closeModal();
  }

  function setModalError(text: string) {
    setModalMessage({ tone: "error", text });
  }

  function setModalOk(text: string) {
    setModalMessage({ tone: "ok", text });
  }

  const secretLabel = form.authMode === "key" ? "Private key 저장" : "비밀번호 저장";

  return (
    <section className="connection-panel" aria-label="SSH connection">
      <div className="connection-panel__main">
        <div className="connection-status">
          <Server size={17} />
          <div>
            <strong>{session ? session.label : "연결되지 않음"}</strong>
            <span>{session ? `SSH · ${session.cwd}` : "SSH 연결을 시작하세요"}</span>
          </div>
        </div>

        <div className="connection-actions">
          <Button variant="primary" onClick={openModal} disabled={isConnecting}>
            {isConnecting ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
            {session ? "연결 변경" : "SSH 연결"}
          </Button>
          {session ? (
            <Button variant="danger" onClick={() => void onDisconnect()} disabled={isConnecting}>
              <Unplug size={15} />
              연결 종료
            </Button>
          ) : null}
          {headerAction}
        </div>
      </div>

      {isModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <div
            className="connection-modal"
            role="dialog"
            aria-modal="true"
            aria-label="SSH 연결"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleModalKeyDown}
          >
            <div className="connection-modal__head">
              <div>
                <strong>SSH 연결</strong>
                <span>저장된 연결은 더블 클릭으로 접속합니다.</span>
              </div>
              <IconButton variant="modal" onClick={closeModal} aria-label="닫기">
                <X size={16} />
              </IconButton>
            </div>

            <div className="connection-modal__content">
              <aside className="saved-connections" aria-label="저장된 SSH 연결">
                <div className="saved-connections__head">
                  <strong>저장된 연결</strong>
                  <span>{savedConnections.length}</span>
                </div>
                <div className="saved-connection-list">
                  {savedConnections.length ? (
                    savedConnections.map((item) => (
                      <button
                        className={`saved-connection ${selectedId === item.id ? "is-selected" : ""}`}
                        type="button"
                        key={item.id}
                        onClick={() => applySavedConnection(item)}
                        onDoubleClick={() => void connectSaved(item)}
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.username}@{item.host}:{item.port}</small>
                        </span>
                        <em>{item.password || item.privateKey ? "secret" : "no secret"}</em>
                      </button>
                    ))
                  ) : (
                    <div className="saved-empty">
                      <KeyRound size={20} />
                      <span>저장된 연결이 없습니다.</span>
                    </div>
                  )}
                </div>
                {selectedConnection ? (
                  <Button
                    variant="secondary"
                    className="saved-delete-button"
                    onClick={() => removeSavedConnection(selectedConnection.id)}
                  >
                    <Trash2 size={14} />
                    삭제
                  </Button>
                ) : null}
              </aside>

              <form className="connection-form" onSubmit={(event) => void connectFromForm(event)}>
                <Field label="Host" htmlFor="ssh-host">
                  <Input
                    id="ssh-host"
                    ref={hostInputRef}
                    value={form.host}
                    onChange={(event) => updateField("host", event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Port" htmlFor="ssh-port" short>
                  <Input
                    id="ssh-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(event) => updateField("port", Number(event.target.value))}
                  />
                </Field>
                <Field label="User" htmlFor="ssh-user">
                  <Input
                    id="ssh-user"
                    value={form.username}
                    onChange={(event) => updateField("username", event.target.value)}
                    autoComplete="username"
                  />
                </Field>
                <SegmentedControl
                  ariaLabel="인증 방식"
                  className="connection-auth"
                  value={form.authMode}
                  options={[
                    { value: "password", label: "Password" },
                    { value: "key", label: "Key" }
                  ]}
                  onChange={(value) => updateField("authMode", value)}
                />

                {form.authMode === "password" ? (
                  <Field label="Password" htmlFor="ssh-password" wide>
                    <Input
                      id="ssh-password"
                      ref={passwordInputRef}
                      type="password"
                      value={form.password}
                      onChange={(event) => updateField("password", event.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Private key" htmlFor="ssh-private-key" wide>
                      <TextArea
                        id="ssh-private-key"
                        ref={privateKeyInputRef}
                        value={form.privateKey}
                        onChange={(event) => updateField("privateKey", event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                            event.preventDefault();
                            void connectFromForm();
                          }
                        }}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      />
                    </Field>
                    <Field label="Passphrase" htmlFor="ssh-passphrase" wide>
                      <Input
                        id="ssh-passphrase"
                        type="password"
                        value={form.passphrase}
                        onChange={(event) => updateField("passphrase", event.target.value)}
                        autoComplete="off"
                      />
                    </Field>
                  </>
                )}

                <label className="connection-secret-row">
                  <input
                    type="checkbox"
                    checked={saveSecret}
                    onChange={(event) => setSaveSecret(event.target.checked)}
                  />
                  <span>
                    <strong>{secretLabel}</strong>
                    <small>체크하면 현재 기기의 localStorage에 함께 저장됩니다.</small>
                  </span>
                </label>

                {modalMessage ? (
                  <div className={`inline-error ${modalMessage.tone === "ok" ? "is-ok" : ""}`}>
                    {modalMessage.text}
                  </div>
                ) : null}

                <div className="connection-form__actions">
                  <Button variant="ghost" onClick={closeModal}>
                    취소
                  </Button>
                  <Button variant="secondary" onClick={saveConnectionFromForm}>
                    <Save size={15} />
                    {selectedConnection ? "변경 저장" : "저장"}
                  </Button>
                  <Button variant="primary" type="submit" disabled={isConnecting}>
                    {isConnecting ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
                    접속
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

function formToPayload(form: ConnectionForm): ConnectPayload {
  return {
    mode: "ssh",
    host: form.host.trim(),
    port: form.port || 22,
    username: form.username.trim(),
    password: form.authMode === "password" ? form.password : undefined,
    privateKey: form.authMode === "key" ? form.privateKey : undefined,
    passphrase: form.authMode === "key" ? form.passphrase || undefined : undefined
  };
}

function savedConnectionToPayload(connection: SavedConnection): ConnectPayload {
  return {
    mode: "ssh",
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.authMode === "password" ? connection.password : undefined,
    privateKey: connection.authMode === "key" ? connection.privateKey : undefined,
    passphrase: connection.authMode === "key" ? connection.passphrase : undefined
  };
}

function formToSavedConnection(form: ConnectionForm, includeSecret: boolean): SavedConnection {
  const nextConnection: SavedConnection = {
    id: connectionId(form),
    name: `${form.username.trim()}@${form.host.trim()}`,
    host: form.host.trim(),
    port: form.port || 22,
    username: form.username.trim(),
    authMode: form.authMode,
    savedAt: Date.now()
  };

  if (includeSecret) {
    if (form.authMode === "password" && form.password) nextConnection.password = form.password;
    if (form.authMode === "key" && form.privateKey) {
      nextConnection.privateKey = form.privateKey;
      if (form.passphrase) nextConnection.passphrase = form.passphrase;
    }
  }

  return nextConnection;
}

function connectionId(form: ConnectionForm) {
  return `${form.username.trim()}@${form.host.trim()}:${form.port || 22}:${form.authMode}`;
}

function readSavedConnections(): SavedConnection[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedConnection);
  } catch {
    return [];
  }
}

function writeSavedConnections(connections: SavedConnection[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
}

function isSavedConnection(value: unknown): value is SavedConnection {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedConnection>;
  return (
    typeof item.id === "string" &&
    typeof item.host === "string" &&
    typeof item.username === "string" &&
    typeof item.port === "number" &&
    (item.authMode === "password" || item.authMode === "key")
  );
}
