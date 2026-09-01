use crate::commands::network_session::IsolatedWebSessions;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Copy the current source code and open the official Codeforces submit page.
/// The WebView uses the same persistent profile as the login window, so the
/// user's Codeforces session is reused without exposing cookies to the app.
#[tauri::command]
pub async fn open_cf_manual_submit(
    app: AppHandle,
    problem_id: String,
    code: String,
) -> Result<String, String> {
    if code.trim().is_empty() {
        return Err("代码为空，无法复制".into());
    }
    let re = Regex::new(r"^(\d+)([A-Za-z][A-Za-z0-9]*)$").map_err(|e| e.to_string())?;
    let captures = re
        .captures(problem_id.trim())
        .ok_or_else(|| format!("无法识别 Codeforces 题号：{problem_id}"))?;
    let contest = captures.get(1).unwrap().as_str();
    let index = captures.get(2).unwrap().as_str();

    let clipboard_code = code.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("无法访问剪贴板：{e}"))?;
        clipboard
            .set_text(clipboard_code)
            .map_err(|e| format!("复制代码失败：{e}"))
    })
    .await
    .map_err(|e| format!("复制代码任务失败：{e}"))??;

    let url = format!("https://codeforces.com/problemset/submit/{contest}/{index}")
        .parse()
        .map_err(|e| format!("提交页地址无效：{e}"))?;
    if let Some(window) = app.get_webview_window("cf_manual_submit") {
        window
            .navigate(url)
            .map_err(|e| format!("无法切换 Codeforces 提交页：{e}"))?;
        let _ = window.set_title(&format!("Codeforces {problem_id} · 代码已复制，请粘贴提交"));
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(format!("已复制代码并打开 {problem_id} 的官方提交页"));
    }
    WebviewWindowBuilder::new(&app, "cf_manual_submit", WebviewUrl::External(url))
        .title(format!("Codeforces {problem_id} · 代码已复制，请粘贴提交"))
        .inner_size(1080.0, 820.0)
        .min_inner_size(760.0, 560.0)
        .visible(true)
        .build()
        .map_err(|e| format!("无法打开 Codeforces 提交窗口：{e}"))?;

    Ok(format!("已复制代码并打开 {problem_id} 的官方提交页"))
}

/// Copy source and open the corresponding AtCoder submit page in the system
/// browser. AtCoder can hang inside WebView2, while the browser also preserves
/// the user's existing login session.
#[tauri::command]
pub async fn open_atcoder_manual_submit(
    sessions: State<'_, IsolatedWebSessions>,
    problem_url: String,
    code: String,
) -> Result<String, String> {
    if code.trim().is_empty() {
        return Err("代码为空，无法复制".into());
    }
    let re =
        Regex::new(r"^https://atcoder\.jp/contests/([A-Za-z0-9_-]+)/tasks/([A-Za-z0-9_-]+)/?$")
            .map_err(|e| e.to_string())?;
    let captures = re
        .captures(problem_url.trim())
        .ok_or_else(|| "无法识别 AtCoder 官方题目链接".to_string())?;
    let contest = captures.get(1).unwrap().as_str();
    let task = captures.get(2).unwrap().as_str();
    let clipboard_code = code;
    tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("无法访问剪贴板：{e}"))?;
        clipboard
            .set_text(clipboard_code)
            .map_err(|e| format!("复制代码失败：{e}"))
    })
    .await
    .map_err(|e| format!("复制代码任务失败：{e}"))??;
    let url = format!("https://atcoder.jp/contests/{contest}/submit?taskScreenName={task}");
    sessions.open(
        "atcoder",
        &url,
        &format!("AtCoder {task} · 代码已复制，请粘贴提交"),
    )?;
    Ok(format!("已复制代码并在独立窗口打开 {task} 的官方提交页"))
}

