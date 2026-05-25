import { createServer } from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import multer from "multer";
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type FileEntryWithStats,
  type SFTPWrapper,
  type Stats
} from "ssh2";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 20,
    fileSize: 50 * 1024 * 1024
  }
});

type RemoteFile = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number;
};

type BaseSession = {
  id: string;
  mode: "ssh";
  label: string;
  host: string;
  username: string;
  homeDir: string;
  cwd: string;
  uploadRoot: string;
  createdAt: number;
};

type SshSession = BaseSession & {
  mode: "ssh";
  client: Client;
  sftp: SFTPWrapper;
};

type ConnectBody = {
  mode?: "ssh";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

type UploadedMetadata = {
  token?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

const sessions = new Map<string, SshSession>();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

app.post("/api/sessions", async (req: Request<object, object, ConnectBody>, res: Response) => {
  try {
    const body = req.body;
    if (!body.host) {
      res.status(400).json({ message: "host is required" });
      return;
    }

    if (!body.username) {
      res.status(400).json({ message: "username is required" });
      return;
    }

    const client = await connectSsh({
      host: body.host,
      port: body.port || 22,
      username: body.username,
      password: body.password || undefined,
      privateKey: body.privateKey || undefined,
      passphrase: body.passphrase || undefined,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000
    });

    const sftp = await openSftp(client);
    const { homeDir, cwd } = await readRemoteHome(client);
    const id = randomUUID();
    const uploadRoot = posixJoin(homeDir, ".terminal-composer", "uploads");
    const session: SshSession = {
      id,
      mode: "ssh",
      label: `${body.username}@${body.host}`,
      host: body.host,
      username: body.username,
      homeDir,
      cwd,
      uploadRoot,
      createdAt: Date.now(),
      client,
      sftp
    };

    client.on("close", () => {
      sessions.delete(id);
    });
    client.on("error", () => {
      sessions.delete(id);
    });

    sessions.set(id, session);
    res.json(publicSession(session));
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

app.delete("/api/sessions/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session?.mode === "ssh") {
    session.client.end();
  }
  sessions.delete(req.params.sessionId);
  res.json({ ok: true });
});

app.get("/api/sessions/:sessionId/files", async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ message: "session not found" });
    return;
  }

  const requestedPath = typeof req.query.path === "string" ? req.query.path : session.cwd;
  const targetPath = resolveRemotePath(requestedPath, session.homeDir);

  try {
    const entries = await sftpReaddir(session.sftp, targetPath);
    const files: RemoteFile[] = entries
      .map((entry) => {
        const attrs = entry.attrs;
        const type: RemoteFile["type"] = attrs.isDirectory()
          ? "directory"
          : attrs.isSymbolicLink()
            ? "symlink"
            : attrs.isFile()
              ? "file"
              : "other";
        return {
          name: entry.filename,
          path: posixJoin(targetPath, entry.filename),
          type,
          size: attrs.size,
          modifiedAt: attrs.mtime * 1000
        };
      })
      .sort(sortRemoteFiles);

    res.json({ path: targetPath, files });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

app.post("/api/sessions/:sessionId/upload", upload.array("files", 20), async (req, res) => {
  const session = sessions.get(String(req.params.sessionId));
  if (!session) {
    res.status(404).json({ message: "session not found" });
    return;
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    res.status(400).json({ message: "files are required" });
    return;
  }

  const metadata = parseMetadata(req.body.metadata);
  const uploadDir = posixJoin(
    session.uploadRoot,
    localDateString(),
    session.id.slice(0, 8)
  );

  try {
    if (session.mode === "ssh") {
      await sftpMkdirp(session.sftp, uploadDir);
    }

    const uploaded = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const meta = metadata[index] || {};
      const originalName = sanitizeFileName(meta.originalName || file.originalname || "file");
      const remotePath =
        session.mode === "ssh"
          ? await nextAvailableRemotePath(session.sftp, uploadDir, originalName)
          : posixJoin(uploadDir, originalName);

      if (session.mode === "ssh") {
        await sftpWriteFile(session.sftp, remotePath, file.buffer);
      }

      uploaded.push({
        token: meta.token,
        originalName,
        mimeType: meta.mimeType || file.mimetype || "application/octet-stream",
        sizeBytes: meta.sizeBytes || file.size,
        remotePath,
        status: "uploaded"
      });
    }

    res.json({ uploadDir, files: uploaded });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

const distPath = path.resolve(process.cwd(), "dist");
app.use(express.static(distPath));
app.get(/.*/, (_req, res, next) => {
  res.sendFile(path.join(distPath, "index.html"), (error) => {
    if (error) next();
  });
});

const server = createServer(app);
const terminalWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/ws\/terminal\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  terminalWss.handleUpgrade(request, socket, head, (ws) => {
    terminalWss.emit("connection", ws, request, match[1]);
  });
});

terminalWss.on("connection", (ws: WebSocket, _request: unknown, sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "session not found" }));
    ws.close();
    return;
  }

  openSshTerminal(ws, session);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SSH Terminal Composer server listening on http://0.0.0.0:${PORT}`);
});

