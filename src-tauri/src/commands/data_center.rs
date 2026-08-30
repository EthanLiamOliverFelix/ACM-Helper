use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const POINTER_FILE: &str = ".data-center-location.json";
const MANIFEST_FILE: &str = ".acm-helper-data-center.json";
const STATE_DIRECTORY: &str = "state";
const BACKUP_DIRECTORY: &str = ".backups";
const BACKUP_METADATA: &str = "backup.json";
const BACKUP_RETENTION: usize = 10;
const DATA_CENTER_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataCenterPointer {
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataCenterManifest {
    version: u32,
    migrated_at: u64,
    previous_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataCenterBackup {
    id: String,
    created_at: u64,
    reason: String,
    file_count: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCenterOperationResult {
    path: String,
    file_count: u64,
    total_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataCenterInfo {
    path: String,
    default_path: String,
    is_custom: bool,
    file_count: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCenterMigrationResult {
    info: DataCenterInfo,
    migrated_files: u64,
    migrated_bytes: u64,
    cleanup_warning: Option<String>,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn unix_now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn timestamp_id(now: u64) -> String {
    chrono::DateTime::from_timestamp(now as i64, 0)
        .unwrap_or_default()
        .format("%Y%m%d-%H%M%S")
        .to_string()
}

pub fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法定位默认数据目录: {error}"))
}

fn pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(default_root(app)?.join(POINTER_FILE))
}

fn read_pointer(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = pointer_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取数据中心位置失败: {error}")),
    };
    let pointer: DataCenterPointer =
        serde_json::from_str(&content).map_err(|error| format!("数据中心位置配置损坏: {error}"))?;
    let resolved = PathBuf::from(pointer.path);
    if !resolved.is_absolute() {
        return Err("数据中心位置必须是绝对路径".into());
    }
    Ok(Some(resolved))
}

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(read_pointer(app)?.unwrap_or(default_root(app)?))
}

fn write_pointer(app: &AppHandle, target: &Path) -> Result<(), String> {
    let default = default_root(app)?;
    fs::create_dir_all(&default).map_err(|error| format!("创建引导目录失败: {error}"))?;
    let pointer = pointer_path(app)?;
    if same_path(&default, target) {
        if pointer.exists() {
            fs::remove_file(pointer).map_err(|error| format!("恢复默认数据中心失败: {error}"))?;
        }
        return Ok(());
    }
    let json = serde_json::to_vec_pretty(&DataCenterPointer {
        path: target.to_string_lossy().into_owned(),
    })
    .map_err(|error| format!("序列化数据中心位置失败: {error}"))?;
    write_json_atomic(&pointer, &json).map_err(|error| format!("保存数据中心位置失败: {error}"))
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn valid_state_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 80
        && key
            .bytes()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'-')
}

fn state_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_state_key(key) {
        return Err("无效的数据中心项目名称".into());
    }
    Ok(root(app)?.join(STATE_DIRECTORY).join(format!("{key}.json")))
}

fn directory_stats(path: &Path, top_level: bool) -> Result<(u64, u64), String> {
    if !path.exists() {
        return Ok((0, 0));
    }
    let mut files = 0u64;
    let mut bytes = 0u64;
    for entry in fs::read_dir(path).map_err(|error| format!("读取数据目录失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取数据项目失败: {error}"))?;
        let name = entry.file_name();
        if top_level
            && matches!(
                name.to_string_lossy().as_ref(),
                POINTER_FILE | BACKUP_DIRECTORY
            )
        {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("读取数据项目属性失败: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "数据中心不支持符号链接: {}",
                entry.path().display()
            ));
        }
        if metadata.is_dir() {
            let nested = directory_stats(&entry.path(), false)?;
            files += nested.0;
            bytes += nested.1;
        } else {
            files += 1;
            bytes += metadata.len();
        }
    }
    Ok((files, bytes))
}