/// QOJ submission stays in the official browser because accounts, Cloudflare
/// verification and per-problem submission formats are managed by QOJ itself.
#[tauri::command]
pub async fn open_qoj_manual_submit(
    app: AppHandle,
    problem_id: String,
    code: String,
) -> Result<String, String> {
    if code.trim().is_empty() {
        return Err("代码为空，无法复制".into());
    }
    let problem_id = problem_id.trim().to_ascii_uppercase();
    if !Regex::new(r"^(?:\d+|C\d+[A-Z][A-Z0-9_]*)$")
        .unwrap()
        .is_match(&problem_id)
    {
        return Err(format!("无法识别 QOJ 题号：{problem_id}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("无法访问剪贴板：{e}"))?;
        clipboard
            .set_text(code)
            .map_err(|e| format!("复制代码失败：{e}"))
    })
    .await
    .map_err(|e| format!("复制代码任务失败：{e}"))??;
    let submit_url = if let Some(captures) = Regex::new(r"^C(\d+)([A-Z][A-Z0-9_]*)$")
        .unwrap()
        .captures(&problem_id)
    {
        format!(
            "https://qoj.ac/contest/{}/problem/{}#tab-submit-answer",
            &captures[1], &captures[2]
        )
    } else {
        format!("https://qoj.ac/problem/{problem_id}#tab-submit-answer")
    };
    let url = submit_url
        .parse()
        .map_err(|e| format!("提交页地址无效：{e}"))?;
    if let Some(window) = app.get_webview_window("qoj_manual_submit") {
        window
            .navigate(url)
            .map_err(|e| format!("无法切换 QOJ 提交页：{e}"))?;
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        WebviewWindowBuilder::new(&app, "qoj_manual_submit", WebviewUrl::External(url))
            .title(format!("QOJ {problem_id} · 代码已复制，请粘贴提交"))
            .inner_size(1080.0, 820.0)
            .min_inner_size(760.0, 560.0)
            .visible(true)
            .build()
            .map_err(|e| format!("无法打开 QOJ 提交窗口：{e}"))?;
    }
    Ok(format!("已复制代码并打开 QOJ {problem_id} 的官方提交页"))
}

// ── Serde types ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LoginResult {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub logged_in: bool,
    pub username: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CfProblemRaw {
    pub contest_id: Option<i64>,
    pub index: Option<String>,
    pub name: String,
    pub tags: Vec<String>,
    pub rating: Option<i32>,
}

#[derive(Deserialize, Debug)]
struct CfProblemsetResponse {
    status: String,
    result: Option<CfProblemsetResult>,
    comment: Option<String>,
}

#[derive(Deserialize, Debug)]
struct CfProblemsetResult {
    problems: Vec<CfProblemRaw>,
}

#[derive(Deserialize, Debug)]
struct CfContestResponse {
    status: String,
    result: Option<CfContestResult>,
    comment: Option<String>,
}

#[derive(Deserialize, Debug)]
struct CfContestResult {
    contest: CfContest,
    problems: Vec<CfProblemRaw>,
}

#[derive(Deserialize, Debug)]
struct CfContest {
    id: i64,
    name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Problem {
    pub id: String,
    pub title: String,
    pub rating: Option<i32>,
    pub tags: Vec<String>,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(rename = "contentFormat", skip_serializing_if = "Option::is_none")]
    pub content_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "timeLimitMs", skip_serializing_if = "Option::is_none")]
    pub time_limit_ms: Option<u64>,
    #[serde(rename = "memoryLimitMb", skip_serializing_if = "Option::is_none")]
    pub memory_limit_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<SampleCase>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SampleCase {
    pub input: String,
    pub output: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContestProblemAnalysis {
    pub id: String,
    pub title: String,
    pub rating: Option<i32>,
    pub tags: Vec<String>,
    pub missing_skills: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContestAnalysis {
    pub platform: String,
    pub contest_id: String,
    pub title: String,
    pub url: String,
    pub tags: Vec<String>,
    pub problems: Vec<ContestProblemAnalysis>,
}

// ── Helpers ───────────────────────────────────────────────────────

fn build_client() -> Result<Client, String> {
    Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

#[allow(dead_code)]
fn normalize_cf_problem_id(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_uppercase();
    Regex::new(r"^\d+[A-Z][A-Z0-9]*$")
        .unwrap()
        .is_match(&normalized)
        .then_some(normalized)
        .ok_or_else(|| format!("无效的 Codeforces 题号: {}", value))
}

// 通用 problemset 提交页使用题号文本输入框；比赛提交页和旧页面可能使用
// 下拉框。不能写死为 select，否则脚本会一直等待不存在的控件并最终超时。
#[allow(dead_code)]
const CF_PROBLEM_CONTROL_SELECTOR: &str = r#"input[name="submittedProblemCode"], select[name="submittedProblemCode"], select[name="submittedProblemIndex"]"#;
#[allow(dead_code)]
const CF_SOURCE_CONTROL_SELECTOR: &str = r#"textarea[name="source"], #source"#;

fn convert_problem(raw: &CfProblemRaw) -> Problem {
    let id = match (raw.contest_id, &raw.index) {
        (Some(cid), Some(idx)) => format!("{}{}", cid, idx),
        _ => raw.name.clone(),
    };
    Problem {
        id,
        title: raw.name.clone(),
        rating: raw.rating,
        tags: raw.tags.clone(),
        platform: "codeforces".into(),
        difficulty: None,
        source: Some("Codeforces".into()),
        content_format: None,
        description: None,
        url: None,
        time_limit_ms: None,
        memory_limit_mb: None,
        input: None,
        output: None,
        note: None,
        samples: None,
    }
}

fn section_html(document: &Html, class_name: &str) -> Option<String> {
    let selector = Selector::parse(&format!(".problem-statement .{}", class_name)).ok()?;
    let section = document.select(&selector).next()?;
    let html = section.inner_html();
    let title = Regex::new(
        r#"(?is)^\s*<div[^>]*class=[\"'][^\"']*section-title[^\"']*[\"'][^>]*>.*?</div>"#,
    )
    .ok()?;
    let body = title.replace(&html, "").trim().to_string();
    (!body.is_empty()).then_some(body)
}

fn pre_text(element: scraper::ElementRef<'_>) -> String {
    let div_selector = Selector::parse("div").unwrap();
    let lines: Vec<String> = element
        .select(&div_selector)
        .map(|div| div.text().collect::<String>())
        .collect();
    if lines.is_empty() {
        // WebView 序列化后的 Codeforces 样例通常用 <br>，scraper::text()
        // 不会自动把它转换成换行，必须先显式保留这些边界。
        let html = element.inner_html();
        let br_re = Regex::new(r"(?i)<br\s*/?>").unwrap();
        let normalized = br_re.replace_all(&html, "\n");
        Html::parse_fragment(&normalized)
            .root_element()
            .text()
            .collect::<String>()
            .trim()
            .to_string()
    } else {
        lines.join("\n").trim().to_string()
    }
}

// ── Local HTTP callback servers ───────────────────────────────────

/// 在随机端口接收 WebView 发回的一次性结果或“登录成功”标记。
/// 这里不会读取、导出或传输站点 Cookie。
fn start_signal_server() -> Result<(u16, std::sync::mpsc::Receiver<String>), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动本地服务失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取端口失败: {}", e))?
        .port();

    let (tx, rx) = std::sync::mpsc::channel::<String>();

    std::thread::spawn(move || {
        // 只接收一次连接
        if let Ok((mut stream, _)) = listener.accept() {
            // 设置超时，避免无限等待
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(120)));
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            let mut line = String::new();
            if reader.read_line(&mut line).is_ok() {
                // 解析 GET /cookie?XXX HTTP/1.1
                let marker = if line.contains("GET /cookie?") {
                    "GET /cookie?"
                } else {
                    "GET /result?"
                };
                if let Some(query_start) = line.find(marker) {
                    let after = &line[query_start + marker.len()..];
                    let query_end = after.find(' ').unwrap_or(after.len());
                    let cookie_encoded = &after[..query_end];

                    // URL decode
                    let cookie = urlencoding::decode(cookie_encoded)
                        .unwrap_or_else(|_| std::borrow::Cow::Borrowed(""))
                        .into_owned();

                    if !cookie.is_empty() {
                        // 返回成功响应（简单文本）
                        let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nOK";
                        let _ = stream.write_all(resp.as_bytes());

                        let _ = tx.send(cookie);
                        return;
                    }
                }
            }
            // 未提取到 cookie 也返回一个响应
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK";
            let _ = stream.write_all(resp.as_bytes());
        }
    });

    Ok((port, rx))
}

