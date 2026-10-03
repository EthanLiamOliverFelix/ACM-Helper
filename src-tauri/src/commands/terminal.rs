use super::{data_center, workspace};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, AppHandle, State, Window};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.killer.kill();
    }
}
#[derive(Default)]
pub struct TerminalSessions(Arc<Mutex<HashMap<u64, Session>>>);
impl Drop for TerminalSessions {
    fn drop(&mut self) {
        let removed = self
            .0
            .lock()
            .ok()
            .map(|mut sessions| std::mem::take(&mut *sessions));
        drop(removed);
    }
}
#[derive(Clone, Serialize)]
pub struct TerminalOutput {
    data: Vec<u8>,
    exited: bool,
}
#[derive(Serialize)]
pub struct TerminalInfo {
    id: u64,
    directory: String,
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
fn main_window(window: &Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("终端只允许在主窗口使用".into())
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(2, 500),
        rows: rows.clamp(2, 300),
        pixel_width: 0,
        pixel_height: 0,
    }
}

type Shell = (Session, Box<dyn Read + Send>, Box<dyn Child + Send + Sync>);
fn open_shell(directory: &std::path::Path, cols: u16, rows: u16) -> Result<Shell, String> {
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut command = {
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoProfile", "-NoExit", "-Command", "[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $OutputEncoding = [Console]::OutputEncoding"]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command =
            CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()));
        command.arg("-i");
        command
    };
    command.cwd(&directory);
    command.env("TERM", "xterm-256color");
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    drop(pair.slave);
    Ok((
        Session {
            master: pair.master,
            writer,
            killer,
        },
        reader,
        child,
    ))
}

