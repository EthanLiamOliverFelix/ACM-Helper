use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::time::{timeout, Duration};

use super::data_center;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    success: bool,
    stdout: String,
    stderr: String,
    compile_failed: bool,
    exit_code: Option<i32>,
    duration_ms: u128,
    compile_duration_ms: u128,
    timed_out: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugResult {
    success: bool,
    adapter: String,
    output: String,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    diagnostic: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInfo {
    id: String,
    label: String,
    available: bool,
    version: String,
    purpose: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftFileInfo {
    platform: String,
    problem_id: String,
    title: Option<String>,
    language: String,
    path: String,
    created_at: u64,
    unbound: bool,
    statement_markdown: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnapshot {
    id: String,
    name: String,
    created_at: u64,
    code: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeBranch {
    name: String,
    snapshots: Vec<CodeSnapshot>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeHistory {
    active_branch: String,
    branches: Vec<CodeBranch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeHistoryCheckout {
    history: CodeHistory,
    code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    name: String,
    path: String,
    is_directory: bool,
    language: Option<String>,
    draft: Option<DraftFileInfo>,
    children: Vec<WorkspaceEntry>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DraftMetadata {
    title: String,
    created_at: u64,
    platform: String,
    problem_id: String,
    file_stem: String,
    statement_markdown: String,
}

static DRAFT_DIRECTORY_CACHE: OnceLock<Mutex<HashMap<String, (PathBuf, String)>>> = OnceLock::new();

fn draft_cache() -> &'static Mutex<HashMap<String, (PathBuf, String)>> {
    DRAFT_DIRECTORY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn draft_cache_key(root: &Path, platform: &str, problem_id: &str) -> String {
    format!("{}\0{}\0{}", root.to_string_lossy(), platform, problem_id)
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn new_code_history() -> CodeHistory {
    CodeHistory {
        active_branch: "main".into(),
        branches: vec![CodeBranch {
            name: "main".into(),
            snapshots: Vec::new(),
        }],
    }
}

fn validate_history_label(value: &str, kind: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{}不能为空", kind));
    }
    if value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err(format!("{}不能超过 80 个字符或包含控制字符", kind));
    }
    Ok(value.to_string())
}

fn code_history_path(
    app: &AppHandle,
    platform: &str,
    problem_id: &str,
    language: &str,
) -> Result<PathBuf, String> {
    if !matches!(
        platform,
        "local" | "codeforces" | "luogu" | "atcoder" | "qoj"
    ) {
        return Err("不支持当前题目来源的版本管理".into());
    }
    if !matches!(language, "cpp" | "python" | "java") {
        return Err("不支持当前代码语言的版本管理".into());
    }
    let problem_id = problem_id.trim();
    if problem_id.is_empty() || problem_id.chars().count() > 240 {
        return Err("题目标识无效".into());
    }
    // 使用固定 FNV-1a，避免题目标识含 Windows 特殊字符，也保证重启后路径稳定。
    let identity = format!("{}\0{}\0{}", platform, problem_id, language);
    let hash = identity
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    Ok(data_center::root(app)?
        .join("code-history")
        .join(format!("{:016x}.json", hash)))
}

fn read_code_history(path: &Path) -> Result<CodeHistory, String> {
    if !path.exists() {
        return Ok(new_code_history());
    }
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("读取代码版本库失败: {}", e))?;
    let mut history: CodeHistory =
        serde_json::from_str(&content).map_err(|e| format!("代码版本库格式损坏: {}", e))?;
    if history.branches.is_empty() {
        history = new_code_history();
    }
    if !history
        .branches
        .iter()
        .any(|branch| branch.name == history.active_branch)
    {
        history.active_branch = history.branches[0].name.clone();
    }
    Ok(history)
}

fn write_code_history(path: &Path, history: &CodeHistory) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建代码版本库失败: {}", e))?;
    }
    let content =
        serde_json::to_vec_pretty(history).map_err(|e| format!("序列化代码版本库失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("保存代码版本库失败: {}", e))
}

fn snapshot_id(history: &CodeHistory) -> String {
    let count: usize = history
        .branches
        .iter()
        .map(|branch| branch.snapshots.len())
        .sum();
    format!("v{}_{}", unix_now_millis(), count + 1)
}

fn commit_code_history(history: &mut CodeHistory, name: &str, code: String) -> Result<(), String> {
    let name = validate_history_label(name, "版本名称")?;
    let id = snapshot_id(history);
    let branch = history
        .branches
        .iter_mut()
        .find(|branch| branch.name == history.active_branch)
        .ok_or_else(|| "当前分支不存在".to_string())?;
    branch.snapshots.push(CodeSnapshot {
        id,
        name,
        created_at: unix_now(),
        code,
    });
    Ok(())
}

fn create_code_history_branch(
    history: &mut CodeHistory,
    name: &str,
    code: String,
) -> Result<(), String> {
    let name = validate_history_label(name, "分支名称")?;
    if history.branches.iter().any(|branch| branch.name == name) {
        return Err("同名分支已经存在".into());
    }
    let active_is_empty = history
        .branches
        .iter()
        .find(|branch| branch.name == history.active_branch)
        .map(|branch| branch.snapshots.is_empty())
        .unwrap_or(false);
    if active_is_empty {
        commit_code_history(history, "建立版本库", code.clone())?;
    }
    let id = snapshot_id(history);
    history.branches.push(CodeBranch {
        name: name.clone(),
        snapshots: vec![CodeSnapshot {
            id,
            name: format!("创建分支 {}", name),
            created_at: unix_now(),
            code,
        }],
    });
    history.active_branch = name;
    Ok(())
}

fn remove_code_history_snapshot(
    history: &mut CodeHistory,
    branch_name: &str,
    snapshot_id: &str,
) -> Result<(), String> {
    let branch = history
        .branches
        .iter_mut()
        .find(|branch| branch.name == branch_name)
        .ok_or_else(|| "找不到代码分支".to_string())?;
    let before = branch.snapshots.len();
    branch
        .snapshots
        .retain(|snapshot| snapshot.id != snapshot_id);
    if branch.snapshots.len() == before {
        return Err("找不到要删除的代码版本".into());
    }
    Ok(())
}

fn remove_code_history_branch(history: &mut CodeHistory, branch_name: &str) -> Result<(), String> {
    if branch_name == history.active_branch {
        return Err("请先切换到其他分支，再删除当前分支".into());
    }
    if history.branches.len() <= 1 {
        return Err("版本库至少需要保留一个分支".into());
    }
    let before = history.branches.len();
    history.branches.retain(|branch| branch.name != branch_name);
    if history.branches.len() == before {
        return Err("找不到要删除的代码分支".into());
    }
    Ok(())
}

fn history_file(
    app: &AppHandle,
    platform: &str,
    problem_id: &str,
    language: &str,
) -> Result<(PathBuf, CodeHistory), String> {
    let path = code_history_path(app, platform, problem_id, language)?;
    let history = read_code_history(&path)?;
    Ok((path, history))
}

#[tauri::command]
pub fn load_code_history(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
) -> Result<CodeHistory, String> {
    let (_, history) = history_file(&app, &platform, &problem_id, &language)?;
    Ok(history)
}

#[tauri::command]
pub fn create_code_snapshot(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    name: String,
    code: String,
) -> Result<CodeHistory, String> {
    let (path, mut history) = history_file(&app, &platform, &problem_id, &language)?;
    commit_code_history(&mut history, &name, code)?;
    write_code_history(&path, &history)?;
    Ok(history)
}

#[tauri::command]
pub fn create_code_branch(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    name: String,
    code: String,
) -> Result<CodeHistory, String> {
    let (path, mut history) = history_file(&app, &platform, &problem_id, &language)?;
    create_code_history_branch(&mut history, &name, code)?;
    write_code_history(&path, &history)?;
    Ok(history)
}

#[tauri::command]
pub fn switch_code_branch(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    branch_name: String,
) -> Result<CodeHistoryCheckout, String> {
    let (path, mut history) = history_file(&app, &platform, &problem_id, &language)?;
    let branch_name = validate_history_label(&branch_name, "分支名称")?;
    let code = history
        .branches
        .iter()
        .find(|branch| branch.name == branch_name)
        .and_then(|branch| branch.snapshots.last())
        .map(|snapshot| snapshot.code.clone())
        .ok_or_else(|| "目标分支还没有可载入的版本".to_string())?;
    history.active_branch = branch_name;
    write_code_history(&path, &history)?;
    Ok(CodeHistoryCheckout { history, code })
}

#[tauri::command]
pub fn restore_code_snapshot(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    branch_name: String,
    snapshot_id: String,
) -> Result<String, String> {
    let (_, history) = history_file(&app, &platform, &problem_id, &language)?;
    history
        .branches
        .iter()
        .find(|branch| branch.name == branch_name)
        .and_then(|branch| {
            branch
                .snapshots
                .iter()
                .find(|snapshot| snapshot.id == snapshot_id)
        })
        .map(|snapshot| snapshot.code.clone())
        .ok_or_else(|| "找不到要回退的代码版本".to_string())
}

#[tauri::command]
pub fn delete_code_snapshot(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    branch_name: String,
    snapshot_id: String,
) -> Result<CodeHistory, String> {
    let (path, mut history) = history_file(&app, &platform, &problem_id, &language)?;
    remove_code_history_snapshot(&mut history, &branch_name, &snapshot_id)?;
    write_code_history(&path, &history)?;
    Ok(history)
}

#[tauri::command]
pub fn delete_code_branch(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    branch_name: String,
) -> Result<CodeHistory, String> {
    let (path, mut history) = history_file(&app, &platform, &problem_id, &language)?;
    remove_code_history_branch(&mut history, &branch_name)?;
    write_code_history(&path, &history)?;
    Ok(history)
}

fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_center::root(app)?.join("solutions"))
}

fn validate_child_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("名称不能为空".into());
    }
    if trimmed != safe_segment(trimmed) {
        return Err("名称不能包含 \\ / : * ? \" < > | 或控制字符，也不能以空格或句点结尾".into());
    }
    Ok(trimmed.to_string())
}

fn canonical_workspace_target(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("无法访问代码目录: {}", e))?;
    let target =
        std::fs::canonicalize(target).map_err(|e| format!("目标不存在或无法访问: {}", e))?;
    if target == root || !target.starts_with(&root) {
        return Err("仅允许操作资源管理器代码目录内的项目".into());
    }
    Ok(target)
}