fn write_json_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建数据目录失败: {error}"))?;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let temporary = path.with_extension(format!("{extension}.tmp"));
    let previous = path.with_extension(format!("{extension}.previous"));
    {
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("创建临时文件失败: {error}"))?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("写入临时文件失败: {error}"))?;
    }
    if previous.exists() {
        fs::remove_file(&previous).map_err(|error| format!("清理旧保护文件失败: {error}"))?;
    }
    if path.exists() {
        fs::rename(path, &previous).map_err(|error| format!("保护旧数据失败: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if previous.exists() {
            let _ = fs::rename(&previous, path);
        }
        return Err(format!("替换数据文件失败: {error}"));
    }
    if previous.exists() {
        fs::remove_file(previous).map_err(|error| format!("清理保护文件失败: {error}"))?;
    }
    Ok(())
}

fn info_for(app: &AppHandle, path: &Path) -> Result<DataCenterInfo, String> {
    let default = default_root(app)?;
    let stats = directory_stats(path, same_path(path, &default))?;
    Ok(DataCenterInfo {
        path: path.to_string_lossy().into_owned(),
        default_path: default.to_string_lossy().into_owned(),
        is_custom: !same_path(path, &default),
        file_count: stats.0,
        total_bytes: stats.1,
    })
}

fn copy_file_verified(source: &Path, target: &Path) -> Result<u64, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建迁移目录失败: {error}"))?;
    }
    fs::copy(source, target).map_err(|error| format!("复制 {} 失败: {error}", source.display()))?;
    let source_len = fs::metadata(source)
        .map_err(|error| format!("读取源文件属性失败: {error}"))?
        .len();
    let target_len = fs::metadata(target)
        .map_err(|error| format!("读取目标文件属性失败: {error}"))?
        .len();
    if source_len != target_len {
        return Err(format!("迁移校验失败，文件长度不同: {}", source.display()));
    }
    let mut source_file =
        fs::File::open(source).map_err(|error| format!("校验源文件失败: {error}"))?;
    let mut target_file =
        fs::File::open(target).map_err(|error| format!("校验目标文件失败: {error}"))?;
    let mut source_buffer = [0u8; 64 * 1024];
    let mut target_buffer = [0u8; 64 * 1024];
    loop {
        let source_read = source_file
            .read(&mut source_buffer)
            .map_err(|error| format!("读取源文件失败: {error}"))?;
        let target_read = target_file
            .read(&mut target_buffer)
            .map_err(|error| format!("读取目标文件失败: {error}"))?;
        if source_read != target_read
            || source_buffer[..source_read] != target_buffer[..target_read]
        {
            return Err(format!("迁移校验失败，文件内容不同: {}", source.display()));
        }
        if source_read == 0 {
            break;
        }
    }
    Ok(source_len)
}

fn copy_directory_verified(
    source: &Path,
    target: &Path,
    top_level: bool,
) -> Result<(u64, u64), String> {
    fs::create_dir_all(target).map_err(|error| format!("创建目标数据中心失败: {error}"))?;
    let mut files = 0u64;
    let mut bytes = 0u64;
    for entry in fs::read_dir(source).map_err(|error| format!("读取原数据中心失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取原数据项目失败: {error}"))?;
        let name = entry.file_name();
        if top_level && name.to_string_lossy() == POINTER_FILE {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(&name);
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("读取迁移项目属性失败: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "数据中心不支持迁移符号链接: {}",
                source_path.display()
            ));
        }
        if metadata.is_dir() {
            let nested = copy_directory_verified(&source_path, &target_path, false)?;
            files += nested.0;
            bytes += nested.1;
        } else {
            bytes += copy_file_verified(&source_path, &target_path)?;
            files += 1;
        }
    }
    Ok((files, bytes))
}

