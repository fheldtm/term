use std::{
  collections::HashMap,
  io::{Read, Write},
  net::TcpStream,
  path::Path,
  sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
  },
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use chrono::Local;
use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Session};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;

#[derive(Default)]
struct AppState {
  sessions: Mutex<HashMap<String, ManagedSession>>,
}

struct ManagedSession {
  info: SessionInfo,
  kind: SessionKind,
  terminal_tx: Option<Sender<TerminalCommand>>,
}

enum SessionKind {
  Demo,
  Ssh { ssh: Arc<Mutex<Session>> },
}

enum TerminalCommand {
  Input(String),
  Resize { cols: u32, rows: u32 },
  Close,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
  id: String,
  mode: String,
  label: String,
  host: String,
  username: String,
  home_dir: String,
  cwd: String,
  upload_root: String,
  created_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectPayload {
  mode: Option<String>,
  host: Option<String>,
  port: Option<u16>,
  username: Option<String>,
  password: Option<String>,
  private_key: Option<String>,
  passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFile {
  name: String,
  path: String,
  #[serde(rename = "type")]
  file_type: String,
  size: u64,
  modified_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileListResponse {
  path: String,
  files: Vec<RemoteFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadFileInput {
  token: String,
  original_name: String,
  mime_type: String,
  size_bytes: u64,
  data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadedFile {
  token: String,
  original_name: String,
  mime_type: String,
  size_bytes: u64,
  remote_path: String,
  status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
  upload_dir: String,
  files: Vec<UploadedFile>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
  session_id: String,
  data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalError {
  session_id: String,
  message: String,
}

#[tauri::command]
fn create_session(payload: ConnectPayload, state: State<'_, AppState>) -> Result<SessionInfo> {
  if payload.mode.as_deref() == Some("demo") || payload.host.as_deref().unwrap_or("").is_empty() {
    let session = create_demo_session();
    let info = session.info.clone();
    state
      .sessions
      .lock()
      .map_err(lock_error)?
      .insert(info.id.clone(), session);
    return Ok(info);
  }

  let host = payload.host.ok_or_else(|| "host is required".to_string())?;
  let username = payload
    .username
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| "username is required".to_string())?;
  let port = payload.port.unwrap_or(22);

  let tcp = TcpStream::connect((host.as_str(), port)).map_err(to_error)?;
  tcp
    .set_read_timeout(Some(Duration::from_secs(15)))
    .map_err(to_error)?;
  tcp
    .set_write_timeout(Some(Duration::from_secs(15)))
    .map_err(to_error)?;

  let mut ssh = Session::new().map_err(to_error)?;
  ssh.set_tcp_stream(tcp);
  ssh.handshake().map_err(to_error)?;

  if let Some(private_key) = payload.private_key.filter(|value| !value.trim().is_empty()) {
    ssh
      .userauth_pubkey_memory(
        username.as_str(),
        None,
        private_key.as_str(),
        payload.passphrase.as_deref(),
      )
      .map_err(to_error)?;
  } else {
    ssh
      .userauth_password(username.as_str(), payload.password.as_deref().unwrap_or(""))
      .map_err(to_error)?;
  }

  if !ssh.authenticated() {
    return Err("SSH authentication failed".to_string());
  }

  let (home_dir, cwd) = read_remote_home(&ssh)?;
  let id = Uuid::new_v4().to_string();
  let info = SessionInfo {
    id: id.clone(),
    mode: "ssh".to_string(),
    label: format!("{username}@{host}"),
    host,
    username,
    home_dir: home_dir.clone(),
    cwd,
    upload_root: posix_join(&[home_dir.as_str(), ".terminal-composer", "uploads"]),
    created_at: now_ms(),
  };
  let session = ManagedSession {
    info: info.clone(),
    kind: SessionKind::Ssh {
      ssh: Arc::new(Mutex::new(ssh)),
    },
    terminal_tx: None,
  };

  state
    .sessions
    .lock()
    .map_err(lock_error)?
    .insert(id, session);
  Ok(info)
}

#[tauri::command]
fn disconnect_session(session_id: String, state: State<'_, AppState>) -> Result<()> {
  if let Some(session) = state
    .sessions
    .lock()
    .map_err(lock_error)?
    .remove(session_id.as_str())
  {
    if let Some(tx) = session.terminal_tx {
      let _ = tx.send(TerminalCommand::Close);
    }
  }
  Ok(())
}

#[tauri::command]
fn list_files(session_id: String, path: String, state: State<'_, AppState>) -> Result<FileListResponse> {
  let sessions = state.sessions.lock().map_err(lock_error)?;
  let session = sessions
    .get(session_id.as_str())
    .ok_or_else(|| "session not found".to_string())?;
  let target_path = resolve_remote_path(path.as_str(), session.info.home_dir.as_str());

  match &session.kind {
    SessionKind::Demo => Ok(FileListResponse {
      path: target_path.clone(),
      files: list_demo_files(target_path.as_str()),
    }),
    SessionKind::Ssh { ssh } => {
      let ssh = ssh.lock().map_err(lock_error)?;
      let sftp = ssh.sftp().map_err(to_error)?;
      let entries = sftp.readdir(Path::new(target_path.as_str())).map_err(to_error)?;
      let mut files = entries
        .into_iter()
        .filter_map(|(path, stat)| {
          let name = path.file_name()?.to_string_lossy().to_string();
          Some(RemoteFile {
            path: posix_join(&[target_path.as_str(), name.as_str()]),
            name,
            file_type: stat_type(&stat),
            size: stat.size.unwrap_or(0),
            modified_at: stat.mtime.unwrap_or(0) * 1000,
          })
        })
        .collect::<Vec<_>>();
      files.sort_by(sort_remote_files);
      Ok(FileListResponse {
        path: target_path,
        files,
      })
    }
  }
}

#[tauri::command]
fn upload_files(
  session_id: String,
  files: Vec<UploadFileInput>,
  state: State<'_, AppState>,
) -> Result<UploadResponse> {
  let sessions = state.sessions.lock().map_err(lock_error)?;
  let session = sessions
    .get(session_id.as_str())
    .ok_or_else(|| "session not found".to_string())?;

  let upload_dir = posix_join(&[
    session.info.upload_root.as_str(),
    Local::now().format("%Y-%m-%d").to_string().as_str(),
    &session.info.id[..8],
  ]);

  match &session.kind {
    SessionKind::Demo => {
      let uploaded = files
        .into_iter()
        .map(|file| UploadedFile {
          remote_path: posix_join(&[upload_dir.as_str(), sanitize_file_name(file.original_name.as_str()).as_str()]),
          token: file.token,
          original_name: sanitize_file_name(file.original_name.as_str()),
          mime_type: file.mime_type,
          size_bytes: file.size_bytes,
          status: "uploaded".to_string(),
        })
        .collect();
      Ok(UploadResponse {
        upload_dir,
        files: uploaded,
      })
    }
    SessionKind::Ssh { ssh } => {
      let ssh = ssh.lock().map_err(lock_error)?;
      let sftp = ssh.sftp().map_err(to_error)?;
      mkdirp(&sftp, upload_dir.as_str())?;

      let mut uploaded = Vec::with_capacity(files.len());
      for file in files {
        let file_name = sanitize_file_name(file.original_name.as_str());
        let remote_path = next_available_remote_path(&sftp, upload_dir.as_str(), file_name.as_str())?;
        let data = general_purpose::STANDARD
          .decode(file.data_base64.as_bytes())
          .map_err(to_error)?;
        let mut remote_file = sftp.create(Path::new(remote_path.as_str())).map_err(to_error)?;
        remote_file.write_all(data.as_slice()).map_err(to_error)?;
        uploaded.push(UploadedFile {
          token: file.token,
          original_name: file_name,
          mime_type: file.mime_type,
          size_bytes: file.size_bytes,
          remote_path,
          status: "uploaded".to_string(),
        });
      }

      Ok(UploadResponse {
        upload_dir,
        files: uploaded,
      })
    }
  }
}

#[tauri::command]
fn terminal_open(session_id: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
  let mut sessions = state.sessions.lock().map_err(lock_error)?;
  let session = sessions
    .get_mut(session_id.as_str())
    .ok_or_else(|| "session not found".to_string())?;

  if let Some(tx) = session.terminal_tx.take() {
    let _ = tx.send(TerminalCommand::Close);
  }

  let (tx, rx) = mpsc::channel::<TerminalCommand>();
  session.terminal_tx = Some(tx);
  let info = session.info.clone();

  match &session.kind {
    SessionKind::Demo => {
      thread::spawn(move || run_demo_terminal(app, info, rx));
    }
    SessionKind::Ssh { ssh } => {
      let ssh = ssh.clone();
      thread::spawn(move || run_ssh_terminal(app, info, ssh, rx));
    }
  }

  Ok(())
}

#[tauri::command]
fn terminal_input(session_id: String, data: String, state: State<'_, AppState>) -> Result<()> {
  send_terminal_command(&state, session_id.as_str(), TerminalCommand::Input(data))
}

#[tauri::command]
fn terminal_resize(session_id: String, cols: u32, rows: u32, state: State<'_, AppState>) -> Result<()> {
  send_terminal_command(&state, session_id.as_str(), TerminalCommand::Resize { cols, rows })
}

fn send_terminal_command(state: &State<'_, AppState>, session_id: &str, command: TerminalCommand) -> Result<()> {
  let sessions = state.sessions.lock().map_err(lock_error)?;
  let session = sessions
    .get(session_id)
    .ok_or_else(|| "session not found".to_string())?;
  let tx = session
    .terminal_tx
    .as_ref()
    .ok_or_else(|| "terminal is not open".to_string())?;
  tx.send(command).map_err(to_error)
}

fn run_demo_terminal(app: AppHandle, info: SessionInfo, rx: Receiver<TerminalCommand>) {
  let prompt = format!("\x1b[36m{}\x1b[0m $ ", info.cwd.replace(info.home_dir.as_str(), "~"));
  emit_output(
    &app,
    &info.id,
    format!(
      "\x1b[32mWelcome to Ubuntu 24.04.4 LTS\x1b[0m\r\nLast login: {} from 192.168.0.10\r\n{}",
      Local::now().format("%a %b %d %Y"),
      prompt
    ),
  );

  while let Ok(command) = rx.recv() {
    match command {
      TerminalCommand::Input(data) => {
        emit_output(&app, &info.id, data.clone());
        if data.ends_with('\n') || data.ends_with('\r') {
          thread::sleep(Duration::from_millis(80));
          emit_output(&app, &info.id, format!("\r\n{prompt}"));
        }
      }
      TerminalCommand::Resize { .. } => {}
      TerminalCommand::Close => break,
    }
  }
}

fn run_ssh_terminal(app: AppHandle, info: SessionInfo, ssh: Arc<Mutex<Session>>, rx: Receiver<TerminalCommand>) {
  let mut channel = match ssh.lock().map_err(lock_error).and_then(|ssh| ssh.channel_session().map_err(to_error)) {
    Ok(channel) => channel,
    Err(error) => {
      emit_error(&app, &info.id, error);
      return;
    }
  };

  if let Err(error) = channel.request_pty("xterm-256color", None, Some((120, 34, 0, 0))) {
    emit_error(&app, &info.id, error.to_string());
    return;
  }
  if let Err(error) = channel.shell() {
    emit_error(&app, &info.id, error.to_string());
    return;
  }

  if let Ok(ssh) = ssh.lock() {
    ssh.set_blocking(false);
  }

  let mut buffer = [0_u8; 8192];
  loop {
    match channel.read(&mut buffer) {
      Ok(size) if size > 0 => {
        emit_output(&app, &info.id, String::from_utf8_lossy(&buffer[..size]).to_string());
      }
      Ok(_) => {}
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
      Err(error) => {
        emit_error(&app, &info.id, error.to_string());
        break;
      }
    }

    while let Ok(command) = rx.try_recv() {
      match command {
        TerminalCommand::Input(data) => {
          if let Err(error) = channel.write_all(data.as_bytes()) {
            emit_error(&app, &info.id, error.to_string());
          }
          let _ = channel.flush();
        }
        TerminalCommand::Resize { cols, rows } => {
          let _ = channel.request_pty_size(cols, rows, None, None);
        }
        TerminalCommand::Close => {
          let _ = channel.close();
          return;
        }
      }
    }

    if channel.eof() {
      break;
    }
    thread::sleep(Duration::from_millis(12));
  }
}

fn emit_output(app: &AppHandle, session_id: &str, data: String) {
  let _ = app.emit(
    "terminal-output",
    TerminalOutput {
      session_id: session_id.to_string(),
      data,
    },
  );
}

fn emit_error(app: &AppHandle, session_id: &str, message: String) {
  let _ = app.emit(
    "terminal-error",
    TerminalError {
      session_id: session_id.to_string(),
      message,
    },
  );
}

fn create_demo_session() -> ManagedSession {
  let id = Uuid::new_v4().to_string();
  let home_dir = "/home/fheldtm".to_string();
  let cwd = posix_join(&[home_dir.as_str(), "project"]);
  let info = SessionInfo {
    id,
    mode: "demo".to_string(),
    label: "demo@192.168.0.210".to_string(),
    host: "192.168.0.210".to_string(),
    username: "demo".to_string(),
    home_dir: home_dir.clone(),
    cwd,
    upload_root: posix_join(&[home_dir.as_str(), ".terminal-composer", "uploads"]),
    created_at: now_ms(),
  };
  ManagedSession {
    info,
    kind: SessionKind::Demo,
    terminal_tx: None,
  }
}

fn read_remote_home(ssh: &Session) -> Result<(String, String)> {
  let mut channel = ssh.channel_session().map_err(to_error)?;
  channel
    .exec("printf '__HOME__%s\\n__PWD__%s\\n' \"$HOME\" \"$PWD\"")
    .map_err(to_error)?;
  let mut output = String::new();
  channel.read_to_string(&mut output).map_err(to_error)?;
  channel.wait_close().map_err(to_error)?;

  let home = output
    .lines()
    .find_map(|line| line.strip_prefix("__HOME__"))
    .unwrap_or("/")
    .trim()
    .to_string();
  let cwd = output
    .lines()
    .find_map(|line| line.strip_prefix("__PWD__"))
    .unwrap_or(home.as_str())
    .trim()
    .to_string();
  Ok((home, cwd))
}

fn stat_type(stat: &FileStat) -> String {
  let mode = stat.perm.unwrap_or(0);
  let file_type = mode & libc_mode::S_IFMT;
  if file_type == libc_mode::S_IFDIR {
    "directory"
  } else if file_type == libc_mode::S_IFLNK {
    "symlink"
  } else if file_type == libc_mode::S_IFREG {
    "file"
  } else {
    "other"
  }
  .to_string()
}

fn mkdirp(sftp: &ssh2::Sftp, remote_path: &str) -> Result<()> {
  let mut current = if remote_path.starts_with('/') {
    "/".to_string()
  } else {
    String::new()
  };
  for part in remote_path.split('/').filter(|part| !part.is_empty()) {
    current = if current == "/" {
      format!("/{part}")
    } else {
      posix_join(&[current.as_str(), part])
    };
    match sftp.stat(Path::new(current.as_str())) {
      Ok(_) => {}
      Err(_) => {
        sftp.mkdir(Path::new(current.as_str()), 0o755).map_err(to_error)?;
      }
    }
  }
  Ok(())
}

fn next_available_remote_path(sftp: &ssh2::Sftp, dir: &str, file_name: &str) -> Result<String> {
  let path = Path::new(file_name);
  let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("file");
  let ext = path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| format!(".{value}"))
    .unwrap_or_default();

  for index in 1..10_000 {
    let candidate = if index == 1 {
      posix_join(&[dir, file_name])
    } else {
      posix_join(&[dir, format!("{stem}-{index}{ext}").as_str()])
    };
    if sftp.stat(Path::new(candidate.as_str())).is_err() {
      return Ok(candidate);
    }
  }
  Err("could not allocate a unique upload path".to_string())
}

fn resolve_remote_path(requested_path: &str, home_dir: &str) -> String {
  let expanded = if requested_path.starts_with('~') {
    requested_path.replacen('~', home_dir, 1)
  } else if requested_path.trim().is_empty() {
    home_dir.to_string()
  } else {
    requested_path.to_string()
  };
  let normalized = normalize_posix_path(expanded.as_str());
  if normalized.starts_with(home_dir) {
    normalized
  } else {
    home_dir.to_string()
  }
}

fn normalize_posix_path(path: &str) -> String {
  let absolute = path.starts_with('/');
  let mut stack = Vec::<&str>::new();
  for part in path.split('/') {
    match part {
      "" | "." => {}
      ".." => {
        stack.pop();
      }
      value => stack.push(value),
    }
  }
  let joined = stack.join("/");
  if absolute {
    format!("/{joined}")
  } else {
    joined
  }
}

fn posix_join(parts: &[&str]) -> String {
  let mut out = String::new();
  for part in parts {
    if part.is_empty() {
      continue;
    }
    if out.is_empty() {
      out.push_str(part.trim_end_matches('/'));
    } else {
      out.push('/');
      out.push_str(part.trim_matches('/'));
    }
  }
  if out.is_empty() {
    "/".to_string()
  } else {
    normalize_posix_path(out.as_str())
  }
}

fn sanitize_file_name(file_name: &str) -> String {
  let base = Path::new(file_name)
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("file");
  let cleaned = base
    .chars()
    .map(|ch| match ch {
      '\u{0}'..='\u{1f}' | '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*' => '_',
      value => value,
    })
    .collect::<String>()
    .trim()
    .to_string();
  if cleaned.is_empty() {
    "file".to_string()
  } else {
    cleaned
  }
}

fn sort_remote_files(a: &RemoteFile, b: &RemoteFile) -> std::cmp::Ordering {
  match (a.file_type.as_str(), b.file_type.as_str()) {
    ("directory", "directory") => a.name.cmp(&b.name),
    ("directory", _) => std::cmp::Ordering::Less,
    (_, "directory") => std::cmp::Ordering::Greater,
    _ => a.name.cmp(&b.name),
  }
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64
}

fn to_error(error: impl std::fmt::Display) -> String {
  error.to_string()
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
  error.to_string()
}

fn list_demo_files(target_path: &str) -> Vec<RemoteFile> {
  let home = "/home/fheldtm";
  let project = "/home/fheldtm/project";
  let now = now_ms();
  let mut files = match target_path {
    path if path == project => vec![
      directory(".terminal-composer", project, now - 300_000),
      directory("components", project, now - 3_700_000),
      directory("server", project, now - 2_700_000),
      directory("src", project, now - 4_000_000),
      directory("uploads", project, now - 1_700_000),
      file("package.json", project, 4096, now - 900_000),
      file("README.md", project, 9200, now - 800_000),
      file("terminal-session.log", project, 18_432, now - 600_000),
    ],
    path if path == home => vec![
      directory("project", home, now - 500_000),
      directory(".ssh", home, now - 700_000),
      directory("Downloads", home, now - 800_000),
    ],
    path if path == "/home/fheldtm/project/uploads" => vec![
      file("screen.png", path, 607_976, now - 300_000),
      file("server.log", path, 18_432, now - 250_000),
    ],
    _ => vec![],
  };
  files.sort_by(sort_remote_files);
  files
}

fn directory(name: &str, parent: &str, modified_at: u64) -> RemoteFile {
  RemoteFile {
    name: name.to_string(),
    path: posix_join(&[parent, name]),
    file_type: "directory".to_string(),
    size: 0,
    modified_at,
  }
}

fn file(name: &str, parent: &str, size: u64, modified_at: u64) -> RemoteFile {
  RemoteFile {
    name: name.to_string(),
    path: posix_join(&[parent, name]),
    file_type: "file".to_string(),
    size,
    modified_at,
  }
}

mod libc_mode {
  pub const S_IFMT: u32 = 0o170000;
  pub const S_IFDIR: u32 = 0o040000;
  pub const S_IFREG: u32 = 0o100000;
  pub const S_IFLNK: u32 = 0o120000;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      create_session,
      disconnect_session,
      list_files,
      upload_files,
      terminal_open,
      terminal_input,
      terminal_resize
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