fn canonical_workspace_parent(root: &Path, parent: Option<&str>) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("无法访问代码目录: {}", e))?;
    let parent = match parent {
        Some(value) if !value.trim().is_empty() => {
            std::fs::canonicalize(value).map_err(|e| format!("父文件夹不存在: {}", e))?
        }
        _ => root.clone(),
    };
    if !parent.starts_with(&root) || !parent.is_dir() {
        return Err("新项目只能建立在资源管理器代码目录内".into());
    }
    Ok(parent)
}

fn read_draft_metadata(directory: &Path) -> Option<DraftMetadata> {
    let content = std::fs::read_to_string(directory.join(".acm-meta.json")).ok()?;
    serde_json::from_str(&content).ok()
}

fn source_metadata_path(source: &Path) -> PathBuf {
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    source.with_file_name(format!(".{}.acm-meta.json", name))
}

fn read_source_metadata(source: &Path) -> Option<DraftMetadata> {
    std::fs::read_to_string(source_metadata_path(source))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .or_else(|| source.parent().and_then(read_draft_metadata))
}

fn write_source_metadata(source: &Path, metadata: &DraftMetadata) -> Result<(), String> {
    let json =
        serde_json::to_vec_pretty(metadata).map_err(|e| format!("序列化草稿元数据失败: {}", e))?;
    std::fs::write(source_metadata_path(source), json)
        .map_err(|e| format!("保存草稿元数据失败: {}", e))
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LearningProfile {
    solved_problems: Vec<String>,
    learning_skills: Vec<String>,
    mastered_skills: Vec<String>,
    skipped_skills: Vec<String>,
    updated_at: u64,
    skill_evidence: HashMap<String, Vec<String>>,
    skill_plans: HashMap<String, SkillLearningPlan>,
    skill_plan_pages: HashMap<String, Vec<SkillLearningPlan>>,
    skill_last_practiced_at: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct SkillLearningPlan {
    skill_id: String,
    generated_at: u64,
    problems: Vec<SkillPlanProblem>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct SkillPlanProblem {
    platform: String,
    id: String,
    title: String,
    url: String,
    rating: Option<u32>,
    reason: String,
}

fn safe_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    let trimmed = sanitized.trim_matches(|c| c == ' ' || c == '.');
    if trimmed.is_empty() {
        "untitled".into()
    } else {
        trimmed.into()
    }
}

fn extension(language: &str) -> Result<&'static str, String> {
    match language {
        "cpp" => Ok("cpp"),
        "python" => Ok("py"),
        "java" => Ok("java"),
        _ => Err(format!("不支持的语言: {}", language)),
    }
}

fn source_language(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "cpp" => Some("cpp"),
        "py" => Some("python"),
        "java" => Some("java"),
        _ => None,
    }
}

fn dated_draft_directory(
    root: &Path,
    created_at: u64,
    _platform: &str,
    problem_id: &str,
    title: &str,
) -> (PathBuf, String) {
    let date = Local
        .timestamp_opt(created_at as i64, 0)
        .single()
        .unwrap_or_else(Local::now);
    let file_stem = safe_segment(&format!("{} {}", problem_id, title));
    let directory = root
        .join(format!("{:04}", date.year()))
        .join(format!("{:02}", date.month()))
        .join(format!("{:02}", date.day()));
    (directory, file_stem)
}

fn find_metadata_directory(
    directory: &Path,
    platform: &str,
    problem_id: &str,
) -> Option<(PathBuf, DraftMetadata)> {
    for entry in std::fs::read_dir(directory).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_metadata_directory(&path, platform, problem_id) {
                return Some(found);
            }
        } else if source_language(&path).is_some() {
            if let Some(metadata) = read_source_metadata(&path) {
                if metadata.platform == platform && metadata.problem_id == problem_id {
                    return Some((directory.to_path_buf(), metadata));
                }
            }
        }
    }
    None
}

fn migrate_legacy_directory(
    root: &Path,
    legacy: &Path,
    platform: &str,
    problem_id: &str,
    title: &str,
) -> Result<(PathBuf, DraftMetadata), String> {
    let existing = read_draft_metadata(legacy).unwrap_or_default();
    let created_at = if existing.created_at > 0 {
        existing.created_at
    } else {
        std::fs::metadata(legacy)
            .ok()
            .and_then(|item| item.created().or_else(|_| item.modified()).ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or_else(unix_now)
    };
    let resolved_title = if title.trim().is_empty() {
        existing.title
    } else {
        title.trim().to_string()
    };
    let (directory, file_stem) =
        dated_draft_directory(root, created_at, platform, problem_id, &resolved_title);
    std::fs::create_dir_all(&directory).map_err(|e| format!("迁移草稿目录失败: {}", e))?;
    let metadata = DraftMetadata {
        title: resolved_title,
        created_at,
        platform: platform.to_string(),
        problem_id: problem_id.to_string(),
        file_stem: file_stem.clone(),
        statement_markdown: existing.statement_markdown,
    };
    for (language, ext) in [("cpp", "cpp"), ("python", "py"), ("java", "java")] {
        let source = legacy.join(format!("main.{}", extension(language)?));
        let target = directory.join(format!("{}.{}", file_stem, ext));
        if source.exists() && !target.exists() {
            std::fs::rename(&source, &target)
                .or_else(|_| {
                    std::fs::copy(&source, &target)?;
                    std::fs::remove_file(&source)
                })
                .map_err(|e| format!("迁移旧草稿失败: {}", e))?;
            write_source_metadata(&target, &metadata)?;
        }
    }
    let _ = std::fs::remove_file(legacy.join(".acm-meta.json"));
    let _ = std::fs::remove_dir(legacy);
    if let Some(parent) = legacy.parent() {
        let _ = std::fs::remove_dir(parent);
    }
    Ok((directory, metadata))
}

fn resolve_draft_path_in_root(
    root: &Path,
    platform: &str,
    problem_id: &str,
    problem_title: Option<&str>,
    language: &str,
) -> Result<PathBuf, String> {
    let cache_key = draft_cache_key(root, platform, problem_id);
    if let Some((directory, stem)) = draft_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&cache_key).cloned())
    {
        if directory.exists() || problem_title.is_some() {
            return Ok(directory.join(format!("{}.{}", stem, extension(language)?)));
        }
        if let Ok(mut cache) = draft_cache().lock() {
            cache.remove(&cache_key);
        }
    }
    if let Some((directory, metadata)) = find_metadata_directory(root, platform, problem_id) {
        let stem = if metadata.file_stem.is_empty() {
            "main".to_string()
        } else {
            metadata.file_stem
        };
        if let Ok(mut cache) = draft_cache().lock() {
            cache.insert(cache_key, (directory.clone(), stem.clone()));
        }
        return Ok(directory.join(format!("{}.{}", stem, extension(language)?)));
    }
    let legacy = root
        .join(safe_segment(platform))
        .join(safe_segment(problem_id));
    if legacy.exists() {
        if let Some(title) = problem_title {
            let (directory, metadata) =
                migrate_legacy_directory(root, &legacy, platform, problem_id, title)?;
            if let Ok(mut cache) = draft_cache().lock() {
                cache.insert(cache_key, (directory.clone(), metadata.file_stem.clone()));
            }
            return Ok(directory.join(format!("{}.{}", metadata.file_stem, extension(language)?)));
        }
        return Ok(legacy.join(format!("main.{}", extension(language)?)));
    }
    if let Some(title) = problem_title {
        let (directory, file_stem) =
            dated_draft_directory(root, unix_now(), platform, problem_id, title);
        if let Ok(mut cache) = draft_cache().lock() {
            cache.insert(cache_key, (directory.clone(), file_stem.clone()));
        }
        return Ok(directory.join(format!("{}.{}", file_stem, extension(language)?)));
    }
    Ok(legacy.join(format!("main.{}", extension(language)?)))
}

fn draft_path(
    app: &AppHandle,
    platform: &str,
    problem_id: &str,
    problem_title: Option<&str>,
    language: &str,
) -> Result<PathBuf, String> {
    let root = workspace_root(app)?;
    resolve_draft_path_in_root(&root, platform, problem_id, problem_title, language)
}

#[tauri::command]
pub async fn load_draft(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
) -> Result<String, String> {
    let path = draft_path(&app, &platform, &problem_id, None, &language)?;
    match tokio::fs::read_to_string(path).await {
        Ok(code) => Ok(code),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取草稿失败: {}", e)),
    }
}

#[tauri::command]
pub async fn save_draft(
    app: AppHandle,
    platform: String,
    problem_id: String,
    problem_title: Option<String>,
    language: String,
    code: String,
) -> Result<String, String> {
    let path = draft_path(
        &app,
        &platform,
        &problem_id,
        problem_title.as_deref(),
        &language,
    )?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建草稿目录失败: {}", e))?;
    }
    tokio::fs::write(&path, code)
        .await
        .map_err(|e| format!("保存草稿失败: {}", e))?;
    {
        let existing = read_source_metadata(&path).unwrap_or_default();
        let metadata = DraftMetadata {
            title: problem_title
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or(existing.title),
            created_at: if existing.created_at > 0 {
                existing.created_at
            } else {
                unix_now()
            },
            platform: platform.clone(),
            problem_id: problem_id.clone(),
            file_stem: path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("main")
                .to_string(),
            statement_markdown: existing.statement_markdown,
        };
        write_source_metadata(&path, &metadata)?;
    }
    Ok(path.to_string_lossy().into_owned())
}

fn collect_drafts(_root: &Path, directory: &Path, files: &mut Vec<DraftFileInfo>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_drafts(_root, &path, files);
            continue;
        }
        if let Some(draft) = draft_info_for_path(&path) {
            files.push(draft);
        }
    }
}

#[tauri::command]
pub async fn list_drafts(app: AppHandle) -> Result<Vec<DraftFileInfo>, String> {
    let root = workspace_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&root).map_err(|e| format!("创建代码目录失败: {}", e))?;
        flatten_workspace_layout(&root)?;
        let mut files = Vec::new();
        collect_drafts(&root, &root, &mut files);
        files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok::<_, String>(files)
    })
    .await
    .map_err(|e| format!("扫描本地代码失败: {}", e))?
}

