use crate::commands::callback::callback_server;
use crate::commands::oj::luogu_pid_regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct ActionResult {
    success: bool,
    message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuoguAccountStatus {
    logged_in: bool,
    username: Option<String>,
}

fn validate_account_status(mut status: LuoguAccountStatus) -> LuoguAccountStatus {
    status.username = status.username.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    status
}

#[tauri::command]
pub async fn inspect_luogu_account(app: AppHandle) -> Result<LuoguAccountStatus, String> {
    if let Some(window) = app.get_webview_window("luogu_account_check") {
        let _ = window.destroy();
    }
    let (port, rx) = callback_server()?;
    let script = format!(
        r#"(function() {{
          if (window.__acmAccountInspector) return;
          window.__acmAccountInspector=true;
          function report(value) {{
            if (window.__acmAccountReported) return;
            window.__acmAccountReported=true;
            new Image().src='http://127.0.0.1:{port}/result?'+encodeURIComponent(JSON.stringify(value));
          }}
          function usernameFrom(root) {{
            var data=root&&(root.currentData||root.data||root);
            var candidates=[
              data&&data.currentUser, data&&data.user,
              data&&data.data&&data.data.currentUser, data&&data.data&&data.data.user,
              root&&root.currentUser, root&&root.user
            ];
            for (var i=0;i<candidates.length;i++) {{
              var user=candidates[i];
              if (!user || typeof user!=='object') continue;
              var name=String(user.name||user.username||'').trim();
              if (name) return name;
            }}
            return '';
          }}
          function hasSession(root) {{
            var data=root&&(root.currentData||root.data||root);
            var candidates=[
              data&&data.currentUser, data&&data.user,
              data&&data.data&&data.data.currentUser, data&&data.data&&data.data.user,
              root&&root.currentUser, root&&root.user
            ];
            return candidates.some(function(user) {{
              return Boolean(user && typeof user==='object' && (user.uid||user.id||user.name||user.username));
            }});
          }}
          function usernameFromPage() {{
            try {{
              var context=document.querySelector('script#lentille-context');
              var name=context&&usernameFrom(JSON.parse(context.textContent||'{{}}'));
              if (name) return name;
            }} catch(e) {{}}
            var logout=document.querySelector('a[href="/auth/logout"],a[href^="/auth/logout?"]');
            var link=logout&&document.querySelector('header a[href^="/user/"],nav a[href^="/user/"],a[href^="/user/"][title]');
            if (!link) return '';
            var href=link.getAttribute('href')||'';
            return (link.getAttribute('title')||link.getAttribute('aria-label')||link.textContent||href.split('/user/')[1]||'').trim();
          }}
          var attempts=0;
          async function inspect() {{
            attempts++;
            try {{
              var response=await fetch('/?_contentOnly=1&_t='+Date.now(),{{credentials:'include',cache:'no-store',headers:{{'x-lentille-request':'content-only'}}}});
              var body=await response.json().catch(function(){{return {{}}}});
              var name=usernameFrom(body);
              if (name) {{ report({{loggedIn:true,username:name}}); return; }}
              if (hasSession(body)) {{ report({{loggedIn:true,username:null}}); return; }}
            }} catch(e) {{}}
            var pageName=usernameFromPage();
            if (pageName) {{ report({{loggedIn:true,username:pageName}}); return; }}
            if (document.querySelector('a[href="/auth/logout"],a[href^="/auth/logout?"]')) {{
              report({{loggedIn:true,username:null}}); return;
            }}
            // 新版页面的用户上下文可能晚于 load 注入。不要在第一次空响应时
            // 把有效 Cookie 判成未登录，给页面约 8 秒完成 hydration。
            if (document.readyState==='complete' && attempts>=9) report({{loggedIn:false,username:null}});
          }}
          setInterval(inspect,900); window.addEventListener('load',inspect); inspect();
        }})();"#,
        port = port
    );
    WebviewWindowBuilder::new(
        &app,
        "luogu_account_check",
        // 主动进入官方登录页以触发 WebView2 恢复持久会话；若 Cookie
        // 仍有效，洛谷会返回当前用户上下文或跳转到已登录页面。
        WebviewUrl::External("https://www.luogu.com.cn/auth/login".parse().unwrap()),
    )
    .title("检测洛谷账号")
    .inner_size(1.0, 1.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("无法检测洛谷账号: {e}"))?;
    let payload =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(30)))
            .await
            .map_err(|e| format!("等待洛谷账号检测失败: {e}"))?
            .map_err(|_| "洛谷账号检测超时".to_string());
    if let Some(window) = app.get_webview_window("luogu_account_check") {
        let _ = window.destroy();
    }
    serde_json::from_str(&payload?)
        .map(validate_account_status)
        .map_err(|e| format!("解析洛谷账号失败: {e}"))
}

