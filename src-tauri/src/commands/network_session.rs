use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::Mutex;

/// Visible third-party WebViews run outside the main application process. A
/// broken page can therefore be terminated without blocking unrelated OJ or
/// AI requests in the main process.
#[derive(Default)]
pub struct IsolatedWebSessions {
    children: Mutex<HashMap<String, Child>>,
}

impl IsolatedWebSessions {
    pub fn open(&self, platform: &str, url: &str, title: &str) -> Result<(), String> {
        validate_session_url(platform, url)?;
        self.stop(platform)?;
        let executable =
            std::env::current_exe().map_err(|error| format!("无法定位登录窗口程序: {error}"))?;
        let child = Command::new(executable)
            .arg("--isolated-webview")
            .arg(platform)
            .arg(url)
            .arg(title)
            .spawn()
            .map_err(|error| format!("无法启动独立 {title} 进程: {error}"))?;
        self.children
            .lock()
            .map_err(|_| "网络窗口状态已损坏".to_string())?
            .insert(platform.to_string(), child);
        Ok(())
    }

    pub fn stop(&self, platform: &str) -> Result<(), String> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| "网络窗口状态已损坏".to_string())?;
        if let Some(mut child) = children.remove(platform) {
            if child
                .try_wait()
                .map_err(|error| format!("无法查询网络窗口状态: {error}"))?
                .is_none()
            {
                child
                    .kill()
                    .map_err(|error| format!("无法结束网络窗口进程: {error}"))?;
                let _ = child.wait();
            }
        }
        Ok(())
    }

    pub fn is_running(&self, platform: &str) -> Result<bool, String> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| "网络窗口状态已损坏".to_string())?;
        let Some(child) = children.get_mut(platform) else {
            return Ok(false);
        };
        match child
            .try_wait()
            .map_err(|error| format!("无法查询网络窗口状态: {error}"))?
        {
            None => Ok(true),
            Some(_) => {
                children.remove(platform);
                Ok(false)
            }
        }
    }
}

impl Drop for IsolatedWebSessions {
    fn drop(&mut self) {
        if let Ok(children) = self.children.get_mut() {
            for (_, child) in children.iter_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

pub fn validate_session_url(platform: &str, url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("网络窗口地址无效: {error}"))?;
    let expected_host = match platform {
        "atcoder" => "atcoder.jp",
        "codeforces" => "codeforces.com",
        "luogu" => "www.luogu.com.cn",
        "qoj" => "qoj.ac",
        _ => return Err("不支持的网络窗口平台".into()),
    };
    if parsed.scheme() != "https" || parsed.host_str() != Some(expected_host) {
        return Err(format!("拒绝打开非 {expected_host} 官方页面"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_session_url;

    #[test]
    fn isolated_sessions_accept_only_official_https_hosts() {
        assert!(validate_session_url("atcoder", "https://atcoder.jp/login").is_ok());
        assert!(validate_session_url("atcoder", "https://evil.example/atcoder.jp").is_err());
        assert!(validate_session_url("atcoder", "http://atcoder.jp/login").is_err());
    }
}
