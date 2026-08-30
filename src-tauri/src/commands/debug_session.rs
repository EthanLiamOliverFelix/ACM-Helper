use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::data_center;

#[derive(Default)]
pub struct DebugSessions(Mutex<HashMap<String, DebugSession>>);

struct DebugSession {
    adapter: String,
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    program_stdout: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariable {
    name: String,
    value: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionState {
    session_id: String,
    adapter: String,
    active: bool,
    paused: bool,
    line: Option<u32>,
    function: String,
    variables: Vec<DebugVariable>,
    watches: Vec<DebugVariable>,
    stdout: String,
    stderr: String,
    message: String,
}

const PYTHON_INTERACTIVE_DEBUGGER: &str = r#"import io, json, runpy, sys, traceback
source, input_path, raw_lines = sys.argv[1], sys.argv[2], sys.argv[3]
breakpoints = {int(x) for x in raw_lines.split(',') if x}
controller_in, controller_out = sys.stdin, sys.stdout
program_out, program_err = io.StringIO(), io.StringIO()
mode, target_frame, target_depth = 'continue', None, 0
first_line = True

class DebugQuit(BaseException): pass

def safe_repr(value):
    try:
        text = repr(value)
        return text if len(text) <= 500 else text[:500] + '…'
    except Exception as exc: return '<repr failed: %s>' % exc

def depth(frame):
    count = 0
    while frame is not None: count, frame = count + 1, frame.f_back
    return count

def snapshot(frame, watches, active=True, error=''):
    watched = {}
    if frame is not None:
        for expression in watches:
            try: watched[expression] = {'value': safe_repr(eval(expression, frame.f_globals, frame.f_locals))}
            except Exception as exc: watched[expression] = {'value': '', 'error': str(exc)}
    body = {
        'active': active, 'paused': active, 'line': frame.f_lineno if frame else None,
        'function': frame.f_code.co_name if frame else '',
        'variables': {key: safe_repr(value) for key, value in (frame.f_locals.items() if frame else []) if not key.startswith('__')},
        'watches': watched, 'stdout': program_out.getvalue(), 'stderr': program_err.getvalue(), 'error': error,
    }
    controller_out.write(json.dumps(body, ensure_ascii=True) + '\n'); controller_out.flush()

def wait_command(frame):
    global mode, target_frame, target_depth
    while True:
        raw = controller_in.readline()
        if not raw: raise DebugQuit()
        command = json.loads(raw)
        action, watches = command.get('action', 'continue'), command.get('watches', [])
        if action == 'stop': raise DebugQuit()
        if action == 'inspect': snapshot(frame, watches); continue
        mode = action
        target_frame, target_depth = frame, depth(frame)
        return

def tracer(frame, event, arg):
    global first_line
    if frame.f_code.co_filename != source: return tracer
    current_depth = depth(frame)
    should_stop = False
    if event == 'line':
        if mode == 'step': should_stop = True
        elif mode == 'next': should_stop = frame is target_frame or current_depth < target_depth
        elif mode == 'finish': should_stop = current_depth < target_depth
        elif mode == 'continue': should_stop = frame.f_lineno in breakpoints or (first_line and not breakpoints)
        first_line = False
    if should_stop:
        snapshot(frame, [])
        wait_command(frame)
    return tracer

error = ''
try:
    sys.stdin = open(input_path, 'r', encoding='utf-8')
    sys.stdout, sys.stderr = program_out, program_err
    sys.settrace(tracer)
    runpy.run_path(source, run_name='__main__')
except DebugQuit: pass
except SystemExit as exc:
    if exc.code not in (None, 0): error = 'Program exited with %s' % exc.code
except BaseException: error = traceback.format_exc()
finally:
    sys.settrace(None)
    sys.stdin, sys.stdout, sys.stderr = controller_in, controller_out, sys.__stderr__
    snapshot(None, [], False, error)
"#;

fn session_id() -> String {
    format!(
        "debug-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0)
    )
}

fn configure_hidden(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000);
}

async fn command_output(mut command: Command) -> Result<std::process::Output, String> {
    configure_hidden(&mut command);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "编译超时".to_string())?
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "未找到对应的编译器或调试器，请检查 PATH".to_string()
            } else {
                format!("启动编译器失败: {}", error)
            }
        })
}

