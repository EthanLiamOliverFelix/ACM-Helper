// Included by oj.rs: the same QOJ session and callback transport as statement imports.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QojProblemPage {
    problems: Vec<Problem>,
    page: u32,
    total_pages: u32,
}

fn qoj_text(node: scraper::ElementRef<'_>) -> String {
    node.text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn qoj_link(href: &str) -> Option<String> {
    let url = reqwest::Url::parse("https://qoj.ac")
        .ok()?
        .join(href)
        .ok()?;
    (url.host_str() == Some("qoj.ac")).then(|| url.to_string())
}

fn qoj_problem_link(href: &str, label: String, title: String) -> Option<QojArchiveProblem> {
    let url = qoj_link(href)?;
    let captures = Regex::new(r"/contest/(\d+)/problem/([^/?#]+)").unwrap();
    let id = if let Some(c) = captures.captures(&url) {
        let raw = c[2].to_uppercase();
        if raw.chars().all(|ch| ch.is_ascii_digit()) {
            raw
        } else {
            format!("C{}{}", &c[1], raw)
        }
    } else {
        Regex::new(r"/problem/(\d+)(?:/|$|[?#])")
            .unwrap()
            .captures(&url)?[1]
            .to_string()
    };
    Some(QojArchiveProblem {
        id,
        label,
        title,
        url,
        accepted_teams: None,
        submitted_teams: None,
    })
}

fn parse_qoj_catalog(html: &str, page: u32) -> Result<QojProblemPage, String> {
    let doc = Html::parse_document(html);
    let links = Selector::parse("table tbody a[href]").unwrap();
    let mut seen = std::collections::HashSet::new();
    let problems = doc
        .select(&links)
        .filter_map(|link| {
            let item = qoj_problem_link(link.value().attr("href")?, String::new(), qoj_text(link))?;
            if !item.id.chars().all(|ch| ch.is_ascii_digit()) || !seen.insert(item.id.clone()) {
                return None;
            }
            Some(Problem {
                id: item.id,
                title: item.title,
                platform: "qoj".into(),
                tags: vec![],
                rating: None,
                difficulty: None,
                source: None,
                content_format: None,
                description: None,
                url: Some(item.url),
                time_limit_ms: None,
                memory_limit_mb: None,
                input: None,
                output: None,
                note: None,
                samples: None,
            })
        })
        .collect::<Vec<_>>();
    let mut total_pages = page;
    let page_re = Regex::new(r"[?&]page=(\d+)").unwrap();
    for link in doc.select(&Selector::parse(".pagination a[href]").unwrap()) {
        if let Some(c) = page_re.captures(link.value().attr("href").unwrap_or("")) {
            total_pages = total_pages.max(c[1].parse().unwrap_or(page));
        }
    }
    for input in doc.select(&Selector::parse(".pagination input[max], input[data-max]").unwrap()) {
        total_pages = total_pages.max(
            input
                .value()
                .attr("max")
                .or(input.value().attr("data-max"))
                .and_then(|n| n.parse().ok())
                .unwrap_or(page),
        );
    }
    let actual_page = doc
        .select(&Selector::parse(".pagination .active a").unwrap())
        .next()
        .and_then(|link| qoj_text(link).parse::<u32>().ok())
        .unwrap_or(page);
    // A valid empty results table is different from a login / verification page.
    if problems.is_empty()
        && doc
            .select(&Selector::parse("table").unwrap())
            .next()
            .is_none()
    {
        return Err("QOJ 题库未加载，请在 OJ 账号中登录 QOJ 后重试".into());
    }
    Ok(QojProblemPage {
        problems,
        page: actual_page,
        total_pages: total_pages.max(actual_page),
    })
}

fn parse_qoj_archive(html: &str, url: &str) -> Result<QojArchivePage, String> {
    let doc = Html::parse_document(html);
    let title = doc
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(qoj_text)
        .unwrap_or_default()
        .trim_end_matches(" - QOJ.ac")
        .to_string();
    let is_contest = url.contains("/contest/");
    let mut entries = vec![];
    let mut section = String::new();
    let elements = Selector::parse("h2, h3, h4, table").unwrap();
    let link_selector = Selector::parse("a[href]").unwrap();
    let cells_selector = Selector::parse("td").unwrap();
    let id_re = Regex::new(r"^/(category|contest)/(\d+)/?$").unwrap();
    let ratio_re = Regex::new(r"(\d+)\s*/\s*(\d+)").unwrap();
    let mut contest_problems = vec![];
    for element in doc.select(&elements) {
        if element.value().name() != "table" {
            section = if element.value().name() == "h2" {
                String::new()
            } else {
                qoj_text(element)
            };
            continue;
        }
        let mut children = vec![];
        for row in element.select(&Selector::parse("tbody tr").unwrap()) {
            let cells = row.select(&cells_selector).collect::<Vec<_>>();
            let links = row.select(&link_selector).collect::<Vec<_>>();
            if is_contest {
                let raw_label = cells.first().map(|c| qoj_text(*c)).unwrap_or_default();
                let label = if Regex::new(r"^[A-Z][A-Z0-9_]*$")
                    .unwrap()
                    .is_match(&raw_label)
                {
                    raw_label
                } else {
                    ((b'A' + contest_problems.len().min(25) as u8) as char).to_string()
                };
                for link in &links {
                    if let Some(problem) = qoj_problem_link(
                        link.value().attr("href").unwrap_or(""),
                        label.clone(),
                        qoj_text(*link),
                    ) {
                        if let Some(previous) = contest_problems
                            .iter_mut()
                            .find(|p: &&mut QojArchiveProblem| p.id == problem.id)
                        {
                            if problem.title.len() > previous.title.len() {
                                previous.title = problem.title;
                            }
                        } else {
                            contest_problems.push(problem);
                        }
                    }
                }
                continue;
            }
            let parent = links.iter().find_map(|link| {
                let href = qoj_link(link.value().attr("href")?)?;
                let parsed = reqwest::Url::parse(&href).ok()?;
                let c = id_re.captures(parsed.path())?;
                Some((c[1].to_string(), c[2].to_string(), href, qoj_text(*link)))
            });
            let Some((kind, id, href, name)) = parent else {
                continue;
            };
            let problems = links
                .iter()
                .filter_map(|link| {
                    qoj_problem_link(
                        link.value().attr("href").unwrap_or(""),
                        qoj_text(*link),
                        link.value()
                            .attr("title")
                            .map(str::to_owned)
                            .unwrap_or_else(|| qoj_text(*link)),
                    )
                })
                .collect::<Vec<_>>();
            let counts = cells
                .iter()
                .skip(1)
                .map(|c| qoj_text(*c).parse::<u64>().ok())
                .collect::<Vec<_>>();
            let ratio = cells.iter().find_map(|c| {
                ratio_re.captures(&qoj_text(*c)).map(|r| {
                    (
                        r[1].parse::<u64>().unwrap_or(0),
                        r[2].parse::<u64>().unwrap_or(0),
                    )
                })
            });
            children.push(QojArchiveEntry {
                kind,
                id,
                title: name,
                url: href,
                contest_count: counts.iter().rev().nth(1).copied().flatten(),
                solved_count: ratio.map(|r| r.0),
                problem_count: ratio
                    .map(|r| r.1)
                    .or_else(|| counts.last().copied().flatten()),
                problems,
                children: vec![],
            });
        }
        if children.is_empty() {
            continue;
        }
        if !section.is_empty() && !section.starts_with("Category:") {
            entries.push(QojArchiveEntry {
                kind: "group".into(),
                id: format!("section-{}", entries.len()),
                title: section.clone(),
                url: url.into(),
                contest_count: None,
                solved_count: None,
                problem_count: None,
                problems: vec![],
                children,
            });
        } else {
            entries.extend(children);
        }
    }
    if is_contest && !contest_problems.is_empty() {
        let id = url.rsplit('/').next().unwrap_or_default().to_string();
        entries = vec![QojArchiveEntry {
            kind: "contest".into(),
            id,
            title: title.clone(),
            url: url.into(),
            contest_count: None,
            solved_count: None,
            problem_count: Some(contest_problems.len() as u64),
            problems: contest_problems,
            children: vec![],
        }];
    }
    if entries.is_empty() {
        return Err("QOJ 归档未加载或比赛需要登录，请在 OJ 账号中登录 QOJ 后重试".into());
    }
    Ok(QojArchivePage {
        title,
        url: url.into(),
        entries,
    })
}

fn apply_qoj_standings(html: &str, problems: &mut [QojArchiveProblem]) {
    let doc = Html::parse_document(html);
    let ratio_re = Regex::new(r"(\d+)\s*/\s*(\d+)").unwrap();
    let label_re = Regex::new(r"^([A-Z][A-Z0-9_]*)\b").unwrap();
    // Read only header cells: ordinary team score rows are not totals.
    for cell in doc.select(&Selector::parse("table thead th, table thead td, table th").unwrap()) {
        let text = qoj_text(cell);
        let Some(ratio) = ratio_re.captures(&text) else {
            continue;
        };
        let label = cell
            .select(&Selector::parse("a").unwrap())
            .next()
            .map(qoj_text)
            .and_then(|s| label_re.captures(&s).map(|c| c[1].to_string()))
            .or_else(|| label_re.captures(&text).map(|c| c[1].to_string()));
        if let Some(problem) = problems
            .iter_mut()
            .find(|p| Some(p.label.as_str()) == label.as_deref())
        {
            problem.accepted_teams = ratio[1].parse().ok();
            problem.submitted_teams = ratio[2].parse().ok();
        }
    }
}

fn qoj_capture_html(app: &AppHandle, url: &str, standings: bool) -> Result<String, String> {
    let (port, result_rx) = start_qoj_payload_server()?;
    let script = format!(
        r#"(function(){{
      if(window.__acmQojCatalogCapture)return;window.__acmQojCatalogCapture=true;
      var started=Date.now(),sent=false;
      function send(){{
        if(sent)return;
        var login=/^\/login/.test(location.pathname);
        var ready=document.readyState==='complete'&&document.querySelector('table');
        var ratios=Array.from(document.querySelectorAll('table th,table thead td')).some(function(c){{return /\d+\s*\/\s*\d+/.test(c.textContent);}});
        if(!login&&(!ready||({standings}&&!ratios&&Date.now()-started<15000)))return;
        sent=true;
        fetch('http://127.0.0.1:{port}/result',{{method:'POST',mode:'no-cors',headers:{{'Content-Type':'text/plain'}},body:encodeURIComponent(document.documentElement.outerHTML)}}).catch(function(){{sent=false;}});
      }}
      document.addEventListener('DOMContentLoaded',send);setInterval(send,500);
    }})();"#
    );
    let window = WebviewWindowBuilder::new(
        app,
        next_qoj_webview_label("qoj_catalog"),
        WebviewUrl::External(url.parse().map_err(|e| format!("QOJ 链接无效: {e}"))?),
    )
    .title("QOJ · 正在读取目录")
    .inner_size(980.0, 760.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("创建 QOJ 目录窗口失败: {e}"))?;
    let result = result_rx
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| "QOJ 加载超时，请在 OJ 账号中完成登录或验证后重试".to_string());
    window.destroy().ok();
    result
}

