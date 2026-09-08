use reqwest::{Client, ClientBuilder, Proxy};

fn normalize_proxy_server(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let selected = if value.contains('=') {
        let entries = value.split(';').filter_map(|entry| entry.split_once('='));
        let mut https = None;
        let mut http = None;
        for (scheme, address) in entries {
            match scheme.trim().to_ascii_lowercase().as_str() {
                "https" => https = Some(address.trim()),
                "http" => http = Some(address.trim()),
                _ => {}
            }
        }
        https.or(http)?
    } else {
        value
    };
    if selected.contains("://") {
        Some(selected.to_string())
    } else {
        Some(format!("http://{selected}"))
    }
}

fn environment_proxy() -> Option<String> {
    [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .into_iter()
    .find_map(|name| {
        std::env::var(name)
            .ok()
            .and_then(|value| normalize_proxy_server(&value))
    })
}

#[cfg(target_os = "windows")]
fn windows_proxy() -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let settings = current_user
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enabled: u32 = settings.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }
    let server: String = settings.get_value("ProxyServer").ok()?;
    normalize_proxy_server(&server)
}

#[cfg(not(target_os = "windows"))]
fn windows_proxy() -> Option<String> {
    None
}

/// Build a reqwest client that honors explicit proxy environment variables and
/// the Windows user proxy used by browsers. The boolean only indicates whether
/// an explicit proxy was successfully attached and never exposes credentials.
pub fn builder() -> (ClientBuilder, bool) {
    let builder = Client::builder();
    let Some(proxy_url) = environment_proxy().or_else(windows_proxy) else {
        return (builder, false);
    };
    match Proxy::all(proxy_url) {
        Ok(proxy) => (builder.proxy(proxy), true),
        Err(_) => (builder, false),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_proxy_server;

    #[test]
    fn normalizes_plain_windows_proxy() {
        assert_eq!(
            normalize_proxy_server("127.0.0.1:7897").as_deref(),
            Some("http://127.0.0.1:7897")
        );
    }

    #[test]
    fn selects_https_then_http_from_per_protocol_proxy() {
        assert_eq!(
            normalize_proxy_server("http=127.0.0.1:8080;https=127.0.0.1:8443").as_deref(),
            Some("http://127.0.0.1:8443")
        );
        assert_eq!(
            normalize_proxy_server("http=127.0.0.1:8080").as_deref(),
            Some("http://127.0.0.1:8080")
        );
    }
}