async fn spawn_session(mut command: Command, adapter: &str) -> Result<DebugSession, String> {
    configure_hidden(&mut command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("未找到 {}，请安装并加入 PATH", adapter)
        } else {
            format!("启动 {} 失败: {}", adapter, error)
        }
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接调试器输入".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法连接调试器输出".to_string())?;
    Ok(DebugSession {
        adapter: adapter.into(),
        child,
        stdin,
        stdout: BufReader::new(stdout).lines(),
        program_stdout: String::new(),
    })
}

async fn write_command(session: &mut DebugSession, command: &str) -> Result<(), String> {
    session
        .stdin
        .write_all(format!("{}\n", command).as_bytes())
        .await
        .map_err(|error| format!("向调试器发送命令失败: {}", error))?;
    session
        .stdin
        .flush()
        .await
        .map_err(|error| error.to_string())
}

async fn read_line(session: &mut DebugSession, wait: Duration) -> Result<String, String> {
    timeout(wait, session.stdout.next_line())
        .await
        .map_err(|_| "等待调试器响应超时".to_string())?
        .map_err(|error| format!("读取调试器响应失败: {}", error))?
        .ok_or_else(|| "调试器已退出".to_string())
}

async fn gdb_until_prompt(session: &mut DebugSession) -> Result<String, String> {
    let mut output = String::new();
    loop {
        let line = read_line(session, Duration::from_secs(10)).await?;
        if line.trim() == "(gdb)" {
            break;
        }
        output.push_str(&line);
        output.push('\n');
    }
    Ok(output)
}

async fn gdb_command(session: &mut DebugSession, command: &str) -> Result<String, String> {
    write_command(session, command).await?;
    gdb_until_prompt(session).await
}

async fn gdb_execute(session: &mut DebugSession, command: &str) -> Result<String, String> {
    write_command(session, command).await?;
    let mut output = String::new();
    let mut stopped = false;
    loop {
        let line = read_line(session, Duration::from_secs(30)).await?;
        if let Some(text) = mi_stream_text(&line) {
            if line.starts_with('@') {
                session.program_stdout.push_str(&text);
            }
        }
        if line.starts_with("*stopped") || line.starts_with("^error") {
            stopped = true;
        }
        if stopped && line.trim() == "(gdb)" {
            break;
        }
        output.push_str(&line);
        output.push('\n');
    }
    Ok(output)
}

fn mi_stream_text(line: &str) -> Option<String> {
    if !(line.starts_with('~') || line.starts_with('@') || line.starts_with('&')) {
        return None;
    }
    serde_json::from_str::<String>(&line[1..]).ok()
}

fn capture_field(text: &str, field: &str) -> Option<String> {
    let marker = format!("{}=\"", field);
    let start = text.rfind(&marker)? + marker.len();
    let mut escaped = false;
    let mut end = start;
    for (offset, character) in text[start..].char_indices() {
        if character == '"' && !escaped {
            end = start + offset;
            break;
        }
        escaped = character == '\\' && !escaped;
        if character != '\\' {
            escaped = false;
        }
    }
    serde_json::from_str::<String>(&format!("\"{}\"", &text[start..end])).ok()
}

fn parse_gdb_variables(text: &str) -> Vec<DebugVariable> {
    let mut result = Vec::new();
    let mut rest = text;
    while let Some(name_at) = rest.find("name=\"") {
        rest = &rest[name_at..];
        let Some(name) = capture_field(rest, "name") else {
            break;
        };
        let value = capture_field(rest, "value").unwrap_or_else(|| "<不可用>".into());
        result.push(DebugVariable {
            name,
            value,
            error: None,
        });
        rest = &rest[6..];
    }
    result
}

