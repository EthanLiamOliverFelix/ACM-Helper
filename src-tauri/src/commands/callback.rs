use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::time::Duration;

pub(crate) fn callback_server() -> Result<(u16, std::sync::mpsc::Receiver<String>), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动本地回调失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取回调端口失败: {}", e))?
        .port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(180)));
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_line = String::new();
            let _ = reader.read_line(&mut request_line);
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(value) = line
                    .split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                {
                    content_length = value;
                }
            }
            let mut body = vec![0; content_length.min(8 * 1024 * 1024)];
            let _ = reader.read_exact(&mut body);
            let get_payload = request_line
                .split_once("GET /result?")
                .and_then(|(_, rest)| rest.split_once(' ').map(|(value, _)| value));
            let post_payload = request_line
                .starts_with("POST /result ")
                .then(|| String::from_utf8_lossy(&body).into_owned());
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nConnection: close\r\n\r\nOK";
            let _ = stream.write_all(response.as_bytes());
            if let Some(payload) = post_payload {
                let _ = tx.send(payload);
                break;
            } else if let Some(encoded) = get_payload {
                let decoded = urlencoding::decode(encoded)
                    .unwrap_or_else(|_| std::borrow::Cow::Borrowed(encoded))
                    .into_owned();
                let _ = tx.send(decoded);
                break;
            }
        }
    });
    Ok((port, rx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    #[test]
    fn callback_server_decodes_large_unicode_get_payload() {
        let (port, rx) = callback_server().expect("callback server");
        let payload = format!(
            r#"{{"recordId":296017458,"title":"洛谷","cases":"{}"}}"#,
            "AC".repeat(20_000)
        );
        let encoded = urlencoding::encode(&payload);
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect callback");
        write!(
            stream,
            "GET /result?{encoded} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        )
        .expect("write callback");
        let received = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive callback");
        assert_eq!(received, payload);
    }

    #[test]
    fn callback_server_accepts_large_post_payload() {
        let (port, rx) = callback_server().expect("callback server");
        let payload = format!(r#"{{"content":"{}"}}"#, "题解".repeat(30_000));
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect callback");
        write!(
            stream,
            "POST /result HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
            payload.len(),
            payload
        )
        .expect("write callback");
        let received = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive callback");
        assert_eq!(received, payload);
    }

    #[test]
    fn callback_server_ignores_preflight_before_post_payload() {
        let (port, rx) = callback_server().expect("callback server");
        let mut preflight = TcpStream::connect(("127.0.0.1", port)).expect("connect preflight");
        write!(
            preflight,
            "OPTIONS /result HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://www.luogu.com.cn\r\nAccess-Control-Request-Method: POST\r\n\r\n"
        )
        .expect("write preflight");
        let mut response = String::new();
        preflight
            .read_to_string(&mut response)
            .expect("read preflight response");
        assert!(response.contains("Access-Control-Allow-Methods: GET, POST, OPTIONS"));
        assert!(response.contains("Access-Control-Allow-Private-Network: true"));

        let payload = r#"{"content":"题解正文"}"#;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect callback");
        write!(
            stream,
            "POST /result HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
            payload.len(),
            payload
        )
        .expect("write callback");
        let received = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive callback");
        assert_eq!(received, payload);
    }
}
