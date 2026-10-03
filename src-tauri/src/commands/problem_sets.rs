#[tauri::command]
pub async fn export_problem_set_text(name: String, content: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name: String = name.chars().map(|ch| {
            if ch.is_control() || "<>:\"/\\|?*".contains(ch) { '_' } else { ch }
        }).collect();
        let safe_name = safe_name.trim().trim_end_matches('.');
        let filename = format!("{}.txt", if safe_name.is_empty() { "题单" } else { safe_name });
        let Some(target) = rfd::FileDialog::new()
            .set_title("导出题单")
            .add_filter("文本文件", &["txt"])
            .set_file_name(&filename)
            .save_file()
        else { return Ok(None); };
        // UTF-8 BOM helps Windows text editors recognize Chinese titles.
        std::fs::write(&target, format!("\u{feff}{content}"))
            .map_err(|error| format!("保存题单失败: {error}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    }).await.map_err(|error| format!("导出题单任务失败: {error}"))?
}