#[tauri::command]
pub async fn login_luogu_browser(
    app: AppHandle,
    switch_account: Option<bool>,
    current_username: Option<String>,
) -> Result<ActionResult, String> {
    if let Some(window) = app.get_webview_window("luogu_login") {
        let _ = window.destroy();
    }
    let (port, rx) = callback_server()?;
    let switching = switch_account.unwrap_or(false);
    let current_json = serde_json::to_string(current_username.as_deref().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    let script = format!(
        r#"
(function() {{
  if (window.__acmLuoguLoginWatcher) return;
  window.__acmLuoguLoginWatcher = true;
  var switching={switching}, previous={current_json}.toLowerCase(), checking=false;
  var startKey='__acmLuoguSwitchStarted_{port}', sawKey='__acmLuoguSawLogout_{port}';
  function usernameFrom(root) {{
    var data=root&&(root.currentData||root.data||root);
    var candidates=[data&&data.currentUser,data&&data.user,data&&data.data&&data.data.currentUser,data&&data.data&&data.data.user,root&&root.currentUser,root&&root.user];
    for (var i=0;i<candidates.length;i++) {{
      var user=candidates[i];
      if (!user || typeof user!=='object') continue;
      var name=String(user.name||user.username||'').trim();
      if (name) return name;
    }}
    return '';
  }}
  function usernameFromPage() {{
    try {{
      var context=document.querySelector('script#lentille-context');
      var name=context&&usernameFrom(JSON.parse(context.textContent||'{{}}'));
      if (name) return name;
    }} catch(e) {{}}
    var logout=document.querySelector('a[href="/auth/logout"],a[href^="/auth/logout?"]');
    var link=logout&&document.querySelector('header a[href^="/user/"],nav a[href^="/user/"],a[href^="/user/"][title]');
    if (!link) return '';
    var href=link.getAttribute('href')||'';
    return (link.getAttribute('title')||link.getAttribute('aria-label')||link.textContent||href.split('/user/')[1]||'').trim();
  }}
  async function currentUser() {{
    try {{
      var response=await fetch('/?_contentOnly=1&_t='+Date.now(),{{credentials:'include',cache:'no-store',headers:{{'x-lentille-request':'content-only'}}}});
      var body=await response.json().catch(function(){{return {{}}}}), name=usernameFrom(body);
      if (name) return name;
    }} catch(e) {{}}
    return usernameFromPage();
  }}
  async function tick() {{
    if (checking || window.__acmLuoguLoginReported) return;
    checking=true;
    try {{
      if (switching && !sessionStorage.getItem(startKey)) {{
        sessionStorage.setItem(startKey,'1');
        location.replace('/auth/logout');
        return;
      }}
      var username=await currentUser();
      if (!username) {{
        if (switching) {{
          sessionStorage.setItem(sawKey,'1');
          if (!location.pathname.startsWith('/auth/login')) location.replace('/auth/login');
        }}
        return;
      }}
      var changed=!switching || (sessionStorage.getItem(sawKey)==='1' && (!previous || username.toLowerCase()!==previous));
      if (changed) {{
        window.__acmLuoguLoginReported = true;
        sessionStorage.removeItem(startKey); sessionStorage.removeItem(sawKey);
        new Image().src='http://127.0.0.1:{port}/result?'+encodeURIComponent(username);
      }}
    }} finally {{ checking=false; }}
  }}
  setInterval(tick, 800); window.addEventListener('load', tick); tick();
}})();
"#,
        switching = if switching { "true" } else { "false" },
        current_json = current_json
    );
    let start_url = if switching {
        "https://www.luogu.com.cn/"
    } else {
        "https://www.luogu.com.cn/auth/login"
    };
    WebviewWindowBuilder::new(
        &app,
        "luogu_login",
        WebviewUrl::External(start_url.parse().unwrap()),
    )
    .title(if switching {
        "切换洛谷账号 — 请先退出旧账号再登录"
    } else {
        "登录洛谷 — 登录状态将保存在官方 WebView 中"
    })
    .inner_size(980.0, 760.0)
    .center()
    .resizable(true)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("打开洛谷登录窗口失败: {}", e))?;
    let app_thread = app.clone();
    std::thread::spawn(move || match rx.recv_timeout(Duration::from_secs(600)) {
        Ok(username) => {
            let _ = app_thread.emit("luogu-login-success", username);
            if let Some(window) = app_thread.get_webview_window("luogu_login") {
                let _ = window.destroy();
            }
        }
        Err(_) => {
            let _ = app_thread.emit("luogu-login-error", "洛谷登录等待超时".to_string());
        }
    });
    Ok(ActionResult {
        success: true,
        message: "洛谷官方登录页已打开".into(),
    })
}