/// 接收浏览器回传的大段页面内容。POST 避免把完整题面塞进 URL。
fn start_payload_server() -> Result<(u16, std::sync::mpsc::Receiver<String>), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动本地服务失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取端口失败: {}", e))?
        .port();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(45)));
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
            let mut body = vec![0u8; content_length.min(4 * 1024 * 1024)];
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

fn fetch_cf_html_via_webview(app: &AppHandle, url: &str) -> Result<String, String> {
    if let Some(existing) = app.get_webview_window("cf_statement") {
        existing.destroy().ok();
    }
    let (port, result_rx) = start_payload_server()?;
    let window = WebviewWindowBuilder::new(
        app,
        "cf_statement",
        WebviewUrl::External(url.parse().map_err(|e| format!("题目链接无效: {}", e))?),
    )
    .title("Codeforces Statement")
    .inner_size(900.0, 700.0)
    .visible(false)
    .build()
    .map_err(|e| format!("创建题面浏览器失败: {}", e))?;
    let js = format!(
        r#"(function() {{
            if (window.__acmStatementSent) return;
            var node = document.querySelector('.problem-statement');
            if (!node) return;
            window.__acmStatementSent = true;
            fetch('http://127.0.0.1:{}/result', {{
                method: 'POST', mode: 'no-cors',
                headers: {{'Content-Type': 'text/plain'}},
                body: encodeURIComponent(node.outerHTML)
            }}).catch(function() {{ window.__acmStatementSent = false; }});
        }})();"#,
        port
    );
    let injector = window.clone();
    std::thread::spawn(move || {
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(750));
            let _ = injector.eval(&js);
        }
    });
    let result = result_rx
        .recv_timeout(std::time::Duration::from_secs(35))
        .map_err(|_| "Codeforces 浏览器题面加载超时，请先在官方窗口完成人机验证".to_string());
    window.destroy().ok();
    result
}

// ── Tauri Commands ────────────────────────────────────────────────