function publicSession(session: SshSession) {
  return {
    id: session.id,
    mode: session.mode,
    label: session.label,
    host: session.host,
    username: session.username,
    homeDir: session.homeDir,
    cwd: session.cwd,
    uploadRoot: session.uploadRoot,
    createdAt: session.createdAt
  };
}

function connectSsh(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const cleanup = () => {
      client.off("ready", onReady);
      client.off("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve(client);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    client.once("ready", onReady);
    client.once("error", onError);
    client.connect(config);
  });
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

async function readRemoteHome(client: Client): Promise<{ homeDir: string; cwd: string }> {
  const output = await execRemote(client, "printf '__HOME__%s\\n__PWD__%s\\n' \"$HOME\" \"$PWD\"");
  const homeDir = output.match(/__HOME__(.+)/)?.[1]?.trim() || "/";
  const cwd = output.match(/__PWD__(.+)/)?.[1]?.trim() || homeDir;
  return { homeDir, cwd };
}

function execRemote(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      stream.on("close", (code: number) => {
        if (code && stderr) reject(new Error(stderr.trim()));
        else resolve(stdout);
      });
    });
  });
}

function openSshTerminal(ws: WebSocket, session: SshSession) {
  let channel: ClientChannel | undefined;
  session.client.shell(
    {
      term: "xterm-256color",
      cols: 120,
      rows: 34
    },
    (error, stream) => {
      if (error) {
        ws.send(JSON.stringify({ type: "error", message: error.message }));
        ws.close();
        return;
      }

      channel = stream;
      stream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: chunk.toString("utf8") }));
        }
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: chunk.toString("utf8") }));
        }
      });
      stream.on("close", () => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });
    }
  );

  ws.on("message", (raw) => {
    const message = parseSocketMessage(raw.toString());
    if (!message || !channel) return;
    if (message.type === "input") {
      channel.write(message.data);
    }
    if (message.type === "resize") {
      channel.setWindow(message.rows, message.cols, 0, 0);
    }
  });

  ws.on("close", () => {
    channel?.end();
  });
}

function parseSocketMessage(raw: string): { type: "input"; data: string } | { type: "resize"; cols: number; rows: number } | null {
  try {
    const value = JSON.parse(raw) as { type?: string; data?: string; cols?: number; rows?: number };
    if (value.type === "input" && typeof value.data === "string") return { type: "input", data: value.data };
    if (value.type === "resize" && typeof value.cols === "number" && typeof value.rows === "number") {
      return { type: "resize", cols: value.cols, rows: value.rows };
    }
    return null;
  } catch {
    return null;
  }
}

function sftpReaddir(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<FileEntryWithStats[]>((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) reject(error);
      else resolve(list);
    });
  });
}

function sftpStat(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<Stats>((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) reject(error);
      else resolve(stats);
    });
  });
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, buffer: Buffer) {
  return new Promise<void>((resolve, reject) => {
    sftp.writeFile(remotePath, buffer, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sftpMkdirp(sftp: SFTPWrapper, remotePath: string) {
  const parts = remotePath.split("/").filter(Boolean);
  let current = remotePath.startsWith("/") ? "/" : "";
  for (const part of parts) {
    current = current === "/" ? `/${part}` : posixJoin(current, part);
    try {
      const stats = await sftpStat(sftp, current);
      if (!stats.isDirectory()) throw new Error(`${current} exists and is not a directory`);
    } catch (error) {
      if (isSftpNotFound(error)) {
        await sftpMkdir(sftp, current);
      } else {
        throw error;
      }
    }
  }
}

async function nextAvailableRemotePath(sftp: SFTPWrapper, dir: string, fileName: string) {
  const parsed = path.posix.parse(fileName);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate =
      index === 1
        ? posixJoin(dir, fileName)
        : posixJoin(dir, `${parsed.name}-${index}${parsed.ext}`);
    try {
      await sftpStat(sftp, candidate);
    } catch (error) {
      if (isSftpNotFound(error)) return candidate;
      throw error;
    }
  }
  throw new Error("could not allocate a unique upload path");
}

function isSftpNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error) &&
      ((error as { code?: number }).code === 2 ||
        /no such file|not found/i.test(String((error as { message?: string }).message || "")))
  );
}

function parseMetadata(value: unknown): UploadedMetadata[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveRemotePath(requestedPath: string, homeDir: string) {
  const expanded = requestedPath.startsWith("~")
    ? requestedPath.replace(/^~/, homeDir)
    : requestedPath;
  const normalized = path.posix.normalize(expanded || homeDir);
  if (!normalized.startsWith(homeDir)) return homeDir;
  return normalized;
}

function posixJoin(...parts: string[]) {
  return path.posix.join(...parts).replace(/\/+/g, "/");
}

function sanitizeFileName(fileName: string) {
  const cleaned = path.posix.basename(fileName).replace(/[\u0000-\u001f<>:"\\|?*]/g, "_").trim();
  return cleaned || "file";
}

function sortRemoteFiles(a: RemoteFile, b: RemoteFile) {
  if (a.type === "directory" && b.type !== "directory") return -1;
  if (a.type !== "directory" && b.type === "directory") return 1;
  return a.name.localeCompare(b.name);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