async fn inspect_gdb(
    session_id: &str,
    session: &mut DebugSession,
    execution: &str,
    watches: &[String],
) -> Result<DebugSessionState, String> {
    let active = !execution.contains("reason=\"exited") && !execution.contains("exited-normally");
    if !active {
        return Ok(DebugSessionState {
            session_id: session_id.into(),
            adapter: session.adapter.clone(),
            active: false,
            paused: false,
            line: None,
            function: String::new(),
            variables: Vec::new(),
            watches: Vec::new(),
            stdout: session.program_stdout.clone(),
            stderr: String::new(),
            message: "程序已结束".into(),
        });
    }
    let frame = gdb_command(session, "-stack-info-frame")
        .await
        .unwrap_or_default();
    let variables_raw = gdb_command(session, "-stack-list-variables --simple-values")
        .await
        .unwrap_or_default();
    let mut watched = Vec::new();
    for expression in watches {
        let quoted = serde_json::to_string(expression).unwrap_or_else(|_| "\"\"".into());
        match gdb_command(session, &format!("-data-evaluate-expression {}", quoted)).await {
            Ok(value) if value.starts_with("^done") => watched.push(DebugVariable {
                name: expression.clone(),
                value: capture_field(&value, "value").unwrap_or_default(),
                error: None,
            }),
            Ok(value) => watched.push(DebugVariable {
                name: expression.clone(),
                value: String::new(),
                error: capture_field(&value, "msg").or(Some("表达式不可用".into())),
            }),
            Err(error) => watched.push(DebugVariable {
                name: expression.clone(),
                value: String::new(),
                error: Some(error),
            }),
        }
    }
    Ok(DebugSessionState {
        session_id: session_id.into(),
        adapter: session.adapter.clone(),
        active: true,
        paused: true,
        line: capture_field(&frame, "line").and_then(|value| value.parse().ok()),
        function: capture_field(&frame, "func").unwrap_or_default(),
        variables: parse_gdb_variables(&variables_raw),
        watches: watched,
        stdout: session.program_stdout.clone(),
        stderr: String::new(),
        message: "已暂停".into(),
    })
}

fn python_state(session_id: &str, adapter: &str, line: &str) -> Result<DebugSessionState, String> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| format!("解析 Python 调试状态失败: {}", error))?;
    let variables = value
        .get("variables")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(name, value)| DebugVariable {
            name: name.clone(),
            value: value.as_str().unwrap_or("").into(),
            error: None,
        })
        .collect();
    let watches = value
        .get("watches")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(name, item)| DebugVariable {
            name: name.clone(),
            value: item
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
            error: item
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect();
    let active = value
        .get("active")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(DebugSessionState {
        session_id: session_id.into(),
        adapter: adapter.into(),
        active,
        paused: value
            .get("paused")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        line: value
            .get("line")
            .and_then(Value::as_u64)
            .map(|line| line as u32),
        function: value
            .get("function")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        variables,
        watches,
        stdout: value
            .get("stdout")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        stderr: value
            .get("stderr")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        message: value
            .get("error")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .unwrap_or(if active {
                "已暂停"
            } else {
                "程序已结束"
            })
            .into(),
    })
}