/// 通过 Codeforces 官方页面登录。
///
/// 流程：
/// 1. 启动本地 TCP 监听
/// 2. 打开 Tauri webview → codeforces.com/enter
/// 3. 注入 JS：只检测页面是否已出现 Logout，不读取 Cookie 或表单内容
/// 4. Rust 收到布尔登录信号 → emit 事件给前端 → 关闭 webview
#[tauri::command]
pub async fn login_via_browser(
    app: AppHandle,
    switch_account: Option<bool>,
    current_username: Option<String>,
) -> Result<LoginResult, String> {
    // 关闭可能已有的旧窗口
    if let Some(existing) = app.get_webview_window("cf_login") {
        existing.destroy().ok();
    }

    // 本地回调只传输“登录成功”标记。
    let (port, login_rx) = start_signal_server()?;

    // 生成检测 JS（函数形式，方便每次 navigation 后重新注入）
    fn make_detect_js(port: u16, switch_account: bool, current_username: &str) -> String {
        let current_json =
            serde_json::to_string(current_username).unwrap_or_else(|_| "\"\"".into());
        format!(
            r#"
(function() {{
    if (window.__cf_login_sent) return;
    var switching={switching}, previous={current_json}.toLowerCase();
    var check = function() {{
        if (window.__cf_login_sent) return;
        try {{
            var profile = document.querySelector('#header a[href^="/profile/"], .lang-chooser a[href^="/profile/"]');
            var hasProfile = !!profile;
            var hasLogout = document.body && document.body.innerText &&
                document.body.innerText.indexOf('Logout') !== -1;
            var href=profile?(profile.getAttribute('href')||''):'';
            var username=decodeURIComponent((href.split('/profile/')[1]||'').split(/[?#]/)[0]||'').toLowerCase();
            if (switching && !hasProfile && !hasLogout) sessionStorage.setItem('__acmCfSawLogout','1');
            var changed=!switching || (username && previous && username!==previous) || (username && !previous && sessionStorage.getItem('__acmCfSawLogout')==='1');
            if ((hasProfile || hasLogout) && changed) {{
                window.__cf_login_sent = true;
                new Image().src = 'http://127.0.0.1:{port}/cookie?login';
            }}
        }} catch(e) {{}}
    }};
    check();
    setInterval(check, 1500);
    document.addEventListener('submit', function() {{ setTimeout(check, 2500); }});
}})();
"#,
            port = port,
            switching = if switch_account { "true" } else { "false" },
            current_json = current_json
        )
    }

    let switching = switch_account.unwrap_or(false);
    let detect_js = make_detect_js(port, switching, current_username.as_deref().unwrap_or(""));
    let start_url = if switching {
        "https://codeforces.com/"
    } else {
        "https://codeforces.com/enter"
    };

    // initialization_script 会在每个新文档中执行；登录表单导航后的页面也能
    // 继续检测成功状态。on_navigation 发生在导航开始前，不能用于此目的。
    WebviewWindowBuilder::new(
        &app,
        "cf_login",
        WebviewUrl::External(
            start_url
                .parse()
                .map_err(|e| format!("URL 解析失败: {}", e))?,
        ),
    )
    .title(if switching {
        "切换 Codeforces 账号 — 请先退出旧账号再登录"
    } else {
        "登录 Codeforces — 请在窗口中完成登录"
    })
    .inner_size(900.0, 720.0)
    .resizable(true)
    .center()
    .initialization_script(&detect_js)
    .build()
    .map_err(|e| format!("创建浏览器窗口失败: {}", e))?;

    // 等待官方页面发出登录成功信号。
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        match login_rx.recv_timeout(std::time::Duration::from_secs(180)) {
            Ok(_) => {
                if let Some(wv) = app_for_thread.get_webview_window("cf_login") {
                    wv.destroy().ok();
                }
                let _ = app_for_thread.emit("cf-login-success", true);
            }
            Err(_timeout) => {
                // 超时，关闭窗口
                if let Some(wv) = app_for_thread.get_webview_window("cf_login") {
                    wv.destroy().ok();
                }
                let _ =
                    app_for_thread.emit("cf-login-error", "登录超时（3 分钟），请重试".to_string());
            }
        }
    });

    Ok(LoginResult {
        success: true,
        message:
            "官方登录窗口已打开。应用不会读取密码或导出 Cookie；登录会话由官方 WebView 持久保存。"
                .into(),
    })
}

/// 获取 Codeforces 题目列表（公开 API，无需登录）
/// 返回所有有 rating 的题目，按 ID 倒序排列
#[tauri::command]
pub async fn fetch_problems_cf() -> Result<Vec<Problem>, String> {
    let client = build_client()?;
    let resp = client
        .get("https://codeforces.com/api/problemset.problems")
        .send()
        .await
        .map_err(|e| format!("请求题目列表失败: {}", e))?;

    let body: CfProblemsetResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    if body.status != "OK" {
        let msg = body.comment.unwrap_or_else(|| "未知错误".into());
        return Err(format!("Codeforces API 返回错误: {}", msg));
    }

    let result = body.result.ok_or_else(|| "API 返回结果为空".to_string())?;
    let mut problems: Vec<Problem> = result
        .problems
        .iter()
        .filter(|p| p.rating.is_some())
        .map(convert_problem)
        .collect();
    problems.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(problems)
}

/// 抓取 Codeforces 题面、输入输出说明与样例。
#[tauri::command]
pub async fn fetch_problem_detail_cf(
    app: AppHandle,
    problem_id: String,
) -> Result<Problem, String> {
    let id_re = Regex::new(r"^(\d+)([A-Za-z][A-Za-z0-9]*)$").unwrap();
    let captures = id_re
        .captures(problem_id.trim())
        .ok_or_else(|| format!("无效的 Codeforces 题号: {}", problem_id))?;
    let contest_id = captures.get(1).unwrap().as_str();
    let index = captures.get(2).unwrap().as_str();
    let url = format!(
        "https://codeforces.com/problemset/problem/{}/{}",
        contest_id, index
    );

    let client = build_client()?;
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("抓取题面失败: {}", e))?;
    // Codeforces 主站有时会对非浏览器请求返回 403；官方 m1 镜像提供相同题面。
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        let mirror_url = format!(
            "https://m1.codeforces.com/problemset/problem/{}/{}",
            contest_id, index
        );
        response = client
            .get(mirror_url)
            .send()
            .await
            .map_err(|e| format!("从 Codeforces 镜像抓取题面失败: {}", e))?;
    }
    if !response.status().is_success() {
        return Err(format!("抓取题面失败: HTTP {}", response.status()));
    }
    let mut html = response
        .text()
        .await
        .map_err(|e| format!("读取题面失败: {}", e))?;
    if html.contains("Just a moment")
        || html.contains("_cf_chl_opt")
        || html.contains("Your browser is being checked")
        || !html.contains("problem-statement")
    {
        html = fetch_cf_html_via_webview(&app, &url)?;
    }
    let document = Html::parse_document(&html);
    let title_selector = Selector::parse(".problem-statement .title").unwrap();
    let raw_title = document
        .select(&title_selector)
        .next()
        .map(|e| e.text().collect::<String>())
        .unwrap_or_else(|| problem_id.clone())
        .trim()
        .to_string();
    let title = raw_title
        .split_once(". ")
        .map(|(_, name)| name.to_string())
        .unwrap_or(raw_title);

    let description_selector = Selector::parse(
        ".problem-statement > div:not(.header):not(.input-specification):not(.output-specification):not(.sample-tests):not(.note)",
    ).unwrap();
    // 保留 OJ 原始结构（段落、公式、上下标、列表），前端会进行净化后渲染。
    // 旧实现把 DOM 压成逐行纯文本，导致截图中变量 n/h 被拆成单独段落。
    let description = document
        .select(&description_selector)
        .next()
        .map(|e| e.inner_html());

    let input_selector = Selector::parse(".sample-test .input pre").unwrap();
    let output_selector = Selector::parse(".sample-test .output pre").unwrap();
    let inputs: Vec<String> = document.select(&input_selector).map(pre_text).collect();
    let outputs: Vec<String> = document.select(&output_selector).map(pre_text).collect();
    let samples = inputs
        .into_iter()
        .zip(outputs)
        .map(|(input, output)| SampleCase { input, output })
        .collect();

    let time_selector = Selector::parse(".problem-statement .time-limit").unwrap();
    let memory_selector = Selector::parse(".problem-statement .memory-limit").unwrap();
    let number_re = Regex::new(r"([0-9]+(?:\.[0-9]+)?)").unwrap();
    let time_limit_ms = document.select(&time_selector).next().and_then(|e| {
        let text = e.text().collect::<String>();
        number_re
            .captures(&text)?
            .get(1)?
            .as_str()
            .parse::<f64>()
            .ok()
            .map(|v| (v * 1000.0) as u64)
    });
    let memory_limit_mb = document.select(&memory_selector).next().and_then(|e| {
        let text = e.text().collect::<String>();
        number_re
            .captures(&text)?
            .get(1)?
            .as_str()
            .parse::<u64>()
            .ok()
    });

    Ok(Problem {
        id: problem_id,
        title,
        rating: None,
        tags: vec![],
        platform: "codeforces".into(),
        difficulty: None,
        source: Some("Codeforces".into()),
        content_format: Some("html".into()),
        description,
        url: Some(url),
        time_limit_ms,
        memory_limit_mb,
        input: section_html(&document, "input-specification"),
        output: section_html(&document, "output-specification"),
        note: section_html(&document, "note"),
        samples: Some(samples),
    })
}