#[tauri::command]
pub async fn create_empty_draft(
    app: AppHandle,
    name: String,
    language: String,
) -> Result<DraftFileInfo, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("请输入文件名称".into());
    }
    let now = unix_now();
    let base_id = format!("{}_{}", unix_now_millis(), safe_segment(trimmed));
    let mut suffix = 0u32;
    let (problem_id, path) = loop {
        let candidate = if suffix == 0 {
            base_id.clone()
        } else {
            format!("{}_{}", base_id, suffix)
        };
        let candidate_path = draft_path(&app, "local", &candidate, Some(trimmed), &language)?;
        if !candidate_path.exists() {
            break (candidate, candidate_path);
        }
        suffix += 1;
    };
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建本地文件目录失败: {}", e))?;
    }
    tokio::fs::write(&path, "")
        .await
        .map_err(|e| format!("创建本地文件失败: {}", e))?;
    let metadata = DraftMetadata {
        title: trimmed.to_string(),
        created_at: now,
        platform: "local".into(),
        problem_id: problem_id.clone(),
        file_stem: path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("main")
            .to_string(),
        statement_markdown: String::new(),
    };
    write_source_metadata(&path, &metadata)?;
    Ok(DraftFileInfo {
        platform: "local".into(),
        problem_id,
        title: Some(trimmed.to_string()),
        language,
        path: path.to_string_lossy().into_owned(),
        created_at: now,
        unbound: true,
        statement_markdown: String::new(),
    })
}

fn draft_info_for_path(path: &Path) -> Option<DraftFileInfo> {
    if matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some("acm_python_debugger.py" | "debug-controller.py")
    ) {
        return None;
    }
    let language = source_language(path)?.to_string();
    let metadata = read_source_metadata(path);
    let statement_markdown = metadata
        .as_ref()
        .map(|item| item.statement_markdown.clone())
        .unwrap_or_default();
    let file_metadata = std::fs::metadata(path).ok();
    let created_at = metadata
        .as_ref()
        .map(|item| item.created_at)
        .filter(|value| *value > 0)
        .or_else(|| {
            file_metadata
                .and_then(|item| item.created().or_else(|_| item.modified()).ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
        })
        .unwrap_or_else(unix_now);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let (platform, problem_id, title, unbound) = if let Some(metadata) = metadata {
        let inferred_problem = path
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or(stem);
        let inferred_platform = path
            .parent()
            .and_then(|value| value.parent())
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            .filter(|value| matches!(*value, "codeforces" | "luogu" | "atcoder" | "qoj" | "local"))
            .unwrap_or("local");
        let platform = if metadata.platform.is_empty() {
            inferred_platform.into()
        } else {
            metadata.platform
        };
        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().hash(&mut hasher);
        let problem_id = if metadata.problem_id.is_empty() {
            if inferred_platform == "local" {
                format!("local_{:x}", hasher.finish())
            } else {
                inferred_problem.to_string()
            }
        } else {
            metadata.problem_id
        };
        let title = if metadata.title.is_empty() {
            stem.to_string()
        } else {
            metadata.title
        };
        let unbound = platform == "local";
        (platform, problem_id, Some(title), unbound)
    } else {
        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().hash(&mut hasher);
        (
            "local".into(),
            format!("local_{:x}", hasher.finish()),
            Some(stem.to_string()),
            true,
        )
    };
    Some(DraftFileInfo {
        platform,
        problem_id,
        title,
        language,
        path: path.to_string_lossy().into_owned(),
        created_at,
        unbound,
        statement_markdown,
    })
}

fn move_file_preserving_contents(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        let same = std::fs::read(source).ok() == std::fs::read(target).ok();
        if same {
            std::fs::remove_file(source).map_err(|e| format!("清理旧代码文件失败: {}", e))?;
            return Ok(());
        }
        return Err(format!(
            "迁移目标已存在不同内容的同名文件: {}",
            target.display()
        ));
    }
    std::fs::rename(source, target)
        .or_else(|_| {
            std::fs::copy(source, target)?;
            std::fs::remove_file(source)
        })
        .map_err(|e| format!("迁移代码文件失败: {}", e))
}

fn flatten_workspace_layout(root: &Path) -> Result<(), String> {
    let mut sources = Vec::new();
    fn visit(directory: &Path, sources: &mut Vec<(PathBuf, Option<DraftMetadata>)>) {
        let Ok(entries) = std::fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, sources);
            } else if source_language(&path).is_some() {
                let metadata = read_source_metadata(&path);
                sources.push((path, metadata));
            }
        }
    }
    visit(root, &mut sources);
    for (source, captured_metadata) in sources {
        let Ok(relative) = source.strip_prefix(root) else {
            continue;
        };
        let parts: Vec<String> = relative
            .components()
            .map(|item| item.as_os_str().to_string_lossy().into_owned())
            .collect();
        let dated_old_layout = parts.len() >= 6
            && parts[0].len() == 4
            && parts[0].chars().all(|c| c.is_ascii_digit())
            && matches!(
                parts[3].as_str(),
                "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
            );
        let legacy_layout = parts.len() >= 3
            && matches!(
                parts[0].as_str(),
                "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
            );
        if !dated_old_layout && !legacy_layout {
            continue;
        }
        let mut metadata = captured_metadata.unwrap_or_default();
        let (day_directory, filename) = if dated_old_layout {
            if metadata.platform.is_empty() {
                metadata.platform = parts[3].clone();
            }
            if metadata.problem_id.is_empty() {
                metadata.problem_id = parts[4].clone();
            }
            (
                root.join(&parts[0]).join(&parts[1]).join(&parts[2]),
                source.file_name().unwrap().to_owned(),
            )
        } else {
            if metadata.platform.is_empty() {
                metadata.platform = parts[0].clone();
            }
            if metadata.problem_id.is_empty() {
                metadata.problem_id = parts[1].clone();
            }
            if metadata.created_at == 0 {
                metadata.created_at = unix_now();
            }
            let title = if metadata.title.is_empty() {
                parts[1].clone()
            } else {
                metadata.title.clone()
            };
            let (directory, stem) = dated_draft_directory(
                root,
                metadata.created_at,
                &metadata.platform,
                &metadata.problem_id,
                &title,
            );
            let ext = source.extension().unwrap_or_default();
            (
                directory,
                std::ffi::OsString::from(format!("{}.{}", stem, ext.to_string_lossy())),
            )
        };
        std::fs::create_dir_all(&day_directory).map_err(|e| format!("建立日期目录失败: {}", e))?;
        let target = day_directory.join(filename);
        let old_parent = source.parent().map(Path::to_path_buf);
        let old_sidecar = source_metadata_path(&source);
        move_file_preserving_contents(&source, &target)?;
        metadata.file_stem = target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("main")
            .to_string();
        if metadata.created_at == 0 {
            metadata.created_at = std::fs::metadata(&target)
                .ok()
                .and_then(|item| item.created().or_else(|_| item.modified()).ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or_else(unix_now);
        }
        write_source_metadata(&target, &metadata)?;
        if old_sidecar != source_metadata_path(&target) {
            let _ = std::fs::remove_file(old_sidecar);
        }
        if let Some(mut directory) = old_parent {
            let _ = std::fs::remove_file(directory.join(".acm-meta.json"));
            while directory != day_directory && directory.starts_with(root) {
                if std::fs::remove_dir(&directory).is_err() {
                    break;
                }
                let Some(parent) = directory.parent() else {
                    break;
                };
                directory = parent.to_path_buf();
            }
        }
    }
    let generated_names = [
        "main.exe",
        "debug-main.exe",
        "debug-input.txt",
        "acm-debug.gdb",
        "acm_python_debugger.py",
        "debug-controller.py",
    ];
    let mut old_directories = Vec::new();
    fn collect_old_directories(root: &Path, directory: &Path, output: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_old_directories(root, &path, output);
                output.push(path);
            }
        }
    }
    collect_old_directories(root, root, &mut old_directories);
    old_directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for directory in old_directories {
        let Ok(relative) = directory.strip_prefix(root) else {
            continue;
        };
        let parts: Vec<String> = relative
            .components()
            .map(|item| item.as_os_str().to_string_lossy().into_owned())
            .collect();
        let old_problem_directory = (parts.len() >= 5
            && parts[0].len() == 4
            && matches!(
                parts[3].as_str(),
                "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
            ))
            || (parts.len() >= 2
                && matches!(
                    parts[0].as_str(),
                    "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
                ));
        let old_source_directory = (parts.len() == 4
            && parts[0].len() == 4
            && matches!(
                parts[3].as_str(),
                "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
            ))
            || (parts.len() == 1
                && matches!(
                    parts[0].as_str(),
                    "codeforces" | "luogu" | "atcoder" | "qoj" | "local"
                ));
        if old_problem_directory {
            for name in generated_names {
                let _ = std::fs::remove_file(directory.join(name));
            }
            let _ = std::fs::remove_file(directory.join(".acm-meta.json"));
        }
        if old_problem_directory || old_source_directory {
            let _ = std::fs::remove_dir(&directory);
        }
    }
    if let Ok(mut cache) = draft_cache().lock() {
        cache.clear();
    }
    Ok(())
}

fn collect_workspace_entries(directory: &Path) -> Vec<WorkspaceEntry> {
    let mut entries = Vec::new();
    let Ok(children) = std::fs::read_dir(directory) else {
        return entries;
    };
    for child in children.flatten() {
        let path = child.path();
        let name = child.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            entries.push(WorkspaceEntry {
                name,
                path: path.to_string_lossy().into_owned(),
                is_directory: true,
                language: None,
                draft: None,
                children: collect_workspace_entries(&path),
            });
        } else if let Some(draft) = draft_info_for_path(&path) {
            entries.push(WorkspaceEntry {
                name,
                path: path.to_string_lossy().into_owned(),
                is_directory: false,
                language: Some(draft.language.clone()),
                draft: Some(draft),
                children: Vec::new(),
            });
        }
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

#[tauri::command]
pub async fn list_workspace_entries(app: AppHandle) -> Result<Vec<WorkspaceEntry>, String> {
    let root = workspace_root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("创建代码目录失败: {}", e))?;
    tauri::async_runtime::spawn_blocking(move || {
        flatten_workspace_layout(&root)?;
        Ok::<_, String>(collect_workspace_entries(&root))
    })
    .await
    .map_err(|e| format!("扫描资源管理器失败: {}", e))?
}