fn copy_business_directory(source: &Path, target: &Path) -> Result<(u64, u64), String> {
    fs::create_dir_all(target).map_err(|error| format!("创建目标目录失败: {error}"))?;
    let mut files = 0;
    let mut bytes = 0;
    for entry in fs::read_dir(source).map_err(|error| format!("读取数据中心失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取数据项目失败: {error}"))?;
        let name = entry.file_name();
        if matches!(
            name.to_string_lossy().as_ref(),
            POINTER_FILE | BACKUP_DIRECTORY | BACKUP_METADATA
        ) {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(&name);
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("读取数据项目属性失败: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("数据中心不支持符号链接: {}", source_path.display()));
        }
        if metadata.is_dir() {
            let nested = copy_directory_verified(&source_path, &target_path, false)?;
            files += nested.0;
            bytes += nested.1;
        } else {
            bytes += copy_file_verified(&source_path, &target_path)?;
            files += 1;
        }
    }
    Ok((files, bytes))
}

fn clear_business_directory(path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|error| format!("读取数据中心失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取数据项目失败: {error}"))?;
        let name = entry.file_name();
        if matches!(
            name.to_string_lossy().as_ref(),
            POINTER_FILE | BACKUP_DIRECTORY
        ) {
            continue;
        }
        let item = entry.path();
        let metadata =
            fs::symlink_metadata(&item).map_err(|error| format!("读取待替换项目失败: {error}"))?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir_all(&item)
                .map_err(|error| format!("清理目录 {} 失败: {error}", item.display()))?;
        } else {
            fs::remove_file(&item)
                .map_err(|error| format!("清理文件 {} 失败: {error}", item.display()))?;
        }
    }
    Ok(())
}

fn write_manifest(path: &Path, previous_path: &str) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(&DataCenterManifest {
        version: DATA_CENTER_VERSION,
        migrated_at: unix_now(),
        previous_path: previous_path.into(),
    })
    .map_err(|error| format!("生成数据中心清单失败: {error}"))?;
    write_json_atomic(&path.join(MANIFEST_FILE), &content)
}

fn list_backups_in_root(root: &Path) -> Result<Vec<DataCenterBackup>, String> {
    let directory = root.join(BACKUP_DIRECTORY);
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| format!("读取备份目录失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取备份项目失败: {error}"))?;
        if !entry.path().is_dir() {
            continue;
        }
        let metadata = fs::read_to_string(entry.path().join(BACKUP_METADATA))
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok());
        let created_at = metadata
            .as_ref()
            .and_then(|value| value.get("createdAt"))
            .and_then(Value::as_u64)
            .or_else(|| {
                entry
                    .metadata()
                    .ok()
                    .and_then(|value| value.modified().ok())
                    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|value| value.as_secs())
            })
            .unwrap_or(0);
        let stats = directory_stats(&entry.path(), false)?;
        backups.push(DataCenterBackup {
            id: entry.file_name().to_string_lossy().into_owned(),
            created_at,
            reason: metadata
                .as_ref()
                .and_then(|value| value.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("manual")
                .into(),
            file_count: metadata
                .as_ref()
                .and_then(|value| value.get("fileCount"))
                .and_then(Value::as_u64)
                .unwrap_or(stats.0),
            total_bytes: metadata
                .as_ref()
                .and_then(|value| value.get("totalBytes"))
                .and_then(Value::as_u64)
                .unwrap_or(stats.1),
        });
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn backup_from_root(root: &Path, reason: &str) -> Result<DataCenterBackup, String> {
    let now = unix_now();
    let id = format!(
        "{}-{}-{}",
        timestamp_id(now),
        unix_now_millis(),
        reason.replace(|value: char| !value.is_ascii_alphanumeric(), "-")
    );
    let folder = root.join(BACKUP_DIRECTORY).join(&id);
    let (file_count, total_bytes) = copy_business_directory(root, &folder)?;
    let metadata = serde_json::json!({ "id": id, "createdAt": now, "reason": reason, "fileCount": file_count, "totalBytes": total_bytes });
    write_json_atomic(
        &folder.join(BACKUP_METADATA),
        &serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?,
    )?;
    let mut backups = list_backups_in_root(root)?;
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    for old in backups.into_iter().skip(BACKUP_RETENTION) {
        let old_path = root.join(BACKUP_DIRECTORY).join(old.id);
        if old_path.is_dir() {
            let _ = fs::remove_dir_all(old_path);
        }
    }
    Ok(DataCenterBackup {
        id,
        created_at: now,
        reason: reason.into(),
        file_count,
        total_bytes,
    })
}

fn directory_is_empty_except_pointer(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    for entry in fs::read_dir(path).map_err(|error| format!("读取目标目录失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取目标项目失败: {error}"))?;
        if entry.file_name().to_string_lossy() != POINTER_FILE {
            return Ok(false);
        }
    }
    Ok(true)
}