async fn qoj_public_html(url: &str) -> Result<String, String> {
    let response = crate::commands::network_client::builder()
        .0
        .use_native_tls()
        .http1_only()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;
    if let Ok(response) = response {
        if response.url().path().starts_with("/login") {
            return Err("QOJ 页面需要登录".into());
        }
        if response.status().is_success() {
            return response.text().await.map_err(|e| e.to_string());
        }
    }
    // QOJ's CDN sometimes rejects reqwest but accepts the system HTTP client.
    // Keep this bounded, then let the caller use the signed-in browser session.
    let mut command = Command::new("curl");
    command.args([
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "10",
        "-L",
        "-A",
        BROWSER_UA,
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        url,
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = command.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("QOJ 页面需要登录或验证".into());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

async fn qoj_catalog_html(app: AppHandle, url: String, standings: bool) -> Result<String, String> {
    if let Ok(html) = qoj_public_html(&url).await {
        if html.contains("<table") && (!standings || html.contains("/standings")) {
            return Ok(html);
        }
    }
    tauri::async_runtime::spawn_blocking(move || qoj_capture_html(&app, &url, standings))
        .await
        .map_err(|e| e.to_string())?
}

static QOJ_CATALOG_TOTALS: OnceLock<Mutex<HashMap<String, (Instant, u32)>>> = OnceLock::new();

#[tauri::command]
pub async fn fetch_problems_qoj(
    app: AppHandle,
    page: Option<u32>,
    keyword: Option<String>,
) -> Result<QojProblemPage, String> {
    let page = page.unwrap_or(1).max(1);
    let keyword = keyword.unwrap_or_default();
    let keyword = keyword.trim().to_string();
    let url = format!(
        "https://qoj.ac/problems?page={page}&search={}",
        urlencoding::encode(&keyword)
    );
    let totals = QOJ_CATALOG_TOTALS.get_or_init(|| Mutex::new(HashMap::new()));
    let cached = totals
        .lock()
        .await
        .get(&keyword)
        .filter(|(time, _)| time.elapsed() < Duration::from_secs(60))
        .map(|(_, pages)| *pages);
    let mut result = parse_qoj_catalog(&qoj_catalog_html(app.clone(), url, false).await?, page)?;
    // QOJ deliberately shows only a moving window of page links. Its out-of-range
    // page request is clamped to the last page, which gives the real page count.
    let total = if let Some(total) = cached {
        total
    } else {
        let last_url = format!(
            "https://qoj.ac/problems?page=1000000&search={}",
            urlencoding::encode(&keyword)
        );
        let last = parse_qoj_catalog(&qoj_catalog_html(app, last_url, false).await?, 1)?;
        totals
            .lock()
            .await
            .insert(keyword, (Instant::now(), last.page));
        last.page
    };
    result.total_pages = total.max(result.page);
    Ok(result)
}

#[tauri::command]
pub async fn fetch_qoj_archive(
    app: AppHandle,
    url: Option<String>,
) -> Result<QojArchivePage, String> {
    let url = normalized_qoj_archive_url(url.as_deref())?;
    let mut page = parse_qoj_archive(
        &qoj_catalog_html(app.clone(), url.clone(), false).await?,
        &url,
    )?;
    if url.contains("/contest/") {
        if let Ok(html) = qoj_public_html(&format!("{url}/standings")).await {
            if let Some(contest) = page.entries.first_mut() {
                apply_qoj_standings(&html, &mut contest.problems);
            }
        }
        if page
            .entries
            .first()
            .is_some_and(|contest| contest.problems.iter().all(|p| p.submitted_teams.is_none()))
        {
            let app_clone = app.clone();
            let standings_url = format!("{url}/standings");
            if let Ok(Ok(html)) = tauri::async_runtime::spawn_blocking(move || {
                qoj_capture_html(&app_clone, &standings_url, true)
            })
            .await
            {
                if let Some(contest) = page.entries.first_mut() {
                    apply_qoj_standings(&html, &mut contest.problems);
                }
            }
        }
    }
    Ok(page)
}

#[cfg(test)]
mod qoj_catalog_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires network"]
    async fn verifies_live_qoj_public_catalog_and_archive() {
        let catalog = parse_qoj_catalog(
            &qoj_public_html("https://qoj.ac/problems").await.unwrap(),
            1,
        )
        .unwrap();
        // QOJ paginates ID ranges; hidden / removed IDs leave holes in a page.
        assert!((90..=100).contains(&catalog.problems.len()));
        assert_eq!(catalog.problems[0].id, "1");
        let search = parse_qoj_catalog(
            &qoj_public_html("https://qoj.ac/problems?search=Boat")
                .await
                .unwrap(),
            1,
        )
        .unwrap();
        assert!(search.problems.iter().any(|p| p.title == "Boat"));
        assert!(!search.problems.iter().any(|p| p.id == "1"));
        let last = parse_qoj_catalog(
            &qoj_public_html("https://qoj.ac/problems?page=1000000")
                .await
                .unwrap(),
            1,
        )
        .unwrap();
        assert!(last.page > 100);
        let archive = parse_qoj_archive(
            &qoj_public_html("https://qoj.ac/category/18").await.unwrap(),
            "https://qoj.ac/category/18",
        )
        .unwrap();
        assert_eq!(
            archive
                .entries
                .iter()
                .map(|e| e.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Regionals", "Finals"]
        );
        assert!(archive.entries[1]
            .children
            .iter()
            .all(|e| e.kind == "contest"));
    }
    #[test]
    fn parses_official_archive_and_search_pages() {
        let page = parse_qoj_archive(
            include_str!("fixtures/qoj-europe.html"),
            "https://qoj.ac/category/18",
        )
        .unwrap();
        assert_eq!(
            page.entries
                .iter()
                .map(|e| e.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Regionals", "Finals"]
        );
        assert_eq!(page.entries[0].children.len(), 4);
        assert_eq!(page.entries[1].children.len(), 3);
        assert_eq!(page.entries[0].children[0].contest_count, Some(63));
        let catalog = parse_qoj_catalog(include_str!("fixtures/qoj-search.html"), 1).unwrap();
        assert_eq!(catalog.problems.len(), 5);
        assert_eq!(catalog.problems[0].title, "Boat");
        let last = parse_qoj_catalog(include_str!("fixtures/qoj-last-page.html"), 1000000).unwrap();
        assert_eq!(last.page, 243);
    }
    #[test]
    fn mixed_archive_keeps_both_original_sections() {
        let html = r#"<title>Europe - QOJ.ac</title><h2>Category: Europe</h2><h3>Regionals</h3><table><tbody><tr><td><a href='/category/19'>Central Europe</a></td><td></td><td>63</td><td>671</td></tr></tbody></table><h3>Finals</h3><table><tbody><tr><td><a href='/contest/1967'>The 2024 Championship</a></td><td><a href='/contest/1967/problem/1'>A</a></td><td></td><td>11</td></tr></tbody></table>"#;
        let page = parse_qoj_archive(html, "https://qoj.ac/category/18").unwrap();
        assert_eq!(page.entries.len(), 2);
        assert_eq!(page.entries[0].title, "Regionals");
        assert_eq!(page.entries[1].title, "Finals");
        assert_eq!(page.entries[1].children[0].kind, "contest");
    }
    #[test]
    fn standings_match_labels_not_position_and_keep_zero() {
        let mut problems = vec![
            qoj_problem_link("/contest/2/problem/100", "A".into(), "One".into()).unwrap(),
            qoj_problem_link("/contest/2/problem/101", "B".into(), "Two".into()).unwrap(),
        ];
        apply_qoj_standings("<table><thead><tr><th>B<br>0/9</th><th>A<br>25/57</th></tr></thead><tbody><tr><td>A 99/99</td></tr></tbody></table>", &mut problems);
        assert_eq!(problems[0].accepted_teams, Some(25));
        assert_eq!(problems[0].submitted_teams, Some(57));
        assert_eq!(problems[1].accepted_teams, Some(0));
    }
    #[test]
    fn main_catalog_has_no_ratings_and_uses_pagination() {
        let page = parse_qoj_catalog("<table><tbody><tr><td>#1</td><td><a href='/problem/1'>I/O Test</a></td><td>2000</td></tr></tbody></table><ul class='pagination'><li><a href='?page=11'>11</a></li><li><input max='242'></li></ul>", 1).unwrap();
        assert_eq!(page.problems[0].title, "I/O Test");
        assert_eq!(page.problems[0].rating, None);
        assert_eq!(page.total_pages, 242);
        assert!(parse_qoj_catalog("<h2>Login</h2>", 1).is_err());
    }
}
