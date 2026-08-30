use crate::commands::codeforces::{
    fetch_problem_detail_cf, ContestAnalysis, ContestProblemAnalysis, Problem, SampleCase,
};
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;
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
                source: item.get("type").and_then(Value::as_str).map(str::to_string),
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
    let document = Html::parse_document(&html);
    let title_selector = Selector::parse("span.h2").unwrap();
    let raw_title = document
        .select(&title_selector)
        .next()
        .map(clean_text)
        .unwrap_or_else(|| id.clone());
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
        } else if lower == "input" || lower.contains("input format") {
            input = Some(body);
        } else if lower == "output" || lower.contains("output format") {
            output = Some(body);
        } else if lower.contains("note") {
            note = Some(body);
        }
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
        id,
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
        source: problem
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string),
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
    } else {
        Err("当前支持 Codeforces、AtCoder 和洛谷题目链接".into())
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
