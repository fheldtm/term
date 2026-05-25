import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  KeyRound,
  Loader2,
  Plug,
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

type PendingSave = {
  form: ConnectionForm;
  session: SessionInfo;
};

type ConnectionPanelProps = {
  session: SessionInfo | null;
  isConnecting: boolean;
  onConnect: (payload: ConnectPayload) => Promise<SessionInfo | null>;
  onDisconnect: () => Promise<void>;
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
  onDisconnect
}: ConnectionPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>(() => readSavedConnections());
  const [selectedId, setSelectedId] = useState("");
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [saveSecret, setSaveSecret] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
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
    setModalMessage("");
  }

  function closeModal() {
    if (isConnecting) return;
    setIsModalOpen(false);
    setModalMessage("");
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
    setModalMessage("");
  }

  async function connectFromForm(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (isConnecting) return;

    const payload = formToPayload(form);
    if (!payload.host || !payload.username) {
      setModalMessage("Host와 User를 입력하세요.");
      return;
    }

    const nextSession = await onConnect(payload);
    if (!nextSession) return;

    setIsModalOpen(false);
    setSaveSecret(false);
    setPendingSave({ form, session: nextSession });
  }

  async function connectSaved(connection: SavedConnection) {
    if (isConnecting) return;

    applySavedConnection(connection);
    if (connection.authMode === "password" && !connection.password) {
      setModalMessage("저장된 비밀번호가 없습니다. 비밀번호 입력 후 Enter로 접속하세요.");
      window.setTimeout(() => passwordInputRef.current?.focus(), 0);
      return;
    }
    if (connection.authMode === "key" && !connection.privateKey) {
      setModalMessage("저장된 Private key가 없습니다. Key 입력 후 Ctrl+Enter로 접속하세요.");
      window.setTimeout(() => privateKeyInputRef.current?.focus(), 0);
      return;
    }

    const nextSession = await onConnect(savedConnectionToPayload(connection));
    if (nextSession) {
      setIsModalOpen(false);
      setModalMessage("");
    }
  }

  function savePendingConnection() {
    if (!pendingSave) return;

    const { form: sourceForm, session: nextSession } = pendingSave;
    const id = connectionId(sourceForm);
    const nextConnection: SavedConnection = {
      id,
      name: nextSession.label,
      host: sourceForm.host.trim(),
      port: sourceForm.port || 22,
      username: sourceForm.username.trim(),
      authMode: sourceForm.authMode,
      savedAt: Date.now()
    };

    if (saveSecret) {
      if (sourceForm.authMode === "password") nextConnection.password = sourceForm.password;
      if (sourceForm.authMode === "key") {
        nextConnection.privateKey = sourceForm.privateKey;
        nextConnection.passphrase = sourceForm.passphrase;
      }
    }

    setSavedConnections((items) => [
      nextConnection,
      ...items.filter((item) => item.id !== id)
    ]);
    setPendingSave(null);
  }

  function skipSave() {
    setPendingSave(null);
    setSaveSecret(false);
  }

  function removeSavedConnection(id: string) {
    setSavedConnections((items) => items.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId("");
  }

  function handleModalKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") closeModal();
  }

  const secretLabel = pendingSave?.form.authMode === "key" ? "Private key도 저장" : "비밀번호도 저장";

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

                {modalMessage ? <div className="inline-error">{modalMessage}</div> : null}

                <div className="connection-form__actions">
                  <Button variant="ghost" onClick={closeModal}>
                    취소
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

      {pendingSave ? (
        <div className="modal-backdrop" role="presentation">
          <div className="save-connection-modal" role="dialog" aria-modal="true" aria-label="연결 저장">
            <div className="connection-modal__head">
              <div>
                <strong>연결을 저장할까요?</strong>
                <span>{pendingSave.session.label}</span>
              </div>
            </div>
            <p>
              저장된 연결은 다음부터 목록에서 더블 클릭으로 접속할 수 있습니다.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={saveSecret}
                onChange={(event) => setSaveSecret(event.target.checked)}
              />
              <span>{secretLabel}</span>
            </label>
            <small>비밀번호와 key는 현재 기기의 localStorage에 저장됩니다.</small>
            <div className="connection-form__actions">
              <Button variant="ghost" onClick={skipSave}>
                저장 안 함
              </Button>
              <Button variant="primary" onClick={savePendingConnection}>
                저장
              </Button>
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
