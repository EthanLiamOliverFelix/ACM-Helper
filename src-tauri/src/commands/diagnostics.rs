use super::data_center;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use tauri::AppHandle;

const DIAGNOSTIC_DIRECTORY: &str = "diagnostics";
const OJ_LOG_FILE: &str = "oj-events.jsonl";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OjDiagnosticEntry {
    timestamp: u64,
    platform: String,
    operation: String,
    status: String,
    duration_ms: u64,
    message: String,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize(value: &str) -> String {
    let mut text = value.chars().take(2000).collect::<String>();
    if let Ok(regex) = Regex::new(r"(?i)bearer\s+[a-z0-9._~+/-]+") {
        text = regex.replace_all(&text, "Bearer [REDACTED]").into_owned();
    }
    for pattern in [
        r"(?i)(cookie|authorization|api[-_ ]?key|token|captcha)\s*[:=]\s*[^\s,;]+",
        r#"(?i)\"(cookie|authorization|token|apiKey)\"\s*:\s*\"[^\"]+\""#,
    ] {
        if let Ok(regex) = Regex::new(pattern) {
            text = regex.replace_all(&text, "$1=[REDACTED]").into_owned();
        }
    }
    text
}

fn log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_center::root(app)?
        .join(DIAGNOSTIC_DIRECTORY)
        .join(OJ_LOG_FILE))
}

fn append(app: &AppHandle, entry: &OjDiagnosticEntry) -> Result<(), String> {
    let path = log_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建诊断目录失败: {error}"))?;
    }
    if fs::metadata(&path).map(|value| value.len()).unwrap_or(0) > MAX_LOG_BYTES {
        let previous = path.with_extension("previous.jsonl");
        let _ = fs::remove_file(&previous);
        fs::rename(&path, previous).map_err(|error| format!("轮换诊断日志失败: {error}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("打开诊断日志失败: {error}"))?;
    let json =
        serde_json::to_string(entry).map_err(|error| format!("序列化诊断记录失败: {error}"))?;
    writeln!(file, "{json}").map_err(|error| format!("写入诊断日志失败: {error}"))
}

#[tauri::command]
pub async fn record_oj_diagnostic(
    app: AppHandle,
    platform: String,
    operation: String,
    status: String,
    duration_ms: u64,
    message: Option<String>,
) -> Result<(), String> {
    let entry = OjDiagnosticEntry {
        timestamp: now_ms(),
        platform: sanitize(&platform),
        operation: sanitize(&operation),
        status: sanitize(&status),
        duration_ms,
        message: sanitize(message.as_deref().unwrap_or("")),
    };
    tauri::async_runtime::spawn_blocking(move || append(&app, &entry))
        .await
        .map_err(|error| format!("诊断记录任务失败: {error}"))?
}

#[tauri::command]
pub async fn get_oj_diagnostics(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<OjDiagnosticEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = log_path(&app)?;
        let content = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("读取诊断日志失败: {error}")),
        };
        let mut entries = content
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect::<Vec<_>>();
        let keep = limit.unwrap_or(100).clamp(1, 1000);
        if entries.len() > keep {
            entries.drain(0..entries.len() - keep);
        }
        entries.reverse();
        Ok(entries)
    })
    .await
    .map_err(|error| format!("读取诊断任务失败: {error}"))?
}

#[tauri::command]
pub async fn export_oj_diagnostics(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = rfd::FileDialog::new()
            .set_title("导出 OJ 诊断日志")
            .set_file_name("acm-helper-oj-diagnostics.jsonl")
            .save_file()
        else {
            return Ok(None);
        };
        let source = log_path(&app)?;
        let content = fs::read(&source).unwrap_or_default();
        fs::write(&target, content).map_err(|error| format!("导出诊断日志失败: {error}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("导出诊断任务失败: {error}"))?
}

#[tauri::command]
pub async fn clear_oj_diagnostics(app: AppHandle) -> Result<(), String> {
    let path = log_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("清理诊断日志失败: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_common_secrets() {
        let value = sanitize("Authorization: Bearer abc.def Cookie=session123 apiKey=secret");
        assert!(!value.contains("abc.def"));
        assert!(!value.contains("session123"));
        assert!(!value.contains("secret"));
    }
}