#[tauri::command]
pub async fn submit_luogu(
    app: AppHandle,
    problem_id: String,
    language: String,
    language_id: u8,
    enable_o2: bool,
    code: String,
    captcha: Option<String>,
) -> Result<String, String> {
    let id_re = luogu_pid_regex(true);
    if !id_re.is_match(problem_id.trim()) {
        return Err("无效的洛谷题号".into());
    }
    validate_luogu_language_id(&language, language_id)?;
    let pid = problem_id.trim().to_uppercase();
    let (port, rx) = callback_server()?;
    let pid_json = serde_json::to_string(&pid).map_err(|e| e.to_string())?;
    let code_json = serde_json::to_string(&code).map_err(|e| e.to_string())?;
    let captcha_json =
        serde_json::to_string(&captcha.unwrap_or_default()).map_err(|e| e.to_string())?;
    let script = format!(
        r#"
(function() {{
  if (window.__acmLuoguSubmitter) return;
  window.__acmLuoguSubmitter = true;
  var pid={pid_json}, code={code_json}, lang={language_id}, enableO2={enable_o2}, captcha={captcha_json}, port={port};
  function report(value) {{
    if (window.__acmLuoguReported) return;
    window.__acmLuoguReported=true;
    new Image().src='http://127.0.0.1:'+port+'/result?'+encodeURIComponent(JSON.stringify(value));
  }}
  function readError(data) {{ return data && (data.errorMessage || data.message || (data.data && data.data.errorMessage)); }}
  function values(value) {{ return Array.isArray(value)?value:Object.values(value||{{}}); }}
  function concreteVerdict(record,status) {{
    if (status!==14 && status!==22 && status!==23) return verdicts[status]||'UKE';
    var detail=record.detail||{{}};
    for (var depth=0;depth<3 && typeof detail==='string';depth++) {{ try {{detail=JSON.parse(detail);}} catch (_) {{detail={{}};break;}} }}
    var judge=detail.judgeResult||detail.judge||record.judgeResult||{{}};
    var subtasks=values(judge.subtasks);
    for (var i=0;i<subtasks.length;i++) {{
      var cases=values(subtasks[i].testCases||subtasks[i].cases);
      for (var j=0;j<cases.length;j++) {{
        var caseStatus=Number(cases[j].status);
        if ([2,3,4,5,6,7,11].indexOf(caseStatus)>=0) return verdicts[caseStatus]||'UKE';
      }}
    }}
    return verdicts[status]||'WA';
  }}
  var rid=0, pollCount=0;
  var verdicts={{0:'WJ',1:'Judging',2:'CE',3:'OLE',4:'MLE',5:'TLE',6:'WA',7:'RE',11:'UKE',12:'AC',14:'WA',21:'AC',22:'WA',23:'WA'}};
  async function captchaImage() {{
    var response=await fetch('/api/verify/captcha?_t='+Date.now(),{{credentials:'include',cache:'no-store'}});
    if (!response.ok) throw new Error('验证码 HTTP '+response.status);
    var blob=await response.blob();
    return await new Promise(function(resolve,reject){{var reader=new FileReader();reader.onload=function(){{resolve(reader.result)}};reader.onerror=reject;reader.readAsDataURL(blob);}});
  }}
  async function submit() {{
    try {{
      var csrf=document.querySelector('meta[name="csrf-token"]');
      if (!csrf) {{ setTimeout(submit,500); return; }}
      var response=await fetch('/fe/api/problem/submit/'+encodeURIComponent(pid),{{
        method:'POST',credentials:'include',headers:{{'Content-Type':'application/json','X-CSRF-Token':csrf.content,'X-Requested-With':'XMLHttpRequest'}},
        body:JSON.stringify({{code:code,lang:lang,enableO2:enableO2?1:0,captcha:captcha||undefined}})
      }});
      var data=await response.json().catch(function(){{return {{}}}});
      var error=readError(data);
      if (!response.ok || error) {{
        var errorDetails=String(error||'')+' '+JSON.stringify(data||{{}});
        if (/验证码|captcha/i.test(errorDetails)) {{ report({{captchaRequired:true,captchaImage:await captchaImage(),error:String(error||'需要验证码')}}); return; }}
        if (String(error||'').indexOf('未登录')>=0 || response.status===401 || response.status===403) {{ report({{error:'洛谷会话未登录或已过期，请重新登录'}}); return; }}
        report({{error:'洛谷拒绝提交：'+(error||('HTTP '+response.status))}}); return;
      }}
      rid=data.rid || (data.data && data.data.rid);
      if (!rid) {{ report({{error:'洛谷已响应，但未返回有效评测记录号'}}); return; }}
      setTimeout(pollRecord,700);
    }} catch(error) {{ report({{error:'洛谷提交请求失败：'+error.message}}); }}
  }}
  async function pollRecord() {{
    pollCount++;
    try {{
      var response=await fetch('/record/'+rid+'?_contentOnly=1&_t='+Date.now(),{{
        credentials:'include',cache:'no-store',headers:{{'X-Requested-With':'XMLHttpRequest','x-lentille-request':'content-only'}}
      }});
      var body=await response.json().catch(function(){{return {{}}}});
      var data=body.data || body.currentData || {{}};
      var record=data.record || (data.data && data.data.record);
      if (!response.ok || !record) {{
        if (pollCount<110) {{setTimeout(pollRecord,1500);return;}}
        report({{error:'无法读取洛谷评测记录 '+rid}});return;
      }}
      var status=Number(record.status);
      if ((status===0 || status===1) && pollCount<110) {{setTimeout(pollRecord,1500);return;}}
      // 洛谷记录接口的 memory 单位为 KiB；前端 Submission 统一使用字节。
      report({{status:concreteVerdict(record,status),rid:rid,time:Number(record.time)||0,memory:(Number(record.memory)||0)*1024,score:Number(record.score)||0}});
    }} catch(error) {{
      if (pollCount<110) {{setTimeout(pollRecord,1800);return;}}
      report({{error:'轮询洛谷评测失败：'+error.message}});
    }}
  }}
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',submit); else submit();
}})();
"#,
        pid_json = pid_json,
        code_json = code_json,
        language_id = language_id,
        enable_o2 = if enable_o2 { "true" } else { "false" },
        captcha_json = captcha_json,
        port = port
    );
    if let Some(window) = app.get_webview_window("luogu_submit") {
        let _ = window.destroy();
    }
    WebviewWindowBuilder::new(
        &app,
        "luogu_submit",
        WebviewUrl::External(
            format!("https://www.luogu.com.cn/problem/{}", pid)
                .parse()
                .unwrap(),
        ),
    )
    .title(format!("洛谷提交 {}", pid))
    .inner_size(1.0, 1.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("创建洛谷提交窗口失败: {}", e))?;
    let result =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(240)))
            .await
            .map_err(|e| format!("等待洛谷结果失败: {}", e))?
            .map_err(|_| "洛谷提交或评测超时（240 秒），请到洛谷评测记录确认状态".to_string())?;
    if let Some(window) = app.get_webview_window("luogu_submit") {
        let _ = window.destroy();
    }
    Ok(result)
}