/// 解析 Codeforces 比赛链接/比赛号并聚合题目知识标签。
#[tauri::command]
pub async fn analyze_contest_cf(contest_url: String) -> Result<ContestAnalysis, String> {
    let id_re = Regex::new(r"(?:contest/|gym/)?(\d+)").unwrap();
    let contest_id = id_re
        .captures(contest_url.trim())
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| "无法从链接中识别 Codeforces 比赛号".to_string())?;
    // Codeforces 对普通比赛的匿名 standings 请求不允许附带 from/count。
    let api_url = format!(
        "https://codeforces.com/api/contest.standings?contestId={}",
        contest_id
    );
    // standings 会连同排名一起返回；老比赛响应可能较大，不能沿用题面请求的
    // 30 秒总超时。当前网络较慢时，状态码已经返回但读取 JSON 正文会超时。
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("创建比赛分析客户端失败: {}", e))?;
    let response = client
        .get(&api_url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| format!("获取比赛信息失败: {}", e))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取比赛信息失败（HTTP {}）: {}", status, e))?;
    let body: CfContestResponse = serde_json::from_slice(&bytes).map_err(|e| {
        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(160)]);
        format!(
            "解析比赛信息失败（HTTP {}）: {}；响应开头：{}",
            status, e, preview
        )
    })?;
    if body.status != "OK" {
        return Err(body
            .comment
            .unwrap_or_else(|| "Codeforces API 返回错误".into()));
    }
    let result = body
        .result
        .ok_or_else(|| "比赛不存在或暂不可访问".to_string())?;
    let mut all_tags: Vec<String> = result
        .problems
        .iter()
        .flat_map(|p| p.tags.clone())
        .collect();
    all_tags.sort();
    all_tags.dedup();
    let problems = result
        .problems
        .iter()
        .map(|p| ContestProblemAnalysis {
            id: format!(
                "{}{}",
                p.contest_id.unwrap_or(result.contest.id),
                p.index.clone().unwrap_or_default()
            ),
            title: p.name.clone(),
            rating: p.rating,
            tags: p.tags.clone(),
            missing_skills: vec![],
        })
        .collect();
    Ok(ContestAnalysis {
        platform: "codeforces".into(),
        contest_id: contest_id.clone(),
        title: result.contest.name,
        url: format!("https://codeforces.com/contest/{}", contest_id),
        tags: all_tags,
        problems,
    })
}

