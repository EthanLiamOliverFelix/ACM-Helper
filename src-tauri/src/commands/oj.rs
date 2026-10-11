use crate::commands::codeforces::{
    fetch_problem_detail_cf, ContestAnalysis, ContestProblemAnalysis, Problem, SampleCase,
};
use crate::commands::network_session::IsolatedWebSessions;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tokio::process::Command;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LUOGU_DIFFICULTIES: [&str; 9] = [
    "暂无评定",
    "入门",
    "普及-",
    "普及",
    "普及+/提高-",
    "提高",
    "提高+/省选-",
    "省选/NOI-",
    "NOI/NOI+/CTS",
];
const LUOGU_TAG_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
static LUOGU_TAG_CACHE: OnceLock<Mutex<Option<(Instant, Vec<LuoguTag>)>>> = OnceLock::new();
static QOJ_WEBVIEW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn next_qoj_webview_label(prefix: &str) -> String {
    format!(
        "{prefix}_{}",
        QOJ_WEBVIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

/// AtCoder does not expose a first-party catalog API. The community-maintained
/// AtCoder Problems dataset is used only for lightweight title/difficulty metadata;
/// complete statements are still fetched directly from atcoder.jp on demand.
#[tauri::command]
pub async fn fetch_problems_atcoder() -> Result<Vec<Problem>, String> {
    let client = Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建 AtCoder 题库客户端失败: {error}"))?;
    let (problems_response, models_response) = tokio::join!(
        client
            .get("https://kenkoooo.com/atcoder/resources/problems.json")
            .send(),
        client
            .get("https://kenkoooo.com/atcoder/resources/problem-models.json")
            .send(),
    );
    let raw: Vec<Value> = problems_response
        .map_err(|error| format!("拉取 AtCoder 题库失败: {error}"))?
        .json()
        .await
        .map_err(|error| format!("解析 AtCoder 题库失败: {error}"))?;
    let models: Value = match models_response {
        Ok(response) => response.json().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let mut result = raw
        .into_iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim().to_string();
            let contest = item.get("contest_id")?.as_str()?.trim().to_string();
            let title = item
                .get("title")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .trim()
                .to_string();
            let raw_difficulty = models
                .pointer(&format!(
                    "/{}/difficulty",
                    id.replace('~', "~0").replace('/', "~1")
                ))
                .and_then(Value::as_f64);
            let rating = raw_difficulty.map(|difficulty| {
                let displayed: f64 = if difficulty >= 400.0 {
                    difficulty
                } else {
                    400.0 / (1.0 + (400.0 - difficulty) / 400.0).exp()
                };
                displayed.round().max(0.0) as i32
            });
            Some(Problem {
                id: id.clone(),
                title,
                rating,
                tags: vec![],
                platform: "atcoder".into(),
                difficulty: None,
                source: Some("AtCoder".into()),
                content_format: None,
                description: None,
                url: Some(format!("https://atcoder.jp/contests/{contest}/tasks/{id}")),
                time_limit_ms: None,
                memory_limit_mb: None,
                input: None,
                output: None,
                note: None,
                samples: None,
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(result)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguProblemPage {
    problems: Vec<Problem>,
    count: u64,
    per_page: u64,
    tags: Vec<LuoguTag>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LuoguTag {
    id: i64,
    name: String,
    tag_type: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguTrainingSummary {
    id: u64,
    name: String,
    provider_name: String,
    problem_count: u64,
    mark_count: u64,
    training_type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguTrainingPage {
    trainings: Vec<LuoguTrainingSummary>,
    count: u64,
    per_page: u64,
    categories: Vec<LuoguTrainingCategory>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguTrainingCategory {
    key: String,
    name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguTrainingDetail {
    id: u64,
    name: String,
    description: String,
    provider_name: String,
    problems: Vec<Problem>,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .use_native_tls()
        .cookie_store(true)
        .http1_only()
        .user_agent(BROWSER_UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建抓题客户端失败: {}", e))
}

async fn fetch_luogu_content(url: &str) -> Result<Value, String> {
    client()?
        .get(url)
        .header("Accept", "application/json")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("x-lentille-request", "content-only")
        .send()
        .await
        .map_err(|e| format!("访问洛谷失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("洛谷页面不可用: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析洛谷页面数据失败: {}", e))
}

async fn fetch_text_with_system_fallback(
    url: &str,
    accept_language: &str,
) -> Result<String, String> {
    match client()?
        .get(url)
        .header("Accept-Language", accept_language)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .text()
            .await
            .map_err(|e| format!("读取页面失败: {}", e)),
        Ok(response) => Err(format!("OJ 返回 HTTP {}", response.status())),
        Err(primary_error) => {
            // 某些 OJ/CDN 会重置 rustls/native-tls 指纹；使用系统 curl 作为兼容回退。
            let output = Command::new("curl")
                .args([
                    "-L",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    "30",
                    "--retry",
                    "2",
                    "--retry-delay",
                    "1",
                    "--retry-all-errors",
                    "-A",
                    BROWSER_UA,
                    "-H",
                    &format!("Accept-Language: {}", accept_language),
                    url,
                ])
                .output()
                .await
                .map_err(|e| format!("网络请求失败: {}; curl 回退不可用: {}", primary_error, e))?;
            if !output.status.success() {
                return Err(format!(
                    "网络请求失败: {}; curl: {}",
                    primary_error,
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            String::from_utf8(output.stdout).map_err(|e| format!("OJ 页面编码无效: {}", e))
        }
    }
}

fn clean_text(element: scraper::ElementRef<'_>) -> String {
    element
        .text()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn section_body_html(element: scraper::ElementRef<'_>) -> String {
    let html = element.inner_html();
    Regex::new(r"(?is)^\s*<h3[^>]*>.*?</h3>")
        .unwrap()
        .replace(&html, "")
        .trim()
        .to_string()
}

fn value_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}

pub(crate) fn luogu_pid_regex(anchored: bool) -> Regex {
    // 整个 PID 保持为捕获组 1，链接导入需要从完整 URL 中取出它；
    // anchored=true 的提交校验仍可直接使用 is_match。
    let body = r"(P\d+|B\d+|U\d+|T\d+|CF\d+[A-Z]\d*|AT_[A-Z0-9_]+|SP\d+|UVA\d+)";
    let pattern = if anchored {
        format!(r"(?i)^{}$", body)
    } else {
        format!(r"(?i){}", body)
    };
    Regex::new(&pattern).expect("Luogu PID regex is valid")
}

fn parse_luogu_tags(value: &Value) -> Vec<LuoguTag> {
    value
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tag| {
            Some(LuoguTag {
                id: tag.get("id")?.as_i64()?,
                name: tag.get("name")?.as_str()?.to_string(),
                tag_type: tag.get("type").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect()
}

async fn fetch_luogu_tags_cached() -> Result<Vec<LuoguTag>, String> {
    let cache = LUOGU_TAG_CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache.lock().await;
    if let Some((fetched_at, tags)) = cached.as_ref() {
        if fetched_at.elapsed() < LUOGU_TAG_CACHE_TTL {
            return Ok(tags.clone());
        }
    }
    let root: Value = client()?
        .get("https://www.luogu.com.cn/_lfe/tags/zh-CN")
        .send()
        .await
        .map_err(|e| format!("获取洛谷标签失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("洛谷标签请求失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析洛谷标签失败: {}", e))?;
    let tags = parse_luogu_tags(&root);
    *cached = Some((Instant::now(), tags.clone()));
    Ok(tags)
}

fn parse_luogu_problem_page(
    root: &Value,
    tags: &[LuoguTag],
) -> Result<(Vec<Problem>, u64, u64), String> {
    let data = root
        .get("data")
        .or_else(|| root.get("currentData"))
        .ok_or_else(|| "洛谷题库响应缺少数据".to_string())?;
    let status = root
        .get("status")
        .or_else(|| root.get("code"))
        .and_then(Value::as_u64)
        .unwrap_or(200);
    if status != 200 {
        return Err(data
            .get("errorMessage")
            .and_then(Value::as_str)
            .unwrap_or("获取洛谷题库失败")
            .to_string());
    }
    let list = data
        .get("problems")
        .ok_or_else(|| "洛谷题库响应格式无效".to_string())?;
    let count = list.get("count").and_then(Value::as_u64).unwrap_or(0);
    let per_page = list.get("perPage").and_then(Value::as_u64).unwrap_or(50);
    let tag_names: HashMap<i64, &str> =
        tags.iter().map(|tag| (tag.id, tag.name.as_str())).collect();
    let problems = list
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("pid")?.as_str()?.to_string();
            let difficulty_id =
                item.get("difficulty").and_then(Value::as_u64).unwrap_or(0) as usize;
            let item_tags = item
                .get("tags")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .filter_map(|id| tag_names.get(&id).map(|name| (*name).to_string()))
                .collect();
            Some(Problem {
                id: id.clone(),
                title: item.get("name")?.as_str()?.to_string(),
                rating: None,
                tags: item_tags,
                platform: "luogu".into(),
                difficulty: Some(
                    LUOGU_DIFFICULTIES
                        .get(difficulty_id)
                        .unwrap_or(&LUOGU_DIFFICULTIES[0])
                        .to_string(),
                ),
                source: Some("洛谷".into()),
                content_format: None,
                description: None,
                url: Some(format!("https://www.luogu.com.cn/problem/{}", id)),
                time_limit_ms: None,
                memory_limit_mb: None,
                input: None,
                output: None,
                note: None,
                samples: None,
            })
        })
        .collect();
    Ok((problems, count, per_page))
}

#[tauri::command]
pub async fn fetch_problems_luogu(
    page: u64,
    keyword: String,
    problem_type: String,
    difficulty: Option<u8>,
    tag_names: Vec<String>,
) -> Result<LuoguProblemPage, String> {
    let client = client()?;
    let tags = fetch_luogu_tags_cached().await?;
    let wanted: std::collections::HashSet<&str> = tag_names.iter().map(String::as_str).collect();
    let tag_ids = tags
        .iter()
        .filter(|tag| wanted.contains(tag.name.as_str()))
        .map(|tag| tag.id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut query = vec![
        ("page", page.max(1).to_string()),
        ("keyword", keyword.trim().to_string()),
        ("type", problem_type.trim().to_string()),
        ("_contentOnly", "1".into()),
    ];
    if let Some(value) = difficulty.filter(|value| *value > 0 && *value <= 8) {
        query.push(("difficulty", value.to_string()));
    }
    if !tag_ids.is_empty() {
        query.push(("tag", tag_ids));
    }
    let root: Value = client
        .get("https://www.luogu.com.cn/problem/list")
        .query(&query)
        .header("X-Requested-With", "XMLHttpRequest")
        .header("x-lentille-request", "content-only")
        .header("Referer", "https://www.luogu.com.cn/")
        .send()
        .await
        .map_err(|e| format!("获取洛谷题库失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("洛谷题库请求失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析洛谷题库失败: {}", e))?;
    let (problems, count, per_page) = parse_luogu_problem_page(&root, &tags)?;
    Ok(LuoguProblemPage {
        problems,
        count,
        per_page,
        tags,
    })
}

#[tauri::command]
pub async fn fetch_luogu_training_list(
    page: u64,
    keyword: String,
    category: String,
) -> Result<LuoguTrainingPage, String> {
    let training_type = if category.trim().is_empty() {
        "public"
    } else {
        category.trim()
    };
    let root: Value = client()?
        .get("https://www.luogu.com.cn/training/list")
        .query(&[
            ("type", training_type.to_string()),
            ("page", page.max(1).to_string()),
            ("keyword", keyword.trim().to_string()),
            ("_contentOnly", "1".to_string()),
        ])
        .header("Accept", "application/json")
        .header("x-lentille-request", "content-only")
        .send()
        .await
        .map_err(|e| format!("获取洛谷题单广场失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("洛谷题单广场不可用: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析洛谷题单广场失败: {}", e))?;
    let data = root
        .get("data")
        .ok_or_else(|| "洛谷题单广场响应缺少数据".to_string())?;
    let list = data
        .get("trainings")
        .ok_or_else(|| "洛谷题单广场响应格式无效".to_string())?;
    let trainings = list
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(LuoguTrainingSummary {
                id: item.get("id")?.as_u64()?,
                name: item.get("name")?.as_str()?.to_string(),
                provider_name: item
                    .pointer("/provider/name")
                    .and_then(Value::as_str)
                    .unwrap_or("洛谷用户")
                    .to_string(),
                problem_count: item
                    .get("problemCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                mark_count: item.get("markCount").and_then(Value::as_u64).unwrap_or(0),
                training_type: item
                    .get("type")
                    .map(|value| match value {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default(),
            })
        })
        .collect();
    let categories = data
        .get("categories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(LuoguTrainingCategory {
                key: item.get("key")?.as_str()?.to_string(),
                name: item.get("name")?.as_str()?.to_string(),
            })
        })
        .collect();
    Ok(LuoguTrainingPage {
        trainings,
        count: list.get("count").and_then(Value::as_u64).unwrap_or(0),
        per_page: list.get("perPage").and_then(Value::as_u64).unwrap_or(30),
        categories,
    })
}

#[tauri::command]
pub async fn fetch_luogu_training_detail(source: String) -> Result<LuoguTrainingDetail, String> {
    let id = Regex::new(r"(?i)^(?:https?://(?:www\.)?luogu\.com\.cn/training/)?(\d+)(?:[/?#].*)?$")
        .unwrap()
        .captures(source.trim())
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u64>().ok())
        .ok_or_else(|| "无法识别洛谷题单链接或编号".to_string())?;
    let root = fetch_luogu_content(&format!(
        "https://www.luogu.com.cn/training/{}?_contentOnly=1",
        id
    ))
    .await?;
    let training = root
        .pointer("/data/training")
        .ok_or_else(|| "洛谷题单不存在、未公开或当前账号无权查看".to_string())?;
    let problems = training
        .get("problems")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let pid = item.get("pid")?.as_str()?.to_uppercase();
            let difficulty_id =
                item.get("difficulty").and_then(Value::as_u64).unwrap_or(0) as usize;
            Some(Problem {
                id: pid.clone(),
                title: item.get("name")?.as_str()?.to_string(),
                rating: None,
                tags: Vec::new(),
                platform: "luogu".into(),
                difficulty: Some(
                    LUOGU_DIFFICULTIES
                        .get(difficulty_id)
                        .unwrap_or(&LUOGU_DIFFICULTIES[0])
                        .to_string(),
                ),
                source: Some(format!("洛谷题单 #{}", id)),
                content_format: None,
                description: None,
                url: Some(format!("https://www.luogu.com.cn/problem/{}", pid)),
                time_limit_ms: None,
                memory_limit_mb: None,
                input: None,
                output: None,
                note: None,
                samples: None,
            })
        })
        .collect();
    Ok(LuoguTrainingDetail {
        id,
        name: training
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("洛谷题单")
            .to_string(),
        description: training
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        provider_name: training
            .pointer("/provider/name")
            .and_then(Value::as_str)
            .unwrap_or("洛谷用户")
            .to_string(),
        problems,
    })
}

async fn fetch_atcoder(url: &str) -> Result<Problem, String> {
    let normalized = url.split('?').next().unwrap_or(url).trim_end_matches('/');
    let id = normalized
        .rsplit('/')
        .next()
        .ok_or_else(|| "无效的 AtCoder 题目链接".to_string())?
        .to_string();
    let html = fetch_text_with_system_fallback(normalized, "en-US,en;q=0.9")
        .await
        .map_err(|e| format!("抓取 AtCoder 题面失败: {}", e))?;
    parse_atcoder_page(normalized, &id, &html)
}

fn parse_atcoder_page(normalized: &str, id: &str, html: &str) -> Result<Problem, String> {
    let document = Html::parse_document(html);
    let title_selector = Selector::parse("span.h2").unwrap();
    let raw_title = document
        .select(&title_selector)
        .next()
        .map(|element| {
            element
                .children()
                .filter_map(|node| node.value().as_text().map(|text| text.to_string()))
                .collect::<String>()
                .trim()
                .to_string()
        })
        .unwrap_or_else(|| id.to_string());
    let title = raw_title
        .split_once(" - ")
        .map(|(_, title)| title.to_string())
        .unwrap_or(raw_title);

    let english_selector = Selector::parse("#task-statement .lang-en").unwrap();
    let statement_selector = Selector::parse("#task-statement").unwrap();
    // 组合选择器会按 DOM 顺序先返回祖先 #task-statement，从而同时解析
    // 日文和英文并生成重复样例。显式优先选择英文区域，仅在其不存在时回退。
    let root = document
        .select(&english_selector)
        .next()
        .or_else(|| document.select(&statement_selector).next())
        .ok_or_else(|| "AtCoder 页面中未找到题面".to_string())?;
    let section_selector = Selector::parse("section").unwrap();
    let heading_selector = Selector::parse("h3").unwrap();
    let pre_selector = Selector::parse("pre").unwrap();
    let mut description = None;
    let mut input = None;
    let mut output = None;
    let mut note = None;
    let mut sample_inputs: Vec<String> = vec![];
    let mut sample_outputs: Vec<String> = vec![];
    for section in root.select(&section_selector) {
        let heading = section
            .select(&heading_selector)
            .next()
            .map(clean_text)
            .unwrap_or_default();
        let body = section_body_html(section);
        let lower = heading.to_ascii_lowercase();
        if lower.contains("sample input") {
            sample_inputs.push(
                section
                    .select(&pre_selector)
                    .next()
                    .map(clean_text)
                    .unwrap_or(body),
            );
        } else if lower.contains("sample output") {
            sample_outputs.push(
                section
                    .select(&pre_selector)
                    .next()
                    .map(clean_text)
                    .unwrap_or(body),
            );
        } else if lower.contains("problem statement") {
            description = Some(body);
        } else if lower == "constraints" {
            if let Some(description) = description.as_mut() {
                description.push_str(&format!("<h3>Constraints</h3>{body}"));
            }
        } else if lower == "input" || lower.contains("input format") {
            input = Some(body);
        } else if lower == "output" || lower.contains("output format") {
            output = Some(body);
        } else if lower.contains("note") {
            note = Some(body);
        }
    }
    if description
        .as_ref()
        .is_none_or(|body| body.trim().is_empty())
    {
        return Err("AtCoder 页面中未找到有效正文，未覆盖原有题面".into());
    }
    let samples = sample_inputs
        .into_iter()
        .zip(sample_outputs)
        .map(|(input, output)| SampleCase { input, output })
        .collect();
    let page_text = document.root_element().text().collect::<String>();
    let time_re = Regex::new(r"Time Limit:\s*([0-9.]+)\s*sec").unwrap();
    let memory_re = Regex::new(r"Memory Limit:\s*(\d+)\s*MiB").unwrap();
    let time_limit_ms = time_re
        .captures(&page_text)
        .and_then(|c| c[1].parse::<f64>().ok())
        .map(|v| (v * 1000.0) as u64);
    let memory_limit_mb = memory_re
        .captures(&page_text)
        .and_then(|c| c[1].parse::<u64>().ok());
    Ok(Problem {
        id: id.to_string(),
        title,
        rating: None,
        tags: vec![],
        platform: "atcoder".into(),
        difficulty: None,
        source: Some("AtCoder".into()),
        content_format: Some("html".into()),
        description,
        url: Some(normalized.into()),
        time_limit_ms,
        memory_limit_mb,
        input,
        output,
        note,
        samples: Some(samples),
    })
}

struct QojProblemTarget {
    id: String,
    statement_url: String,
    public_url: String,
}

fn qoj_problem_target(url: &str) -> Result<QojProblemTarget, String> {
    let value = url.trim();
    let numeric = Regex::new(
        r"(?i)^https?://(?:www\.)?qoj\.ac/problem/(\d+)(?:/statement/[a-z_]+)?/?(?:[?#].*)?$",
    )
    .unwrap();
    if let Some(captures) = numeric.captures(value) {
        let id = captures.get(1).unwrap().as_str().to_string();
        return Ok(QojProblemTarget {
            id: id.clone(),
            statement_url: format!("https://qoj.ac/problem/{id}/statement/zh_cn"),
            public_url: format!("https://qoj.ac/problem/{id}"),
        });
    }
    let contest = Regex::new(
        r"(?i)^https?://(?:www\.)?qoj\.ac/contest/(\d+)/problem/([a-z0-9_]+)(?:/statement/[a-z_]+)?/?(?:[?#].*)?$",
    )
    .unwrap();
    if let Some(captures) = contest.captures(value) {
        let contest_id = captures.get(1).unwrap().as_str();
        let label = captures.get(2).unwrap().as_str().to_uppercase();
        let public_url = format!("https://qoj.ac/contest/{contest_id}/problem/{label}");
        return Ok(QojProblemTarget {
            id: if label.chars().all(|value| value.is_ascii_digit()) {
                label.clone()
            } else {
                format!("C{contest_id}{label}")
            },
            statement_url: format!("{public_url}/statement/zh_cn"),
            public_url,
        });
    }
    Err("无法识别 QOJ 题目链接".into())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QojArchiveProblem {
    id: String,
    label: String,
    title: String,
    url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    accepted_teams: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    submitted_teams: Option<u64>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QojArchiveEntry {
    kind: String,
    id: String,
    title: String,
    url: String,
    contest_count: Option<u64>,
    #[serde(default)]
    solved_count: Option<u64>,
    problem_count: Option<u64>,
    problems: Vec<QojArchiveProblem>,
    #[serde(default)]
    children: Vec<QojArchiveEntry>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QojArchivePage {
    title: String,
    url: String,
    entries: Vec<QojArchiveEntry>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContestCatalogEntry {
    platform: String,
    id: String,
    title: String,
    url: String,
    start_time_seconds: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OjAccountStatus {
    logged_in: bool,
    username: Option<String>,
}

#[tauri::command]
pub async fn fetch_contest_catalog() -> Result<Vec<ContestCatalogEntry>, String> {
    let client = Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建比赛目录客户端失败: {error}"))?;
    let (cf_response, atcoder_response) = tokio::join!(
        client
            .get("https://codeforces.com/api/contest.list?gym=false")
            .send(),
        client
            .get("https://kenkoooo.com/atcoder/resources/contests.json")
            .send(),
    );
    let mut entries = Vec::new();
    if let Ok(response) = cf_response {
        if let Ok(root) = response.json::<Value>().await {
            for item in root
                .get("result")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
                if item.get("type").and_then(Value::as_str) != Some("CF")
                    || !Regex::new(r"(?i)\bdiv\.?\s*[1-4]\b")
                        .unwrap()
                        .is_match(name)
                {
                    continue;
                }
                let Some(id) = item.get("id").and_then(Value::as_i64) else {
                    continue;
                };
                entries.push(ContestCatalogEntry {
                    platform: "codeforces".into(),
                    id: id.to_string(),
                    title: name.to_string(),
                    url: format!("https://codeforces.com/contest/{id}"),
                    start_time_seconds: item.get("startTimeSeconds").and_then(Value::as_i64),
                });
            }
        }
    }
    if let Ok(response) = atcoder_response {
        if let Ok(items) = response.json::<Vec<Value>>().await {
            let series = Regex::new(r"(?i)^(abc|arc|agc|ahc)\d+$").unwrap();
            for item in items {
                let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
                if !series.is_match(id) {
                    continue;
                }
                entries.push(ContestCatalogEntry {
                    platform: "atcoder".into(),
                    id: id.to_ascii_lowercase(),
                    title: item
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or(id)
                        .to_string(),
                    url: format!("https://atcoder.jp/contests/{}", id.to_ascii_lowercase()),
                    start_time_seconds: item.get("start_epoch_second").and_then(Value::as_i64),
                });
            }
        }
    }
    entries.sort_by(|left, right| right.start_time_seconds.cmp(&left.start_time_seconds));
    Ok(entries)
}

const QOJ_ACCOUNT_PROBE: &str = include_str!("qoj_account_probe.js");

fn qoj_account_from_navbar(navbar: &str, login_form: bool) -> Option<OjAccountStatus> {
    let document = Html::parse_fragment(navbar);
    let roots = Selector::parse("nav, .navbar, header, #header, ul.nav-pills.float-right[role='tablist']").unwrap();
    let links = Selector::parse("a[href]").unwrap();
    let base = reqwest::Url::parse("https://qoj.ac/").unwrap();
    let profile = Regex::new(r"^/user/profile/([^/?#]+)/?$").unwrap();
    let username_pattern = Regex::new(r"^[A-Za-z0-9_-]{1,64}$").unwrap();
    let mut login_link = false;
    for root in document.select(&roots) {
        let is_content_menu = root.value().name() == "ul";
        let mut logout = false;
        for link in root.select(&links) {
            let Some(url) = link.value().attr("href").and_then(|href| base.join(href).ok()) else { continue };
            if !matches!(url.host_str(), Some("qoj.ac" | "www.qoj.ac")) { continue }
            let path = url.path().trim_end_matches('/');
            if path == "/login" { login_link = true }
            if path == "/logout" { logout = true }
            // For content-area pills, trust only the explicit username in the account dropdown.
            if is_content_menu && !link.value().classes().any(|class| class == "uoj-username") {
                continue;
            }
            if let Some(capture) = profile.captures(path) {
                let username = urlencoding::decode(&capture[1]).ok()?.into_owned();
                if username_pattern.is_match(&username) && !matches!(username.as_str(), "login" | "logout" | "register") {
                    return Some(OjAccountStatus { logged_in: true, username: Some(username) });
                }
            }
        }
        logout |= root.select(&Selector::parse("form[action]").unwrap()).any(|form| {
            form.value().attr("action").and_then(|href| base.join(href).ok())
                .is_some_and(|url| matches!(url.host_str(), Some("qoj.ac" | "www.qoj.ac")) && url.path().trim_end_matches('/') == "/logout")
        });
        // QOJ may display the username as a dropdown toggle rather than a profile link.
        if logout {
            for user in root.select(&Selector::parse(".uoj-username, .username, [data-username], .dropdown-toggle").unwrap()) {
                let text = user.value().attr("data-username").map(str::to_string)
                    .unwrap_or_else(|| user.text().collect::<String>());
                let username = text.trim();
                if username_pattern.is_match(username) && !matches!(username, "English" | "Language" | "Login" | "Register" | "QOJ") {
                    return Some(OjAccountStatus { logged_in: true, username: Some(username.to_string()) });
                }
            }
        }
    }
    (login_form || login_link).then_some(OjAccountStatus { logged_in: false, username: None })
}

fn inspect_qoj_account_via_webview(app: &AppHandle) -> Result<OjAccountStatus, String> {
    let existing = app.get_webview_window("qoj_account");
    let hidden = existing.is_none();
    let window = match existing {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, next_qoj_webview_label("qoj_account_check"), WebviewUrl::External("https://qoj.ac/login".parse().unwrap()))
            .visible(false).build().map_err(|error| format!("创建 QOJ 账号检测窗口失败: {error}"))?,
    };
    // Native script results do not rely on website CSP, mixed-content or local-network requests.
    let deadline = Instant::now() + Duration::from_secs(if hidden { 35 } else { 6 });
    let result = (|| {
        while Instant::now() < deadline {
            if let Some(account) = read_qoj_account_window(&window, QOJ_ACCOUNT_PROBE, deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(2)))? { return Ok(account) }
            std::thread::sleep(Duration::from_millis(250).min(deadline.saturating_duration_since(Instant::now())));
        }
        Err("QOJ 登录页面暂未就绪，请等待页面加载后刷新账号状态".to_string())
    })();
    if hidden { window.destroy().ok(); }
    result
}

fn read_qoj_account_window(
    window: &WebviewWindow,
    script: &str,
    timeout: Duration,
) -> Result<Option<OjAccountStatus>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    window.eval_with_callback(script, move |payload| {
        let _ = sender.send(payload);
    })
        .map_err(|error| format!("读取 QOJ 登录页面失败: {error}"))?;
    let Ok(payload) = receiver.recv_timeout(timeout) else { return Ok(None) };
    let Ok(value) = serde_json::from_str::<Value>(&payload) else { return Ok(None) };
    if value.get("ready").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    Ok(qoj_account_from_navbar(
        value.get("navbar").and_then(Value::as_str).unwrap_or_default(),
        value.get("loginForm").and_then(Value::as_bool).unwrap_or(false),
    ))
}

fn qoj_login_complete(account: &OjAccountStatus, switching: bool, saw_logout: bool) -> bool {
    account.logged_in && account.username.as_ref().is_some_and(|name| !name.trim().is_empty())
        && (!switching || saw_logout)
}

fn monitor_qoj_login(app: AppHandle, window: WebviewWindow, switching: bool) {
    monitor_qoj_login_with_probe(app, window, switching, QOJ_ACCOUNT_PROBE.to_string());
}

fn monitor_qoj_login_with_probe(
    app: AppHandle,
    window: WebviewWindow,
    switching: bool,
    probe: String,
) {
    let closed = Arc::new(AtomicBool::new(false));
    let on_close = closed.clone();
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            on_close.store(true, Ordering::Relaxed);
            let _ = close_app.emit("qoj-login-closed", ());
        }
    });
    std::thread::spawn(move || {
        let mut saw_logout = false;
        while !closed.load(Ordering::Relaxed) {
            if let Ok(Some(account)) = read_qoj_account_window(&window, &probe, Duration::from_secs(2)) {
                if !account.logged_in {
                    saw_logout = true;
                }
                if !closed.load(Ordering::Relaxed) && qoj_login_complete(&account, switching, saw_logout) {
                    // The native monitor owns the window lifecycle across page redirects.
                    if window.destroy().is_ok() {
                        let _ = app.emit("qoj-login-success", account);
                    }
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

fn inspect_external_account_via_webview(
    app: &AppHandle,
    platform: &str,
) -> Result<OjAccountStatus, String> {
    if platform == "qoj" { return inspect_qoj_account_via_webview(app) }
    let (url, username_script) = match platform {
        "atcoder" => ("https://atcoder.jp/login", "var links=Array.from(document.querySelectorAll('a[href^=\"/users/\"],a[href*=\"atcoder.jp/users/\"]'));var link=links.find(function(a){return /\\/users\\/[^/?#]+/.test(a.getAttribute('href')||'');});var match=link?(link.getAttribute('href')||'').match(/\\/users\\/([^/?#]+)/):null;var username=match?decodeURIComponent(match[1]):'';"),
        _ => return Err("仅支持检测 AtCoder 或 QOJ 账号".into()),
    };
    let (port, result_rx) = crate::commands::callback::callback_server_with_timeout(Duration::from_secs(35))?;
    let script = format!(
        r#"(function(){{
      var sent=false,timer;var started=Date.now();var send=function(){{
        if(sent||/just a moment|checking your browser/i.test(document.title||''))return;
        {username_script}
        if(!username&&Date.now()-started<2500)return;
        sent=true;clearInterval(timer);
        var payload={{loggedIn:Boolean(username),username:username||null}};
        new Image().src='http://127.0.0.1:{port}/result?'+encodeURIComponent(JSON.stringify(payload));
      }};timer=setInterval(send,500);send();setTimeout(function(){{clearInterval(timer);}},35000);
    }})();"#
    );
    let mut builder = WebviewWindowBuilder::new(
        app,
        next_qoj_webview_label("oj_account_check"),
        WebviewUrl::External(url.parse().unwrap()),
    );
    if platform == "atcoder" {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位 AtCoder 会话目录: {error}"))?
            .join("webview-sessions")
            .join("atcoder");
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("无法创建 AtCoder 会话目录: {error}"))?;
        builder = builder.data_directory(data_dir);
    }
    let window = builder
        .visible(false)
        .initialization_script(&script)
        .build()
        .map_err(|error| format!("创建账号检测窗口失败: {error}"))?;
    let result = result_rx
        .recv_timeout(Duration::from_secs(35))
        .map_err(|_| {
            format!(
                "{} 账号检测超时",
                if platform == "atcoder" {
                    "AtCoder"
                } else {
                    "QOJ"
                }
            )
        })
        .and_then(|payload| {
            serde_json::from_str(&payload).map_err(|error| format!("解析账号状态失败: {error}"))
        });
    window.destroy().ok();
    result
}

#[tauri::command]
pub async fn inspect_external_account(
    app: AppHandle,
    platform: String,
) -> Result<OjAccountStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_external_account_via_webview(&app, &platform)
    })
    .await
    .map_err(|error| format!("账号检测任务失败: {error}"))?
}

#[tauri::command]
pub async fn open_external_account(
    app: AppHandle,
    sessions: State<'_, IsolatedWebSessions>,
    platform: String,
    switch_account: Option<bool>,
) -> Result<(), String> {
    if platform == "atcoder" {
        let url = if switch_account.unwrap_or(false) {
            "https://atcoder.jp/logout"
        } else {
            "https://atcoder.jp/login"
        };
        return sessions.open("atcoder", url, "AtCoder 账号");
    }
    let (label, url, title) = match platform.as_str() {
        "qoj" => ("qoj_account", "https://qoj.ac/login", "QOJ 账号"),
        _ => return Err("仅支持 AtCoder 或 QOJ 账号".into()),
    };
    if let Some(window) = app.get_webview_window(label) {
        if switch_account.unwrap_or(false) {
            window.destroy().map_err(|error| format!("关闭旧账号窗口失败: {error}"))?;
        } else {
            window.show().ok();
            window.set_focus().ok();
            return Ok(());
        }
    }
    let script = if switch_account.unwrap_or(false) {
        let key = next_qoj_webview_label("qoj_switch");
        format!(r#"(function(){{var key='{key}';if(sessionStorage.getItem(key))return;var timer=setInterval(function(){{var form=document.querySelector('form[action*="logout"]');var link=document.querySelector('a[href*="logout"]');if(form||link){{sessionStorage.setItem(key,'1');clearInterval(timer);if(form)form.submit();else link.click();}}}},500);}})();"#)
    } else {
        String::new()
    };
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url.parse().unwrap()))
        .title(format!("{title} · 登录成功后自动关闭"))
        .inner_size(980.0, 760.0)
        .initialization_script(&script)
        .build()
        .map_err(|error| format!("打开{title}窗口失败: {error}"))?;
    monitor_qoj_login(app, window, switch_account.unwrap_or(false));
    Ok(())
}

#[tauri::command]
pub fn qoj_account_window_open(app: AppHandle) -> bool {
    app.get_webview_window("qoj_account").is_some()
}

#[tauri::command]
pub fn external_account_session_status(
    sessions: State<'_, IsolatedWebSessions>,
    platform: String,
) -> Result<bool, String> {
    sessions.is_running(&platform)
}

fn normalized_qoj_archive_url(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("https://qoj.ac/category").trim();
    let captures =
        Regex::new(r"(?i)^https?://(?:www\.)?qoj\.ac/(category|contest)(?:/(\d+))?/?(?:[?#].*)?$")
            .unwrap()
            .captures(value)
            .ok_or_else(|| "仅支持 QOJ 比赛归档分类或比赛链接".to_string())?;
    let route = captures.get(1).unwrap().as_str().to_ascii_lowercase();
    let id = captures.get(2).map(|value| value.as_str());
    if route == "contest" && id.is_none() {
        return Err("QOJ 比赛链接缺少比赛号".into());
    }
    Ok(id
        .map(|id| format!("https://qoj.ac/{route}/{id}"))
        .unwrap_or_else(|| "https://qoj.ac/category".into()))
}

include!("qoj_catalog.rs");

fn start_qoj_payload_server() -> Result<(u16, std::sync::mpsc::Receiver<String>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("启动 QOJ 本地回调失败: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 QOJ 回调端口失败: {error}"))?
        .port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(150)));
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first_line = String::new();
            let _ = reader.read_line(&mut first_line);
            let mut content_length = 0usize;
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).is_err() || header == "\r\n" || header.is_empty() {
                    break;
                }
                if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0u8; content_length.min(32 * 1024 * 1024)];
            if content_length > 0 && reader.read_exact(&mut body).is_ok() {
                let encoded = String::from_utf8_lossy(&body);
                let decoded = urlencoding::decode(&encoded)
                    .unwrap_or_else(|_| std::borrow::Cow::Borrowed(""))
                    .into_owned();
                if !decoded.is_empty() {
                    let _ = tx.send(decoded);
                }
            }
            let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nOK";
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok((port, rx))
}

fn qoj_pdf_samples(text: &str) -> Vec<SampleCase> {
    let heading = Regex::new(
        r"(?im)^[ \t]*(?:(?:sample|example)[ \t]+(input|output)(?:[ \t]+#?[0-9]+)?|[【\[]?(?:样例|示例)(输入|输出)(?:[ \t]*#?[0-9]+)?[】\]]?|(输入|输出)格式[ \t]*#?[0-9]+)[ \t]*[:：]?[ \t]*$",
    )
    .unwrap();
    let matches = heading.captures_iter(text).collect::<Vec<_>>();
    let mut samples = Vec::<SampleCase>::new();
    for (index, captures) in matches.iter().enumerate() {
        let kind = captures
            .get(1)
            .or_else(|| captures.get(2))
            .or_else(|| captures.get(3))
            .map(|value| value.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        let whole = captures.get(0).unwrap();
        let end = matches
            .get(index + 1)
            .and_then(|next| next.get(0))
            .map(|next| next.start())
            .unwrap_or(text.len());
        let body = &text[whole.end()..end];
        let end = Regex::new(r"(?im)^[ \t]*(?:【[^】]+】|(?:说明|解释|数据范围|子任务)[ \t]*[:：]?[ \t]*$|(?:constraints|notes?|explanation)\b)")
            .unwrap()
            .find(body)
            .map(|section| section.start())
            .unwrap_or(body.len());
        let content = body[..end].trim().to_string();
        if content.is_empty() {
            continue;
        }
        if kind == "input" || kind == "输入" {
            samples.push(SampleCase {
                input: content,
                output: String::new(),
            });
        } else if let Some(sample) = samples.iter_mut().rev().find(|item| item.output.is_empty()) {
            sample.output = content;
        }
    }
    samples
        .into_iter()
        .filter(|sample| !sample.input.is_empty() && !sample.output.is_empty())
        .collect()
}

fn fetch_qoj_via_webview(app: &AppHandle, target: &QojProblemTarget) -> Result<Problem, String> {
    let (port, result_rx) = start_qoj_payload_server()?;
    let problem_id = &target.id;
    let url = target.statement_url.clone();
    let script = format!(
        r#"(function() {{
      if (window.__acmQojWatcher) return; window.__acmQojWatcher = true;
      var clean = function(value) {{ return (value || '').replace(/\s+/g, ' ').trim(); }};
      var markdown = function(root) {{
        var walk=function(node,depth) {{
          if(node.nodeType===3)return (node.nodeValue||'').replace(/\s+/g,' ');
          if(node.nodeType!==1)return '';
          var tag=node.tagName.toLowerCase();
          if(tag==='script'&&node.type==='math/tex')return (node.type.indexOf('mode=display')>=0?'$$':'$')+(node.textContent||'').trim()+(node.type.indexOf('mode=display')>=0?'$$':'$');
          if(['script','style','svg'].indexOf(tag)>=0)return '';
          var body=Array.from(node.childNodes).map(function(child){{return walk(child,depth);}}).join('');
          if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+body.trim()+'\n\n';
          if(tag==='p'||tag==='div'||tag==='section'||tag==='article')return '\n\n'+body.trim()+'\n\n';
          if(tag==='br')return '\n';
          if(tag==='strong'||tag==='b')return '**'+body.trim()+'**';
          if(tag==='em'||tag==='i')return '*'+body.trim()+'*';
          if(tag==='code'&&node.parentElement&&node.parentElement.tagName!=='PRE')return '`'+(node.textContent||'').trim()+'`';
          if(tag==='pre')return '\n\n```\n'+(node.innerText||node.textContent||'').replace(/\r/g,'').trimEnd()+'\n```\n\n';
          if(tag==='li')return '\n'+(node.parentElement&&node.parentElement.tagName==='OL'?String(Array.from(node.parentElement.children).indexOf(node)+1)+'. ':'- ')+body.trim();
          if(tag==='ul'||tag==='ol')return '\n'+body.trim()+'\n';
          if(tag==='a'){{var href=node.getAttribute('href')||'';return href?'['+body.trim()+']('+new URL(href,location.href).href+')':body;}}
          if(tag==='img'){{var src=node.getAttribute('src')||'';return src?'!['+(node.getAttribute('alt')||'')+']('+new URL(src,location.href).href+')':'';}}
          if(tag==='table')return '\n\n'+clean(node.innerText).replace(/\t/g,' | ')+'\n\n';
          return body;
        }};
        return walk(root,0).replace(/ *\n */g,'\n').replace(/\n{{3,}}/g,'\n\n').trim();
      }};
      var send = function() {{
        if (window.__acmQojSent) return;
        if (/^\/login(?:\/|$)/i.test(location.pathname)) {{
          window.__acmQojSent=true;
          fetch('http://127.0.0.1:{port}/result',{{method:'POST',mode:'no-cors',headers:{{'Content-Type':'text/plain'}},body:encodeURIComponent(JSON.stringify({{error:'请先到“设置 → OJ 账号”登录 QOJ，再打开题面'}}))}}).catch(function(){{window.__acmQojSent=false;}});
          return;
        }}
        var chineseLink=Array.from(document.querySelectorAll('a[href]')).find(function(a){{return /\/statement\/zh_cn(?:[?#]|$)/i.test(a.getAttribute('href')||'');}});
        var zhKey='acm-qoj-zh:'+{public_url_json};
        if(/\/statement\/zh_cn(?:\/|$)/i.test(location.pathname))sessionStorage.setItem(zhKey,'1');
        if(!sessionStorage.getItem(zhKey)&&chineseLink){{sessionStorage.setItem(zhKey,'1');location.replace(chineseLink.href);return;}}
        var article = document.querySelector('article.uoj-article, article');
        var pdf = document.querySelector('iframe#statements-pdf');
        var heading = document.querySelector('.page-header');
        if (!heading || ((!article || !article.innerHTML.trim()) && !pdf)) {{if(document.readyState==='complete'&&/\/statement\/zh_cn/.test(location.pathname))location.replace({public_url_json});return;}}
        var title = clean(heading.textContent).replace(/^#\d+\.\s*/, '');
        var text = document.body ? document.body.innerText : '';
        var time = text.match(/Time Limit:\s*([0-9.]+)\s*(ms|s)/i);
        var memory = text.match(/Memory Limit:\s*([0-9.]+)\s*(KB|MB|GB|KiB|MiB|GiB)/i);
        var timeMs = time ? Math.round(parseFloat(time[1]) * (time[2].toLowerCase() === 's' ? 1000 : 1)) : null;
        var memoryMb = null;
        if (memory) {{ var unit=memory[2].toLowerCase(), amount=parseFloat(memory[1]); memoryMb=Math.round(amount*(unit[0]==='g'?1024:unit[0]==='k'?1/1024:1)); }}
        var inputs=[], outputs=[];
        if (article) article.querySelectorAll('h2,h3,h4,h5,strong').forEach(function(h) {{
          var label=clean(h.textContent).toLowerCase(); if (!/^(?:(?:sample|example)\s+)?(input|output)(?:\s*#?\d+)?$|^(?:样例|示例)?(输入|输出)(?:(?:样例|示例)?(?:\s*#?\d+)?|格式\s*#?\d+)$/.test(label)) return;
          var node=h.nextElementSibling || (h.parentElement && h.parentElement.nextElementSibling);
          while (node && !/^(PRE|H2|H3|H4|H5)$/.test(node.tagName)) node=node.nextElementSibling;
          var pre=node && node.tagName==='PRE' ? node : (node && node.querySelector ? node.querySelector('pre') : null);
          if (pre) (/input|输入/.test(label)?inputs:outputs).push((pre.innerText||pre.textContent||'').replace(/\r/g,'').trimEnd());
        }});
        var samples=inputs.slice(0,Math.min(inputs.length,outputs.length)).map(function(input,index){{return {{input:input,output:outputs[index]}};}});
        var pdfUrl=pdf?pdf.src:'';
        var statement=article?article.cloneNode(true):null;
        if(statement) statement.querySelectorAll('h2,h3,h4,h5,strong').forEach(function(h){{
          if(!/^(?:(?:sample|example)\s+)?(input|output)(?:\s*#?\d+)?$|^(?:样例|示例)?(输入|输出)(?:(?:样例|示例)?(?:\s*#?\d+)?|格式\s*#?\d+)$/i.test(clean(h.textContent)))return;
          var node=h.nextElementSibling || (h.parentElement && h.parentElement.nextElementSibling);
          while(node && !/^(PRE|H2|H3|H4|H5)$/.test(node.tagName))node=node.nextElementSibling;
          if(node&&node.tagName==='PRE')node.remove(); h.remove();
        }});
        var description=statement&&statement.innerHTML.trim()?markdown(statement):'该题使用 PDF 题面。\n\n[打开 QOJ 官方英文 PDF 题面 →]('+pdfUrl+')';
        var payload={{id:{id_json},title:title||('QOJ '+{id_json}),rating:null,tags:[],platform:'qoj',source:article&&/[\u3400-\u9fff]/.test(article.textContent||'')?'QOJ · 中文题面':'QOJ · 原题面',contentFormat:'markdown',description:description,url:{public_url_json},timeLimitMs:timeMs,memoryLimitMb:memoryMb,input:null,output:null,note:pdfUrl?('PDF statement: '+pdfUrl):(/AI Translation/.test(text)?'QOJ 站内 AI 翻译；如有疑问，请参照原题面。':null),samples:samples}};
        window.__acmQojSent=true;
        var deliver=function(){{fetch('http://127.0.0.1:{port}/result',{{method:'POST',mode:'no-cors',headers:{{'Content-Type':'text/plain'}},body:encodeURIComponent(JSON.stringify(payload))}}).catch(function(){{window.__acmQojSent=false;}});}};
        if (!pdfUrl) {{ deliver(); return; }}
        fetch(pdfUrl).then(function(response){{if(!response.ok)throw new Error('PDF HTTP '+response.status);return response.blob();}}).then(function(blob){{
          var reader=new FileReader(); reader.onload=function(){{payload.pdfBase64=String(reader.result||'').split(',')[1]||'';deliver();}}; reader.onerror=deliver; reader.readAsDataURL(blob);
        }}).catch(deliver);
      }}; send(); setInterval(send,800);
      setTimeout(function() {{
        if (!window.__acmQojSent && !document.querySelector('.page-header') && !/just a moment/i.test(document.title || ''))
          location.replace({public_url_json});
      }}, 15000);
    }})();"#,
        port = port,
        id_json = serde_json::to_string(problem_id).unwrap(),
        public_url_json = serde_json::to_string(&target.public_url).unwrap()
    );
    let window = WebviewWindowBuilder::new(
        app,
        next_qoj_webview_label("qoj_statement"),
        WebviewUrl::External(
            url.parse()
                .map_err(|error| format!("QOJ 题目链接无效: {error}"))?,
        ),
    )
    .title(format!("QOJ {problem_id} · 正在抓取题面"))
    .inner_size(980.0, 760.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|error| format!("创建 QOJ 题面窗口失败: {error}"))?;
    let result = result_rx
        .recv_timeout(Duration::from_secs(150))
        .map_err(|_| {
            "QOJ 题面加载超时；请先到“设置 → OJ 账号”登录 QOJ 或完成验证后重试".to_string()
        })
        .and_then(|payload| {
            let mut value: Value = serde_json::from_str(&payload)
                .map_err(|error| format!("解析 QOJ 题面失败: {error}"))?;
            if let Some(message) = value.get("error").and_then(Value::as_str) {
                return Err(message.to_string());
            }
            let pdf_base64 = value
                .get("pdfBase64")
                .and_then(Value::as_str)
                .map(str::to_string);
            if let Some(object) = value.as_object_mut() {
                object.remove("pdfBase64");
            }
            let mut problem: Problem = serde_json::from_value(value)
                .map_err(|error| format!("解析 QOJ 题面失败: {error}"))?;
            if let Some(encoded) = pdf_base64 {
                use base64::Engine;
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) {
                    if let Ok(text) = pdf_extract::extract_text_from_mem(&bytes) {
                        let text = text.trim();
                        if !text.is_empty() {
                            let samples = qoj_pdf_samples(text);
                            problem.description = Some(text.to_string());
                            problem.content_format = Some("text".into());
                            if !samples.is_empty() {
                                problem.samples = Some(samples);
                            }
                        }
                    }
                }
            }
            Ok(problem)
        });
    window.destroy().ok();
    result
}

fn qoj_fragment_text(fragment: &str) -> String {
    let with_breaks = Regex::new(r"(?i)<br\s*/?>").unwrap().replace_all(fragment, "\n");
    let document = Html::parse_fragment(&with_breaks);
    document
        .root_element()
        .text()
        .collect::<String>()
        .trim_matches('\n')
        .to_string()
}

async fn fetch_qoj_direct(target: &QojProblemTarget) -> Result<Problem, String> {
    let html = match qoj_public_html(&target.statement_url).await {
        Ok(html) if html.contains("<article") => html,
        _ => qoj_public_html(&target.public_url).await?,
    };
    let mut problem = parse_qoj_statement(&html, target)?;
    if let Some(url) = problem
        .note
        .as_deref()
        .and_then(|note| note.strip_prefix("PDF statement: "))
    {
        if let Ok(bytes) = qoj_pdf_bytes(url).await {
            if let Ok(Ok(text)) = tauri::async_runtime::spawn_blocking(move || {
                pdf_extract::extract_text_from_mem(&bytes)
            })
            .await
            {
                if !text.trim().is_empty() {
                    problem.samples = Some(qoj_pdf_samples(&text));
                    problem.description = Some(text.trim().into());
                    problem.content_format = Some("text".into());
                }
            }
        }
    }
    Ok(problem)
}

async fn qoj_pdf_bytes(url: &str) -> Result<Vec<u8>, String> {
    let mut command = Command::new("curl");
    command.args([
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "-L",
        "-A",
        BROWSER_UA,
        url,
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = command.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() || !output.stdout.starts_with(b"%PDF-") {
        return Err("QOJ PDF 下载失败".into());
    }
    Ok(output.stdout)
}

fn parse_qoj_statement(html: &str, target: &QojProblemTarget) -> Result<Problem, String> {
    if Regex::new(r"(?i)just a moment|checking your browser|cf-chl-")
        .unwrap()
        .is_match(&html)
    {
        return Err("QOJ 需要人机验证".into());
    }
    let document = Html::parse_document(html);
    let article_selector = Selector::parse("article.uoj-article, article").unwrap();
    let heading_selector = Selector::parse(".page-header").unwrap();
    let article = document
        .select(&article_selector)
        .next()
        .ok_or_else(|| "QOJ 页面未返回可解析的本地题面".to_string())?;
    let title = document
        .select(&heading_selector)
        .map(clean_text)
        .find(|title| !title.is_empty() && title != "QOJ" && title != "QOJ.ac")
        .or_else(|| document.select(&Selector::parse("h1,h2").unwrap()).map(clean_text).find(|title| title.starts_with(&format!("#{}.", target.id))))
        .or_else(|| document.select(&Selector::parse("title").unwrap()).next().map(clean_text).and_then(|title| title.strip_suffix(" - Problem - QOJ.ac").map(str::to_string)))
        .unwrap_or_else(|| format!("QOJ {}", target.id));
    let title = Regex::new(r"^\s*#\d+\.\s*")
        .unwrap()
        .replace(&title, "")
        .trim()
        .to_string();
    let page_text = clean_text(document.root_element());
    let time = Regex::new(r"(?i)Time Limit:\s*([0-9.]+)\s*(ms|s)")
        .unwrap()
        .captures(&page_text);
    let time_limit_ms = time.as_ref().and_then(|captures| {
        captures.get(1)?.as_str().parse::<f64>().ok().map(|amount| {
            (amount
                * if captures
                    .get(2)
                    .map(|unit| unit.as_str().eq_ignore_ascii_case("s"))
                    .unwrap_or(false)
                {
                    1000.0
                } else {
                    1.0
                })
            .round() as u64
        })
    });
    let memory = Regex::new(r"(?i)Memory Limit:\s*([0-9.]+)\s*(KB|MB|GB|KiB|MiB|GiB)")
        .unwrap()
        .captures(&page_text);
    let memory_limit_mb = memory.as_ref().and_then(|captures| {
        let amount = captures.get(1)?.as_str().parse::<f64>().ok()?;
        let unit = captures.get(2)?.as_str().to_ascii_lowercase();
        Some(
            (amount
                * if unit.starts_with('g') {
                    1024.0
                } else if unit.starts_with('k') {
                    1.0 / 1024.0
                } else {
                    1.0
                })
            .round() as u64,
        )
    });
    let article_html = article.inner_html();
    let pdf_url = document
        .select(&Selector::parse("iframe#statements-pdf[src]").unwrap())
        .next()
        .and_then(|iframe| iframe.value().attr("src"))
        .and_then(|url| reqwest::Url::parse(&target.public_url).ok()?.join(url).ok())
        .filter(|url| url.scheme() == "https" && url.host_str() == Some("qoj.ac"))
        .map(|url| url.to_string());
    let sample_pattern = Regex::new(r"(?is)<h[2-6][^>]*>\s*(?:<(?:strong|span|b)[^>]*>\s*)?(?:(?:(?:sample|example)\s+)?(input|output)(?:\s*#?\d+)?|(?:样例|示例)?(输入|输出)(?:(?:样例|示例)?(?:\s*#?\d+)?|格式\s*#?\d+))\s*(?:</(?:strong|span|b)>\s*)?</h[2-6]>\s*<pre[^>]*>(.*?)</pre>").unwrap();
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();
    for captures in sample_pattern.captures_iter(&article_html) {
        let content = qoj_fragment_text(
            captures
                .get(3)
                .map(|value| value.as_str())
                .unwrap_or_default(),
        )
        .replace('\r', "")
        .trim_matches('\n')
        .to_string();
        if captures
            .get(1)
            .map(|value| value.as_str().eq_ignore_ascii_case("input"))
            .unwrap_or(false)
            || captures
                .get(2)
                .is_some_and(|value| value.as_str() == "输入")
        {
            inputs.push(content);
        } else {
            outputs.push(content);
        }
    }
    let samples = inputs
        .into_iter()
        .zip(outputs)
        .map(|(input, output)| SampleCase { input, output })
        .collect::<Vec<_>>();
    Ok(Problem {
        id: target.id.clone(),
        title: if title.is_empty() {
            format!("QOJ {}", target.id)
        } else {
            title
        },
        rating: None,
        tags: vec![],
        platform: "qoj".into(),
        difficulty: None,
        source: Some(
            if article.text().any(|text| {
                text.chars()
                    .any(|ch| ('\u{3400}'..='\u{9fff}').contains(&ch))
            }) {
                "QOJ · 中文题面"
            } else {
                "QOJ · 原题面"
            }
            .into(),
        ),
        content_format: Some("html".into()),
        description: Some(if pdf_url.is_some() {
            "该题使用 PDF 题面，可查看原始 PDF 或切换到提取文字。".into()
        } else {
            Regex::new(
                r"(?is)<h[2-6][^>]*>\s*(?:样例|示例)(?:[一二三四五六七八九十0-9]+)?\s*</h[2-6]>",
            )
            .unwrap()
            .replace_all(&sample_pattern.replace_all(&article_html, ""), "")
            .into_owned()
        }),
        url: Some(target.public_url.clone()),
        time_limit_ms,
        memory_limit_mb,
        input: None,
        output: None,
        note: pdf_url
            .map(|url| format!("PDF statement: {url}"))
            .or_else(|| {
                html.contains("AI Translation")
                    .then(|| "QOJ 站内 AI 翻译；如有疑问，请参照原题面。".into())
            }),
        samples: Some(samples),
    })
}

#[tauri::command]
pub async fn fetch_problem_qoj(app: AppHandle, url: String) -> Result<Problem, String> {
    let target = qoj_problem_target(&url)?;
    if let Ok(problem) = fetch_qoj_direct(&target).await {
        return Ok(problem);
    }
    tauri::async_runtime::spawn_blocking(move || fetch_qoj_via_webview(&app, &target))
        .await
        .map_err(|error| format!("QOJ 抓题任务失败: {error}"))?
}

pub(crate) async fn fetch_luogu(url: &str) -> Result<Problem, String> {
    let id_re = luogu_pid_regex(false);
    let id = id_re
        .captures(url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_uppercase())
        .ok_or_else(|| "无法从链接中识别洛谷题号".to_string())?;
    let normalized = format!("https://www.luogu.com.cn/problem/{}", id);
    let response = client()?
        .get(&normalized)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .map_err(|e| format!("抓取洛谷题面失败: {:?}", e))?;
    if !response.status().is_success() {
        return Err(format!("洛谷返回 HTTP {}", response.status()));
    }
    let html = response
        .text()
        .await
        .map_err(|e| format!("读取洛谷题面失败: {}", e))?;
    // scraper 的 DOM 不是 Send，必须在下一个 await 前完全释放。
    let root: Value = {
        let document = Html::parse_document(&html);
        let context_selector = Selector::parse("script#lentille-context").unwrap();
        let json_text = document
            .select(&context_selector)
            .next()
            .map(|e| e.text().collect::<String>())
            .ok_or_else(|| "洛谷页面中未找到题目数据，可能需要验证或登录".to_string())?;
        serde_json::from_str(&json_text).map_err(|e| format!("解析洛谷题目数据失败: {}", e))?
    };
    let problem = root
        .pointer("/data/problem")
        .ok_or_else(|| "洛谷题目数据为空".to_string())?;
    let content = problem
        .get("content")
        .or_else(|| problem.get("contenu"))
        .ok_or_else(|| "洛谷题面内容为空".to_string())?;
    let difficulty = problem
        .get("difficulty")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;

    let tag_ids: Vec<i64> = problem
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    let tag_names: HashMap<i64, String> = fetch_luogu_tags_cached()
        .await?
        .into_iter()
        .map(|tag| (tag.id, tag.name))
        .collect();
    let tags = tag_ids
        .iter()
        .filter_map(|id| tag_names.get(id).cloned())
        .collect();

    let samples = problem
        .get("samples")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|sample| {
            let pair = sample.as_array()?;
            Some(SampleCase {
                input: pair.first()?.as_str()?.to_string(),
                output: pair.get(1)?.as_str()?.to_string(),
            })
        })
        .collect();
    let time_limit_ms = problem.pointer("/limits/time/0").and_then(Value::as_u64);
    let memory_limit_mb = problem
        .pointer("/limits/memory/0")
        .and_then(Value::as_u64)
        .map(|kb| kb / 1024);
    Ok(Problem {
        id,
        title: value_str(problem.get("name"))
            .or_else(|| value_str(content.get("name")))
            .unwrap_or_else(|| "未命名题目".into()),
        rating: None,
        tags,
        platform: "luogu".into(),
        difficulty: Some(
            LUOGU_DIFFICULTIES
                .get(difficulty)
                .unwrap_or(&"暂无评定")
                .to_string(),
        ),
        source: Some("洛谷".into()),
        content_format: Some("markdown".into()),
        description: value_str(content.get("description")),
        url: Some(normalized),
        time_limit_ms,
        memory_limit_mb,
        input: value_str(content.get("formatI")),
        output: value_str(content.get("formatO")),
        note: value_str(content.get("hint")),
        samples: Some(samples),
    })
}

/// 分析公开洛谷比赛的题目与知识标签。比赛页面本身不提供完整标签，
/// 因此先读取官方 content-only 数据中的题号，再逐题读取公开题面标签。
#[tauri::command]
pub async fn analyze_contest_luogu(contest_url: String) -> Result<ContestAnalysis, String> {
    let re =
        Regex::new(r"(?i)^https?://(?:www\.)?luogu\.com\.cn/contest/(\d+)(?:[/?#].*)?$").unwrap();
    let contest_id = re
        .captures(contest_url.trim())
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .ok_or_else(|| "无法从链接中识别洛谷比赛号".to_string())?;
    let normalized = format!("https://www.luogu.com.cn/contest/{}", contest_id);
    let root: Value = client()?
        .get(format!("{}?_contentOnly=1", normalized))
        .header("Accept", "application/json")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("x-lentille-request", "content-only")
        .send()
        .await
        .map_err(|e| format!("抓取洛谷比赛失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("洛谷比赛页面不可用: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析洛谷比赛数据失败: {}", e))?;
    let contest = root
        .pointer("/data/contest")
        .ok_or_else(|| "洛谷比赛数据为空，比赛可能私有或需要报名".to_string())?;
    let title = contest
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("洛谷比赛")
        .to_string();
    let raw_problems = root
        .pointer("/data/contestProblems")
        .and_then(Value::as_array)
        .ok_or_else(|| "洛谷比赛尚未公开题目，暂时无法分析知识点".to_string())?;
    if raw_problems.is_empty() {
        return Err("洛谷比赛尚未公开题目，暂时无法分析知识点".into());
    }

    let mut problem_specs = Vec::with_capacity(raw_problems.len());
    for (index, item) in raw_problems.iter().enumerate() {
        let problem = item.get("problem").unwrap_or(item);
        let pid = problem
            .get("pid")
            .and_then(Value::as_str)
            .ok_or_else(|| "洛谷比赛题目缺少题号".to_string())?
            .to_uppercase();
        let fallback_title = problem
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("未命名题目")
            .to_string();
        problem_specs.push((index, pid, fallback_title));
    }

    let semaphore = Arc::new(Semaphore::new(4));
    let mut tasks = JoinSet::new();
    for (index, pid, fallback_title) in problem_specs {
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .expect("contest semaphore stays open");
            let detail = fetch_luogu(&format!("https://www.luogu.com.cn/problem/{}", pid)).await;
            let (problem_title, tags) = match detail {
                Ok(detail) => (detail.title, detail.tags),
                // 比赛题在赛前或权限受限时可能只能看到列表。仍返回题目，
                // 但不虚构知识点，前端会明确显示“未发现缺口”。
                Err(_) => (fallback_title, Vec::new()),
            };
            (
                index,
                ContestProblemAnalysis {
                    id: pid,
                    title: problem_title,
                    rating: None,
                    tags,
                    missing_skills: Vec::new(),
                },
            )
        });
    }
    let mut indexed_problems = Vec::new();
    while let Some(item) = tasks.join_next().await {
        indexed_problems.push(item.map_err(|e| format!("分析洛谷比赛题目失败: {}", e))?);
    }
    indexed_problems.sort_by_key(|(index, _)| *index);
    let problems: Vec<_> = indexed_problems
        .into_iter()
        .map(|(_, problem)| problem)
        .collect();
    let mut all_tags = problems
        .iter()
        .flat_map(|problem| problem.tags.iter().cloned())
        .collect::<Vec<_>>();
    all_tags.sort();
    all_tags.dedup();
    Ok(ContestAnalysis {
        platform: "luogu".into(),
        contest_id,
        title,
        url: normalized,
        tags: all_tags,
        problems,
    })
}

#[tauri::command]
pub async fn import_problem_url(app: AppHandle, url: String) -> Result<Problem, String> {
    let lower = url.to_ascii_lowercase();
    if lower.contains("codeforces.com") {
        let re =
            Regex::new(r"(?:problemset/problem|contest)/(\d+)(?:/problem)?/([A-Za-z][A-Za-z0-9]*)")
                .unwrap();
        let caps = re
            .captures(&url)
            .ok_or_else(|| "无法识别 Codeforces 题目链接".to_string())?;
        fetch_problem_detail_cf(app, format!("{}{}", &caps[1], &caps[2])).await
    } else if lower.contains("atcoder.jp") && lower.contains("/tasks/") {
        fetch_atcoder(&url).await
    } else if lower.contains("luogu.com") {
        fetch_luogu(&url).await
    } else if lower.contains("qoj.ac") {
        fetch_problem_qoj(app, url).await
    } else {
        Err("当前支持 Codeforces、AtCoder、QOJ 和洛谷题目链接".into())
    }
}

#[tauri::command]
pub async fn load_imported_problems(app: AppHandle) -> Result<Vec<Problem>, String> {
    let path = super::data_center::root(&app)?.join("imported-problems.json");
    match tokio::fs::read_to_string(path).await {
        Ok(json) => serde_json::from_str(&json).map_err(|e| format!("导入题库损坏: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(format!("读取导入题库失败: {}", e)),
    }
}

#[tauri::command]
pub async fn save_imported_problems(app: AppHandle, problems: Vec<Problem>) -> Result<(), String> {
    let root = super::data_center::root(&app)?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("创建数据目录失败: {}", e))?;
    let json =
        serde_json::to_vec_pretty(&problems).map_err(|e| format!("序列化导入题库失败: {}", e))?;
    tokio::fs::write(root.join("imported-problems.json"), json)
        .await
        .map_err(|e| format!("保存导入题库失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    #[ignore = "requires installed WebView2; runs an isolated hidden native window"]
    fn qoj_native_login_monitor_closes_window_and_emits_username() {
        use tauri::Listener;
        let (sender, receiver) = std::sync::mpsc::channel::<Result<String, String>>();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let data = std::env::current_dir().unwrap().join("target").join(format!("qoj-native-test-{}-{}", std::process::id(), QOJ_WEBVIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&data).unwrap();
        let app = tauri::Builder::default().any_thread().setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "qoj_native_test", WebviewUrl::External("about:blank".parse().unwrap()))
                .data_directory(data).visible(false).build()?;
            let handle = app.handle().clone();
            let event_sender = sender.clone();
            let event_handle = handle.clone();
            app.listen("qoj-login-success", move |event| {
                let sender = event_sender.clone();
                let handle = event_handle.clone();
                let payload = event.payload().to_string();
                std::thread::spawn(move || {
                    let deadline = Instant::now() + Duration::from_secs(2);
                    while handle.get_webview_window("qoj_native_test").is_some() {
                        if Instant::now() >= deadline {
                            let _ = sender.send(Err("login succeeded but the native window stayed open".into()));
                            handle.exit(1);
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    let _ = sender.send(Ok(payload));
                    handle.exit(0);
                });
            });
            std::thread::spawn(move || {
                // Use an offline DOM fixture; only the origin gate is changed for about:blank.
                let probe = QOJ_ACCOUNT_PROBE.replace("location.hostname", "'qoj.ac'");
                let fixture = format!(
                    r#"document.head.innerHTML='<meta http-equiv="Content-Security-Policy" content="connect-src &apos;none&apos;; img-src &apos;none&apos;">';document.body.innerHTML={};"#,
                    serde_json::to_string(include_str!("fixtures/qoj-account-menu.html")).unwrap()
                );
                std::thread::sleep(Duration::from_millis(250));
                if let Err(error) = window.eval(&fixture.replace("white_sword", "old_account")) {
                    let _ = sender.send(Err(error.to_string())); handle.exit(1); return;
                }
                monitor_qoj_login_with_probe(handle.clone(), window.clone(), true, probe);
                // Switching must not close on the old account. Observe logout before the new login.
                std::thread::sleep(Duration::from_millis(1200));
                if let Err(error) = window.eval("document.body.innerHTML='<div class=\"container\" role=\"main\"><div><ul class=\"nav nav-pills float-right\" role=\"tablist\"><li class=\"nav-item\"><a href=\"/login\">Login</a></li></ul></div></div>';") {
                    let _ = sender.send(Err(error.to_string())); handle.exit(1); return;
                }
                std::thread::sleep(Duration::from_millis(1200));
                if let Err(error) = window.eval(&fixture) {
                    let _ = sender.send(Err(error.to_string())); handle.exit(1); return;
                }
                std::thread::sleep(Duration::from_secs(12));
                let _ = sender.send(Err("native login success event did not fire".into()));
                handle.exit(1);
            });
            Ok(())
        }).build(context).unwrap();
        let exit_code = app.run_return(|_, event| {
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event { api.prevent_exit(); }
        });
        let payload = receiver.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        assert_eq!(exit_code, 0);
        let account: OjAccountStatus = serde_json::from_str(&payload).unwrap();
        assert_eq!(account.username.as_deref(), Some("white_sword"));
        assert!(account.logged_in);
    }

    #[test]
    fn qoj_login_success_waits_for_verified_account_and_completed_switch() {
        let account = OjAccountStatus { logged_in: true, username: Some("white_sword".into()) };
        assert!(qoj_login_complete(&account, false, false));
        assert!(!qoj_login_complete(&account, true, false));
        assert!(qoj_login_complete(&account, true, true));
        assert!(!qoj_login_complete(&OjAccountStatus { logged_in: false, username: None }, false, true));
        assert!(!qoj_login_complete(&OjAccountStatus { logged_in: true, username: None }, false, true));
    }

    #[test]
    fn qoj_account_detects_profile_links_and_visible_username_dropdown() {
        for href in ["/user/profile/white_sword", "user/profile/white_sword", "https://qoj.ac/user/profile/white_sword", "//qoj.ac/user/profile/white_sword"] {
            let navbar = format!(r#"<nav class="navbar"><a href="{href}">个人资料</a><a href="/logout">Logout</a></nav>"#);
            let account = qoj_account_from_navbar(&navbar, false).unwrap();
            assert!(account.logged_in);
            assert_eq!(account.username.as_deref(), Some("white_sword"));
        }
        let dropdown = r#"<div class="navbar"><ul class="navbar-right"><li><a class="dropdown-toggle"><span style="color:green">white_sword</span><span class="caret"></span></a></li><li><a href="/logout">Logout</a></li></ul></div>"#;
        let account = qoj_account_from_navbar(dropdown, false).unwrap();
        assert!(account.logged_in);
        assert_eq!(account.username.as_deref(), Some("white_sword"));
    }

    #[test]
    fn qoj_account_reads_the_content_header_menu_from_the_user_screenshot() {
        let html = include_str!("fixtures/qoj-account-menu.html");
        // The pictured dropdown is sufficient, without assuming its collapsed menu has Logout.
        let account = qoj_account_from_navbar(html, false).unwrap();
        assert!(account.logged_in);
        assert_eq!(account.username.as_deref(), Some("white_sword"));

        let anonymous = r#"<ul class="nav nav-pills float-right" role="tablist"><li class="nav-item"><a href="/login">Login</a></li></ul>"#;
        assert!(!qoj_account_from_navbar(anonymous, false).unwrap().logged_in);
        let logout = r#"<nav><a class="dropdown-toggle">white_sword</a><a href="//qoj.ac/logout">Logout</a></nav>"#;
        assert_eq!(qoj_account_from_navbar(logout, false).unwrap().username.as_deref(), Some("white_sword"));

        let public_profile = r#"<div class="container" role="main"><div class="uoj-content"><h2><a class="uoj-username" href="//qoj.ac/user/profile/someone_else">someone_else</a></h2></div></div>"#;
        assert!(qoj_account_from_navbar(public_profile, false).is_none());
        let unrelated_menu = html.replace("//qoj.ac/user/profile/white_sword", "https://example.com/user/profile/white_sword");
        assert!(qoj_account_from_navbar(&unrelated_menu, false).is_none());
    }

    #[test]
    fn qoj_account_does_not_confuse_public_profiles_or_loading_with_login() {
        let anonymous = r#"<nav class="navbar"><a href="/login">Login</a></nav><footer><a href="/user/profile/Qingyu">Qingyu</a></footer><main><a href="/user/profile/white_sword">white_sword</a></main>"#;
        assert!(!qoj_account_from_navbar(anonymous, false).unwrap().logged_in);
        assert!(qoj_account_from_navbar("", false).is_none());
        assert!(!qoj_account_from_navbar("", true).unwrap().logged_in);
        let unrelated = r#"<nav><a href="https://example.com/user/profile/other">other</a><a class="dropdown-toggle">English</a></nav>"#;
        assert!(qoj_account_from_navbar(unrelated, false).is_none());
        let dropdown_without_logout = r#"<nav><a class="dropdown-toggle">white_sword</a></nav>"#;
        assert!(qoj_account_from_navbar(dropdown_without_logout, false).is_none());
    }
    #[test]
    fn numbered_input_format_headers_are_samples_but_unnumbered_headers_are_not() {
        let target = qoj_problem_target("https://qoj.ac/problem/10").unwrap();
        let html = r#"<h1 class="page-header">#10. 混乱的密码</h1><article><h2>输入格式</h2><p>读入 n 和字符串。</p><h2>输出格式</h2><p>输出答案。</p><h3>输入格式 1</h3><pre>8
abaaaaaa</pre><h3>输出格式 1</h3><pre>4</pre><h3>说明</h3><p>对应的字符串是 abaa 和 aaaa。</p><h3>输入格式 2</h3><pre>9
abcdefghi</pre><h3>输出格式 2</h3><pre>8</pre><h3>输入格式 3</h3><pre>5
aaaaa</pre><h3>输出格式 3</h3><pre>-1</pre></article>"#;
        let parsed = parse_qoj_statement(html, &target).unwrap();
        let samples = parsed.samples.unwrap();
        assert_eq!(samples.len(), 3);
        assert_eq!(samples[0].input, "8\nabaaaaaa");
        assert_eq!(samples[1].output, "8");
        assert_eq!(samples[2].output, "-1");
        let body = parsed.description.unwrap();
        assert!(body.contains("读入 n 和字符串"));
        assert!(body.contains("对应的字符串"));
        assert!(!body.contains("输入格式 1"));
        assert!(!body.contains("输出格式 3"));
        let pdf_samples = qoj_pdf_samples("输入格式\n读入 n\n输入格式 1\n8\nabaaaaaa\n输出格式 1\n4\n说明\n这里是解释\n输入格式 2\n9\nabcdefghi\n输出格式 2\n8");
        assert_eq!(pdf_samples.len(), 2);
        assert_eq!(pdf_samples[0].output, "4");
    }
    #[test]
    fn archive_statement_supports_alternate_title_headers_and_reversed_sample_labels() {
        let target = qoj_problem_target("https://qoj.ac/contest/1096/problem/14687").unwrap();
        let problem = parse_qoj_statement(r#"<h1>QOJ.ac</h1><h2 class="page-header">#14687. Grand Voting</h2><article class="uoj-article"><p>Dada 举办了一场比赛。</p><h3><strong>输入样例 1</strong></h3><pre>5
-1 0 1 2 3</pre><h3>输出样例 1</h3><pre>5 -5</pre><h3>说明</h3><p>这里是解释。</p></article>"#, &target).unwrap();
        assert_eq!(problem.title, "Grand Voting");
        assert_eq!(qoj_fragment_text("<code>5<br>-1 0 1 2 3</code>"), "5\n-1 0 1 2 3");
        let samples = problem.samples.unwrap();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].input, "5\n-1 0 1 2 3");
        assert_eq!(samples[0].output, "5 -5");
        let description = problem.description.unwrap();
        assert!(!description.contains("输入样例"));
        assert!(description.contains("这里是解释"));
    }

    #[test]
    fn statement_fragment_uses_document_title_without_selecting_site_branding() {
        let target = qoj_problem_target("https://qoj.ac/problem/14687").unwrap();
        let problem = parse_qoj_statement("<title>Grand Voting - Problem - QOJ.ac</title><h1>QOJ.ac</h1><article>Statement</article>", &target).unwrap();
        assert_eq!(problem.title, "Grand Voting");
    }
    #[test]
    fn qoj_pdf_article_keeps_the_real_title_and_pdf_source() {
        let target = qoj_problem_target("https://qoj.ac/problem/2").unwrap();
        let problem =
            parse_qoj_statement(include_str!("fixtures/qoj-problem-2.html"), &target).unwrap();
        assert_eq!(problem.title, "划艇");
        assert_eq!(
            problem.note.as_deref(),
            Some("PDF statement: https://qoj.ac/download.php?type=statement&id=2&ver=zh_cn")
        );
        assert!(!problem.description.unwrap().is_empty());
    }

    #[test]
    fn qoj_bare_input_output_headers_become_separate_samples() {
        let target = qoj_problem_target("https://qoj.ac/problem/9").unwrap();
        let problem =
            parse_qoj_statement(include_str!("fixtures/qoj-problem-9.html"), &target).unwrap();
        assert_eq!(problem.title, "简单回路");
        let samples = problem.samples.unwrap();
        assert_eq!(samples.len(), 2);
        assert!(samples[0].input.starts_with("4 4 4\n2 2\n2 4"));
        assert_eq!(samples[0].output.lines().count(), 4);
        let body = problem.description.unwrap();
        assert!(body.contains("限制与约定"));
        assert!(!body.contains("<pre>"));
        assert!(!body.contains("样例一"));
    }

    #[tokio::test]
    #[ignore = "requires network"]
    async fn verifies_live_qoj_pdf_and_html_statements() {
        let pdf = fetch_qoj_direct(&qoj_problem_target("https://qoj.ac/problem/2").unwrap())
            .await
            .unwrap();
        assert_eq!(pdf.title, "划艇");
        assert!(pdf.note.unwrap().contains("ver=zh_cn"));
        assert_eq!(pdf.content_format.as_deref(), Some("text"));
        assert!(pdf.description.unwrap().len() > 100);
        let html = fetch_qoj_direct(&qoj_problem_target("https://qoj.ac/problem/9").unwrap())
            .await
            .unwrap();
        assert_eq!(html.title, "简单回路");
        assert_eq!(html.samples.unwrap().len(), 2);
    }

    #[test]
    fn extracts_chinese_pdf_samples_without_including_constraints() {
        let samples = qoj_pdf_samples(
            "【样例输入】\n4 2\n0\n1\n2\n3\n【样例输出】\n10\n【数据范围】\nn <= 100",
        );
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].input, "4 2\n0\n1\n2\n3");
        assert_eq!(samples[0].output, "10");
    }

    #[test]
    fn parses_chinese_qoj_statement_without_losing_math_or_sample_lines() {
        let target = qoj_problem_target("https://qoj.ac/problem/1173").unwrap();
        assert!(target.statement_url.ends_with("/statement/zh_cn"));
        let problem =
            parse_qoj_statement(include_str!("fixtures/qoj-chinese.html"), &target).unwrap();
        assert_eq!(problem.title, "知识就是……");
        assert_eq!(problem.content_format.as_deref(), Some("html"));
        let description = problem.description.unwrap();
        assert!(description.contains("$N$"));
        assert!(description.contains("输入格式"));
        assert!(!description.contains("<pre>"));
        let samples = problem.samples.unwrap();
        assert_eq!(samples.len(), 3);
        assert!(samples[0].input.starts_with("7 5\n9 10"));
        assert_eq!(samples[0].output, "3 2 2 5 5 4 1");
        assert!(problem.note.unwrap().contains("QOJ 站内 AI 翻译"));
        let contest = qoj_problem_target("https://qoj.ac/contest/537/problem/A").unwrap();
        assert!(contest.statement_url.ends_with("/A/statement/zh_cn"));
    }

    #[test]
    fn builds_endpoint_problem_ids() {
        let cf =
            Regex::new(r"(?:problemset/problem|contest)/(\d+)(?:/problem)?/([A-Za-z][A-Za-z0-9]*)")
                .unwrap();
        let caps = cf
            .captures("https://codeforces.com/contest/1999/problem/A")
            .unwrap();
        assert_eq!(format!("{}{}", &caps[1], &caps[2]), "1999A");
        let luogu = luogu_pid_regex(false);
        let captures = luogu
            .captures("https://www.luogu.com.cn/problem/CF1234A2")
            .unwrap();
        assert_eq!(captures.get(1).unwrap().as_str(), "CF1234A2");
        assert_eq!(
            qoj_problem_target("https://qoj.ac/problem/18920/statement/en")
                .unwrap()
                .id,
            "18920"
        );
        assert_eq!(
            qoj_problem_target("https://qoj.ac/contest/1096/problem/a")
                .unwrap()
                .id,
            "C1096A"
        );
        assert!(qoj_problem_target("https://qoj.ac/problem/../1").is_err());
    }

    #[test]
    fn accepts_only_qoj_archive_links() {
        assert_eq!(
            normalized_qoj_archive_url(None).unwrap(),
            "https://qoj.ac/category"
        );
        assert_eq!(
            normalized_qoj_archive_url(Some("https://qoj.ac/category/107?lang=en")).unwrap(),
            "https://qoj.ac/category/107"
        );
        assert_eq!(
            normalized_qoj_archive_url(Some("https://qoj.ac/contest/1096")).unwrap(),
            "https://qoj.ac/contest/1096"
        );
        assert!(normalized_qoj_archive_url(Some("https://example.com/category/107")).is_err());
    }

    #[test]
    fn parses_atcoder_statement_without_editorial_title_and_keeps_constraints() {
        let html = r#"<span class="h2">F - Xor Sum 3 <a>Editorial</a></span><div id="task-statement"><span class="lang-en"><section><h3>Problem Statement</h3><p>Paint the integers <var>A_i</var>.</p></section><section><h3>Constraints</h3><p>N is positive.</p></section><section><h3>Sample Input 1</h3><pre>3</pre></section><section><h3>Sample Output 1</h3><pre>12</pre></section></span></div>"#;
        let problem = parse_atcoder_page(
            "https://atcoder.jp/contests/abc141/tasks/abc141_f",
            "abc141_f",
            html,
        )
        .unwrap();
        assert_eq!(problem.title, "Xor Sum 3");
        assert!(problem.description.unwrap().contains("Constraints"));
        assert_eq!(problem.samples.unwrap().len(), 1);
        assert!(parse_atcoder_page(
            "https://atcoder.jp/contests/abc141/tasks/abc141_f",
            "abc141_f",
            "<div id='task-statement'><section><h3>Input</h3></section></div>"
        )
        .is_err());
    }

    #[test]
    fn extracts_qoj_pdf_sample_pairs() {
        let samples = qoj_pdf_samples(
            "Statement\nSample Input 1\n3 4\nSample Output 1\n7\nExample Input\nhello\nExample Output\nworld\n",
        );
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].input, "3 4");
        assert_eq!(samples[0].output, "7");
        assert_eq!(samples[1].input, "hello");
        assert_eq!(samples[1].output, "world");
    }

    #[test]
    fn parses_current_luogu_problem_list_envelope() {
        let tags = vec![
            LuoguTag {
                id: 2,
                name: "字符串".into(),
                tag_type: 2,
            },
            LuoguTag {
                id: 108,
                name: "模拟".into(),
                tag_type: 2,
            },
        ];
        let root = serde_json::json!({
            "status": 200,
            "data": { "problems": { "perPage": 50, "count": 17344, "result": [{
                "pid": "P1000", "type": "P", "name": "超级玛丽游戏",
                "difficulty": 1, "tags": [2, 108], "totalSubmit": 1,
                "totalAccepted": 1, "flag": 5
            }] } }
        });
        let (problems, count, per_page) = parse_luogu_problem_page(&root, &tags).unwrap();
        assert_eq!(count, 17344);
        assert_eq!(per_page, 50);
        assert_eq!(problems[0].id, "P1000");
        assert_eq!(problems[0].difficulty.as_deref(), Some("入门"));
        assert_eq!(problems[0].tags, vec!["字符串", "模拟"]);
    }

    #[test]
    #[ignore = "requires network"]
    fn imports_live_atcoder_problem() {
        let problem = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_atcoder(
                "https://atcoder.jp/contests/abc350/tasks/abc350_a",
            ))
            .unwrap();
        assert_eq!(problem.id, "abc350_a");
        assert!(!problem.title.is_empty());
        assert!(!problem.samples.unwrap().is_empty());
    }

    #[test]
    #[ignore = "requires network"]
    fn fetches_live_contest_catalog() {
        let entries = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_contest_catalog())
            .unwrap();
        assert!(entries.iter().any(|entry| entry.platform == "codeforces"));
        assert!(entries.iter().any(|entry| entry.platform == "atcoder"));
    }

    #[test]
    #[ignore = "requires network"]
    fn imports_live_luogu_problem() {
        let problem = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_luogu("https://www.luogu.com.cn/problem/P1001"))
            .unwrap();
        assert_eq!(problem.id, "P1001");
        assert_eq!(problem.platform, "luogu");
        assert!(!problem.samples.unwrap().is_empty());
    }

    #[test]
    #[ignore = "requires network"]
    fn fetches_live_luogu_catalog_with_filters() {
        let page = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_problems_luogu(
                1,
                "P1001".into(),
                "P".into(),
                Some(1),
                vec![],
            ))
            .unwrap();
        assert!(page.count >= 1);
        assert!(page.problems.iter().any(|problem| problem.id == "P1001"));
        assert!(page.tags.iter().any(|tag| tag.tag_type == 2));
    }

    #[test]
    #[ignore = "requires network"]
    fn fetches_live_luogu_training_plaza_and_detail() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let page = runtime
            .block_on(fetch_luogu_training_list(
                1,
                "动态规划".into(),
                "public".into(),
            ))
            .unwrap();
        assert!(!page.trainings.is_empty());
        let detail = runtime
            .block_on(fetch_luogu_training_detail(
                "https://www.luogu.com.cn/training/100".into(),
            ))
            .unwrap();
        assert_eq!(detail.id, 100);
        assert!(!detail.name.is_empty());
        assert!(!detail.problems.is_empty());
        assert!(detail
            .problems
            .iter()
            .all(|problem| problem.platform == "luogu"));
    }

    #[test]
    #[ignore = "requires network"]
    fn analyzes_live_luogu_contest() {
        let analysis = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(analyze_contest_luogu(
                "https://www.luogu.com.cn/contest/281947".into(),
            ))
            .unwrap();
        assert_eq!(analysis.platform, "luogu");
        assert_eq!(analysis.contest_id, "281947");
        assert!(analysis.problems.len() >= 4);
        assert!(analysis
            .problems
            .iter()
            .all(|problem| !problem.id.is_empty()));
        assert!(analysis
            .problems
            .iter()
            .any(|problem| !problem.tags.is_empty()));
        assert!(!analysis.tags.is_empty());
    }
}