fn cleanup_source(source: &Path, preserve_pointer: bool) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|error| format!("读取旧数据中心失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取旧数据项目失败: {error}"))?;
        if preserve_pointer && entry.file_name().to_string_lossy() == POINTER_FILE {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("读取旧数据项目属性失败: {error}"))?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("清理旧目录 {} 失败: {error}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|error| format!("清理旧文件 {} 失败: {error}", path.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_data_center_info(app: AppHandle) -> Result<DataCenterInfo, String> {
    let path = root(&app)?;
    fs::create_dir_all(&path).map_err(|error| format!("创建数据中心失败: {error}"))?;
    if !path.join(MANIFEST_FILE).exists() {
        write_manifest(&path, "legacy")?;
    }
    info_for(&app, &path)
}

#[tauri::command]
pub async fn read_data_center_value(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let path = state_path(&app, &key)?;
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| format!("数据中心项目 {key} 损坏: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取数据中心项目 {key} 失败: {error}")),
    }
}

#[tauri::command]
pub async fn write_data_center_value(
    app: AppHandle,
    key: String,
    value: Value,
) -> Result<(), String> {
    let path = state_path(&app, &key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建数据中心状态目录失败: {error}"))?;
    }
    let content = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("序列化数据中心项目 {key} 失败: {error}"))?;
    write_json_atomic(&path, &content)
        .map_err(|error| format!("保存数据中心项目 {key} 失败: {error}"))
}

#[tauri::command]
pub async fn create_data_center_backup(
    app: AppHandle,
    reason: Option<String>,
) -> Result<DataCenterBackup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        fs::create_dir_all(&root).map_err(|error| format!("创建数据中心失败: {error}"))?;
        backup_from_root(&root, reason.as_deref().unwrap_or("manual"))
    })
    .await
    .map_err(|error| format!("创建备份任务失败: {error}"))?
}

#[tauri::command]
pub async fn ensure_daily_data_center_backup(
    app: AppHandle,
) -> Result<Option<DataCenterBackup>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        fs::create_dir_all(&root).map_err(|error| format!("创建数据中心失败: {error}"))?;
        let latest = list_backups_in_root(&root)?
            .first()
            .map(|backup| backup.created_at)
            .unwrap_or(0);
        if unix_now().saturating_sub(latest) < 24 * 60 * 60 {
            return Ok(None);
        }
        backup_from_root(&root, "daily").map(Some)
    })
    .await
    .map_err(|error| format!("自动备份任务失败: {error}"))?
}

#[tauri::command]
pub async fn list_data_center_backups(app: AppHandle) -> Result<Vec<DataCenterBackup>, String> {
    tauri::async_runtime::spawn_blocking(move || list_backups_in_root(&root(&app)?))
        .await
        .map_err(|error| format!("读取备份任务失败: {error}"))?
}

#[tauri::command]
pub async fn restore_data_center_backup(
    app: AppHandle,
    id: String,
) -> Result<DataCenterOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if id.contains('/') || id.contains('\\') || id.contains("..") {
            return Err("无效的备份编号".into());
        }
        let root = root(&app)?;
        let source = root.join(BACKUP_DIRECTORY).join(&id);
        if !source.is_dir() {
            return Err("备份不存在".into());
        }
        let _guard = backup_from_root(&root, "before-restore")?;
        clear_business_directory(&root)?;
        let (file_count, total_bytes) = copy_business_directory(&source, &root)?;
        write_manifest(&root, &format!("backup:{id}"))?;
        Ok(DataCenterOperationResult {
            path: root.to_string_lossy().into_owned(),
            file_count,
            total_bytes,
        })
    })
    .await
    .map_err(|error| format!("恢复备份任务失败: {error}"))?
}

