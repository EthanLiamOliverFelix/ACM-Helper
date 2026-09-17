use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::data_center;

const UNFILED_FOLDER: &str = "未归档";
const INDEX_FILE: &str = ".problem-note-index.json";
const ASSET_FOLDER: &str = ".assets";
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    name: String,
    path: String,
    is_directory: bool,
    updated_at: u64,
    children: Vec<NoteEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    name: String,
    path: String,
    content: String,
    updated_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteImageAsset {
    id: String,
    reference: String,
    data_url: String,
    display_name: String,
}

fn image_format(path: &Path) -> Option<(&'static str, &'static str)> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some(("png", "image/png")),
        "jpg" | "jpeg" => Some(("jpg", "image/jpeg")),
        "gif" => Some(("gif", "image/gif")),
        "webp" => Some(("webp", "image/webp")),
        "bmp" => Some(("bmp", "image/bmp")),
        _ => None,
    }
}

fn note_assets_directory(app: &AppHandle, note_path: &str) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    ensure_root(&root)?;
    match canonical_target(&root, Path::new(note_path)) {
        Ok(note) if note.is_file() && is_markdown(&note) => {}
        _ => super::workspace::validate_statement_image_owner(app, note_path)?,
    }
    let directory = canonical_root(&root)?.join(ASSET_FOLDER);
    fs::create_dir_all(&directory).map_err(|error| format!("创建笔记图片目录失败: {error}"))?;
    Ok(directory)
}

fn unique_asset_path(directory: &Path, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    for suffix in 0..10_000_u32 {
        let id = if suffix == 0 {
            format!("{timestamp}.{extension}")
        } else {
            format!("{timestamp}-{suffix}.{extension}")
        };
        let candidate = directory.join(id);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{timestamp}-overflow.{extension}"))
}

fn asset_document(path: &Path, display_name: String) -> Result<NoteImageAsset, String> {
    let id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "笔记图片文件名无效".to_string())?
        .to_string();
    let (_, mime) = image_format(path).ok_or_else(|| "不支持该图片格式".to_string())?;
    let metadata = fs::metadata(path).map_err(|error| format!("读取笔记图片信息失败: {error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("笔记图片不能超过 20 MB".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("读取笔记图片失败: {error}"))?;
    Ok(NoteImageAsset {
        reference: format!("acm-note-image://{id}"),
        data_url: format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        id,
        display_name,
    })
}

fn validate_asset_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        || Path::new(value).file_name().and_then(|name| name.to_str()) != Some(value)
    {
        return Err("笔记图片引用无效".into());
    }
    image_format(Path::new(value)).ok_or_else(|| "笔记图片格式无效".to_string())?;
    Ok(value)
}

#[tauri::command]
pub async fn pick_note_image(
    app: AppHandle,
    note_path: String,
) -> Result<Option<NoteImageAsset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = note_assets_directory(&app, &note_path)?;
        let Some(source) = rfd::FileDialog::new()
            .set_title("选择要插入笔记的图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
            .pick_file()
        else {
            return Ok(None);
        };
        let (extension, _) = image_format(&source)
            .ok_or_else(|| "支持 PNG、JPEG、GIF、WebP 和 BMP 图片".to_string())?;
        let metadata =
            fs::metadata(&source).map_err(|error| format!("读取图片信息失败: {error}"))?;
        if metadata.len() > MAX_IMAGE_BYTES {
            return Err("图片不能超过 20 MB".into());
        }
        let display_name = source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let target = unique_asset_path(&directory, extension);
        fs::copy(&source, &target).map_err(|error| format!("导入笔记图片失败: {error}"))?;
        asset_document(&target, display_name).map(Some)
    })
    .await
    .map_err(|error| format!("打开图片选择器失败: {error}"))?
}

#[tauri::command]
pub async fn paste_note_image(app: AppHandle, note_path: String) -> Result<NoteImageAsset, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = note_assets_directory(&app, &note_path)?;
        let mut clipboard =
            arboard::Clipboard::new().map_err(|error| format!("无法访问剪贴板: {error}"))?;
        let clipboard_image = clipboard
            .get_image()
            .map_err(|_| "剪贴板中没有可用图片".to_string())?;
        let width =
            u32::try_from(clipboard_image.width).map_err(|_| "剪贴板图片宽度无效".to_string())?;
        let height =
            u32::try_from(clipboard_image.height).map_err(|_| "剪贴板图片高度无效".to_string())?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 40_000_000 {
            return Err("剪贴板图片尺寸过大或无效".into());
        }
        let target = unique_asset_path(&directory, "png");
        image::save_buffer_with_format(
            &target,
            clipboard_image.bytes.as_ref(),
            width,
            height,
            image::ColorType::Rgba8,
            image::ImageFormat::Png,
        )
        .map_err(|error| format!("保存剪贴板图片失败: {error}"))?;
        asset_document(&target, "剪贴板图片.png".into())
    })
    .await
    .map_err(|error| format!("读取剪贴板图片任务失败: {error}"))?
}