/// 提交代码到 Codeforces（通过隐藏 Webview，自动填写表单 + 提交 + 轮询评测结果）
#[tauri::command]
#[allow(dead_code)]
pub async fn submit_cf(
    app: AppHandle,
    problem_id: String,
    language: String,
    code: String,
) -> Result<String, String> {
    let normalized_problem_id = normalize_cf_problem_id(&problem_id)?;
    let (program_type_id, language_kind): (&str, &str) = match language.as_str() {
        "cpp" => ("89", "cpp"),       // 首选 GNU G++23 (64 bit)
        "python" => ("70", "python"), // 首选 PyPy 3
        "java" => ("87", "java"),     // 首选 Java 21
        _ => return Err(format!("不支持的语言: {}", language)),
    };

    let (port, result_rx) = start_signal_server()?;

    let code_json =
        serde_json::to_string(&code).map_err(|e| format!("序列化提交代码失败: {}", e))?;
    let problem_json = serde_json::to_string(&normalized_problem_id)
        .map_err(|e| format!("序列化题号失败: {}", e))?;
    let language_json =
        serde_json::to_string(program_type_id).map_err(|e| format!("序列化语言失败: {}", e))?;
    let language_kind_json =
        serde_json::to_string(language_kind).map_err(|e| format!("序列化语言失败: {}", e))?;

    // JS：自动填表 → 提交 → 轮询 API 获取评测结果
    let js = format!(
        r#"
(function() {{
    if (window.__acmHelperSubmitInjector) return;
    window.__acmHelperSubmitInjector = true;
    var pid = {pid};
    var lang = {lang};
    var languageKind = {language_kind};
    var code = {code};
    var port = {port};
    var submitted = false;
    var pollCount = 0;
    var formWaitCount = 0;
    var baselineId = 0;
    var handle = '';
    var submittedAt = Math.floor(Date.now() / 1000) - 3;
    var stateKey = 'acm-helper-cf-submit-state';

    function sendResult(data) {{
        try {{ sessionStorage.removeItem(stateKey); }} catch (_) {{}}
        new Image().src = 'http://127.0.0.1:' + port + '/result?' + encodeURIComponent(JSON.stringify(data));
    }}

    function findHandle() {{
        var link = document.querySelector('#header a[href^="/profile/"], .lang-chooser a[href^="/profile/"]');
        if (!link) return '';
        var parts = link.getAttribute('href').split('/');
        return parts[parts.length - 1] || '';
    }}

    function statusUrl() {{
        return 'https://codeforces.com/api/user.status?handle=' + encodeURIComponent(handle) + '&from=1&count=30&_=' + Date.now();
    }}

    function restorePendingState() {{
        try {{
            var saved = JSON.parse(sessionStorage.getItem(stateKey) || 'null');
            if (!saved || saved.pid !== pid) return false;
            handle = saved.handle || '';
            baselineId = saved.baselineId || 0;
            submittedAt = saved.submittedAt || submittedAt;
            submitted = true;
            setTimeout(pollVerdict, 1800);
            return true;
        }} catch (_) {{ return false; }}
    }}

    function chooseLanguage(select) {{
        var options = Array.prototype.slice.call(select.options || []);
        var preferred = options.find(function(option) {{ return option.value === lang && !option.disabled; }});
        if (preferred) return preferred.value;
        var patterns = languageKind === 'cpp'
            ? [/GNU G\+\+.*(?:23|20|17)/i, /GNU G\+\+/i]
            : languageKind === 'python'
                ? [/PyPy\s*3/i, /Python\s*3/i]
                : [/Java\s*(?:21|17)/i, /Java/i];
        for (var i=0;i<patterns.length;i++) {{
            var found = options.find(function(option) {{ return !option.disabled && patterns[i].test(option.textContent || ''); }});
            if (found) return found.value;
        }}
        return '';
    }}

    // ── Step 1: 自动填表 + 提交 ──
    function trySubmit() {{
        if (submitted || window.__acmHelperSubmissionSent) return;
        var csrf = document.querySelector('input[name="csrf_token"]');
        var problemControl = document.querySelector({problem_selector});
        var langSel = document.querySelector('select[name="programTypeId"]');
        var srcArea = document.querySelector({source_selector});
        var form = (srcArea && srcArea.closest('form')) || document.querySelector('form.submit-form');

        if (!csrf || !problemControl || !langSel || !srcArea || !form) {{
            formWaitCount++;
            var pageText = (document.body && document.body.innerText || '').slice(0, 1000);
            if (/\/enter(?:\?|$)/.test(location.pathname) || /Enter your handle|Sign in to Codeforces/i.test(pageText)) {{
                sendResult({{error:'Codeforces 会话未登录或已过期，请重新登录'}});
                return;
            }}
            if (formWaitCount >= 60) {{
                var missing = [];
                if (!csrf) missing.push('csrf_token');
                if (!problemControl) missing.push('题号输入框');
                if (!langSel) missing.push('编译器列表');
                if (!srcArea) missing.push('源码编辑框');
                if (!form) missing.push('提交表单');
                var challenge = /cloudflare|verification|captcha|human/i.test(document.title + ' ' + pageText);
                sendResult({{error:(challenge ? 'Codeforces 人机验证尚未完成' : 'Codeforces 提交页结构识别失败') + '；缺少：' + missing.join('、') + '；页面：' + location.href}});
                return;
            }}
            setTimeout(trySubmit, 500);
            return;
        }}

        // 填表
        // 通用题库页使用完整题号；比赛页下拉框只使用题目下标。
        problemControl.value = problemControl.name === 'submittedProblemIndex'
            ? pid.replace(/^\d+/, '')
            : pid;
        var selectedLanguage = chooseLanguage(langSel);
        if (!selectedLanguage) {{
            sendResult({{error:'Codeforces 当前提交页没有可用的 '+languageKind+' 编译器'}});
            return;
        }}
        langSel.value = selectedLanguage;
        srcArea.value = code;
        problemControl.dispatchEvent(new Event('input', {{bubbles:true}}));
        problemControl.dispatchEvent(new Event('change', {{bubbles:true}}));
        langSel.dispatchEvent(new Event('change', {{bubbles:true}}));
        srcArea.dispatchEvent(new Event('input', {{bubbles:true}}));

        handle = findHandle();
        if (!handle) {{
            sendResult({{error:'未检测到 Codeforces 登录用户，请重新登录'}});
            return;
        }}
        submitted = true;
        window.__acmHelperSubmissionSent = true;

        // 先记录用户最新提交 ID，避免把历史记录误当本次结果。
        fetch(statusUrl())
            .then(function(r) {{ return r.json(); }})
            .then(function(data) {{
                if (data.status === 'OK' && data.result && data.result.length) baselineId = data.result[0].id || 0;
            }})
            .catch(function() {{ baselineId = 0; }})
            .then(function() {{
                // 使用 Codeforces 官方表单的原生导航流程。状态保存在同源
                // sessionStorage，页面重载后注入脚本只轮询，不会重复提交。
                submittedAt = Math.floor(Date.now() / 1000) - 2;
                sessionStorage.setItem(stateKey, JSON.stringify({{
                    pid: pid, handle: handle, baselineId: baselineId, submittedAt: submittedAt
                }}));
                var submitButton = form.querySelector('input[type="submit"], button[type="submit"]');
                if (form.requestSubmit) form.requestSubmit(submitButton || undefined);
                else HTMLFormElement.prototype.submit.call(form);
            }})
            .catch(function(error) {{ sendResult({{error:'提交请求失败: ' + error.message}}); }});
    }}

    // ── Step 2: 轮询 CF API 获取评测结果 ──
    function pollVerdict() {{
        pollCount++;
        fetch(statusUrl())
            .then(function(r){{ return r.json(); }})
            .then(function(data) {{
                if (data.status !== 'OK' || !data.result || data.result.length === 0) {{
                    if (pollCount < 60) setTimeout(pollVerdict, 1000);
                    else sendResult({{error:'无法获取提交状态'}});
                    return;
                }}
                var sub = data.result.find(function(item) {{
                    var problemCode = item.problem ? String(item.problem.contestId || '') + String(item.problem.index || '') : '';
                    return item.id > baselineId
                        && (item.creationTimeSeconds || 0) >= submittedAt
                        && problemCode.toUpperCase() === pid.toUpperCase();
                }});
                if (!sub) {{
                    // 若官方页面明确展示表单错误，直接返回原因，避免假装已提交。
                    var formError = document.querySelector('.error.for__field, .alert-danger, .notice.error');
                    if (formError && formError.textContent.trim()) {{
                        sendResult({{error:'Codeforces 拒绝提交：' + formError.textContent.trim().slice(0,300)}});
                        return;
                    }}
                    if (pollCount < 48) setTimeout(pollVerdict, 2500);
                    else sendResult({{error:'未在提交记录中找到本次代码'}});
                    return;
                }}
                var verdict = sub.verdict || 'TESTING';

                if (verdict === 'TESTING') {{
                    // 还在评测中，每秒轮询一次
                    if (pollCount < 48) setTimeout(pollVerdict, 2500);
                    else sendResult({{error:'评测超时'}});
                }} else {{
                    // 评测完成
                    sendResult({{
                        status: verdict,
                        time: sub.timeConsumedMillis,
                        memory: sub.memoryConsumedBytes,
                        passed: sub.passedTestCount || 0
                    }});
                }}
            }})
            .catch(function(e) {{
                if (pollCount < 48) setTimeout(pollVerdict, 3000);
                else sendResult({{error:'网络错误: '+e.message}});
            }});
    }}

    if (restorePendingState()) return;
    if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', trySubmit);
    }} else {{
        trySubmit();
    }}
}})();
"#,
        pid = problem_json,
        lang = language_json,
        language_kind = language_kind_json,
        code = code_json,
        port = port,
        problem_selector = serde_json::to_string(CF_PROBLEM_CONTROL_SELECTOR)
            .map_err(|e| format!("序列化题号控件选择器失败: {}", e))?,
        source_selector = serde_json::to_string(CF_SOURCE_CONTROL_SELECTOR)
            .map_err(|e| format!("序列化源码控件选择器失败: {}", e))?
    );

    // 打开隐藏 webview
    let wv_label = if app.get_webview_window("cf_login").is_some() {
        "cf_submit"
    } else {
        "cf_login"
    };

    let wv = if let Some(existing) = app.get_webview_window(wv_label) {
        existing
    } else {
        WebviewWindowBuilder::new(
            &app,
            wv_label,
            WebviewUrl::External("https://codeforces.com/problemset/submit".parse().unwrap()),
        )
        .title("CF Submit")
        .inner_size(1.0, 1.0) // 最小化，不可见
        .visible(false)
        .build()
        .map_err(|e| format!("创建窗口失败: {}", e))?
    };

    // 导航到提交页
    wv.navigate("https://codeforces.com/problemset/submit".parse().unwrap())
        .map_err(|e| format!("导航失败: {}", e))?;

    // 导航完成时间受网络影响。重复尝试注入，页面内全局标记保证最多提交一次。
    // 这比固定等待数秒可靠：若导航尚未结束，旧文档中的脚本会被新页面销毁。
    let injection_window = wv.clone();
    let injection_script = js.clone();
    std::thread::spawn(move || {
        // 最多等待约 60 秒，覆盖网络较慢、Cloudflare 检查或首次 WebView
        // 初始化的情况。页面内标记仍保证最多只会真正提交一次。
        for _ in 0..80 {
            std::thread::sleep(std::time::Duration::from_millis(750));
            let _ = injection_window.eval(&injection_script);
        }
    });

    // 页面初始化最多约 60 秒，之后评测轮询最多约 120 秒；外层必须覆盖
    // 两段时间，避免远端已经创建提交而客户端先行报超时。
    let result = tauri::async_runtime::spawn_blocking(move || {
        result_rx.recv_timeout(std::time::Duration::from_secs(210))
    })
    .await
    .map_err(|e| format!("等待 Codeforces 结果失败: {}", e))?
    .map_err(|_| "提交或评测超时（210 秒），请到 Codeforces 提交记录确认状态".to_string());
    if let Some(window) = app.get_webview_window(wv_label) {
        window.destroy().ok();
    }
    // 回调服务器已完成 URL 解码，这里直接返回 JSON，避免百分号被二次解码。
    result
}