#[tauri::command]
pub async fn export_data_center(
    app: AppHandle,
) -> Result<Option<DataCenterOperationResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(parent) = rfd::FileDialog::new()
            .set_title("选择数据中心导出位置")
            .pick_folder()
        else {
            return Ok(None);
        };
        let source = root(&app)?;
        let target = parent.join(format!("ACM-Helper-Export-{}", timestamp_id(unix_now())));
        if target.exists() {
            return Err("同名导出目录已经存在，请稍后重试".into());
        }
        let (file_count, total_bytes) = copy_business_directory(&source, &target)?;
        write_manifest(&target, &source.to_string_lossy())?;
        Ok(Some(DataCenterOperationResult {
            path: target.to_string_lossy().into_owned(),
            file_count,
            total_bytes,
        }))
    })
    .await
    .map_err(|error| format!("导出数据中心任务失败: {error}"))?
}

#[tauri::command]
pub async fn import_data_center(
    app: AppHandle,
) -> Result<Option<DataCenterOperationResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(source) = rfd::FileDialog::new()
            .set_title("选择 ACM Helper 数据中心导出目录")
            .pick_folder()
        else {
            return Ok(None);
        };
        let manifest: DataCenterManifest = serde_json::from_slice(
            &fs::read(source.join(MANIFEST_FILE))
                .map_err(|_| "所选目录不是有效的数据中心导出包")?,
        )
        .map_err(|error| format!("数据中心清单损坏: {error}"))?;
        if manifest.version > DATA_CENTER_VERSION {
            return Err("该导出包来自更高版本，请先升级应用".into());
        }
        let root = root(&app)?;
        if source.starts_with(&root) {
            return Err("不能从当前数据中心内部导入".into());
        }
        let _guard = backup_from_root(&root, "before-import")?;
        let staging = std::env::temp_dir().join(format!("acm-helper-import-{}", unix_now_millis()));
        let checked = copy_business_directory(&source, &staging)?;
        clear_business_directory(&root)?;
        let copied = copy_business_directory(&staging, &root)?;
        let _ = fs::remove_dir_all(&staging);
        write_manifest(&root, &source.to_string_lossy())?;
        if checked != copied {
            return Err("导入后的文件校验不一致，已保留导入前备份".into());
        }
        Ok(Some(DataCenterOperationResult {
            path: root.to_string_lossy().into_owned(),
            file_count: copied.0,
            total_bytes: copied.1,
        }))
    })
    .await
    .map_err(|error| format!("导入数据中心任务失败: {error}"))?
}

#[tauri::command]
pub async fn pick_data_center_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok::<_, String>(
            rfd::FileDialog::new()
                .set_title("选择 ACM Helper 数据中心目录")
                .pick_folder()
                .map(|path| path.to_string_lossy().into_owned()),
        )
    })
    .await
    .map_err(|error| format!("打开目录选择器失败: {error}"))?
}

#[tauri::command]
pub async fn pick_toolchain_executable(title: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();
        dialog = dialog.set_title(title.as_deref().unwrap_or("选择工具链程序"));
        #[cfg(windows)]
        {
            dialog = dialog.add_filter("可执行程序", &["exe"]);
        }
        Ok::<_, String>(
            dialog
                .pick_file()
                .map(|path| path.to_string_lossy().into_owned()),
        )
    })
    .await
    .map_err(|error| format!("打开程序选择器失败: {error}"))?
}