#[tauri::command]
pub async fn workspace_root_path(app: AppHandle) -> Result<String, String> {
    let root = workspace_root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("创建代码目录失败: {}", e))?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn create_workspace_folder(
    app: AppHandle,
    parent_path: Option<String>,
    name: String,
) -> Result<String, String> {
    let root = workspace_root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| e.to_string())?;
    let parent = canonical_workspace_parent(&root, parent_path.as_deref())?;
    let target = parent.join(validate_child_name(&name)?);
    if target.exists() {
        return Err("同名文件或文件夹已经存在".into());
    }
    tokio::fs::create_dir(&target)
        .await
        .map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn create_workspace_file(
    app: AppHandle,
    parent_path: Option<String>,
    name: String,
    language: String,
) -> Result<DraftFileInfo, String> {
    let root = workspace_root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| e.to_string())?;
    let parent = if parent_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        let now = Local::now();
        let dated = root
            .join(format!("{:04}", now.year()))
            .join(format!("{:02}", now.month()))
            .join(format!("{:02}", now.day()));
        tokio::fs::create_dir_all(&dated)
            .await
            .map_err(|e| format!("建立日期目录失败: {}", e))?;
        canonical_workspace_parent(&root, dated.to_str())?
    } else {
        canonical_workspace_parent(&root, parent_path.as_deref())?
    };
    let raw_name = validate_child_name(&name)?;
    let requested_extension = Path::new(&raw_name)
        .extension()
        .and_then(|value| value.to_str());
    let filename = if let Some(ext) = requested_extension {
        if !matches!(ext.to_ascii_lowercase().as_str(), "cpp" | "py" | "java") {
            return Err("仅支持创建 .cpp、.py 和 .java 代码文件".into());
        }
        raw_name
    } else {
        format!("{}.{}", raw_name, extension(&language)?)
    };
    let target = parent.join(filename);
    if target.exists() {
        return Err("同名文件已经存在".into());
    }
    tokio::fs::write(&target, "")
        .await
        .map_err(|e| format!("创建代码文件失败: {}", e))?;
    let metadata = DraftMetadata {
        title: target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名")
            .to_string(),
        statement_markdown: String::new(),
        created_at: unix_now(),
        platform: "local".into(),
        problem_id: format!("local_{}", unix_now_millis()),
        file_stem: target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("main")
            .to_string(),
    };
    write_source_metadata(&target, &metadata)?;
    draft_info_for_path(&target).ok_or_else(|| "无法识别新建代码文件的语言".into())
}

#[tauri::command]
pub async fn read_workspace_file(app: AppHandle, path: String) -> Result<String, String> {
    let root = workspace_root(&app)?;
    let target = canonical_workspace_target(&root, Path::new(&path))?;
    if target.is_dir() {
        return Err("不能把文件夹作为代码打开".into());
    }
    tokio::fs::read_to_string(target)
        .await
        .map_err(|e| format!("读取代码文件失败: {}", e))
}

#[tauri::command]
pub async fn save_workspace_file(app: AppHandle, path: String, code: String) -> Result<(), String> {
    let root = workspace_root(&app)?;
    let target = canonical_workspace_target(&root, Path::new(&path))?;
    if target.is_dir() {
        return Err("不能向文件夹保存代码".into());
    }
    tokio::fs::write(target, code)
        .await
        .map_err(|e| format!("保存代码文件失败: {}", e))
}

#[tauri::command]
pub async fn save_local_statement(
    app: AppHandle,
    path: String,
    statement_markdown: String,
) -> Result<(), String> {
    let root = workspace_root(&app)?;
    let target = canonical_workspace_target(&root, Path::new(&path))?;
    if target.is_dir() {
        return Err("不能给文件夹保存题面".into());
    }
    let info =
        draft_info_for_path(&target).ok_or_else(|| "无法识别当前本地代码文件".to_string())?;
    if !info.unbound {
        return Err("只允许编辑未绑定 OJ 的本地代码文件题面".into());
    }
    let mut metadata = read_source_metadata(&target).unwrap_or_else(|| DraftMetadata {
        title: info.title.unwrap_or_else(|| info.problem_id.clone()),
        created_at: info.created_at,
        platform: "local".into(),
        problem_id: info.problem_id,
        file_stem: target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("main")
            .to_string(),
        statement_markdown: String::new(),
    });
    metadata.statement_markdown = statement_markdown;
    write_source_metadata(&target, &metadata)
}