#[tauri::command]
pub async fn load_note_image_assets(
    app: AppHandle,
    note_path: String,
    asset_ids: Vec<String>,
) -> Result<Vec<NoteImageAsset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = note_assets_directory(&app, &note_path)?;
        asset_ids
            .into_iter()
            .map(|id| {
                let id = validate_asset_id(&id)?;
                let path = directory.join(id);
                if !path.is_file() {
                    return Err(format!("笔记图片不存在: {id}"));
                }
                let canonical_directory = fs::canonicalize(&directory)
                    .map_err(|error| format!("无法访问笔记图片目录: {error}"))?;
                let canonical_path = fs::canonicalize(&path)
                    .map_err(|error| format!("无法访问笔记图片: {error}"))?;
                if !canonical_path.starts_with(canonical_directory) {
                    return Err("笔记图片超出资源目录".into());
                }
                asset_document(&canonical_path, id.to_string())
            })
            .collect()
    })
    .await
    .map_err(|error| format!("加载笔记图片任务失败: {error}"))?
}

fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_center::root(app)?.join("notes"))
}

fn modified_millis(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("名称不能为空".into());
    }
    if trimmed.ends_with([' ', '.'])
        || trimmed.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
    {
        return Err("名称不能包含 \\ / : * ? \" < > | 或控制字符，也不能以空格或句点结尾".into());
    }
    Ok(trimmed.to_string())
}

fn safe_generated_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches([' ', '.']);
    if trimmed.is_empty() {
        "未命名笔记".into()
    } else {
        trimmed.chars().take(96).collect()
    }
}

fn markdown_name(value: &str) -> Result<String, String> {
    let name = validate_name(value)?;
    match Path::new(&name)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        None => Ok(format!("{}.md", name)),
        Some(extension) if extension.eq_ignore_ascii_case("md") => Ok(name),
        Some(_) => Err("笔记文件仅支持 .md 格式".into()),
    }
}

fn ensure_root(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root.join(UNFILED_FOLDER))
        .map_err(|error| format!("创建笔记目录失败: {}", error))
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    ensure_root(root)?;
    std::fs::canonicalize(root).map_err(|error| format!("无法访问笔记目录: {}", error))
}

fn canonical_target(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let target = std::fs::canonicalize(target)
        .map_err(|error| format!("笔记不存在或无法访问: {}", error))?;
    if target == root || !target.starts_with(&root) {
        return Err("仅允许操作本地笔记目录内的项目".into());
    }
    Ok(target)
}

fn canonical_parent(root: &Path, parent: Option<&str>) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let parent = match parent.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            std::fs::canonicalize(value).map_err(|error| format!("父文件夹不存在: {}", error))?
        }
        None => root.clone(),
    };
    if !parent.starts_with(&root) || !parent.is_dir() {
        return Err("只能在本地笔记目录内创建项目".into());
    }
    Ok(parent)
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

fn collect_entries(directory: &Path) -> Vec<NoteEntry> {
    let Ok(children) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for child in children.flatten() {
        let path = child.path();
        let name = child.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || (!path.is_dir() && !is_markdown(&path)) {
            continue;
        }
        entries.push(NoteEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_directory: path.is_dir(),
            updated_at: modified_millis(&path),
            children: if path.is_dir() {
                collect_entries(&path)
            } else {
                Vec::new()
            },
        });
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    entries
}

fn document(path: &Path) -> Result<NoteDocument, String> {
    if path.is_dir() || !is_markdown(path) {
        return Err("只能打开 Markdown 笔记文件".into());
    }
    let content =
        std::fs::read_to_string(path).map_err(|error| format!("读取笔记失败: {}", error))?;
    Ok(NoteDocument {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        content,
        updated_at: modified_millis(path),
    })
}

fn index_path(root: &Path) -> PathBuf {
    root.join(INDEX_FILE)
}

fn load_index(root: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(index_path(root))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_index(root: &Path, index: &HashMap<String, String>) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("保存题目笔记索引失败: {}", error))?;
    std::fs::write(index_path(root), content)
        .map_err(|error| format!("保存题目笔记索引失败: {}", error))
}