#[tauri::command]
pub async fn migrate_data_center(
    app: AppHandle,
    new_path: String,
) -> Result<DataCenterMigrationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let requested = PathBuf::from(new_path.trim());
        if !requested.is_absolute() {
            return Err("请选择完整的绝对路径".into());
        }
        let current = root(&app)?;
        fs::create_dir_all(&current).map_err(|error| format!("访问当前数据中心失败: {error}"))?;
        fs::create_dir_all(&requested).map_err(|error| format!("创建目标数据中心失败: {error}"))?;
        let current =
            fs::canonicalize(&current).map_err(|error| format!("解析当前数据中心失败: {error}"))?;
        let target = fs::canonicalize(&requested)
            .map_err(|error| format!("解析目标数据中心失败: {error}"))?;
        if same_path(&current, &target) {
            return Ok(DataCenterMigrationResult {
                info: info_for(&app, &current)?,
                migrated_files: 0,
                migrated_bytes: 0,
                cleanup_warning: None,
            });
        }
        if target.starts_with(&current) || current.starts_with(&target) {
            return Err("新旧数据中心不能互相包含，请选择独立文件夹".into());
        }
        let default = fs::canonicalize(default_root(&app)?).unwrap_or(default_root(&app)?);
        let target_is_default = same_path(&target, &default);
        if !(target_is_default && directory_is_empty_except_pointer(&target)?)
            && !directory_is_empty_except_pointer(&target)?
        {
            return Err("目标文件夹必须为空，避免覆盖已有文件".into());
        }

        let (migrated_files, migrated_bytes) =
            copy_directory_verified(&current, &target, same_path(&current, &default))?;
        write_manifest(&target, &current.to_string_lossy())?;

        write_pointer(&app, &target)?;
        let cleanup_warning = cleanup_source(&current, same_path(&current, &default)).err();
        let info = info_for(&app, &target)?;
        Ok(DataCenterMigrationResult {
            info,
            migrated_files,
            migrated_bytes,
            cleanup_warning,
        })
    })
    .await
    .map_err(|error| format!("数据中心迁移任务失败: {error}"))?
}

pub fn tool_command(app: &AppHandle, key: &str, fallback: &str) -> String {
    let configured = state_path(app, "settings")
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.get("toolchainPaths").cloned())
        .and_then(|paths| {
            paths
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(str::to_string)
        });
    if let Some(configured) = configured {
        return configured.to_string();
    }
    let executable_name = match key {
        "cppCompiler" => "g++.exe",
        "cppDebugger" => "gdb.exe",
        "pythonInterpreter" => "python.exe",
        "javaCompiler" => "javac.exe",
        "javaRuntime" => "java.exe",
        "javaDebugger" => "jdb.exe",
        _ => return fallback.into(),
    };
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("tools")))
        .and_then(|root| find_bundled_tool(&root, executable_name, 0))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| fallback.into())
}

fn find_bundled_tool(directory: &Path, executable_name: &str, depth: usize) -> Option<PathBuf> {
    if depth > 6 || !directory.is_dir() {
        return None;
    }
    let mut entries = fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in &entries {
        let path = entry.path();
        if path.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(executable_name)
        {
            return Some(path);
        }
    }
    for entry in entries {
        if let Some(found) = find_bundled_tool(&entry.path(), executable_name, depth + 1) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_safe_state_keys() {
        assert!(valid_state_key("problem-sets"));
        assert!(valid_state_key("ui-layout-2"));
        assert!(!valid_state_key("../session"));
        assert!(!valid_state_key("Settings"));
    }

    #[test]
    fn copies_and_verifies_nested_files() {
        let base = std::env::temp_dir().join(format!("acm-data-center-test-{}", unix_now()));
        let source = base.join("source");
        let target = base.join("target");
        fs::create_dir_all(source.join("notes")).unwrap();
        fs::write(source.join("notes").join("测试.md"), "内容").unwrap();
        let result = copy_directory_verified(&source, &target, true).unwrap();
        assert_eq!(result.0, 1);
        assert_eq!(
            fs::read_to_string(target.join("notes").join("测试.md")).unwrap(),
            "内容"
        );
        let _ = fs::remove_dir_all(base);
    }
}