#[tauri::command]
pub async fn start_terminal(
    app: AppHandle,
    window: Window,
    sessions: State<'_, TerminalSessions>,
    path: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<TerminalOutput>,
) -> Result<TerminalInfo, String> {
    main_window(&window)?;
    let directory = workspace::terminal_directory(&app, path.as_deref())?;
    let mut registry = sessions.0.lock().map_err(|e| e.to_string())?;
    if registry.len() >= 32 {
        return Err("最多同时打开 32 个终端，请先关闭一个终端".into());
    }
    let (session, mut reader, mut child) = open_shell(&directory, cols, rows)?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    registry.insert(id, session);
    let registry = sessions.0.clone();
    let waiting_registry = sessions.0.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let removed = waiting_registry
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&id));
        drop(removed);
    });
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if output
                .send(TerminalOutput {
                    data: buffer[..count].to_vec(),
                    exited: false,
                })
                .is_err()
            {
                break;
            }
        }
        let removed = registry
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&id));
        drop(removed);
        let _ = output.send(TerminalOutput {
            data: vec![],
            exited: true,
        });
    });
    Ok(TerminalInfo {
        id,
        directory: directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn write_terminal(
    window: Window,
    sessions: State<'_, TerminalSessions>,
    id: u64,
    data: String,
) -> Result<(), String> {
    main_window(&window)?;
    if data.len() > 1024 * 1024 {
        return Err("一次输入不能超过 1 MB".into());
    }
    let mut sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("终端已结束")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn resize_terminal(
    window: Window,
    sessions: State<'_, TerminalSessions>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    main_window(&window)?;
    let sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    sessions
        .get(&id)
        .ok_or("终端已结束")?
        .master
        .resize(size(cols, rows))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn close_terminal(
    window: Window,
    sessions: State<'_, TerminalSessions>,
    id: u64,
) -> Result<(), String> {
    main_window(&window)?;
    let removed = sessions.0.lock().map_err(|e| e.to_string())?.remove(&id);
    drop(removed);
    Ok(())
}

fn quote(value: &str) -> String {
    #[cfg(windows)]
    {
        format!("'{}'", value.replace('\'', "''"))
    }
    #[cfg(not(windows))]
    {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}
#[tauri::command]
pub async fn terminal_run_command(
    app: AppHandle,
    window: Window,
    path: String,
    language: String,
    action: String,
) -> Result<String, String> {
    main_window(&window)?;
    if !matches!(action.as_str(), "run" | "compile-run" | "compile") { return Err("无效的运行方式".into()); }
    let run = action == "compile-run";
    let directory_path = workspace::terminal_directory(&app, Some(&path))?;
    let source = std::path::Path::new(&path);
    let source =
        data_center::portable_path(&std::fs::canonicalize(source).map_err(|e| e.to_string())?);
    let source_text = source.to_string_lossy();
    let directory = quote(&directory_path.to_string_lossy());
    #[cfg(windows)]
    let (prefix, invoke, success) = (
        format!("Set-Location -LiteralPath {}; ", directory),
        "& ",
        "; if ($LASTEXITCODE -eq 0) { ",
    );
    #[cfg(not(windows))]
    let (prefix, invoke, success) = (format!("cd -- {} && ", directory), "", " && ");
    let command = match language.as_str() {
        "cpp" => {
            let executable = source.with_extension(if cfg!(windows) { "exe" } else { "out" });
            let compile = format!(
                "{}{} {} -O2 {} -o {}",
                invoke,
                quote(&data_center::tool_command(&app, "cppCompiler", "g++")),
                data_center::cpp_standard_flag(&app),
                quote(&source_text),
                quote(&executable.to_string_lossy())
            );
            if action == "run" {
                if !executable.is_file() { return Err("尚未找到可执行文件，请先选择编译后运行".into()); }
                format!("{}{}", invoke, quote(&executable.to_string_lossy()))
            } else if run {
                format!(
                    "{}{}{}{}{}",
                    compile,
                    success,
                    invoke,
                    quote(&executable.to_string_lossy()),
                    if cfg!(windows) { " }" } else { "" }
                )
            } else {
                compile
            }
        }
        "python" => format!(
            "{}{} {}",
            invoke,
            quote(&data_center::tool_command(
                &app,
                "pythonInterpreter",
                "python"
            )),
            quote(&source_text)
        ),
        "java" => {
            let text = std::fs::read_to_string(&source).map_err(|e| e.to_string())?;
            let class = regex::Regex::new(
                r"\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)",
            )
            .unwrap()
            .captures(&text)
            .map(|capture| capture[1].to_string())
            .or_else(|| {
                regex::Regex::new(r"\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)")
                    .unwrap()
                    .captures(&text)
                    .map(|capture| capture[1].to_string())
            })
            .unwrap_or_else(|| {
                source
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            let java_source = if action != "run" && source.file_stem().unwrap_or_default() != class.as_str() {
                let prepared = directory_path.join(".acm-terminal");
                std::fs::create_dir_all(&prepared).map_err(|e| e.to_string())?;
                let prepared = prepared.join(format!("{}.java", class));
                std::fs::write(&prepared, &text).map_err(|e| e.to_string())?;
                prepared
            } else {
                source.clone()
            };
            let compile = format!(
                "{}{} -encoding UTF-8 -d {} {}",
                invoke,
                quote(&data_center::tool_command(&app, "javaCompiler", "javac")),
                directory,
                quote(&java_source.to_string_lossy())
            );
            let launch_class =
                regex::Regex::new(r"(?m)^\s*package\s+([A-Za-z_$][A-Za-z0-9_$.]*)\s*;")
                    .unwrap()
                    .captures(&text)
                    .map(|capture| format!("{}.{}", &capture[1], class))
                    .unwrap_or_else(|| class.clone());
            if action == "run" {
                format!("{}{} -cp {} {}", invoke, quote(&data_center::tool_command(&app, "javaRuntime", "java")), directory, quote(&launch_class))
            } else if run {
                format!(
                    "{}{}{}{} -cp {} {}{}",
                    compile,
                    success,
                    invoke,
                    quote(&data_center::tool_command(&app, "javaRuntime", "java")),
                    directory,
                    quote(&launch_class),
                    if cfg!(windows) { " }" } else { "" }
                )
            } else {
                compile
            }
        }
        _ => return Err("该语言暂不支持一键编译运行".into()),
    };
    Ok(format!("{}{}\r", prefix, command))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_quoting_keeps_metacharacters_literal() {
        let quoted = quote("F:/题目/it's $name; main.cpp");
        assert!(quoted.starts_with('\''));
        #[cfg(windows)]
        assert_eq!(quoted, "'F:/题目/it''s $name; main.cpp'");
        assert_eq!(size(0, u16::MAX).cols, 2);
        assert_eq!(size(0, u16::MAX).rows, 300);
    }

    #[test]
    #[cfg(windows)]
    fn real_terminal_accepts_unicode_input_resizes_and_interrupts() {
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };
        let directory = std::env::temp_dir().join(format!(
            "acm-terminal-中文-{}",
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let (mut session, mut reader, mut child) = open_shell(&directory, 80, 24).unwrap();
        let (sender, receiver) = mpsc::channel();
        let reading = std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                if sender.send(buffer[..count].to_vec()).is_err() {
                    break;
                }
            }
        });
        let mut output = Vec::new();
        fn until(
            receiver: &mpsc::Receiver<Vec<u8>>,
            output: &mut Vec<u8>,
            writer: &mut dyn Write,
            needle: &str,
        ) {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut answered = output
                .windows(4)
                .filter(|window| *window == b"\x1b[6n")
                .count();
            while !String::from_utf8_lossy(output).contains(needle) {
                let data = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap_or_else(|error| panic!("terminal output timed out waiting for {needle:?}: {error:?}; output={:?}", String::from_utf8_lossy(output)));
                output.extend(data);
                let requests = output
                    .windows(4)
                    .filter(|window| *window == b"\x1b[6n")
                    .count();
                for _ in answered..requests {
                    writer.write_all(b"\x1b[1;1R").unwrap();
                    writer.flush().unwrap();
                }
                answered = requests;
            }
        }
        session.master.resize(size(120, 40)).unwrap();
        until(&receiver, &mut output, &mut *session.writer, "PS ");
        session
            .writer
            .write_all("$value = Read-Host '输入'; Write-Output ('收到:' + $value)\r".as_bytes())
            .unwrap();
        session.writer.flush().unwrap();
        until(&receiver, &mut output, &mut *session.writer, "输入: ");
        session.writer.write_all("你好终端\r".as_bytes()).unwrap();
        session.writer.flush().unwrap();
        until(
            &receiver,
            &mut output,
            &mut *session.writer,
            "收到:你好终端",
        );
        assert!(String::from_utf8_lossy(&output).contains(&directory.to_string_lossy().to_string()));
        session
            .writer
            .write_all(b"Write-Output 'START-SLEEP'; Start-Sleep -Seconds 60\r")
            .unwrap();
        session.writer.flush().unwrap();
        until(
            &receiver,
            &mut output,
            &mut *session.writer,
            "START-SLEEP\r\n",
        );
        output.clear();
        session.writer.write_all(b"\x03").unwrap();
        session.writer.flush().unwrap();
        until(&receiver, &mut output, &mut *session.writer, "PS ");
        session
            .writer
            .write_all(b"Write-Output ('INTERRUPT' + '-OK')\r")
            .unwrap();
        session.writer.flush().unwrap();
        until(&receiver, &mut output, &mut *session.writer, "INTERRUPT-OK");
        session.writer.write_all(b"exit\r").unwrap();
        session.writer.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(session);
        while let Ok(bytes) = receiver.recv_timeout(Duration::from_secs(3)) {
            output.extend(bytes);
        }
        reading.join().unwrap();
        assert!(std::fs::canonicalize(&directory)
            .unwrap()
            .starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
