use serde::Deserialize;
use std::io::{Cursor, Write};

#[derive(Deserialize)]
pub struct ExportProblem {
    title: String,
    url: String,
}

fn xml(value: &str) -> String {
    value
        .chars()
        .filter(|ch| {
            matches!(*ch, '\t' | '\n' | '\r')
                || (*ch >= ' ' && *ch != '\u{fffe}' && *ch != '\u{ffff}')
        })
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn word_document(name: &str, entries: &[ExportProblem]) -> Result<Vec<u8>, String> {
    let mut document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        xml(name)
    );
    let mut relationships = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (index, entry) in entries.iter().enumerate() {
        document.push_str(&format!(r#"<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{}. {}</w:t></w:r></w:p>"#, index + 1, xml(&entry.title)));
        let url = xml(&entry.url);
        if entry.url.starts_with("https://") || entry.url.starts_with("http://") {
            let id = format!("link{index}");
            relationships.push_str(&format!(r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{url}" TargetMode="External"/>"#));
            document.push_str(&format!(r#"<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:hyperlink r:id="{id}"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">{url}</w:t></w:r></w:hyperlink></w:p>"#));
        } else {
            document.push_str(&format!(
                r#"<w:p><w:r><w:t xml:space="preserve">{url}</w:t></w:r></w:p>"#
            ));
        }
    }
    document.push_str(r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>"#);
    relationships.push_str("</Relationships>");
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (path, content) in [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        ),
        ("word/document.xml", document.as_str()),
        ("word/_rels/document.xml.rels", relationships.as_str()),
    ] {
        archive
            .start_file(path, options)
            .map_err(|e| e.to_string())?;
        archive
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(archive.finish().map_err(|e| e.to_string())?.into_inner())
}

#[tauri::command]
pub async fn export_problem_set_word(
    name: String,
    entries: Vec<ExportProblem>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = word_document(&name, &entries)?;
        let safe_name: String = name
            .chars()
            .map(|ch| {
                if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
                    '_'
                } else {
                    ch
                }
            })
            .collect();
        let safe_name = safe_name.trim().trim_end_matches('.');
        let filename = format!(
            "{}.docx",
            if safe_name.is_empty() {
                "题单"
            } else {
                safe_name
            }
        );
        let Some(mut target) = rfd::FileDialog::new()
            .set_title("导出题单为 Word")
            .add_filter("Word 文档", &["docx"])
            .set_file_name(&filename)
            .save_file()
        else {
            return Ok(None);
        };
        target.set_extension("docx");
        std::fs::write(&target, document).map_err(|e| format!("保存 Word 题单失败: {e}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| format!("导出 Word 任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    #[test]
    fn word_export_contains_ordered_titles_and_safe_clickable_links() {
        let bytes = word_document(
            "图论 & 算法",
            &[
                ExportProblem {
                    title: "P4779 最短路 <标准版>".into(),
                    url: "https://example.com/problem?a=1&b=2".into(),
                },
                ExportProblem {
                    title: "P1000 中文题目\0".into(),
                    url: "javascript:alert(1)".into(),
                },
            ],
        )
        .unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 4);
        let mut content = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert!(content.contains("图论 &amp; 算法"));
        assert!(content.contains("1. P4779 最短路 &lt;标准版&gt;"));
        assert!(content.contains("2. P1000 中文题目"));
        assert!(!content.contains('\0'));
        assert_eq!(content.matches("<w:hyperlink ").count(), 1);
        let mut relationships = String::new();
        archive
            .by_name("word/_rels/document.xml.rels")
            .unwrap()
            .read_to_string(&mut relationships)
            .unwrap();
        assert!(relationships.contains("a=1&amp;b=2"));
        assert!(!relationships.contains("javascript:"));
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("_rels/.rels").is_ok());
    }
}

#[tauri::command]
pub async fn export_problem_set_text(
    name: String,
    content: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name: String = name
            .chars()
            .map(|ch| {
                if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
                    '_'
                } else {
                    ch
                }
            })
            .collect();
        let safe_name = safe_name.trim().trim_end_matches('.');
        let filename = format!(
            "{}.txt",
            if safe_name.is_empty() {
                "题单"
            } else {
                safe_name
            }
        );
        let Some(target) = rfd::FileDialog::new()
            .set_title("导出题单")
            .add_filter("文本文件", &["txt"])
            .set_file_name(&filename)
            .save_file()
        else {
            return Ok(None);
        };
        // UTF-8 BOM helps Windows text editors recognize Chinese titles.
        std::fs::write(&target, format!("\u{feff}{content}"))
            .map_err(|error| format!("保存题单失败: {error}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("导出题单任务失败: {error}"))?
}
