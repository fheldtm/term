import { formatBytes } from "@/lib/format";
import type { Attachment } from "@/types/domain";

const TOKEN_PATTERN = /\[_(?:image|file)\d+\]/g;

export function extractTokens(text: string) {
  return [...new Set(text.match(TOKEN_PATTERN) || [])];
}

export function buildTerminalPayload(text: string, attachments: Attachment[]) {
  const body = text.trimEnd();
  const uploaded = [...attachments].sort((a, b) => tokenSortValue(a.token) - tokenSortValue(b.token));
  if (!uploaded.length) return body;

  const fileLines = uploaded.map((item) => {
    const remotePath = item.remotePath || "(upload pending)";
    return `- ${item.token} ${item.originalName} (${formatBytes(item.sizeBytes)}, ${item.mimeType}): ${remotePath}`;
  });

  return `${body}\n\nUser uploaded files:\n${fileLines.join("\n")}`;
}

export function validateComposer(text: string, attachments: Attachment[]) {
  const textTokens = extractTokens(text);
  const attachmentTokens = new Set(attachments.map((item) => item.token));
  const unknownTokens = textTokens.filter((token) => !attachmentTokens.has(token));
  const unreferencedAttachments = attachments.filter((item) => !textTokens.includes(item.token));
  return { textTokens, unknownTokens, unreferencedAttachments };
}

function tokenSortValue(token: string) {
  const [, kind, number] = token.match(/\[_(image|file)(\d+)\]/) || [];
  const offset = kind === "file" ? 10_000 : 0;
  return offset + Number(number || 0);
}