fn relative_string(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|_| "笔记路径超出笔记目录".to_string())
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn rewrite_index_prefix(
    root: &Path,
    old_relative: &str,
    new_relative: Option<&str>,
) -> Result<(), String> {
    let mut index = load_index(root);
    let prefix = format!("{}/", old_relative.trim_end_matches('/'));
    let mut changed = false;
    index.retain(|_, value| {
        if value == old_relative || value.starts_with(&prefix) {
            changed = true;
            if let Some(new_prefix) = new_relative {
                let suffix = value.strip_prefix(old_relative).unwrap_or("");
                *value = format!("{}{}", new_prefix.trim_end_matches('/'), suffix);
                true
            } else {
                false
            }
        } else {
            true
        }
    });
    if changed {
        save_index(root, &index)?;
    }
    Ok(())
}

fn available_target(parent: &Path, source: &Path) -> PathBuf {
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().into_owned());
    for index in 1..10_000 {
        let label = if index == 1 {
            format!("{} - 副本", stem)
        } else {
            format!("{} - 副本 ({})", stem, index)
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
    parent.join(format!("{}-副本", stem))
}

fn copy_directory(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir(target).map_err(|error| format!("创建目标文件夹失败: {}", error))?;
    for child in std::fs::read_dir(source)
        .map_err(|error| format!("读取源文件夹失败: {}", error))?
        .flatten()
    {
        let source_child = child.path();
        let target_child = target.join(child.file_name());
        if source_child.is_dir() {
            copy_directory(&source_child, &target_child)?;
        } else {
            std::fs::copy(&source_child, &target_child)
                .map_err(|error| format!("复制笔记失败: {}", error))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn notes_root_path(app: AppHandle) -> Result<String, String> {
    let root = notes_root(&app)?;
    ensure_root(&root)?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn list_note_entries(app: AppHandle) -> Result<Vec<NoteEntry>, String> {
    let root = notes_root(&app)?;
    ensure_root(&root)?;
    tauri::async_runtime::spawn_blocking(move || collect_entries(&root))
        .await
        .map_err(|error| format!("扫描笔记目录失败: {}", error))
}

#[tauri::command]
pub async fn read_note(app: AppHandle, path: String) -> Result<NoteDocument, String> {
    let root = notes_root(&app)?;
    let target = canonical_target(&root, Path::new(&path))?;
    document(&target)
}

#[tauri::command]
pub async fn save_note(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<NoteDocument, String> {
    let root = notes_root(&app)?;
    let target = canonical_target(&root, Path::new(&path))?;
    if target.is_dir() || !is_markdown(&target) {
        return Err("只能保存 Markdown 笔记文件".into());
    }
    tokio::fs::write(&target, content)
        .await
        .map_err(|error| format!("保存笔记失败: {}", error))?;
    document(&target)
}

#[tauri::command]
pub async fn create_note_folder(
    app: AppHandle,
    parent_path: Option<String>,
    name: String,
) -> Result<String, String> {
    let root = notes_root(&app)?;
    let parent = canonical_parent(&root, parent_path.as_deref())?;
    let target = parent.join(validate_name(&name)?);
    if target.exists() {
        return Err("同名文件或文件夹已经存在".into());
    }
    tokio::fs::create_dir(&target)
        .await
        .map_err(|error| format!("创建笔记文件夹失败: {}", error))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn create_note_file(
    app: AppHandle,
    parent_path: Option<String>,
    name: String,
) -> Result<NoteDocument, String> {
    let root = notes_root(&app)?;
    let parent = canonical_parent(&root, parent_path.as_deref())?;
    let filename = markdown_name(&name)?;
    let target = parent.join(&filename);
    if target.exists() {
        return Err("同名笔记已经存在".into());
    }
    let title = Path::new(&filename)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    tokio::fs::write(&target, format!("# {}\n\n", title))
        .await
        .map_err(|error| format!("创建笔记失败: {}", error))?;
    document(&target)
}

#[tauri::command]
pub async fn get_or_create_problem_note(
    app: AppHandle,
    platform: String,
    problem_id: String,
    title: String,
) -> Result<NoteDocument, String> {
    let root = notes_root(&app)?;
    ensure_root(&root)?;
    let root =
        std::fs::canonicalize(&root).map_err(|error| format!("无法访问笔记目录: {}", error))?;
    let key = format!("{}:{}", platform.to_lowercase(), problem_id.to_uppercase());
    let mut index = load_index(&root);
    if let Some(relative) = index.get(&key) {
        let candidate = root.join(relative);
        if let Ok(candidate) = canonical_target(&root, &candidate) {
            if is_markdown(&candidate) {
                return document(&candidate);
            }
        }
    }
    let folder = root.join(UNFILED_FOLDER);
    let base = safe_generated_name(&format!("{} {} - {}", problem_id, title, platform));
    let mut target = folder.join(format!("{}.md", base));
    let mut suffix = 2;
    while target.exists() {
        target = folder.join(format!("{} ({}).md", base, suffix));
        suffix += 1;
    }
    let content = format!(
        "# {} · {}\n\n> {} · {}\n\n## 思路\n\n## 易错点\n\n## 技巧与总结\n",
        problem_id, title, platform, problem_id
    );
    std::fs::write(&target, content).map_err(|error| format!("创建题目笔记失败: {}", error))?;
    index.insert(key, relative_string(&root, &target)?);
    save_index(&root, &index)?;
    document(&target)
}

#[tauri::command]
pub async fn rename_note_entry(
    app: AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let root = notes_root(&app)?;
    let canonical_root = canonical_root(&root)?;
    let target = canonical_target(&root, Path::new(&path))?;
    let old_relative = relative_string(&canonical_root, &target)?;
    let parent = target
        .parent()
        .ok_or_else(|| "无法重命名笔记根目录".to_string())?;
    let raw = validate_name(&new_name)?;
    let name = if target.is_file() && Path::new(&raw).extension().is_none() {
        format!("{}.md", raw)
    } else {
        raw
    };
    if target.is_file() && !name.to_lowercase().ends_with(".md") {
        return Err("笔记文件仅支持 .md 格式".into());
    }
    let destination = parent.join(name);
    if destination.exists() {
        return Err("同名文件或文件夹已经存在".into());
    }
    tokio::fs::rename(&target, &destination)
        .await
        .map_err(|error| format!("重命名失败: {}", error))?;
    let new_relative = relative_string(&canonical_root, &destination)?;
    rewrite_index_prefix(&canonical_root, &old_relative, Some(&new_relative))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn delete_note_entry(app: AppHandle, path: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let canonical_root = canonical_root(&root)?;
    let target = canonical_target(&root, Path::new(&path))?;
    let relative = relative_string(&canonical_root, &target)?;
    if target.is_dir() {
        tokio::fs::remove_dir_all(&target)
            .await
            .map_err(|error| format!("删除文件夹失败: {}", error))?;
    } else {
        tokio::fs::remove_file(&target)
            .await
            .map_err(|error| format!("删除笔记失败: {}", error))?;
    }
    rewrite_index_prefix(&canonical_root, &relative, None)
}

#[tauri::command]
pub async fn paste_note_entry(
    app: AppHandle,
    source_path: String,
    destination_path: Option<String>,
    cut: bool,
) -> Result<String, String> {
    let root = notes_root(&app)?;
    let canonical_root = canonical_root(&root)?;
    let source = canonical_target(&root, Path::new(&source_path))?;
    let source_relative = relative_string(&canonical_root, &source)?;
    let parent = canonical_parent(&root, destination_path.as_deref())?;
    if source.is_dir() && parent.starts_with(&source) {
        return Err("不能把文件夹移动到它自身或子文件夹中".into());
    }
    let mut target = parent.join(source.file_name().unwrap_or_default());
    if target == source {
        if cut {
            return Ok(source.to_string_lossy().into_owned());
        }
        target = available_target(&parent, &source);
    } else if target.exists() {
        target = available_target(&parent, &source);
    }
    if cut {
        tokio::fs::rename(&source, &target)
            .await
            .map_err(|error| format!("移动失败: {}", error))?;
        let target_relative = relative_string(&canonical_root, &target)?;
        rewrite_index_prefix(&canonical_root, &source_relative, Some(&target_relative))?;
    } else if source.is_dir() {
        let source_clone = source.clone();
        let target_clone = target.clone();
        tauri::async_runtime::spawn_blocking(move || copy_directory(&source_clone, &target_clone))
            .await
            .map_err(|error| format!("复制任务失败: {}", error))??;
    } else {
        tokio::fs::copy(&source, &target)
            .await
            .map_err(|error| format!("复制笔记失败: {}", error))?;
    }
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_names_are_safe_and_markdown_only() {
        assert_eq!(markdown_name("最短路").unwrap(), "最短路.md");
        assert_eq!(markdown_name("最短路.MD").unwrap(), "最短路.MD");
        assert!(markdown_name("bad/name").is_err());
        assert!(markdown_name("note.txt").is_err());
    }

    #[test]
    fn generated_names_replace_windows_forbidden_characters() {
        assert_eq!(safe_generated_name("P1 A:B/C?"), "P1 A_B_C_");
    }

    #[test]
    fn note_image_ids_cannot_escape_the_asset_directory() {
        assert!(validate_asset_id("1720000000000.png").is_ok());
        assert!(validate_asset_id("../secret.png").is_err());
        assert!(validate_asset_id("image.svg").is_err());
        assert!(validate_asset_id("folder/image.png").is_err());
    }
}