#[tauri::command]
pub async fn rename_workspace_entry(
    app: AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let root = workspace_root(&app)?;
    let target = canonical_workspace_target(&root, Path::new(&path))?;
    let parent = target
        .parent()
        .ok_or_else(|| "无法重命名代码目录根节点".to_string())?;
    let raw_name = validate_child_name(&new_name)?;
    let new_name = if target.is_file() && Path::new(&raw_name).extension().is_none() {
        match target.extension().and_then(|value| value.to_str()) {
            Some(ext) => format!("{}.{}", raw_name, ext),
            None => raw_name,
        }
    } else {
        raw_name
    };
    let destination = parent.join(new_name);
    if destination.exists() {
        return Err("同名文件或文件夹已经存在".into());
    }
    let managed = target
        .is_file()
        .then(|| read_source_metadata(&target))
        .flatten();
    if let Some(mut metadata) = managed {
        let old_stem = target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let new_stem = destination
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if metadata.file_stem == old_stem && !new_stem.is_empty() {
            let mut variants = Vec::new();
            for entry in std::fs::read_dir(parent)
                .map_err(|e| e.to_string())?
                .flatten()
            {
                let variant = entry.path();
                if source_language(&variant).is_some()
                    && variant.file_stem().and_then(|value| value.to_str()) == Some(old_stem)
                {
                    let renamed = parent.join(format!(
                        "{}.{}",
                        new_stem,
                        variant.extension().unwrap().to_string_lossy()
                    ));
                    if renamed.exists() && renamed != variant {
                        return Err("重命名后的代码文件已经存在".into());
                    }
                    variants.push((variant, renamed));
                }
            }
            for (source, renamed) in variants {
                let old_sidecar = source_metadata_path(&source);
                tokio::fs::rename(&source, &renamed)
                    .await
                    .map_err(|e| format!("重命名失败: {}", e))?;
                let _ = tokio::fs::remove_file(old_sidecar).await;
                write_source_metadata(&renamed, &metadata)?;
            }
            metadata.file_stem = new_stem.to_string();
            if metadata.platform == "local" {
                metadata.title = new_stem.to_string();
            }
            for entry in std::fs::read_dir(parent)
                .map_err(|e| e.to_string())?
                .flatten()
            {
                let variant = entry.path();
                if source_language(&variant).is_some()
                    && variant.file_stem().and_then(|value| value.to_str()) == Some(new_stem)
                {
                    write_source_metadata(&variant, &metadata)?;
                }
            }
        } else {
            tokio::fs::rename(&target, &destination)
                .await
                .map_err(|e| format!("重命名失败: {}", e))?;
        }
    } else {
        tokio::fs::rename(&target, &destination)
            .await
            .map_err(|e| format!("重命名失败: {}", e))?;
    }
    if let Ok(mut cache) = draft_cache().lock() {
        cache.clear();
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn delete_workspace_entry(app: AppHandle, path: String) -> Result<(), String> {
    let root = workspace_root(&app)?;
    let target = canonical_workspace_target(&root, Path::new(&path))?;
    if target.is_dir() {
        tokio::fs::remove_dir_all(&target)
            .await
            .map_err(|e| format!("删除文件夹失败: {}", e))?;
    } else {
        let sidecar = source_metadata_path(&target);
        tokio::fs::remove_file(&target)
            .await
            .map_err(|e| format!("删除文件失败: {}", e))?;
        let _ = tokio::fs::remove_file(sidecar).await;
    }
    if let Ok(mut cache) = draft_cache().lock() {
        cache.clear();
    }
    Ok(())
}

fn available_copy_target(parent: &Path, source: &Path) -> PathBuf {
    let original = source.file_name().unwrap_or_default().to_string_lossy();
    let (stem, extension) = if source.is_file() {
        (
            source
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            source
                .extension()
                .map(|value| value.to_string_lossy().into_owned()),
        )
    } else {
        (original.into_owned(), None)
    };
    for suffix in 1..10_000 {
        let label = if suffix == 1 {
            format!("{} - 副本", stem)
        } else {
            format!("{} - 副本 ({})", stem, suffix)
        };
        let name = extension
            .as_ref()
            .map(|ext| format!("{}.{}", label, ext))
            .unwrap_or(label);
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{}-{}", stem, unix_now_millis()))
}

fn copy_directory_recursive(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir(target).map_err(|e| format!("创建目标文件夹失败: {}", e))?;
    for entry in std::fs::read_dir(source)
        .map_err(|e| format!("读取源文件夹失败: {}", e))?
        .flatten()
    {
        let child = entry.path();
        let destination = target.join(entry.file_name());
        if child.is_dir() {
            copy_directory_recursive(&child, &destination)?;
        } else {
            std::fs::copy(&child, &destination).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn paste_workspace_entry(
    app: AppHandle,
    source_path: String,
    destination_path: Option<String>,
    cut: bool,
) -> Result<String, String> {
    let root = workspace_root(&app)?;
    let source = canonical_workspace_target(&root, Path::new(&source_path))?;
    let source_was_file = source.is_file();
    let destination_parent = canonical_workspace_parent(&root, destination_path.as_deref())?;
    if source.is_dir() && destination_parent.starts_with(&source) {
        return Err("不能把文件夹粘贴到它自身或其子文件夹中".into());
    }
    let mut target = destination_parent.join(source.file_name().unwrap_or_default());
    if target == source {
        if cut {
            return Ok(source.to_string_lossy().into_owned());
        }
        target = available_copy_target(&destination_parent, &source);
    } else if target.exists() {
        target = available_copy_target(&destination_parent, &source);
    }
    if cut {
        tokio::fs::rename(&source, &target)
            .await
            .map_err(|e| format!("移动失败: {}", e))?;
        if source_was_file {
            let sidecar = source_metadata_path(&source);
            if sidecar.exists() {
                let _ = tokio::fs::rename(sidecar, source_metadata_path(&target)).await;
            }
        }
    } else if source.is_dir() {
        let source_clone = source.clone();
        let target_clone = target.clone();
        tauri::async_runtime::spawn_blocking(move || {
            copy_directory_recursive(&source_clone, &target_clone)
        })
        .await
        .map_err(|e| format!("复制任务失败: {}", e))??;
    } else {
        tokio::fs::copy(&source, &target)
            .await
            .map_err(|e| format!("复制文件失败: {}", e))?;
        let sidecar = source_metadata_path(&source);
        if sidecar.exists() {
            let _ = tokio::fs::copy(sidecar, source_metadata_path(&target)).await;
        }
    }
    if let Ok(mut cache) = draft_cache().lock() {
        cache.clear();
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn load_learning_profile(app: AppHandle) -> Result<LearningProfile, String> {
    let root = data_center::root(&app)?;
    let path = root.join("learning-profile.json");
    match tokio::fs::read_to_string(path).await {
        Ok(content) => serde_json::from_str(&content).map_err(|e| format!("学习档案损坏: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LearningProfile::default()),
        Err(e) => Err(format!("读取学习档案失败: {}", e)),
    }
}

#[tauri::command]
pub async fn save_learning_profile(app: AppHandle, profile: LearningProfile) -> Result<(), String> {
    let root = data_center::root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("创建数据目录失败: {}", e))?;
    let path = root.join("learning-profile.json");
    let json =
        serde_json::to_vec_pretty(&profile).map_err(|e| format!("序列化学习档案失败: {}", e))?;
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("保存学习档案失败: {}", e))?;
    Ok(())
}

fn normalize_codeforces_translation_id(problem_id: &str) -> Result<String, String> {
    let normalized = problem_id.trim().to_ascii_uppercase();
    let valid =
        regex::Regex::new(r"^\d+[A-Z][A-Z0-9]*$").expect("Codeforces problem id regex is valid");
    if !valid.is_match(&normalized) {
        return Err("Codeforces 题号格式无效".into());
    }
    Ok(normalized)
}

fn codeforces_translation_path(app: &AppHandle, problem_id: &str) -> Result<PathBuf, String> {
    let normalized = normalize_codeforces_translation_id(problem_id)?;
    Ok(data_center::root(app)?
        .join("translations")
        .join("codeforces")
        .join(format!("{}.md", normalized)))
}

fn normalize_oj_translation(platform: &str, problem_id: &str) -> Result<(String, String), String> {
    let platform = platform.trim().to_ascii_lowercase();
    let id = problem_id.trim().to_ascii_uppercase();
    let valid = match platform.as_str() {
        "codeforces" => regex::Regex::new(r"^\d+[A-Z][A-Z0-9]*$")
            .unwrap()
            .is_match(&id),
        "atcoder" => regex::Regex::new(r"^[A-Z0-9]+(?:_[A-Z0-9]+)+$")
            .unwrap()
            .is_match(&id),
        "luogu" => regex::Regex::new(r"^[A-Z0-9][A-Z0-9_-]{0,79}$")
            .unwrap()
            .is_match(&id),
        "qoj" => regex::Regex::new(r"^(?:\d+|C\d+[A-Z][A-Z0-9_]*)$")
            .unwrap()
            .is_match(&id),
        _ => return Err("该平台不支持本地 AI 译文".into()),
    };
    if !valid {
        return Err(format!("{} 题号格式无效", platform));
    }
    Ok((platform, id))
}

fn oj_translation_path(
    app: &AppHandle,
    platform: &str,
    problem_id: &str,
) -> Result<PathBuf, String> {
    let (platform, id) = normalize_oj_translation(platform, problem_id)?;
    Ok(data_center::root(app)?
        .join("translations")
        .join(platform)
        .join(format!("{id}.md")))
}

#[tauri::command]
pub async fn load_oj_translation(
    app: AppHandle,
    platform: String,
    problem_id: String,
) -> Result<Option<String>, String> {
    let path = oj_translation_path(&app, &platform, &problem_id)?;
    match tokio::fs::read_to_string(path).await {
        Ok(content) if content.trim().is_empty() => Ok(None),
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取本地译文失败: {error}")),
    }
}

#[tauri::command]
pub async fn save_oj_translation(
    app: AppHandle,
    platform: String,
    problem_id: String,
    content: String,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("不能保存空白译文".into());
    }
    let path = oj_translation_path(&app, &platform, &problem_id)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建译文目录失败: {e}"))?;
    }
    tokio::fs::write(path, content)
        .await
        .map_err(|e| format!("保存本地译文失败: {e}"))
}

#[tauri::command]
pub async fn load_cf_translation(
    app: AppHandle,
    problem_id: String,
) -> Result<Option<String>, String> {
    let path = codeforces_translation_path(&app, &problem_id)?;
    match tokio::fs::read_to_string(path).await {
        Ok(content) if content.trim().is_empty() => Ok(None),
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取本地译文失败: {}", error)),
    }
}

#[tauri::command]
pub async fn save_cf_translation(
    app: AppHandle,
    problem_id: String,
    content: String,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("不能保存空白译文".into());
    }
    let path = codeforces_translation_path(&app, &problem_id)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建译文目录失败: {}", e))?;
    }
    tokio::fs::write(path, content)
        .await
        .map_err(|e| format!("保存本地译文失败: {}", e))
}

#[tauri::command]
pub async fn load_submissions(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = data_center::root(&app)?.join("submissions.json");
    match tokio::fs::read_to_string(path).await {
        Ok(json) => serde_json::from_str(&json).map_err(|e| format!("提交记录损坏: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(format!("读取提交记录失败: {}", e)),
    }
}

#[tauri::command]
pub async fn save_submissions(
    app: AppHandle,
    submissions: Vec<serde_json::Value>,
) -> Result<(), String> {
    let root = data_center::root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("创建数据目录失败: {}", e))?;
    let json = serde_json::to_vec_pretty(&submissions)
        .map_err(|e| format!("序列化提交记录失败: {}", e))?;
    tokio::fs::write(root.join("submissions.json"), json)
        .await
        .map_err(|e| format!("保存提交记录失败: {}", e))
}

#[tauri::command]
pub async fn detect_toolchains(app: AppHandle) -> Result<Vec<ToolchainInfo>, String> {
    let definitions = [
        ("g++", "G++", "--version", "C++ 编译/运行", "cppCompiler"),
        ("gdb", "GDB", "--version", "C++ 断点调试", "cppDebugger"),
        (
            "python",
            "Python",
            "--version",
            "Python 运行/调试",
            "pythonInterpreter",
        ),
        ("javac", "Javac", "-version", "Java 编译", "javaCompiler"),
        ("java", "Java", "-version", "Java 运行", "javaRuntime"),
        ("jdb", "JDB", "-version", "Java 断点调试", "javaDebugger"),
    ];
    let mut tasks = JoinSet::new();
    for (index, (id, label, argument, purpose, key)) in definitions.into_iter().enumerate() {
        let executable = data_center::tool_command(&app, key, id);
        tasks.spawn(async move {
            let mut command = Command::new(&executable);
            command.arg(argument);
            let info = match command_output(command, None, Duration::from_secs(5)).await {
                Ok(output) => {
                    let combined = format!(
                        "{}{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    );
                    ToolchainInfo {
                        id: id.into(),
                        label: label.into(),
                        available: output.status.success(),
                        version: combined.lines().next().unwrap_or("").trim().to_string(),
                        purpose: purpose.into(),
                    }
                }
                Err(_) => ToolchainInfo {
                    id: id.into(),
                    label: label.into(),
                    available: false,
                    version: format!("无法运行：{}", executable),
                    purpose: purpose.into(),
                },
            };
            (index, info)
        });
    }
    let mut result = Vec::with_capacity(definitions.len());
    while let Some(item) = tasks.join_next().await {
        result.push(item.map_err(|e| format!("检测工具链任务失败: {}", e))?);
    }
    result.sort_by_key(|(index, _)| *index);
    Ok(result.into_iter().map(|(_, info)| info).collect())
}

async fn command_output(
    mut command: Command,
    stdin: Option<&str>,
    limit: Duration,
) -> Result<std::process::Output, String> {
    // GUI applications on Windows otherwise create a visible console for each
    // compiler, runner and debugger child process.
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到对应编译器/解释器，请安装并加入 PATH".to_string()
        } else {
            format!("启动进程失败: {}", e)
        }
    })?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input.as_bytes())
            .await
            .map_err(|e| format!("写入标准输入失败: {}", e))?;
    }
    timeout(limit, child.wait_with_output())
        .await
        .map_err(|_| "__TIMEOUT__".to_string())?
        .map_err(|e| format!("等待进程失败: {}", e))
}

fn failed(
    message: String,
    started: Instant,
    timed_out: bool,
    compile_duration_ms: u128,
) -> RunResult {
    RunResult {
        success: false,
        stdout: String::new(),
        stderr: message,
        compile_failed: false,
        exit_code: None,
        duration_ms: started.elapsed().as_millis(),
        compile_duration_ms,
        timed_out,
    }
}

fn compile_failed(message: String, started: Instant, timed_out: bool) -> RunResult {
    let duration = started.elapsed().as_millis();
    RunResult {
        success: false,
        stdout: String::new(),
        stderr: message,
        compile_failed: true,
        exit_code: None,
        duration_ms: duration,
        compile_duration_ms: duration,
        timed_out,
    }
}

fn truncate_output_lines(value: String, max_lines: usize) -> String {
    let limit = max_lines.clamp(1, 10_000);
    let mut lines = value.lines();
    let kept = lines.by_ref().take(limit).collect::<Vec<_>>();
    if lines.next().is_none() {
        return value;
    }
    format!("[Truncated]\n{}", kept.join("\n"))
}

#[tauri::command]
pub async fn run_code(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    code: String,
    input: String,
    timeout_ms: Option<u64>,
    output_line_limit: Option<usize>,
) -> Result<RunResult, String> {
    let mut compile_duration_ms = 0;
    let source = draft_path(&app, &platform, &problem_id, None, &language)?;
    if let Some(parent) = source.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建工作目录失败: {}", e))?;
    }
    tokio::fs::write(&source, &code)
        .await
        .map_err(|e| format!("保存代码失败: {}", e))?;
    let workdir = source.parent().unwrap_or_else(|| Path::new("."));
    let run_limit = Duration::from_millis(timeout_ms.unwrap_or(5000).clamp(500, 30000));

    let run = match language.as_str() {
        "cpp" => {
            let executable = workdir.join("main.exe");
            let mut compile = Command::new(data_center::tool_command(&app, "cppCompiler", "g++"));
            compile
                .arg(data_center::cpp_standard_flag(&app))
                .args(["-O2", "-pipe"])
                .arg(&source)
                .arg("-o")
                .arg(&executable)
                .current_dir(workdir);
            let compile_started = Instant::now();
            match command_output(compile, None, Duration::from_secs(30)).await {
                Ok(output) if output.status.success() => {
                    compile_duration_ms = compile_started.elapsed().as_millis();
                }
                Ok(output) => {
                    return Ok(compile_failed(
                        String::from_utf8_lossy(&output.stderr).into_owned(),
                        compile_started,
                        false,
                    ))
                }
                Err(e) => {
                    let timed_out = e == "__TIMEOUT__";
                    return Ok(compile_failed(
                        if timed_out { "编译超时".into() } else { e },
                        compile_started,
                        timed_out,
                    ));
                }
            }
            let mut command = Command::new(executable);
            command.current_dir(workdir);
            command
        }
        "python" => {
            let mut command = Command::new(data_center::tool_command(
                &app,
                "pythonInterpreter",
                "python",
            ));
            command.arg(&source).current_dir(workdir);
            command
        }
        "java" => {
            let java_source = workdir.join("Main.java");
            tokio::fs::copy(&source, &java_source)
                .await
                .map_err(|e| format!("准备 Java 源码失败: {}", e))?;
            let mut compile =
                Command::new(data_center::tool_command(&app, "javaCompiler", "javac"));
            compile.arg("Main.java").current_dir(workdir);
            let compile_started = Instant::now();
            match command_output(compile, None, Duration::from_secs(30)).await {
                Ok(output) if output.status.success() => {
                    compile_duration_ms = compile_started.elapsed().as_millis();
                }
                Ok(output) => {
                    return Ok(compile_failed(
                        String::from_utf8_lossy(&output.stderr).into_owned(),
                        compile_started,
                        false,
                    ))
                }
                Err(e) => {
                    let timed_out = e == "__TIMEOUT__";
                    return Ok(compile_failed(
                        if timed_out { "编译超时".into() } else { e },
                        compile_started,
                        timed_out,
                    ));
                }
            }
            let mut command = Command::new(data_center::tool_command(&app, "javaRuntime", "java"));
            command.args(["-cp", ".", "Main"]).current_dir(workdir);
            command
        }
        _ => return Err(format!("不支持的语言: {}", language)),
    };

    let run_started = Instant::now();
    let output_line_limit = output_line_limit.unwrap_or(300).clamp(1, 10_000);
    match command_output(run, Some(&input), run_limit).await {
        Ok(output) => Ok(RunResult {
            success: output.status.success(),
            stdout: truncate_output_lines(
                String::from_utf8_lossy(&output.stdout).into_owned(),
                output_line_limit,
            ),
            stderr: truncate_output_lines(
                String::from_utf8_lossy(&output.stderr).into_owned(),
                output_line_limit,
            ),
            compile_failed: false,
            exit_code: output.status.code(),
            duration_ms: run_started.elapsed().as_millis(),
            compile_duration_ms,
            timed_out: false,
        }),
        Err(e) if e == "__TIMEOUT__" => Ok(failed(
            "运行超时".into(),
            run_started,
            true,
            compile_duration_ms,
        )),
        Err(e) => Ok(failed(e, run_started, false, compile_duration_ms)),
    }
}

