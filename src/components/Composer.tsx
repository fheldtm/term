import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AlertTriangle,
  File,
  Image,
  Paperclip,
  SendHorizontal,
  X
} from "lucide-react";
import { uploadFiles } from "@/lib/api";
import { formatBytes, safeFileName } from "@/lib/format";
import { buildTerminalPayload, validateComposer } from "@/lib/payload";
import type { Attachment, AttachmentKind, SessionInfo, UploadedFile } from "@/types/domain";

const MAX_FILES = 20;
const MAX_SINGLE_FILE = 50 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type ComposerHandle = {
  insertText: (text: string) => void;
};

type ComposerProps = {
  session: SessionInfo | null;
  onSubmitPayload: (payload: string) => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(({ session, onSubmitPayload }, ref) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<Attachment[]>([]);

  useImperativeHandle(ref, () => ({
    insertText(value: string) {
      insertAtCursor(value);
    }
  }));

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    },
    []
  );

  const validation = useMemo(() => validateComposer(text, attachments), [attachments, text]);
  const totalSize = useMemo(
    () => attachments.reduce((sum, item) => sum + item.sizeBytes, 0),
    [attachments]
  );
  const canSubmit =
    Boolean(session) &&
    !isSubmitting &&
    text.trim().length > 0 &&
    validation.unknownTokens.length === 0;

  async function submit() {
    if (!session) {
      setMessage("SSH 세션이 필요합니다.");
      return;
    }
    if (validation.unknownTokens.length) {
      setMessage(`첨부 목록에 없는 토큰이 있습니다: ${validation.unknownTokens.join(", ")}`);
      return;
    }
    if (!text.trim()) {
      setMessage("터미널에 보낼 내용을 입력하세요.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      const nextAttachments = attachments.map((item) => ({ ...item, uploadStatus: "uploading" as const }));
      setAttachments(nextAttachments);

      const pending = nextAttachments.filter((item) => !item.remotePath);
      let uploaded: UploadedFile[] = [];
      if (pending.length) {
        const response = await uploadFiles(
          session.id,
          pending.map((item) => item.file),
          pending.map((item) => ({
            token: item.token,
            originalName: item.originalName,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes
          }))
        );
        uploaded = response.files;
      }

      const uploadedByToken = new Map(uploaded.map((item) => [item.token, item]));
      const finalAttachments = nextAttachments.map((item) => {
        const match = uploadedByToken.get(item.token);
        return {
          ...item,
          remotePath: match?.remotePath || item.remotePath,
          uploadStatus: "uploaded" as const,
          errorMessage: undefined
        };
      });

      setAttachments(finalAttachments);
      onSubmitPayload(`${buildTerminalPayload(text, finalAttachments)}\n`);
      clearComposer(finalAttachments);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setAttachments((items) =>
        items.map((item) => ({
          ...item,
          uploadStatus: item.uploadStatus === "uploading" ? "failed" : item.uploadStatus,
          errorMessage
        }))
      );
      setMessage(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  function clearComposer(items = attachments) {
    items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setText("");
    setAttachments([]);
    setMessage("");
    textareaRef.current?.focus();
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const errors: string[] = [];
    if (attachments.length + files.length > MAX_FILES) {
      errors.push(`첨부는 최대 ${MAX_FILES}개까지 가능합니다.`);
    }

    const nextTotal = totalSize + files.reduce((sum, file) => sum + file.size, 0);
    if (nextTotal > MAX_TOTAL) {
      errors.push(`전체 첨부 용량은 ${formatBytes(MAX_TOTAL)}까지 가능합니다.`);
    }

    const accepted = files.filter((file) => {
      if (file.size > MAX_SINGLE_FILE) {
        errors.push(`${file.name}: ${formatBytes(MAX_SINGLE_FILE)} 제한을 초과했습니다.`);
        return false;
      }
      return true;
    });

    if (errors.length) {
      setMessage(errors.join(" "));
      return;
    }

    const created: Attachment[] = [];
    accepted.forEach((file) => {
      const kind: AttachmentKind = IMAGE_MIME_TYPES.has(file.type) ? "image" : "file";
      const token = createNextToken(kind, [...attachments, ...created]);
      created.push({
        id: crypto.randomUUID(),
        token,
        kind,
        originalName: safeFileName(file.name || (kind === "image" ? "image.png" : "file")),
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        file,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        uploadStatus: "pending"
      });
    });

    setAttachments((items) => [...items, ...created]);
    insertAtCursor(created.map((item) => item.token).join(" "));
    setMessage("");
  }

  function createNextToken(kind: AttachmentKind, current: Attachment[]) {
    const prefix = kind === "image" ? "_image" : "_file";
    const max = current.reduce((value, item) => {
      const match = item.token.match(new RegExp(`\\[${prefix}(\\d+)\\]`));
      return match ? Math.max(value, Number(match[1])) : value;
    }, 0);
    return `[${prefix}${max + 1}]`;
  }

  function removeAttachment(id: string) {
    setAttachments((items) => {
      const target = items.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target) {
        setText((value) =>
          value
            .replace(new RegExp(`\\s*${escapeRegExp(target.token)}\\s*`, "g"), " ")
            .replace(/[ \t]{2,}/g, " ")
            .trim()
        );
      }
      return items.filter((item) => item.id !== id);
    });
  }

  function insertAtCursor(value: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((current) => `${current}${current ? " " : ""}${value}`);
      return;
    }

    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const inserted = `${needsLeadingSpace ? " " : ""}${value}${needsTrailingSpace ? " " : ""}`;
    const next = before + inserted + after;
    setText(next);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = before.length + inserted.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];

    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  function statusText() {
    if (!session) return "세션을 연결하면 제출할 수 있습니다.";
    if (message) return message;
    if (validation.unknownTokens.length) return `알 수 없는 토큰: ${validation.unknownTokens.join(", ")}`;
    if (validation.unreferencedAttachments.length) return "본문에서 참조되지 않은 첨부가 있습니다.";
    return `${attachments.length} files · ${formatBytes(totalSize)}`;
  }

  return (
    <section
      className={`composer ${isDragging ? "is-dragging" : ""}`}
      aria-label="터미널 composer"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {attachments.length ? (
        <div className="composer-preview" aria-label="첨부 Preview">
          {attachments.map((item) => (
            <article className={`attachment-tile is-${item.kind}`} key={item.id}>
              <button
                type="button"
                className="attachment-tile__remove"
                onClick={() => removeAttachment(item.id)}
                aria-label={`${item.token} 삭제`}
              >
                <X size={14} />
              </button>
              <div className="attachment-tile__media">
                {item.kind === "image" && item.previewUrl ? (
                  <img src={item.previewUrl} alt={`${item.originalName} preview`} />
                ) : (
                  <File size={24} />
                )}
              </div>
              <strong>{item.token}</strong>
              <span>{item.originalName}</span>
              <small>{item.uploadStatus === "failed" ? item.errorMessage : `${formatBytes(item.sizeBytes)} ${item.mimeType}`}</small>
            </article>
          ))}
        </div>
      ) : null}

      <div className="composer-body">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Pi에게 작업 요청"
          aria-label="터미널에 보낼 내용"
        />
        <div className="composer-toolbar">
          <div className="composer-toolbar__left">
            <button
              className="round-icon-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="파일 선택"
              title="파일 선택"
            >
              <Paperclip size={18} />
            </button>
            <span className={`composer-status ${message || validation.unknownTokens.length ? "is-error" : ""}`}>
              {message || validation.unknownTokens.length ? <AlertTriangle size={14} /> : <Image size={14} />}
              {statusText()}
            </span>
          </div>
          <button
            className="submit-button"
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            aria-label="터미널로 제출"
            title="터미널로 제출"
          >
            <SendHorizontal size={18} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </section>
  );
});

Composer.displayName = "Composer";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