#[tauri::command]
pub async fn start_debug_session(
    app: AppHandle,
    sessions: State<'_, DebugSessions>,
    language: String,
    code: String,
    input: String,
    breakpoints: Vec<u32>,
    watches: Vec<String>,
) -> Result<DebugSessionState, String> {
    if language != "cpp" && language != "python" {
        return Err("交互式调试当前支持 C++ 和 Python；Java 交互调试将在后续接入 JDB 会话".into());
    }
    let id = session_id();
    let workdir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位调试缓存: {}", error))?
        .join("interactive-debug")
        .join(&id);
    tokio::fs::create_dir_all(&workdir)
        .await
        .map_err(|error| format!("创建调试缓存失败: {}", error))?;
    let input_path = workdir.join("debug-input.txt");
    tokio::fs::write(&input_path, input)
        .await
        .map_err(|error| format!("写入调试输入失败: {}", error))?;

    let (mut session, execution) = if language == "cpp" {
        let source = workdir.join("main.cpp");
        let executable = workdir.join("debug-main.exe");
        tokio::fs::write(&source, code)
            .await
            .map_err(|error| format!("准备源码失败: {}", error))?;
        let mut compile = Command::new(data_center::tool_command(&app, "cppCompiler", "g++"));
        compile
            .args(["-std=c++17", "-g", "-O0", "-fno-omit-frame-pointer"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .current_dir(&workdir);
        let output = command_output(compile).await?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let mut gdb = Command::new(data_center::tool_command(&app, "cppDebugger", "gdb"));
        gdb.args(["--interpreter=mi2", "--quiet"])
            .current_dir(&workdir);
        let mut session = spawn_session(gdb, "gdb").await?;
        gdb_until_prompt(&mut session).await?;
        gdb_command(&mut session, "-gdb-set pagination off").await?;
        gdb_command(&mut session, "-file-exec-and-symbols \"debug-main.exe\"").await?;
        if breakpoints.is_empty() {
            gdb_command(&mut session, "-break-insert main").await?;
        } else {
            for line in &breakpoints {
                gdb_command(&mut session, &format!("-break-insert main.cpp:{}", line)).await?;
            }
        }
        let execution = gdb_execute(
            &mut session,
            "-interpreter-exec console \"run < debug-input.txt\"",
        )
        .await?;
        (session, execution)
    } else {
        let source = workdir.join("main.py");
        let runner = workdir.join("debug-controller.py");
        tokio::fs::write(&source, code)
            .await
            .map_err(|error| format!("准备源码失败: {}", error))?;
        tokio::fs::write(&runner, PYTHON_INTERACTIVE_DEBUGGER)
            .await
            .map_err(|error| format!("准备 Python 调试器失败: {}", error))?;
        let lines = breakpoints
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut python = Command::new(data_center::tool_command(
            &app,
            "pythonInterpreter",
            "python",
        ));
        python
            .arg("-u")
            .arg(&runner)
            .arg(&source)
            .arg(&input_path)
            .arg(lines)
            .current_dir(&workdir);
        let mut session = spawn_session(python, "python-trace").await?;
        let execution = read_line(&mut session, Duration::from_secs(30)).await?;
        (session, execution)
    };

    let state = if language == "cpp" {
        inspect_gdb(&id, &mut session, &execution, &watches).await?
    } else {
        let mut state = python_state(&id, &session.adapter, &execution)?;
        if state.active && !watches.is_empty() {
            write_command(
                &mut session,
                &serde_json::json!({"action":"inspect","watches":watches}).to_string(),
            )
            .await?;
            let adapter = session.adapter.clone();
            let response = read_line(&mut session, Duration::from_secs(10)).await?;
            state = python_state(&id, &adapter, &response)?;
        }
        state
    };
    sessions.0.lock().await.insert(id, session);
    Ok(state)
}

#[tauri::command]
pub async fn debug_session_action(
    sessions: State<'_, DebugSessions>,
    session_id: String,
    action: String,
    watches: Vec<String>,
) -> Result<DebugSessionState, String> {
    let mut sessions = sessions.0.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "调试会话不存在或已经结束".to_string())?;
    if session.adapter == "gdb" {
        if action == "inspect" {
            return inspect_gdb(&session_id, session, "", &watches).await;
        }
        let command = match action.as_str() {
            "continue" => "-exec-continue",
            "next" => "-exec-next",
            "step" => "-exec-step",
            "finish" => "-exec-finish",
            _ => return Err("未知调试操作".into()),
        };
        let execution = gdb_execute(session, command).await?;
        inspect_gdb(&session_id, session, &execution, &watches).await
    } else {
        write_command(
            session,
            &serde_json::json!({"action":action,"watches":watches}).to_string(),
        )
        .await?;
        let line = read_line(session, Duration::from_secs(30)).await?;
        python_state(&session_id, &session.adapter, &line)
    }
}

#[tauri::command]
pub async fn stop_debug_session(
    sessions: State<'_, DebugSessions>,
    session_id: String,
) -> Result<(), String> {
    let mut session = sessions.0.lock().await.remove(&session_id);
    if let Some(ref mut session) = session {
        if session.adapter == "python-trace" {
            let _ = write_command(session, "{\"action\":\"stop\",\"watches\":[]}").await;
        } else {
            let _ = write_command(session, "-gdb-exit").await;
        }
        let _ = session.child.kill().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("acm-helper-{}-{}", name, session_id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn interactive_python_steps_and_watches_expression() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let dir = test_dir("python-session");
            let source = dir.join("main.py");
            let input = dir.join("input.txt");
            let runner = dir.join("controller.py");
            fs::write(&source, "a = 1\nb = 2\nc = a + b\nprint(c)\n").unwrap();
            fs::write(&input, "").unwrap();
            fs::write(&runner, PYTHON_INTERACTIVE_DEBUGGER).unwrap();
            let mut command = Command::new("python");
            command
                .arg("-u")
                .arg(&runner)
                .arg(&source)
                .arg(&input)
                .arg("3")
                .current_dir(&dir);
            let mut session = spawn_session(command, "python-trace").await.unwrap();
            let first = read_line(&mut session, Duration::from_secs(10))
                .await
                .unwrap();
            let state = python_state("test", "python-trace", &first).unwrap();
            assert_eq!(state.line, Some(3));
            write_command(&mut session, r#"{"action":"inspect","watches":["a + b"]}"#)
                .await
                .unwrap();
            let inspected = read_line(&mut session, Duration::from_secs(10))
                .await
                .unwrap();
            let state = python_state("test", "python-trace", &inspected).unwrap();
            assert_eq!(state.watches[0].value, "3");
            write_command(&mut session, r#"{"action":"next","watches":[]}"#)
                .await
                .unwrap();
            let next = read_line(&mut session, Duration::from_secs(10))
                .await
                .unwrap();
            let state = python_state("test", "python-trace", &next).unwrap();
            assert_eq!(state.line, Some(4));
            assert!(state
                .variables
                .iter()
                .any(|item| item.name == "c" && item.value == "3"));
            let _ = session.child.kill().await;
            let _ = fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn interactive_gdb_steps_and_watches_expression() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let dir = test_dir("gdb-session");
            let source = dir.join("main.cpp");
            let executable = dir.join("debug-main.exe");
            let input = dir.join("debug-input.txt");
            fs::write(&source, "#include <iostream>\nint main() {\n int a = 2;\n int b = 3;\n int c = a + b;\n std::cout << c << '\\n';\n return 0;\n}\n").unwrap();
            fs::write(&input, "").unwrap();
            let mut compile = Command::new("g++");
            compile.args(["-g", "-O0"]).arg(&source).arg("-o").arg(&executable);
            assert!(command_output(compile).await.unwrap().status.success());
            let mut command = Command::new("gdb");
            command.args(["--interpreter=mi2", "--quiet"]).current_dir(&dir);
            let mut session = spawn_session(command, "gdb").await.unwrap();
            gdb_until_prompt(&mut session).await.unwrap();
            gdb_command(&mut session, "-file-exec-and-symbols \"debug-main.exe\"").await.unwrap();
            gdb_command(&mut session, "-break-insert main.cpp:5").await.unwrap();
            let execution = gdb_execute(&mut session, "-interpreter-exec console \"run < debug-input.txt\"").await.unwrap();
            let state = inspect_gdb("test", &mut session, &execution, &["a + b".into()]).await.unwrap();
            assert_eq!(state.line, Some(5));
            assert_eq!(state.watches[0].value, "5");
            let execution = gdb_execute(&mut session, "-exec-next").await.unwrap();
            let state = inspect_gdb("test", &mut session, &execution, &["c".into()]).await.unwrap();
            assert_eq!(state.line, Some(6));
            assert_eq!(state.watches[0].value, "5");
            let _ = session.child.kill().await;
            let _ = fs::remove_dir_all(dir);
        });
    }
}