async fn run_prepared_code(
    language: String,
    source: PathBuf,
    workdir: PathBuf,
    input: String,
    run_limit: Duration,
    output_line_limit: usize,
    compile_duration_ms: u128,
    python_runtime: String,
    java_runtime: String,
) -> RunResult {
    let run_started = Instant::now();
    let command = match language.as_str() {
        "cpp" => {
            let mut command = Command::new(workdir.join("main.exe"));
            command.current_dir(&workdir);
            command
        }
        "python" => {
            let mut command = Command::new(python_runtime);
            command.arg(&source).current_dir(&workdir);
            command
        }
        "java" => {
            let mut command = Command::new(java_runtime);
            command.args(["-cp", ".", "Main"]).current_dir(&workdir);
            command
        }
        _ => {
            return failed(
                format!("不支持的语言: {}", language),
                run_started,
                false,
                compile_duration_ms,
            )
        }
    };
    match command_output(command, Some(&input), run_limit).await {
        Ok(output) => RunResult {
            success: output.status.success(),
            stdout: truncate_output_lines(
                String::from_utf8_lossy(&output.stdout).into_owned(),
                output_line_limit,
            ),
            stderr: truncate_output_lines(
                String::from_utf8_lossy(&output.stderr).into_owned(),
                output_line_limit,
            ),
            compile_failed: false,
            exit_code: output.status.code(),
            duration_ms: run_started.elapsed().as_millis(),
            compile_duration_ms,
            timed_out: false,
        },
        Err(e) if e == "__TIMEOUT__" => {
            failed("运行超时".into(), run_started, true, compile_duration_ms)
        }
        Err(e) => failed(e, run_started, false, compile_duration_ms),
    }
}

/// 一次保存、编译源码，再以固定并发数运行整组测试点。
/// 返回值始终与输入顺序一致，避免并发完成顺序影响前端测试点对应关系。
#[tauri::command]
pub async fn run_test_suite(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    code: String,
    inputs: Vec<String>,
    timeout_ms: Option<u64>,
    output_line_limit: Option<usize>,
) -> Result<Vec<RunResult>, String> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    let source = draft_path(&app, &platform, &problem_id, None, &language)?;
    if let Some(parent) = source.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建工作目录失败: {}", e))?;
    }
    tokio::fs::write(&source, &code)
        .await
        .map_err(|e| format!("保存代码失败: {}", e))?;
    let workdir = source
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let mut compile_duration_ms = 0;
    let compile_error = match language.as_str() {
        "cpp" => {
            let executable = workdir.join("main.exe");
            let mut compile = Command::new(data_center::tool_command(&app, "cppCompiler", "g++"));
            compile
                .arg(data_center::cpp_standard_flag(&app))
                .args(["-O2", "-pipe"])
                .arg(&source)
                .arg("-o")
                .arg(&executable)
                .current_dir(&workdir);
            let started = Instant::now();
            let outcome = command_output(compile, None, Duration::from_secs(30)).await;
            compile_duration_ms = started.elapsed().as_millis();
            match outcome {
                Ok(output) if output.status.success() => None,
                Ok(output) => Some((String::from_utf8_lossy(&output.stderr).into_owned(), false)),
                Err(e) => Some((
                    if e == "__TIMEOUT__" {
                        "编译超时".into()
                    } else {
                        e.clone()
                    },
                    e == "__TIMEOUT__",
                )),
            }
        }
        "java" => {
            tokio::fs::copy(&source, workdir.join("Main.java"))
                .await
                .map_err(|e| format!("准备 Java 源码失败: {}", e))?;
            let mut compile =
                Command::new(data_center::tool_command(&app, "javaCompiler", "javac"));
            compile.arg("Main.java").current_dir(&workdir);
            let started = Instant::now();
            let outcome = command_output(compile, None, Duration::from_secs(30)).await;
            compile_duration_ms = started.elapsed().as_millis();
            match outcome {
                Ok(output) if output.status.success() => None,
                Ok(output) => Some((String::from_utf8_lossy(&output.stderr).into_owned(), false)),
                Err(e) => Some((
                    if e == "__TIMEOUT__" {
                        "编译超时".into()
                    } else {
                        e.clone()
                    },
                    e == "__TIMEOUT__",
                )),
            }
        }
        "python" => None,
        _ => return Err(format!("不支持的语言: {}", language)),
    };
    if let Some((message, timed_out)) = compile_error {
        return Ok(inputs
            .into_iter()
            .map(|_| RunResult {
                success: false,
                stdout: String::new(),
                stderr: message.clone(),
                compile_failed: true,
                exit_code: None,
                duration_ms: compile_duration_ms,
                compile_duration_ms,
                timed_out,
            })
            .collect());
    }

    let run_limit = Duration::from_millis(timeout_ms.unwrap_or(5000).clamp(500, 30000));
    let output_line_limit = output_line_limit.unwrap_or(300).clamp(1, 10_000);
    let python_runtime = data_center::tool_command(&app, "pythonInterpreter", "python");
    let java_runtime = data_center::tool_command(&app, "javaRuntime", "java");
    let semaphore = std::sync::Arc::new(Semaphore::new(4));
    let mut tasks = JoinSet::new();
    for (index, input) in inputs.into_iter().enumerate() {
        let semaphore = semaphore.clone();
        let language = language.clone();
        let source = source.clone();
        let workdir = workdir.clone();
        let python_runtime = python_runtime.clone();
        let java_runtime = java_runtime.clone();
        tasks.spawn(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .expect("test semaphore stays open");
            let result = run_prepared_code(
                language,
                source,
                workdir,
                input,
                run_limit,
                output_line_limit,
                compile_duration_ms,
                python_runtime,
                java_runtime,
            )
            .await;
            (index, result)
        });
    }
    let mut results = Vec::new();
    while let Some(item) = tasks.join_next().await {
        results.push(item.map_err(|e| format!("运行测试点任务失败: {}", e))?);
    }
    results.sort_by_key(|(index, _)| *index);
    Ok(results.into_iter().map(|(_, result)| result).collect())
}

const PYTHON_DEBUG_RUNNER: &str = r#"import io, json, runpy, sys, traceback
source, input_path, raw_lines = sys.argv[1], sys.argv[2], sys.argv[3]
breakpoints = {int(x) for x in raw_lines.split(',') if x}
snapshots = []
program_out, program_err = io.StringIO(), io.StringIO()
stop_at_first_line = not breakpoints
stopped_at_first_line = False

def safe_repr(value):
    try:
        text = repr(value)
        return text if len(text) <= 500 else text[:500] + '…'
    except Exception as exc:
        return '<repr failed: %s>' % exc

def tracer(frame, event, arg):
    global stopped_at_first_line
    should_stop = frame.f_lineno in breakpoints or (stop_at_first_line and not stopped_at_first_line)
    if event == 'line' and frame.f_code.co_filename == source and should_stop:
        stopped_at_first_line = True
        snapshots.append({
            'line': frame.f_lineno,
            'function': frame.f_code.co_name,
            'locals': {key: safe_repr(value) for key, value in frame.f_locals.items() if not key.startswith('__')},
            'stack': [f'{item.name} ({item.filename}:{item.lineno})' for item in traceback.extract_stack(frame)[-8:]],
        })
    return tracer

error = ''
old_in, old_out, old_err = sys.stdin, sys.stdout, sys.stderr
try:
    sys.stdin = open(input_path, 'r', encoding='utf-8')
    sys.stdout, sys.stderr = program_out, program_err
    sys.settrace(tracer)
    runpy.run_path(source, run_name='__main__')
except SystemExit as exc:
    if exc.code not in (None, 0): error = f'Program exited with {exc.code}'
except BaseException:
    error = traceback.format_exc()
finally:
    sys.settrace(None)
    sys.stdin, sys.stdout, sys.stderr = old_in, old_out, old_err

print(json.dumps({'snapshots': snapshots, 'stdout': program_out.getvalue(), 'stderr': program_err.getvalue(), 'error': error}, ensure_ascii=True))
"#;

fn debug_failure(
    adapter: &str,
    message: String,
    started: Instant,
    diagnostic: Option<String>,
) -> DebugResult {
    DebugResult {
        success: false,
        adapter: adapter.into(),
        output: String::new(),
        stdout: String::new(),
        stderr: message,
        duration_ms: started.elapsed().as_millis(),
        diagnostic,
    }
}