fn validate_luogu_language_id(language: &str, language_id: u8) -> Result<(), String> {
    let supported = match language {
        "cpp" => matches!(language_id, 3 | 4 | 11 | 12 | 27 | 28 | 34),
        "python" => matches!(language_id, 7 | 25),
        "java" => matches!(language_id, 8 | 33),
        _ => return Err(format!("洛谷不支持的语言: {language}")),
    };
    if supported {
        Ok(())
    } else {
        Err(format!(
            "所选洛谷语言版本与当前代码语言不匹配: {language_id}"
        ))
    }
}

#[tauri::command]
pub async fn fetch_luogu_record_detail(app: AppHandle, rid: u64) -> Result<String, String> {
    if rid == 0 {
        return Err("无效的洛谷评测记录号".into());
    }
    if let Some(window) = app.get_webview_window("luogu_record_detail") {
        let _ = window.destroy();
    }
    let (port, rx) = callback_server()?;
    let script = format!(
        r#"
(function() {{
  if (window.__acmRecordReader) return;
  window.__acmRecordReader=true;
  var sent=false, attempts=0, port={port}, expectedRid={rid};
  var verdicts={{0:'WJ',1:'Judging',2:'CE',3:'OLE',4:'MLE',5:'TLE',6:'WA',7:'RE',11:'UKE',12:'AC',14:'WA',21:'AC',22:'WA',23:'WA'}};
  function num(value, fallback) {{ var result=Number(value); return Number.isFinite(result)?result:(fallback||0); }}
  function values(value) {{ return Array.isArray(value)?value:Object.values(value||{{}}); }}
  function report(value) {{
    if (sent) return; sent=true;
    var callbackImage=new Image();
    callbackImage.src='http://127.0.0.1:'+port+'/result?'+encodeURIComponent(JSON.stringify(value));
    window.__acmRecordCallbackImage=callbackImage;
  }}
  async function read() {{
    attempts++;
    try {{
      var response=await fetch('/record/'+expectedRid+'?_contentOnly=1&_t='+Date.now(),{{credentials:'include',cache:'no-store',headers:{{'X-Requested-With':'XMLHttpRequest','x-lentille-request':'content-only'}}}});
      if (response.status===401 || response.status===403 || (response.redirected && /\/auth\//.test(response.url))) {{ report({{error:'洛谷会话未登录或已过期，请先在设置中登录'}}); return; }}
      var root=await response.json().catch(function(){{return null;}});
      if (!response.ok || !root) {{
        if (attempts<8) {{ setTimeout(read,700); return; }}
        report({{error:'洛谷记录接口返回异常（HTTP '+response.status+'）'}}); return;
      }}
      var data=root.currentData||(root.data&&root.data.currentData)||root.data||root;
      var record=data.record||(data.data&&data.data.record);
      if (!record) {{
        var message=root.errorMessage||root.message||(root.data&&root.data.errorMessage);
        report({{error:message?String(message):'无法读取洛谷记录，记录可能无权访问'}}); return;
      }}
      var detail=record.detail||{{}};
      for (var depth=0; depth<3 && typeof detail==='string'; depth++) {{ try {{ detail=JSON.parse(detail); }} catch (_) {{ detail={{}}; break; }} }}
      var judge=detail.judgeResult||detail.judge||record.judgeResult||{{}};
      var subtasks=values(judge.subtasks).map(function(subtask, subtaskIndex) {{
        var cases=subtask.testCases||subtask.cases||{{}};
        return {{
          id:num(subtask.id,subtaskIndex),status:num(subtask.status),score:num(subtask.score),
          testCases:values(cases).map(function(testcase,testcaseIndex) {{
            var rawId=testcase.id===undefined?testcaseIndex:num(testcase.id);
            return {{id:rawId+1,status:num(testcase.status),verdict:verdicts[num(testcase.status)]||'UKE',score:num(testcase.score),timeMs:num(testcase.time),memoryBytes:num(testcase.memory)*1024,description:testcase.description?String(testcase.description):undefined,signal:num(testcase.signal),exitCode:num(testcase.exitCode)}};
          }})
        }};
      }});
      var problem=record.problem||data.problem||{{}};
      var compile=detail.compileResult||detail.compile||null;
      report({{recordId:num(record.id,expectedRid),problemId:String(problem.pid||record.pid||''),problemTitle:String(problem.name||record.problemName||''),status:num(record.status),score:record.score==null?undefined:num(record.score),submitTime:record.submitTime==null?undefined:num(record.submitTime)*1000,language:record.language,sourceCodeLength:record.sourceCodeLength==null?undefined:num(record.sourceCodeLength),timeMs:record.time==null?undefined:num(record.time),memoryBytes:record.memory==null?undefined:num(record.memory)*1024,compileSuccess:compile==null?undefined:!!compile.success,compileMessage:compile&&compile.message?String(compile.message):undefined,subtasks:subtasks}});
    }} catch(error) {{ report({{error:'解析洛谷记录失败：'+error.message}}); }}
  }}
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',read); else read();
}})();
"#,
        port = port,
        rid = rid
    );
    WebviewWindowBuilder::new(
        &app,
        "luogu_record_detail",
        WebviewUrl::External(
            format!("https://www.luogu.com.cn/record/{}", rid)
                .parse()
                .map_err(|e| format!("记录链接无效: {}", e))?,
        ),
    )
    .title(format!("读取洛谷记录 R{}", rid))
    .inner_size(1.0, 1.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("创建洛谷记录窗口失败: {}", e))?;
    let result =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(50)))
            .await
            .map_err(|e| format!("等待洛谷记录失败: {}", e))?
            .map_err(|_| "读取洛谷记录超时，请确认登录状态后重试".to_string());
    if let Some(window) = app.get_webview_window("luogu_record_detail") {
        let _ = window.destroy();
    }
    result
}