/// 登录会话由系统 WebView 持久管理，应用不读取或导出 Cookie。
#[tauri::command]
pub async fn restore_session() -> Result<LoginResult, String> {
    Ok(LoginResult {
        success: false,
        message: "Codeforces 会话由官方 WebView 持久保管；提交会直接尝试使用现有会话。".into(),
    })
}

/// Inspect the account visible in the persisted official Codeforces WebView.
#[tauri::command]
pub async fn inspect_cf_account(app: AppHandle) -> Result<AccountStatus, String> {
    if let Some(window) = app.get_webview_window("cf_account_check") {
        let _ = window.destroy();
    }
    let (port, rx) = start_signal_server()?;
    let script = format!(
        r#"(function() {{
          if (window.__acmAccountInspector) return;
          window.__acmAccountInspector=true;
          function report(value) {{
            if (window.__acmAccountReported) return;
            window.__acmAccountReported=true;
            new Image().src='http://127.0.0.1:{port}/result?'+encodeURIComponent(JSON.stringify(value));
          }}
          function inspect() {{
            var link=document.querySelector('#header a[href^="/profile/"], .lang-chooser a[href^="/profile/"]');
            if (link) {{
              var href=link.getAttribute('href')||'';
              var username=decodeURIComponent(href.split('/profile/')[1]||'').split(/[?#]/)[0] || (link.textContent||'').trim();
              report({{loggedIn:true,username:username||null}}); return;
            }}
            if (document.readyState==='complete' && document.querySelector('a[href^="/enter"]')) report({{loggedIn:false,username:null}});
          }}
          setInterval(inspect,600); window.addEventListener('load',inspect); inspect();
        }})();"#,
        port = port
    );
    WebviewWindowBuilder::new(
        &app,
        "cf_account_check",
        // 登录页会让 Codeforces 恢复 WebView2 中已有的会话；已登录时
        // 官方页面会直接呈现账号导航，未登录时则保留登录入口。
        WebviewUrl::External("https://codeforces.com/enter".parse().unwrap()),
    )
    .title("检测 Codeforces 账号")
    .inner_size(1.0, 1.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("无法检测 Codeforces 账号: {e}"))?;
    let payload = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(30))
    })
    .await
    .map_err(|e| format!("等待 Codeforces 账号检测失败: {e}"))?
    .map_err(|_| "Codeforces 账号检测超时".to_string());
    if let Some(window) = app.get_webview_window("cf_account_check") {
        let _ = window.destroy();
    }
    serde_json::from_str(&payload?).map_err(|e| format!("解析 Codeforces 账号失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_breaks_in_browser_serialized_samples() {
        let document = Html::parse_fragment("<pre>3 2<br>1 2<br/>2 3</pre>");
        let selector = Selector::parse("pre").unwrap();
        let sample = document.select(&selector).next().unwrap();
        assert_eq!(pre_text(sample), "3 2\n1 2\n2 3");
    }

    #[test]
    fn validates_and_normalizes_submission_problem_ids() {
        assert_eq!(normalize_cf_problem_id(" 1234a2 ").unwrap(), "1234A2");
        assert_eq!(normalize_cf_problem_id("1A").unwrap(), "1A");
        assert!(normalize_cf_problem_id("../1A").is_err());
        assert!(normalize_cf_problem_id("A1").is_err());
    }

    #[test]
    fn recognizes_current_codeforces_submit_controls() {
        assert!(CF_PROBLEM_CONTROL_SELECTOR.contains("input[name=\"submittedProblemCode\"]"));
        assert!(CF_PROBLEM_CONTROL_SELECTOR.contains("submittedProblemIndex"));
        assert!(CF_SOURCE_CONTROL_SELECTOR.contains("textarea[name=\"source\"]"));
    }

    #[test]
    fn preserves_rich_markup_in_statement_sections() {
        let document = Html::parse_fragment(
            r#"<div class="problem-statement"><div class="input-specification"><div class="section-title">Input</div><p>Read <b>n</b> and <span class="tex-font-style-it">h</span>.</p></div></div>"#,
        );
        let body = section_html(&document, "input-specification").unwrap();
        assert!(body.contains("<p>"));
        assert!(body.contains("<b>n</b>"));
        assert!(body.contains("tex-font-style-it"));
        assert!(!body.contains("section-title"));
    }

    #[test]
    #[ignore = "requires network"]
    fn fetches_live_problemset() {
        let runtime = tokio::runtime::Runtime::new().expect("Tokio runtime should start");
        let problems = runtime
            .block_on(fetch_problems_cf())
            .expect("Codeforces problemset should load");
        assert!(
            problems.len() > 1_000,
            "unexpectedly small problemset: {}",
            problems.len()
        );
        assert!(problems.iter().all(|problem| problem.rating.is_some()));
    }

    #[test]
    #[ignore = "requires network"]
    fn analyzes_live_contest_knowledge_tags() {
        let runtime = tokio::runtime::Runtime::new().expect("Tokio runtime should start");
        let analysis = runtime
            .block_on(analyze_contest_cf(
                "https://codeforces.com/contest/1915".into(),
            ))
            .expect("Codeforces contest should load");
        assert_eq!(analysis.contest_id, "1915");
        assert!(!analysis.problems.is_empty());
        assert!(analysis
            .problems
            .iter()
            .any(|problem| !problem.tags.is_empty()));
    }
}