fn gdb_script(executable: &Path, source: &Path, input_path: &Path, breakpoints: &[u32]) -> String {
    // All files live in GDB's ASCII-only cache directory. Referencing only
    // filenames also avoids MinGW GDB misparsing spaces, brackets and Unicode.
    let source = source
        .file_name()
        .unwrap_or(source.as_os_str())
        .to_string_lossy();
    let input = input_path
        .file_name()
        .unwrap_or(input_path.as_os_str())
        .to_string_lossy();
    let executable = executable
        .file_name()
        .unwrap_or(executable.as_os_str())
        .to_string_lossy();
    let mut script = format!(
        "set pagination off\nset print pretty on\nfile \"{}\"\n",
        executable
    );
    if breakpoints.is_empty() {
        script.push_str("break main\ncommands\nsilent\nprintf \"\\n=== BREAKPOINT main ===\\n\"\ninfo locals\nbt 8\ncontinue\nend\n");
    } else {
        for line in breakpoints {
            script.push_str(&format!("break \"{}\":{}\ncommands\nsilent\nprintf \"\\n=== BREAKPOINT line {} ===\\n\"\ninfo locals\nbt 8\ncontinue\nend\n", source, line, line));
        }
    }
    script.push_str(&format!("run < \"{}\"\nquit\n", input));
    script
}

fn gdb_command(executable: &str, script_path: &Path, workdir: &Path) -> Command {
    let mut gdb = Command::new(executable);
    gdb.args(["--batch", "--quiet", "-x"])
        .arg(script_path.file_name().unwrap_or(script_path.as_os_str()))
        .current_dir(workdir);
    gdb
}

#[tauri::command]
pub async fn debug_code(
    app: AppHandle,
    platform: String,
    problem_id: String,
    language: String,
    code: String,
    input: String,
    breakpoints: Vec<u32>,
) -> Result<DebugResult, String> {
    let started = Instant::now();
    let source = draft_path(&app, &platform, &problem_id, None, &language)?;
    let workdir = source
        .parent()
        .ok_or_else(|| "无法定位调试目录".to_string())?;
    tokio::fs::create_dir_all(workdir)
        .await
        .map_err(|e| format!("创建调试目录失败: {}", e))?;
    tokio::fs::write(&source, &code)
        .await
        .map_err(|e| format!("保存调试代码失败: {}", e))?;
    let input_path = workdir.join("debug-input.txt");
    tokio::fs::write(&input_path, &input)
        .await
        .map_err(|e| format!("保存调试输入失败: {}", e))?;
    let active_breakpoints = breakpoints;

    match language.as_str() {
        "cpp" => {
            let gdb_workdir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("无法定位调试缓存目录: {e}"))?
                .join("debug-workspace")
                .join("cpp");
            tokio::fs::create_dir_all(&gdb_workdir)
                .await
                .map_err(|e| format!("创建 GDB 调试目录失败: {e}"))?;
            let debug_source = gdb_workdir.join("main.cpp");
            let debug_input = gdb_workdir.join("debug-input.txt");
            tokio::fs::write(&debug_source, &code)
                .await
                .map_err(|e| format!("准备 GDB 源码失败: {e}"))?;
            tokio::fs::write(&debug_input, &input)
                .await
                .map_err(|e| format!("准备 GDB 输入失败: {e}"))?;
            let executable = gdb_workdir.join("debug-main.exe");
            let mut compile = Command::new(data_center::tool_command(&app, "cppCompiler", "g++"));
            compile
                .arg(data_center::cpp_standard_flag(&app))
                .args(["-g", "-O0", "-fno-omit-frame-pointer"])
                .arg(&debug_source)
                .arg("-o")
                .arg(&executable)
                .current_dir(&gdb_workdir);
            match command_output(compile, None, Duration::from_secs(30)).await {
                Ok(output) if output.status.success() => {}
                Ok(output) => {
                    return Ok(debug_failure(
                        "gdb",
                        String::from_utf8_lossy(&output.stderr).into_owned(),
                        started,
                        None,
                    ))
                }
                Err(e) => return Ok(debug_failure("gdb", e, started, None)),
            }
            let script_path = gdb_workdir.join("acm-debug.gdb");
            tokio::fs::write(
                &script_path,
                gdb_script(
                    &executable,
                    &debug_source,
                    &debug_input,
                    &active_breakpoints,
                ),
            )
            .await
            .map_err(|e| format!("准备 GDB 脚本失败: {}", e))?;
            let gdb_executable = data_center::tool_command(&app, "cppDebugger", "gdb");
            let gdb = gdb_command(&gdb_executable, &script_path, &gdb_workdir);
            match command_output(gdb, None, Duration::from_secs(30)).await {
                Ok(output) => Ok(DebugResult { success: output.status.success(), adapter: "gdb".into(), output: String::from_utf8_lossy(&output.stdout).into_owned(), stdout: String::new(), stderr: String::from_utf8_lossy(&output.stderr).into_owned(), duration_ms: started.elapsed().as_millis(), diagnostic: None }),
                Err(e) if e.contains("未找到") => Ok(debug_failure("gdb", e, started, Some("请安装 GDB 并加入 PATH；Windows 可使用 MinGW-w64，Linux 使用系统包管理器。".into()))),
                Err(e) => Ok(debug_failure("gdb", e, started, None)),
            }
        }
        "python" => {
            let runner = workdir.join("acm_python_debugger.py");
            tokio::fs::write(&runner, PYTHON_DEBUG_RUNNER)
                .await
                .map_err(|e| format!("准备 Python 调试器失败: {}", e))?;
            let lines = active_breakpoints
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let mut command = Command::new(data_center::tool_command(
                &app,
                "pythonInterpreter",
                "python",
            ));
            command
                .arg(&runner)
                .arg(&source)
                .arg(&input_path)
                .arg(lines)
                .current_dir(workdir);
            match command_output(command, None, Duration::from_secs(30)).await {
                Ok(output) if output.status.success() => {
                    let raw = String::from_utf8_lossy(&output.stdout).into_owned();
                    let parsed: serde_json::Value = serde_json::from_str(raw.trim())
                        .map_err(|e| format!("解析 Python 调试结果失败: {}", e))?;
                    let snapshots = serde_json::to_string_pretty(
                        parsed.get("snapshots").unwrap_or(&serde_json::Value::Null),
                    )
                    .unwrap_or_default();
                    let error = parsed
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    Ok(DebugResult {
                        success: error.is_empty(),
                        adapter: "python-trace".into(),
                        output: snapshots,
                        stdout: parsed
                            .get("stdout")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .into(),
                        stderr: format!(
                            "{}{}",
                            parsed.get("stderr").and_then(|v| v.as_str()).unwrap_or(""),
                            error
                        ),
                        duration_ms: started.elapsed().as_millis(),
                        diagnostic: None,
                    })
                }
                Ok(output) => Ok(debug_failure(
                    "python-trace",
                    String::from_utf8_lossy(&output.stderr).into_owned(),
                    started,
                    None,
                )),
                Err(e) => Ok(debug_failure(
                    "python-trace",
                    e,
                    started,
                    Some("请安装 Python 3 并确保 python 命令已加入 PATH。".into()),
                )),
            }
        }
        "java" => {
            let java_source = workdir.join("Main.java");
            tokio::fs::copy(&source, &java_source)
                .await
                .map_err(|e| format!("准备 Java 调试源码失败: {}", e))?;
            let mut compile =
                Command::new(data_center::tool_command(&app, "javaCompiler", "javac"));
            compile.args(["-g", "Main.java"]).current_dir(workdir);
            match command_output(compile, None, Duration::from_secs(30)).await {
                Ok(output) if output.status.success() => {}
                Ok(output) => {
                    return Ok(debug_failure(
                        "jdb",
                        String::from_utf8_lossy(&output.stderr).into_owned(),
                        started,
                        None,
                    ))
                }
                Err(e) => {
                    return Ok(debug_failure(
                        "jdb",
                        e,
                        started,
                        Some("请安装完整 JDK（不是仅 JRE）并将 javac/jdb 加入 PATH。".into()),
                    ))
                }
            }
            let mut commands = String::new();
            if active_breakpoints.is_empty() {
                commands.push_str("stop in Main.main\n");
            } else {
                for line in &active_breakpoints {
                    commands.push_str(&format!("stop at Main:{}\n", line));
                }
            }
            commands.push_str("run\nlocals\nwhere\ncont\nexit\n");
            let mut jdb = Command::new(data_center::tool_command(&app, "javaDebugger", "jdb"));
            jdb.args(["-classpath", ".", "Main"]).current_dir(workdir);
            match command_output(jdb, Some(&commands), Duration::from_secs(30)).await {
                Ok(output) => Ok(DebugResult { success: output.status.success(), adapter: "jdb".into(), output: String::from_utf8_lossy(&output.stdout).into_owned(), stdout: String::new(), stderr: String::from_utf8_lossy(&output.stderr).into_owned(), duration_ms: started.elapsed().as_millis(), diagnostic: Some("JDB 批处理模式当前适合检查断点局部变量；需要交互输入的程序建议先用本地运行验证输入。".into()) }),
                Err(e) => Ok(debug_failure("jdb", e, started, Some("未找到 JDB。请安装完整 JDK，并将 JDK 的 bin 目录加入 PATH。".into()))),
            }
        }
        _ => Err(format!("不支持的调试语言: {}", language)),
    }
}

#[cfg(test)]
mod debug_tests {
    use super::*;
    use std::fs;

    fn temp_test_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("acm-helper-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn safe_segment_keeps_unicode_and_replaces_windows_forbidden_characters() {
        assert_eq!(safe_segment("中文题目"), "中文题目");
        assert_eq!(safe_segment("A/B:C*D?"), "A_B_C_D_");
        assert_eq!(safe_segment("..."), "untitled");
    }

    #[test]
    fn codeforces_translation_ids_cannot_escape_the_cache_directory() {
        assert_eq!(
            normalize_codeforces_translation_id(" 977a ").unwrap(),
            "977A"
        );
        assert_eq!(
            normalize_codeforces_translation_id("1930A1").unwrap(),
            "1930A1"
        );
        assert!(normalize_codeforces_translation_id("../977A").is_err());
        assert!(normalize_codeforces_translation_id("977A.md").is_err());
        assert!(normalize_codeforces_translation_id("P1000").is_err());
        assert_eq!(
            normalize_oj_translation("atcoder", "abc001_a").unwrap().1,
            "ABC001_A"
        );
        assert_eq!(
            normalize_oj_translation("qoj", " 18920 ").unwrap().1,
            "18920"
        );
        assert_eq!(
            normalize_oj_translation("qoj", "c1096a").unwrap().1,
            "C1096A"
        );
        assert!(normalize_oj_translation("qoj", "../18920").is_err());
        assert_eq!(
            normalize_oj_translation("luogu", " p1000 ").unwrap().1,
            "P1000"
        );
        assert!(normalize_oj_translation("luogu", "../P1000").is_err());
    }

    #[test]
    fn recognizes_supported_source_extensions() {
        assert_eq!(source_language(Path::new("P1000 A+B.cpp")), Some("cpp"));
        assert_eq!(source_language(Path::new("P1000 A+B.py")), Some("python"));
        assert_eq!(source_language(Path::new("P1000 A+B.java")), Some("java"));
        assert_eq!(source_language(Path::new("input.txt")), None);
    }