#[tauri::command]
pub async fn find_luogu_record_id(
    app: AppHandle,
    problem_id: String,
    username: String,
    submitted_at: u64,
) -> Result<u64, String> {
    let id_re = luogu_pid_regex(true);
    if !id_re.is_match(problem_id.trim()) || username.trim().is_empty() {
        return Err("缺少可用于查找旧记录的洛谷账号或题号".into());
    }
    if let Some(window) = app.get_webview_window("luogu_record_finder") {
        let _ = window.destroy();
    }
    let (port, rx) = callback_server()?;
    let pid = problem_id.trim().to_uppercase();
    let pid_json = serde_json::to_string(&pid).map_err(|e| e.to_string())?;
    let script = format!(
        r#"(function(){{
          if(window.__acmRecordFinder)return;window.__acmRecordFinder=true;
          var attempts=0,pid={pid_json},target={submitted_at};
          function report(value){{new Image().src='http://127.0.0.1:{port}/result?'+encodeURIComponent(String(value));}}
          function read(){{attempts++;try{{
            var node=document.querySelector('script#lentille-context');
            if(!node){{if(attempts<80)setTimeout(read,500);else report('0');return;}}
            var root=JSON.parse(node.textContent||'{{}}'),data=root.currentData||root.data||root;
            var holder=data.records||data.recordList||{{}},list=holder.result||holder.records||holder;
            if(!Array.isArray(list))list=Object.values(list||{{}});
            list=list.filter(function(item){{var problem=item.problem||{{}};return String(problem.pid||item.pid||'').toUpperCase()===pid;}});
            list.sort(function(a,b){{var at=Number(a.submitTime||a.time||0)*1000,bt=Number(b.submitTime||b.time||0)*1000;return Math.abs(at-target)-Math.abs(bt-target);}});
            report(list.length?Number(list[0].id||list[0].rid||0):0);
          }}catch(_){{report('0');}}}};
          if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',read);else read();
        }})();"#,
        pid_json = pid_json,
        submitted_at = submitted_at,
        port = port
    );
    let url = format!(
        "https://www.luogu.com.cn/record/list?user={}&pid={}",
        urlencoding::encode(username.trim()),
        urlencoding::encode(&pid)
    );
    WebviewWindowBuilder::new(
        &app,
        "luogu_record_finder",
        WebviewUrl::External(
            url.parse()
                .map_err(|e| format!("记录列表链接无效: {}", e))?,
        ),
    )
    .title("查找洛谷历史记录")
    .inner_size(1.0, 1.0)
    .visible(false)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("创建洛谷记录查找窗口失败: {}", e))?;
    let payload =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(50)))
            .await
            .map_err(|e| format!("等待洛谷记录查找失败: {}", e))?
            .map_err(|_| "查找洛谷历史记录超时".to_string())?;
    if let Some(window) = app.get_webview_window("luogu_record_finder") {
        let _ = window.destroy();
    }
    let rid = payload.parse::<u64>().unwrap_or(0);
    if rid == 0 {
        Err("未在当前洛谷账号下找到对应的历史提交".into())
    } else {
        Ok(rid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_luogu_pid_and_current_language_ids() {
        let re = luogu_pid_regex(true);
        assert!(re.is_match("P1001"));
        assert!(re.is_match("U123456"));
        assert!(re.is_match("CF1A"));
        assert!(re.is_match("CF1234A2"));
        assert!(re.is_match("AT_ABC001_1"));
        assert!(re.is_match("UVA100"));
        assert!(!re.is_match("../P1001"));
        for id in [3, 4, 11, 12, 27, 28, 34] {
            assert!(validate_luogu_language_id("cpp", id).is_ok());
        }
        for id in [7, 25] {
            assert!(validate_luogu_language_id("python", id).is_ok());
        }
        assert!(validate_luogu_language_id("java", 33).is_ok());
        assert!(validate_luogu_language_id("cpp", 25).is_err());
        assert!(validate_luogu_language_id("python", 34).is_err());
    }

    #[test]
    fn account_session_does_not_require_username_metadata() {
        let empty = validate_account_status(LuoguAccountStatus {
            logged_in: true,
            username: Some("  ".into()),
        });
        assert!(empty.logged_in);
        assert!(empty.username.is_none());
        let valid = validate_account_status(LuoguAccountStatus {
            logged_in: true,
            username: Some(" example_user ".into()),
        });
        assert!(valid.logged_in);
        assert_eq!(valid.username.as_deref(), Some("example_user"));
    }
}