    #[test]
    fn real_workspace_tree_keeps_empty_folders_and_hides_metadata() {
        let root = temp_test_dir("workspace-tree");
        let folder = root.join("自建题单");
        let empty = root.join("空文件夹");
        fs::create_dir_all(&folder).unwrap();
        fs::create_dir_all(&empty).unwrap();
        fs::write(folder.join("练习.cpp"), "int main() {}\n").unwrap();
        fs::write(folder.join(".acm-meta.json"), "{}").unwrap();
        let entries = collect_workspace_entries(&root);
        assert_eq!(entries.len(), 2);
        let code_folder = entries.iter().find(|item| item.name == "自建题单").unwrap();
        assert_eq!(code_folder.children.len(), 1);
        assert_eq!(code_folder.children[0].language.as_deref(), Some("cpp"));
        assert!(entries
            .iter()
            .any(|item| item.name == "空文件夹" && item.children.is_empty()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_path_guard_rejects_targets_outside_root() {
        let root = temp_test_dir("workspace-guard");
        let inside = root.join("inside.cpp");
        fs::write(&inside, "").unwrap();
        assert!(canonical_workspace_target(&root, &inside).is_ok());
        let outside = std::env::temp_dir().join(format!("outside-{}.cpp", std::process::id()));
        fs::write(&outside, "").unwrap();
        assert!(canonical_workspace_target(&root, &outside).is_err());
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn flattens_source_and_problem_folders_into_the_day_directory() {
        let root = temp_test_dir("flat-date-layout");
        let old = root
            .join("2026")
            .join("08")
            .join("28")
            .join("luogu")
            .join("P1000 超级玛丽游戏");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("P1000 超级玛丽游戏.cpp"), "int main() {}\n").unwrap();
        fs::write(old.join("P1000 超级玛丽游戏.py"), "print('ok')\n").unwrap();
        fs::write(old.join("main.exe"), "generated executable").unwrap();
        fs::write(old.join("debug-input.txt"), "generated input").unwrap();
        fs::write(
            old.join(".acm-meta.json"),
            serde_json::to_vec(&DraftMetadata {
                title: "超级玛丽游戏".into(),
                created_at: 1_777_000_000,
                platform: "luogu".into(),
                problem_id: "P1000".into(),
                file_stem: "P1000 超级玛丽游戏".into(),
                statement_markdown: String::new(),
            })
            .unwrap(),
        )
        .unwrap();
        flatten_workspace_layout(&root).unwrap();
        let day = root.join("2026").join("08").join("28");
        let cpp = day.join("P1000 超级玛丽游戏.cpp");
        let python = day.join("P1000 超级玛丽游戏.py");
        assert!(cpp.exists() && python.exists());
        assert_eq!(read_source_metadata(&cpp).unwrap().problem_id, "P1000");
        assert_eq!(read_source_metadata(&python).unwrap().platform, "luogu");
        assert!(!day.join("luogu").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn flattening_preserves_user_created_empty_folders() {
        let root = temp_test_dir("flat-preserves-custom-folders");
        let custom = root.join("我的草稿").join("待整理");
        fs::create_dir_all(&custom).unwrap();

        flatten_workspace_layout(&root).unwrap();

        assert!(custom.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explorer_preserves_problem_title_and_original_creation_time() {
        let root = temp_test_dir("draft-metadata");
        let directory = root.join("codeforces").join("1A");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("main.cpp"), "int main() {}\n").unwrap();
        fs::write(directory.join("acm_python_debugger.py"), "helper").unwrap();
        fs::write(
            directory.join(".acm-meta.json"),
            serde_json::to_vec(&DraftMetadata {
                title: "Theatre Square".into(),
                created_at: 1_700_000_000,
                platform: String::new(),
                problem_id: String::new(),
                file_stem: String::new(),
                statement_markdown: String::new(),
            })
            .unwrap(),
        )
        .unwrap();

        let mut files = Vec::new();
        collect_drafts(&root, &root, &mut files);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].problem_id, "1A");
        assert_eq!(files[0].title.as_deref(), Some("Theatre Square"));
        assert_eq!(files[0].created_at, 1_700_000_000);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_statement_is_loaded_from_the_source_sidecar() {
        let root = temp_test_dir("local-statement");
        let source = root.join("自定义题目.cpp");
        fs::write(&source, "int main() {}\n").unwrap();
        write_source_metadata(
            &source,
            &DraftMetadata {
                title: "自定义题目".into(),
                created_at: 1_700_000_000,
                platform: "local".into(),
                problem_id: "local_test".into(),
                file_stem: "自定义题目".into(),
                statement_markdown: "# 题目\n\n求 $a+b$。".into(),
            },
        )
        .unwrap();

        let draft = draft_info_for_path(&source).unwrap();
        assert!(draft.unbound);
        assert_eq!(draft.problem_id, "local_test");
        assert_eq!(draft.statement_markdown, "# 题目\n\n求 $a+b$。");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn code_history_supports_snapshots_branches_and_safe_deletion() {
        let mut history = new_code_history();
        commit_code_history(&mut history, "初始解法", "int main() {}".into()).unwrap();
        let main_snapshot = history.branches[0].snapshots[0].id.clone();
        create_code_history_branch(&mut history, "优化", "int main() { return 0; }".into())
            .unwrap();
        assert_eq!(history.active_branch, "优化");
        assert_eq!(history.branches.len(), 2);
        assert!(create_code_history_branch(&mut history, "优化", String::new()).is_err());
        assert!(remove_code_history_branch(&mut history, "优化").is_err());

        history.active_branch = "main".into();
        remove_code_history_branch(&mut history, "优化").unwrap();
        remove_code_history_snapshot(&mut history, "main", &main_snapshot).unwrap();
        assert!(history.branches[0].snapshots.is_empty());
        assert!(remove_code_history_branch(&mut history, "main").is_err());
    }

    #[test]
    fn migrates_legacy_draft_to_real_date_hierarchy_and_named_file() {
        let root = temp_test_dir("draft-layout");
        let legacy = root.join("luogu").join("P1000");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("main.cpp"), "int main() {}\n").unwrap();
        fs::write(
            legacy.join(".acm-meta.json"),
            serde_json::to_vec(&DraftMetadata {
                title: "超级玛丽游戏".into(),
                created_at: 1_700_000_000,
                platform: String::new(),
                problem_id: String::new(),
                file_stem: String::new(),
                statement_markdown: String::new(),
            })
            .unwrap(),
        )
        .unwrap();

        let migrated =
            resolve_draft_path_in_root(&root, "luogu", "P1000", Some("超级玛丽游戏"), "cpp")
                .unwrap();
        assert!(migrated.exists());
        assert_eq!(
            migrated.file_name().and_then(|value| value.to_str()),
            Some("P1000 超级玛丽游戏.cpp")
        );
        let relative: Vec<_> = migrated.strip_prefix(&root).unwrap().components().collect();
        assert_eq!(relative.len(), 4, "应为 年/月/日/代码文件");
        assert!(!legacy.join("main.cpp").exists());

        let reopened = resolve_draft_path_in_root(&root, "luogu", "P1000", None, "cpp").unwrap();
        assert_eq!(reopened, migrated, "再次打开同一道题必须回到原文件");
        let mut files = Vec::new();
        collect_drafts(&root, &root, &mut files);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].platform, "luogu");
        assert_eq!(files[0].problem_id, "P1000");
        assert_eq!(files[0].title.as_deref(), Some("超级玛丽游戏"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn python_debugger_captures_locals() {
        let dir = temp_test_dir("python-debug");
        let source = dir.join("main.py");
        let input = dir.join("input.txt");
        let runner = dir.join("runner.py");
        fs::write(&source, "x = 2\ny = 3\nz = x + y\nprint(z)\n").unwrap();
        fs::write(&input, "").unwrap();
        fs::write(&runner, PYTHON_DEBUG_RUNNER).unwrap();
        let output = std::process::Command::new("python")
            .arg(&runner)
            .arg(&source)
            .arg(&input)
            .arg("3")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let body: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(body["stdout"], "5\n");
        assert_eq!(body["snapshots"][0]["line"], 3);
        assert_eq!(body["snapshots"][0]["locals"]["x"], "2");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gdb_debugger_captures_breakpoint() {
        let dir = temp_test_dir("gdb-debug");
        let source = dir.join("main.cpp");
        let input = dir.join("input.txt");
        let executable = dir.join("main.exe");
        fs::write(&source, "#include <iostream>\nint main() {\n int a, b;\n std::cin >> a >> b;\n int sum = a + b;\n std::cout << sum << '\\n';\n return 0;\n}\n").unwrap();
        fs::write(&input, "2 3\n").unwrap();
        let compile = std::process::Command::new("g++")
            .args(["-g", "-O0"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "{}",
            String::from_utf8_lossy(&compile.stderr)
        );
        let script = dir.join("debug.gdb");
        fs::write(&script, gdb_script(&executable, &source, &input, &[5])).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let output = runtime
            .block_on(command_output(
                gdb_command("gdb", &script, &dir),
                None,
                Duration::from_secs(20),
            ))
            .unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(text.contains("=== BREAKPOINT line 5 ==="), "{}", text);
        assert!(text.contains("a = 2"), "{}", text);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gdb_without_user_breakpoints_stops_at_main() {
        let dir = temp_test_dir("gdb-main");
        let script = gdb_script(
            &dir.join("main.exe"),
            &dir.join("main.cpp"),
            &dir.join("input.txt"),
            &[],
        );
        assert!(script.contains("break main\ncommands"));
        assert!(!script.contains(":1\ncommands"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gdb_script_uses_only_ascii_workspace_filenames() {
        let root = Path::new(r#"C:\solutions\P1284 [USACO02FEB] 中文题目"#);
        let script = gdb_script(
            &root.join("debug-main.exe"),
            &root.join("main.cpp"),
            &root.join("debug-input.txt"),
            &[7],
        );
        assert!(script.contains("file \"debug-main.exe\""));
        assert!(script.contains("break \"main.cpp\":7"));
        assert!(script.contains("run < \"debug-input.txt\""));
        assert!(!script.contains("USACO02FEB"));
        assert!(!script.contains("中文题目"));
    }

    #[test]
    fn truncates_run_output_to_the_first_configured_lines() {
        assert_eq!(truncate_output_lines("a\nb\n".into(), 2), "a\nb\n");
        assert_eq!(
            truncate_output_lines("a\nb\nc\nd".into(), 3),
            "[Truncated]\na\nb\nc"
        );
    }
}
